import {z} from 'zod';
import type {ExactQuantity} from './inventory-consumption-contract';
import {D1PurchasingSuppliers} from './d1-purchasing-suppliers';
import {D1ReplenishmentReview} from './d1-replenishment-review';
import {D1ReplenishmentSalesReadiness} from './d1-replenishment-sales-readiness';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import {SupplierRegistryError,type MappingVersion} from './purchasing-supplier-contract';
import {frozenCopy} from './supplier-simulation-contract';

// Recalculates restocking suggestions for one supplier-list group (supplier, account, delivery
// location) from current stock, counted in each mapping's own pack. Read-only: nothing is saved,
// reserved or sent. The result is draft-ready whole packs plus the items held for review.
const id=z.string().trim().min(1).max(200);
export const supplierSuggestionsSchema=z.object({companyId:id,supplierId:id,accountId:id,locationId:id}).strict();
const MANAGER_ROLE="SELECT role FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager')";
const MAX_MAPPINGS=250;
/** Shown with a line: the numbers are usable, but a person should look first. */
export type SuggestionAttention='stale_count'|'minimum_exceeds_limit'|'order_multiple_exceeds_limit';
/** Why an item gets no line. */
export type SuggestionHold='mapping_needs_review'|'duplicate_product'|'opening_count_required'|'expired_stock'|'settings_missing'|'exact_inventory_missing'
  |'settings_stale'|'invalid_balance'|'pack_unclassified'|'source_changed'|'pack_policy_unconvertible';
const ATTENTION=new Set<string>(['stale_count','minimum_exceeds_limit','order_multiple_exceeds_limit']);
export class SupplierSuggestionError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'conflict',message:string){super(message);this.name='SupplierSuggestionError';}
}
const fail=(code:SupplierSuggestionError['code'],message:string):never=>{throw new SupplierSuggestionError(code,message);};

export class D1SupplierSuggestions {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;clock?:{now():Date};salesPolicy:CloverReviewPolicy}){}
  private async actor(companyId:string){
    const userId=await this.options.identity();
    const row=userId?await this.db.prepare(MANAGER_ROLE).bind(companyId,userId).first<{role:'owner'|'manager'}>():null;
    if(!userId||!row)fail('forbidden','Manager or owner membership is required.');
    return {companyId,userId:userId!,role:row!.role};
  }
  async suggest(value:unknown){
    const parsed=supplierSuggestionsSchema.safeParse(value);
    if(!parsed.success)fail('invalid_request','Choose a supplier, account and delivery location.');
    const input=parsed.data!,actor=await this.actor(input.companyId),calculatedAt=(this.options.clock?.now()??new Date()).toISOString();
    const registry=new D1PurchasingSuppliers(this.db,{identity:async()=>actor.userId,clock:this.options.clock});
    let profile;
    try{
      profile=await registry.profile(input.companyId,input.supplierId);
      await registry.draftSources(input.companyId,input.supplierId,profile.version,input.accountId,input.locationId,[]);
    }catch(error){
      if(error instanceof SupplierRegistryError)fail(error.code==='missing'?'missing':error.code==='forbidden'?'forbidden':'conflict','This supplier, account or delivery location is not active.');
      throw error;
    }
    const rows=(await this.db.prepare(`SELECT id FROM purchasing_mappings WHERE company_id=? AND supplier_id=? AND account_id=? AND location_id=? AND status='active'
      ORDER BY id LIMIT ?`).bind(input.companyId,input.supplierId,input.accountId,input.locationId,MAX_MAPPINGS+1).all<{id:string}>()).results;
    if(rows.length>MAX_MAPPINGS)fail('invalid_request',`Suggestions support up to ${MAX_MAPPINGS} items per supplier.`);
    const held:{mappingId:string;productId:string|null;description:string;reason:SuggestionHold}[]=[];
    const mappings:MappingVersion[]=[];
    for(const row of rows){
      try{mappings.push((await registry.projection(input.companyId,row.id)).mapping);}
      catch(error){if(!(error instanceof SupplierRegistryError))throw error;held.push({mappingId:row.id,productId:null,description:row.id,reason:'mapping_needs_review'});}
    }
    // A draft holds one line per product, so a product mapped twice in one group needs a person to choose.
    const counts=new Map<string,number>();for(const m of mappings)counts.set(m.productId,(counts.get(m.productId)??0)+1);
    const review=new D1ReplenishmentReview(this.db,{clock:this.options.clock});
    const lines=[],notNeeded:{mappingId:string;productId:string;description:string}[]=[];
    for(const m of mappings){
      if(counts.get(m.productId)!>1){held.push({mappingId:m.id,productId:m.productId,description:m.description,reason:'duplicate_product'});continue;}
      const result=await review.buildWithClover({companyId:input.companyId,productId:m.productId,actor,priceEstimate:null,supplierPack:m.stockUnitsPerPack,
        supplier:{companyId:input.companyId,source:'manual_registry',mappingId:m.id,mappingVersion:m.version,supplierId:m.supplierId,accountId:m.accountId,locationId:m.locationId,sku:m.sku}},
        this.options.salesPolicy);
      if(result.kind==='unavailable'){held.push({mappingId:m.id,productId:m.productId,description:m.description,reason:result.reason});continue;}
      const s=result.snapshot,reasons=s.explanation.reviewReasons as readonly string[],packs=s.explanation.recommendedPacks;
      if(packs==='0'){
        const blocked=(['opening_count_required','expired_stock'] as const).find(r=>reasons.includes(r));
        if(blocked)held.push({mappingId:m.id,productId:m.productId,description:m.description,reason:blocked});
        else notNeeded.push({mappingId:m.id,productId:m.productId,description:m.description});
        continue;
      }
      lines.push({mappingId:m.id,mappingVersion:m.version,productId:m.productId,sku:m.sku,description:m.description,unitLabel:m.unitLabel,packs,
        stockUnitsPerPack:m.stockUnitsPerPack,estimatedUnitMinor:m.estimatedUnitMinor,
        estimatedLineMinor:m.estimatedUnitMinor===null?null:(BigInt(m.estimatedUnitMinor)*BigInt(packs)).toString(),
        explanation:{target:s.quantities.target as ExactQuantity,onHand:s.quantities.onHand as ExactQuantity,incoming:s.quantities.incoming as ExactQuantity,
          shortfall:s.explanation.shortfall,wantedPacks:s.explanation.wantedPacks,limitedBy:[...s.explanation.limitedBy]},
        attention:reasons.filter(r=>ATTENTION.has(r)) as SuggestionAttention[]});
    }
    // Sales readiness is company-wide, so it is reported once; the caller decides whether to draft.
    const sales=await new D1ReplenishmentSalesReadiness(this.db,{...this.options.salesPolicy,clock:this.options.clock}).read(input.companyId,actor);
    if(!await this.db.prepare(MANAGER_ROLE).bind(input.companyId,actor.userId).first())fail('forbidden','Session changed during the suggestion.');
    return frozenCopy({companyId:input.companyId,supplier:{id:profile!.id,version:profile!.version,name:profile!.profile.name},accountId:input.accountId,
      locationId:input.locationId,calculatedAt,sales:{status:sales.status,reasons:[...sales.reasons],heldEventCount:sales.heldEventCount},lines,held,notNeeded});
  }
}
