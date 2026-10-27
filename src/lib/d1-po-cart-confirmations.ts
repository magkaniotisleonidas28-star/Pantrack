import {z} from 'zod';
import {D1PoCartJobs} from './d1-po-cart-jobs';
import {D1InventoryManagementService,InventoryManagementError} from './d1-inventory-management';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import {approveOverCapSchema,computeConfirmation,confirmationFail as fail,confirmationQuerySchema,confirmedIncoming,holdOverCapSchema,recordConfirmationSchema,
  type ConfirmationReceipt,type ConfirmationState,type ConfirmedLine,type LimitWarning,type ReviewReceipt} from './po-cart-confirmation-contract';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import type {PreparationPreflight} from './po-cart-preparation-contract';
import {recentlyVerified,type ReauthenticationState} from './reauthentication';
import {spendingWindow,usageSql} from './po-cart-spending-limits-contract';
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
type Row={id:string;job_id:string;authorization_id:string;supplier_reference:string;lines_json:string;extras_json:string;charges_json:string;item_subtotal_minor:number;
  charges_minor:number;total_minor:number;cap_minor:number;expected_delivery:string;state:ConfirmationState;note:string;actor:string;created_at:string;
  fingerprint:string;receipt_json:string};
type Review={id:string;kind:'approved'|'note';approved_total_minor:number|null;note:string;actor:string;created_at:string;operation_id:string;fingerprint:string};

/**
 * Manager-entered supplier confirmations. Within the cap, one batch records the confirmation,
 * adds order-linked incoming through A's port and releases the order's product commitments.
 * Over-cap totals are recorded for owner review with no stock effect. Either way the account's
 * cart ownership ends. The spending reservation stays held until delivery reconciliation.
 * An owner approves an over-cap total after confirming their password: the held amount rises to
 * it and the incoming stock is added in the same batch. Otherwise the order stays held, with notes.
 */
