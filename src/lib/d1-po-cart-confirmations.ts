import {z} from 'zod';
import {D1PoCartJobs} from './d1-po-cart-jobs';
import {D1InventoryManagementService,InventoryManagementError} from './d1-inventory-management';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import {computeConfirmation,confirmationFail as fail,confirmationQuerySchema,recordConfirmationSchema,
  type ConfirmationReceipt,type ConfirmationState} from './po-cart-confirmation-contract';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
type Row={id:string;job_id:string;supplier_reference:string;lines_json:string;extras_json:string;charges_json:string;item_subtotal_minor:number;
  charges_minor:number;total_minor:number;cap_minor:number;expected_delivery:string;state:ConfirmationState;note:string;actor:string;created_at:string;
  fingerprint:string;receipt_json:string};

/**
 * Manager-entered supplier confirmations. Within the cap, one batch records the confirmation,
 * adds order-linked incoming through A's port and releases the order's product commitments.
 * Over-cap totals are recorded for owner review with no stock effect. Either way the account's
 * cart ownership ends. The spending reservation stays held until delivery reconciliation.
 */
export class D1PoCartConfirmations {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;clock?:{now():Date};salesPolicy?:CloverReviewPolicy}) {}
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
    if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during confirmation read.');
    const preflight=status.job.inputs.preflight;
    return frozenCopy({job:{id:status.job.id,revision:status.job.revision,state:status.job.state},capMinor:preflight.capMinor,
      authorizedLines:preflight.lines.map(l=>({lineId:l.lineId,kind:l.kind,sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,unitMinor:l.unitMinor})),
      confirmation:row?{id:row.id,supplierReference:row.supplier_reference,lines:JSON.parse(row.lines_json),extras:JSON.parse(row.extras_json),
        charges:JSON.parse(row.charges_json),itemSubtotalMinor:row.item_subtotal_minor,chargesMinor:row.charges_minor,totalMinor:row.total_minor,
        capMinor:row.cap_minor,expectedDelivery:row.expected_delivery,state:row.state,note:row.note,actor:row.actor,createdAt:row.created_at}:null,
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
}
