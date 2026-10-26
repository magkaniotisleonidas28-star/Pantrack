import {z} from 'zod';
import {D1InventoryManagementService,InventoryManagementError} from './d1-inventory-management';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import type {PreparationPreflight} from './po-cart-preparation-contract';
import {approveDeliverySchema,checkCount,closeOrderSchema,countDeliverySchema,decide,deliveryFail as fail,managerDeliveriesQuerySchema,progress,receivables,
  recountDeliverySchema,staffDeliveriesQuerySchema,type ClosureKind,type ClosureReceipt,type CountedLine,type DecidedLine,type DeliveryReceipt,type DeliveryState} from './po-cart-delivery-contract';
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager','employee'))";
const MANAGER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
type Confirmation={id:string;job_id:string;authorization_id:string;supplier_reference:string;expected_delivery:string;lines_json:string;extras_json:string;created_at:string;inputs_json:string};
type Delivery={id:string;confirmation_id:string;job_id:string;delivered_at:string;count_json:string;count_note:string;counted_by:string;counted_at:string;
  count_operation_id:string;count_fingerprint:string;state:DeliveryState;decision_json:string|null;decision_note:string|null;stock_receipt:number|null;
  decided_by:string|null;decided_at:string|null;decision_operation_id:string|null;decision_fingerprint:string|null};
type Closure={kind:ClosureKind;release_json:string;stock_receipt:number;note:string;closed_by:string;closed_at:string;operation_id:string;fingerprint:string};
type Released={lineId:string;releasePacks:string};

/**
 * Receiving for confirmed (within-cap) fictional supplier orders. Any company member counts a
 * delivery blind: staff see item names and pack descriptions only, never expected amounts or
 * prices. An owner or manager then approves it, posting A's receipt port in the same batch, or
 * sends it back for a recount. One pending count per order; counts and decisions are permanent.
 * The order closes once nothing more is expected: automatically with the approval that resolves
 * everything, or when a manager marks the rest as not arriving. Closing settles the order's
 * in-progress spending hold (daily and monthly limits keep counting its cap) and ends counting.
 */