export class D1PoCartConfirmations {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;clock?:{now():Date};salesPolicy?:CloverReviewPolicy;
    reauthentication?:()=>Promise<ReauthenticationState|null>}) {}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  private parse<T>(schema:z.ZodType<T>,value:unknown):T {
    const parsed=schema.safeParse(value);
    if(!parsed.success)fail('invalid_request',parsed.error.issues.find(i=>i.code==='custom')?.message??'Enter the supplier order number, delivery date and every line in whole packs and cents.');
    return parsed.data;
  }
  private async actor(companyId:string){
    const actor=await this.options.identity();
    if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(companyId,actor).first())fail('forbidden','Current owner or manager membership is required.');
    return actor;
  }
  private jobs(){return new D1PoCartJobs(this.db,this.options);}
  private async owner(companyId:string){
    const actor=await this.options.identity();
    if(!actor||!await this.db.prepare("SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner'").bind(companyId,actor).first())
      fail('forbidden','Only the company owner can review an over-cap confirmation.');
    return actor!;
  }
  private reviews(companyId:string,confirmationId:string){
    return this.db.prepare('SELECT * FROM po_cart_confirmation_reviews WHERE company_id=? AND confirmation_id=? ORDER BY created_at,id').bind(companyId,confirmationId).all<Review>();
  }
  /** What approving the full total would do to each owner limit, including the order's own day and month. */
  private async warnings(companyId:string,row:Row):Promise<LimitWarning[]>{
    const increase=row.total_minor-row.cap_minor,warnings:LimitWarning[]=[];
    const policy=await this.db.prepare('SELECT per_order_minor,per_day_minor,per_month_minor,outstanding_minor,actor FROM po_cart_budget_policies WHERE company_id=? ORDER BY version DESC LIMIT 1')
      .bind(companyId).first<{per_order_minor:number;per_day_minor:number|null;per_month_minor:number|null;outstanding_minor:number;actor:string|null}>();
    if(!policy)return warnings;
    const over=(limit:LimitWarning['limit'],limitMinor:number|null,projected:number)=>{if(limitMinor!==null&&projected>limitMinor)warnings.push({limit,limitMinor,overByMinor:projected-limitMinor});};
    over('per_order',policy.per_order_minor,row.total_minor);
    const used=async(sql:string,...args:unknown[])=>Number((await this.db.prepare(sql).bind(...args).first<{used:number}>())?.used??0);
    if(policy.actor){
      const zone=await this.db.prepare('SELECT version,time_zone FROM company_time_zones WHERE company_id=? ORDER BY version DESC LIMIT 1').bind(companyId).first<{version:number;time_zone:string}>();
      const a=await this.db.prepare('SELECT created_at FROM po_cart_authorizations WHERE company_id=? AND id=?').bind(companyId,row.authorization_id).first<{created_at:string}>();
      if(zone&&a){
        const w=spendingWindow(a.created_at,zone.time_zone,zone.version),day=usageSql('day'),month=usageSql('month');
        over('per_day',policy.per_day_minor,await used(day.sql,companyId,...day.keys.map(k=>w[k]))+increase);
        over('per_month',policy.per_month_minor,await used(month.sql,companyId,...month.keys.map(k=>w[k]))+increase);
      }
    }
    over('in_progress',policy.outstanding_minor,await used("SELECT COALESCE(SUM(total_minor),0) AS used FROM po_cart_reservations WHERE company_id=? AND state='reserved'",companyId)+increase);
    return warnings;
  }
  private async replay(companyId:string,operationId:string,fingerprint:string):Promise<ConfirmationReceipt|null>{
    const row=await this.db.prepare('SELECT fingerprint,receipt_json FROM po_cart_confirmations WHERE company_id=? AND operation_id=?')
      .bind(companyId,operationId).first<{fingerprint:string;receipt_json:string}>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another confirmation or actor.');
    return frozenCopy(JSON.parse(row.receipt_json) as ConfirmationReceipt);
  }
  async get(value:unknown){
    const input=this.parse(confirmationQuerySchema,value),actor=await this.actor(input.companyId);
    const status=await this.jobs().get(input);
    const row=await this.db.prepare('SELECT * FROM po_cart_confirmations WHERE company_id=? AND job_id=?').bind(input.companyId,input.jobId).first<Row>();
    const incoming=row?await new D1InventoryManagementService(this.db,this.options).orderIncoming(input.companyId,row.id):[];
    const reviews=row?(await this.reviews(input.companyId,row.id)).results:[],approval=reviews.find(r=>r.kind==='approved')??null;
    const warnings=row?.state==='needs_owner_review'&&!approval?await this.warnings(input.companyId,row):[];
    const isOwner=!!await this.db.prepare("SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner'").bind(input.companyId,actor).first();
    if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during confirmation read.');
    const preflight=status.job.inputs.preflight;
    return frozenCopy({job:{id:status.job.id,revision:status.job.revision,state:status.job.state},capMinor:preflight.capMinor,
      authorizedLines:preflight.lines.map(l=>({lineId:l.lineId,kind:l.kind,sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,unitMinor:l.unitMinor})),
      confirmation:row?{id:row.id,supplierReference:row.supplier_reference,lines:JSON.parse(row.lines_json),extras:JSON.parse(row.extras_json),
        charges:JSON.parse(row.charges_json),itemSubtotalMinor:row.item_subtotal_minor,chargesMinor:row.charges_minor,totalMinor:row.total_minor,
        capMinor:row.cap_minor,expectedDelivery:row.expected_delivery,state:row.state,note:row.note,actor:row.actor,createdAt:row.created_at,
        approval:approval&&{by:approval.actor,at:approval.created_at,totalMinor:approval.approved_total_minor!,note:approval.note},
        notes:reviews.filter(r=>r.kind==='note').map(r=>({by:r.actor,at:r.created_at,note:r.note})),warnings,canReview:isOwner&&row.state==='needs_owner_review'&&!approval}:null,
      incoming:incoming.map(r=>({lineId:r.lineId,productId:r.productId,dimension:r.dimension,quantityMinor:r.quantityMinor,receivedMinor:r.receivedMinor}))});
  }
  async record(value:unknown){
    const input=this.parse(recordConfirmationSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return {receipt:prior};
    const status=await this.jobs().get({companyId:input.companyId,jobId:input.jobId}),job=status.job,a=status.authorization.authorization;
    if(job.state!=='ready'||job.revision!==input.expectedJobRevision)fail('conflict','Only a ready, verified cart can be confirmed. Refresh and try again.');
    if(!a||a.status!=='authorized'||a.releasedAt!==null||status.authorization.reservation?.state!=='reserved')fail('conflict','Preparation permission or its spending reservation changed.');
    if(await this.db.prepare('SELECT 1 FROM po_cart_confirmations WHERE company_id=? AND job_id=?').bind(input.companyId,input.jobId).first())
      fail('conflict','A supplier confirmation is already recorded for this order.');
    if(await this.db.prepare('SELECT 1 FROM po_cart_confirmations WHERE company_id=? AND supplier_id=? AND account_id=? AND supplier_reference=?')
      .bind(input.companyId,job.supplierId,job.accountId,input.supplierReference).first())fail('conflict','That supplier order number is already recorded for this account.');
    const c=computeConfirmation(job.inputs.preflight,input),id=crypto.randomUUID(),at=this.now();
    const receipt:ConfirmationReceipt={operationId:input.operationId,confirmationId:id,jobId:job.id,state:c.state,at};
    let effects:D1PreparedStatement[]=[];
    if(c.state==='confirmed'){
      try{
        if(c.incoming.length)effects=await new D1InventoryManagementService(this.db,this.options).orderIncomingStatements({companyId:input.companyId,confirmationId:id,actor,lines:c.incoming});
      }catch(error){if(error instanceof InventoryManagementError)fail('conflict','Inventory for a confirmed item changed or needs attention: '+error.message);throw error;}
      effects.push(this.db.prepare('UPDATE po_cart_commitments SET active=0 WHERE company_id=? AND authorization_id=? AND active=1').bind(input.companyId,a.id));
    }
    const insert=this.db.prepare(`INSERT INTO po_cart_confirmations(company_id,id,job_id,job_revision,authorization_id,authorization_revision,order_id,supplier_id,account_id,
      supplier_reference,currency,lines_json,extras_json,charges_json,item_subtotal_minor,charges_minor,total_minor,cap_minor,expected_delivery,state,provenance,note,actor,created_at,
      operation_id,fingerprint,receipt_json) VALUES (?,?,?,?,?,?,?,?,?,?,'USD',?,?,?,?,?,?,?,?,?,'manager_entered',?,?,?,?,?,?)`).bind(input.companyId,id,job.id,job.revision,a.id,a.revision,
      a.orderId,job.supplierId,job.accountId,input.supplierReference,JSON.stringify(c.lines),JSON.stringify(c.extras),JSON.stringify(c.charges),c.itemSubtotalMinor,c.chargesMinor,
      c.totalMinor,c.capMinor,input.expectedDelivery,c.state,input.note,actor,at,input.operationId,fingerprint,JSON.stringify(receipt));
    // Checkout is proven, so the supplier account's cart is free for the next preparation.
    const release=this.db.prepare(`UPDATE po_cart_owners SET job_id=NULL,fence=fence+1 WHERE company_id=? AND supplier_id=? AND account_id=?
      AND job_id=? AND worker_id IS NULL`).bind(input.companyId,job.supplierId,job.accountId,job.id);
    try{
      if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed before saving.');
      await this.db.batch([insert,...effects,release]);
    }catch{
      await this.actor(input.companyId);const replay=await this.replay(input.companyId,input.operationId,fingerprint);if(replay)return {receipt:replay};
      fail('conflict','The order, its inventory or its permission changed; nothing was saved. Refresh and try again.');
    }
    const saved=await this.replay(input.companyId,input.operationId,fingerprint);
    if(!saved)fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.');
    return {receipt:saved};
  }
  private async reviewReplay(companyId:string,operationId:string,fingerprint:string):Promise<ReviewReceipt|null>{
    const row=await this.db.prepare('SELECT confirmation_id,kind,created_at,fingerprint FROM po_cart_confirmation_reviews WHERE company_id=? AND operation_id=?')
      .bind(companyId,operationId).first<{confirmation_id:string;kind:'approved'|'note';created_at:string;fingerprint:string}>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another review or person.');
    return frozenCopy({operationId,confirmationId:row.confirmation_id,kind:row.kind,at:row.created_at});
  }
  /** Loads an over-cap confirmation that the owner can still review. */
  private async held(companyId:string,confirmationId:string){
    const row=await this.db.prepare('SELECT * FROM po_cart_confirmations WHERE company_id=? AND id=?').bind(companyId,confirmationId).first<Row>();
    if(!row)fail('missing','Supplier confirmation not found.');
    if(row!.state!=='needs_owner_review')fail('conflict','This confirmation is within its cap and needs no owner review.');
    if((await this.reviews(companyId,row!.id)).results.some(r=>r.kind==='approved'))fail('conflict','This over-cap total is already approved.');
    return row!;
  }
  private async saveReview(companyId:string,actor:string,operationId:string,fingerprint:string,statements:D1PreparedStatement[]){
    try{
      if(await this.owner(companyId)!==actor)fail('forbidden','Session changed before saving.');
      await this.db.batch(statements);
    }catch{
      await this.owner(companyId);const replay=await this.reviewReplay(companyId,operationId,fingerprint);if(replay)return {receipt:replay};
      fail('conflict','The order, its spending hold or its inventory changed; nothing was saved. Refresh and try again.');
    }
    return {receipt:(await this.reviewReplay(companyId,operationId,fingerprint))??fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.')};
  }
  private review(companyId:string,confirmationId:string,values:{kind:'approved'|'note';total:number|null;note:string;actor:string;at:string;verifiedAt:string|null;operationId:string;fingerprint:string}){
    return this.db.prepare(`INSERT INTO po_cart_confirmation_reviews(company_id,id,confirmation_id,kind,approved_total_minor,note,actor,created_at,reauthenticated_at,operation_id,fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId,crypto.randomUUID(),confirmationId,values.kind,values.total,values.note,values.actor,values.at,values.verifiedAt,values.operationId,values.fingerprint);
  }
  /**
   * Owner approval of the full confirmed total. The approval row raises the held amount (counted even
   * if it goes over a limit, as the owner chose), then incoming stock is added and product holds end.
   */
  async approveOverCap(value:unknown){
    const input=this.parse(approveOverCapSchema,value),actor=await this.owner(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.reviewReplay(input.companyId,input.operationId,fingerprint);if(prior)return {receipt:prior};
    const verified=await this.options.reauthentication?.()??null,now=this.options.clock?.now()??new Date();
    if(!verified||!recentlyVerified(verified,now.getTime()))fail('reauthentication_required','Confirm your password to approve spending above the cap.');
    const row=await this.held(input.companyId,input.confirmationId),at=now.toISOString();
    const reservation=await this.db.prepare('SELECT state,total_minor FROM po_cart_reservations WHERE company_id=? AND authorization_id=?')
      .bind(input.companyId,row.authorization_id).first<{state:string;total_minor:number}>();
    if(reservation?.state!=='reserved'||reservation.total_minor!==row.cap_minor)fail('conflict','The order\'s spending hold changed.');
    const job=await this.db.prepare('SELECT inputs_json FROM po_cart_jobs WHERE company_id=? AND id=?').bind(input.companyId,row.job_id).first<{inputs_json:string}>();
    const preflight=(JSON.parse(job!.inputs_json) as {preflight:PreparationPreflight}).preflight;
    const incoming=confirmedIncoming(preflight,JSON.parse(row.lines_json) as ConfirmedLine[]);
    let effects:D1PreparedStatement[]=[];
    try{
      if(incoming.length)effects=await new D1InventoryManagementService(this.db,this.options).orderIncomingStatements({companyId:input.companyId,confirmationId:row.id,actor,lines:incoming});
    }catch(error){if(error instanceof InventoryManagementError)fail('conflict','Inventory for a confirmed item changed or needs attention: '+error.message);throw error;}
    return this.saveReview(input.companyId,actor,input.operationId,fingerprint,[
      this.review(input.companyId,row.id,{kind:'approved',total:row.total_minor,note:input.note,actor,at,verifiedAt:new Date(verified.reauthenticatedAt!).toISOString(),operationId:input.operationId,fingerprint}),
      ...effects,
      this.db.prepare('UPDATE po_cart_commitments SET active=0 WHERE company_id=? AND authorization_id=? AND active=1').bind(input.companyId,row.authorization_id)]);
  }
  /** The owner leaves an over-cap order held and says why. Nothing else changes. */
  async holdOverCap(value:unknown){
    const parsed=holdOverCapSchema.safeParse(value);
    if(!parsed.success)fail('invalid_request',parsed.error.issues.find(i=>i.message==='Say what should happen with this order.')?.message??'Check the note.');
    const input=parsed.data!,actor=await this.owner(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.reviewReplay(input.companyId,input.operationId,fingerprint);if(prior)return {receipt:prior};
    const row=await this.held(input.companyId,input.confirmationId);
    return this.saveReview(input.companyId,actor,input.operationId,fingerprint,[
      this.review(input.companyId,row.id,{kind:'note',total:null,note:input.note,actor,at:this.now(),verifiedAt:null,operationId:input.operationId,fingerprint})]);
  }
}