export class D1PoCartDeliveries {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;clock?:{now():Date}}) {}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  private parse<T>(schema:z.ZodType<T>,value:unknown):T {
    const parsed=schema.safeParse(value);
    if(!parsed.success)fail('invalid_request',parsed.error.issues.find(i=>i.code==='custom'||i.message==='Say what should be recounted.')?.message??'Enter whole packs for every item.');
    return parsed.data;
  }
  private async actor(companyId:string,managers=false){
    const actor=await this.options.identity();
    if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${managers?MANAGER:MEMBER}`).bind(companyId,actor).first())
      fail('forbidden',managers?'Current owner or manager membership is required.':'Current company membership is required.');
    return actor;
  }
  private inventory(){return new D1InventoryManagementService(this.db,this.options);}
  private confirmations(companyId:string,where:string,...args:string[]){
    return this.db.prepare(`SELECT c.id,c.job_id,c.authorization_id,c.supplier_reference,c.expected_delivery,c.lines_json,c.extras_json,c.created_at,j.inputs_json
      FROM po_cart_confirmations c JOIN po_cart_jobs j ON j.company_id=c.company_id AND j.id=c.job_id
      WHERE c.company_id=? AND c.state='confirmed' ${where} ORDER BY c.created_at,c.id`).bind(companyId,...args).all<Confirmation>();
  }
  /** Lines with what is accepted, released and still owed, from approved decisions and any closure. */
  private async state(companyId:string,c:Confirmation){
    const items=receivables((JSON.parse(c.inputs_json) as {preflight:PreparationPreflight}).preflight,c.lines_json,c.extras_json);
    const list=(await this.db.prepare('SELECT * FROM po_cart_deliveries WHERE company_id=? AND confirmation_id=? ORDER BY counted_at,id').bind(companyId,c.id).all<Delivery>()).results;
    const closed=await this.db.prepare('SELECT * FROM po_cart_order_closures WHERE company_id=? AND confirmation_id=?').bind(companyId,c.id).first<Closure>();
    const hold=await this.db.prepare('SELECT state FROM po_cart_reservations WHERE company_id=? AND authorization_id=?').bind(companyId,c.authorization_id).first<{state:'reserved'|'released'|'settled'}>();
    const kind=(lineId:string)=>items.find(i=>i.lineId===lineId)?.kind??'extra';
    const released=closed?(JSON.parse(closed.release_json) as Released[]).map(r=>({lineId:r.lineId,kind:kind(r.lineId),acceptPacks:'0',excessPacks:'0',releasePacks:r.releasePacks})):[];
    const lines=progress(items,[...list.filter(d=>d.state==='approved').map(d=>JSON.parse(d.decision_json!) as DecidedLine[]),released]);
    return {items,deliveries:list,lines,pending:list.find(d=>d.state==='counted')??null,closure:closed,hold:hold?.state??null};
  }
  // Inserted last in its batch: the database refuses it unless nothing on the order is still owed.
  private closure(companyId:string,c:Confirmation,values:{kind:ClosureKind;release:Released[];stock:number;note:string;actor:string;at:string;operationId:string;fingerprint:string}){
    return this.db.prepare(`INSERT INTO po_cart_order_closures(company_id,confirmation_id,job_id,authorization_id,kind,release_json,stock_receipt,note,closed_by,closed_at,operation_id,fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId,c.id,c.job_id,c.authorization_id,values.kind,JSON.stringify(values.release),values.stock,values.note,
      values.actor,values.at,values.operationId,values.fingerprint);
  }
  /** Blind list for counting: open orders with item names and pack descriptions only. */
  private countable(c:Confirmation,s:Awaited<ReturnType<D1PoCartDeliveries['state']>>){
    return {confirmationId:c.id,supplierReference:c.supplier_reference,expectedDelivery:c.expected_delivery,waitingForReview:!!s.pending,
      lines:s.lines.filter(l=>l.owed>BigInt(0)).map(l=>({lineId:l.item.lineId,sku:l.item.sku,description:l.item.description,unitLabel:l.item.unitLabel}))};
  }
  async staff(value:unknown){
    const input=this.parse(staffDeliveriesQuerySchema,value),actor=await this.actor(input.companyId);
    const orders=[];
    for(const c of (await this.confirmations(input.companyId,'')).results){const s=await this.state(input.companyId,c),order=this.countable(c,s);if(order.lines.length)orders.push(order);}
    if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during the delivery read.');
    return frozenCopy({orders});
  }
  async manager(value:unknown){
    const input=this.parse(managerDeliveriesQuerySchema,value),actor=await this.actor(input.companyId,true);
    const c=(await this.confirmations(input.companyId,'AND c.job_id=?',input.jobId)).results[0];
    if(!c)fail('missing','No within-cap supplier confirmation is recorded for this order.');
    const s=await this.state(input.companyId,c);
    if(await this.actor(input.companyId,true)!==actor)fail('forbidden','Session changed during the delivery read.');
    return frozenCopy({confirmationId:c.id,supplierReference:c.supplier_reference,expectedDelivery:c.expected_delivery,
      lines:s.lines.map(l=>({lineId:l.item.lineId,kind:l.item.kind,sku:l.item.sku,description:l.item.description,unitLabel:l.item.unitLabel,
        confirmedPacks:String(l.item.confirmedPacks),acceptedPacks:String(l.accepted),releasedPacks:String(l.released),excessPacks:String(l.excess),owedPacks:String(l.owed)})),
      complete:s.lines.every(l=>l.owed===BigInt(0)),countable:this.countable(c,s),hold:s.hold,
      closure:s.closure&&{kind:s.closure.kind,note:s.closure.note,closedBy:s.closure.closed_by,closedAt:s.closure.closed_at,stockLowered:s.closure.stock_receipt===1,
        released:JSON.parse(s.closure.release_json) as Released[]},
      deliveries:s.deliveries.map(d=>({id:d.id,state:d.state,deliveredAt:d.delivered_at,countedBy:d.counted_by,countedAt:d.counted_at,
        count:JSON.parse(d.count_json) as CountedLine[],countNote:d.count_note,decision:d.decision_json?JSON.parse(d.decision_json) as DecidedLine[]:null,
        decisionNote:d.decision_note,decidedBy:d.decided_by,decidedAt:d.decided_at,stockAdded:d.stock_receipt===1}))});
  }
  private async replay(companyId:string,column:'count'|'decision',operationId:string,fingerprint:string):Promise<DeliveryReceipt|null>{
    const row=await this.db.prepare(`SELECT id,state,${column}_fingerprint AS fingerprint,${column==='count'?'counted_at':'decided_at'} AS at
      FROM po_cart_deliveries WHERE company_id=? AND ${column}_operation_id=?`).bind(companyId,operationId).first<{id:string;state:DeliveryState;fingerprint:string;at:string}>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another delivery entry or person.');
    return frozenCopy({operationId,deliveryId:row.id,state:column==='count'?'counted':row.state,at:row.at});
  }
  private async closed(companyId:string,operationId:string,fingerprint:string):Promise<ClosureReceipt|null>{
    const row=await this.db.prepare('SELECT confirmation_id,kind,fingerprint,closed_at FROM po_cart_order_closures WHERE company_id=? AND operation_id=?')
      .bind(companyId,operationId).first<{confirmation_id:string;kind:ClosureKind;fingerprint:string;closed_at:string}>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another order closure or person.');
    return frozenCopy({operationId,confirmationId:row.confirmation_id,kind:row.kind,at:row.closed_at});
  }
  private async save<R>(companyId:string,actor:string,managers:boolean,replay:()=>Promise<R|null>,statements:D1PreparedStatement[]){
    try{
      if(await this.actor(companyId,managers)!==actor)fail('forbidden','Session changed before saving.');
      await this.db.batch(statements);
    }catch{
      await this.actor(companyId,managers);const replayed=await replay();if(replayed)return {receipt:replayed};
      fail('conflict','The order, its stock or the delivery changed; nothing was saved. Refresh and try again.');
    }
    const saved=await replay();
    if(!saved)fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.');
    return {receipt:saved};
  }
  async count(value:unknown){
    const input=this.parse(countDeliverySchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,'count',input.operationId,fingerprint);if(prior)return {receipt:prior};
    const t=Date.parse(input.deliveredAt),at=this.now();
    if(!Number.isFinite(t)||!/(Z|[+-]\d\d:\d\d)$/.test(input.deliveredAt)||t>Date.parse(at))fail('invalid_request','Enter when the delivery arrived; it cannot be in the future.');
    const c=(await this.confirmations(input.companyId,'AND c.id=?',input.confirmationId)).results[0];
    if(!c)fail('missing','This order is not waiting for a delivery.');
    const s=await this.state(input.companyId,c);
    if(s.closure)fail('conflict','This order is closed; it takes no more counts.');
    if(s.pending)fail('conflict','A count for this order is waiting for a manager. It must be approved or sent back first.');
    const open=s.items.filter(i=>s.lines.find(l=>l.item.lineId===i.lineId)!.owed>BigInt(0));
    if(!open.length)fail('conflict','Everything on this order is already received or marked as not arriving.');
    const lines=checkCount(open,input);
    return this.save(input.companyId,actor,false,()=>this.replay(input.companyId,'count',input.operationId,fingerprint),[this.db.prepare(`INSERT INTO po_cart_deliveries(company_id,id,confirmation_id,job_id,delivered_at,
      count_json,count_note,counted_by,counted_at,count_operation_id,count_fingerprint,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,'counted')`).bind(input.companyId,crypto.randomUUID(),
      c.id,c.job_id,new Date(t).toISOString(),JSON.stringify(lines),input.note,actor,at,input.operationId,fingerprint)]);
  }
  private async pending(companyId:string,deliveryId:string){
    const d=await this.db.prepare('SELECT * FROM po_cart_deliveries WHERE company_id=? AND id=?').bind(companyId,deliveryId).first<Delivery>();
    if(!d)fail('missing','That delivery count was not found.');
    if(d.state!=='counted')fail('conflict','This delivery count was already decided.');
    const c=(await this.confirmations(companyId,'AND c.id=?',d.confirmation_id)).results[0];if(!c)fail('missing','This order is not waiting for a delivery.');
    return {d,c};
  }
  // The decision update must change the pending row; otherwise the guard aborts the whole batch.
  private decision(companyId:string,deliveryId:string,operationId:string,values:{state:'approved'|'recount';json:string|null;note:string;stock:number|null;actor:string;at:string;fingerprint:string}){
    return [this.db.prepare(`UPDATE po_cart_deliveries SET state=?,decision_json=?,decision_note=?,stock_receipt=?,decided_by=?,decided_at=?,decision_operation_id=?,decision_fingerprint=?
      WHERE company_id=? AND id=? AND state='counted'`).bind(values.state,values.json,values.note,values.stock,values.actor,values.at,operationId,values.fingerprint,companyId,deliveryId),
      this.db.prepare(`INSERT INTO po_cart_delivery_guards(reason) SELECT 'stale' WHERE NOT EXISTS (SELECT 1 FROM po_cart_deliveries
        WHERE company_id=? AND id=? AND state=? AND decision_operation_id=?)`).bind(companyId,deliveryId,values.state,operationId)];
  }
  async approve(value:unknown){
    const input=this.parse(approveDeliverySchema,value),actor=await this.actor(input.companyId,true),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,'decision',input.operationId,fingerprint);if(prior)return {receipt:prior};
    const {d,c}=await this.pending(input.companyId,input.deliveryId),s=await this.state(input.companyId,c),at=this.now();
    const {decided,receipt}=decide(s.lines,JSON.parse(d.count_json) as CountedLine[],input);
    let effects:D1PreparedStatement[]=[];
    if(receipt.length){
      try{effects=await this.inventory().orderReceiptStatements({companyId:input.companyId,confirmationId:c.id,receiptId:d.id,actor,deliveredAt:d.delivered_at,lines:receipt});}
      catch(error){if(error instanceof InventoryManagementError)fail('conflict','Stock for a delivered item changed or needs attention: '+error.message);throw error;}
    }
    // The approval that resolves everything still expected also closes the order.
    const resolved=new Map(decided.map(x=>[x.lineId,BigInt(x.acceptPacks)+BigInt(x.releasePacks)]));
    const completes=s.lines.every(l=>l.owed-(resolved.get(l.item.lineId)??BigInt(0))===BigInt(0));
    return this.save(input.companyId,actor,true,()=>this.replay(input.companyId,'decision',input.operationId,fingerprint),[...effects,
      ...this.decision(input.companyId,d.id,input.operationId,{state:'approved',json:JSON.stringify(decided),note:input.note,stock:receipt.length?1:0,actor,at,fingerprint}),
      ...(completes?[this.closure(input.companyId,c,{kind:'complete',release:[],stock:0,note:'',actor,at,operationId:input.operationId,fingerprint})]:[])]);
  }
  async recount(value:unknown){
    const input=this.parse(recountDeliverySchema,value),actor=await this.actor(input.companyId,true),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,'decision',input.operationId,fingerprint);if(prior)return {receipt:prior};
    const {d}=await this.pending(input.companyId,input.deliveryId);
    return this.save(input.companyId,actor,true,()=>this.replay(input.companyId,'decision',input.operationId,fingerprint),
      this.decision(input.companyId,d.id,input.operationId,{state:'recount',json:null,note:input.note,stock:null,actor,at:this.now(),fingerprint}));
  }
  /** Closes the order: anything still expected is marked as not arriving, with a reason. */
  async close(value:unknown){
    const input=this.parse(closeOrderSchema,value),actor=await this.actor(input.companyId,true),fingerprint=canonicalJson({actor,input});
    const prior=await this.closed(input.companyId,input.operationId,fingerprint);if(prior)return {receipt:prior};
    const c=(await this.confirmations(input.companyId,'AND c.id=?',input.confirmationId)).results[0];
    if(!c)fail('missing','No within-cap supplier confirmation is recorded for this order.');
    const s=await this.state(input.companyId,c),at=this.now();
    if(s.closure)fail('conflict','This order is already closed.');
    if(s.pending)fail('conflict','A count for this order is waiting for review. Approve it or send it back first.');
    const open=s.lines.filter(l=>l.owed>BigInt(0)),release=open.map(l=>({lineId:l.item.lineId,releasePacks:String(l.owed)}));
    if(release.length&&!input.note)fail('invalid_request','Say why the rest of this order will not arrive.');
    const stock=open.filter(l=>l.item.kind==='stock').map(l=>({lineId:l.item.lineId,acceptedMinor:'0',releasedMinor:String(l.owed*l.item.minorPerPack!),excessMinor:'0'}));
    let effects:D1PreparedStatement[]=[];
    if(stock.length){
      try{effects=await this.inventory().orderReceiptStatements({companyId:input.companyId,confirmationId:c.id,receiptId:input.operationId,actor,deliveredAt:at,lines:stock});}
      catch(error){if(error instanceof InventoryManagementError)fail('conflict','Incoming stock for this order changed or needs attention: '+error.message);throw error;}
    }
    return this.save(input.companyId,actor,true,()=>this.closed(input.companyId,input.operationId,fingerprint),[...effects,
      this.closure(input.companyId,c,{kind:release.length?'closed_short':'complete',release,stock:stock.length?1:0,note:input.note,actor,at,operationId:input.operationId,fingerprint})]);
  }
}
