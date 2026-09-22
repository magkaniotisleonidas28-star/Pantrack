import type {InventoryConsumptionApplied,UnitDimension} from '@/lib/inventory-consumption-contract';
import {SalesIngestionError} from '@/lib/sales-ingestion';

const MIN=-BigInt('9223372036854775808');
const MAX=BigInt('9223372036854775807');
const MILLION=BigInt(1_000_000);

type Actor={userId:string;email:string;role:'owner'|'manager'};
type BalanceRow={product_id:string;config_id:string;dimension:UnitDimension;on_hand_minor:string;estimated_used_minor:string;version:number;legacy_data:string|null;legacy_version:number|null;numerator:string;denominator:string};
type ItemRow={product_id:string;dimension:UnitDimension;suggested_minor:string;approved_minor:string;expected_balance_version:number};

export type CorrectionItem={productId:string;dimension:UnitDimension;suggestedMinor:string;approvedMinor:string;expectedBalanceVersion:number};
export type CorrectionView={correctionId:string;eventKey:string;status:'pending'|'applied';reason:string;requestedAt:string;requestedBy:string;items:CorrectionItem[];result:null|{appliedAt:string;confirmedBy:string;changes:Array<{productId:string;quantityMinor:string;balanceVersionBefore:number;balanceVersionAfter:number}>}};

function minor(value:string){
 if(value.length>20||!/^-?(?:0|[1-9]\d*)$/.test(value)||value==='-0')throw new SalesIngestionError('invalid_quantity','Correction quantities must be canonical signed integers.');
 const parsed=BigInt(value);if(parsed<MIN||parsed>MAX)throw new SalesIngestionError('invalid_quantity','Correction quantity is outside the supported range.');return parsed;
}
function factor(value:string){if(value.length>128||!/^[1-9]\d*$/.test(value))throw new SalesIngestionError('corrupt_store','Persisted stock conversion is invalid.');return BigInt(value);}
function json<T>(value:string,label:string):T{try{return JSON.parse(value) as T;}catch{throw new SalesIngestionError('corrupt_store',`Persisted ${label} JSON is invalid.`);}}
function changes(result:D1Result<unknown>|undefined){return Number(result?.meta?.changes??0);}
function legacyValue(minorValue:bigint,row:BalanceRow){
 const numerator=factor(row.numerator),denominator=factor(row.denominator);
 const scale=row.dimension==='count'?BigInt(1):MILLION,negative=minorValue<0,absolute=negative?-minorValue:minorValue;
 const scaled=absolute*denominator*BigInt(1000),divisor=numerator*scale,rounded=scaled/divisor+(scaled%divisor*BigInt(2)>=divisor?BigInt(1):BigInt(0));
 if(rounded>BigInt(Number.MAX_SAFE_INTEGER))throw new SalesIngestionError('invalid_quantity','Correction exceeds the legacy projection range.');
 return Number(negative?-rounded:rounded)/1000;
}
function actorId(actor:Actor){return `user:${actor.userId}`;}

export class D1SalesCorrectionService{
 constructor(private readonly db:D1Database,private readonly now:()=>Date=()=>new Date(),private readonly id:()=>string=()=>crypto.randomUUID()){}

 async request(companyId:string,eventKey:string,actor:Actor,reason:string):Promise<CorrectionView>{
  const clean=reason.trim();if(!clean)throw new SalesIngestionError('reason_required','Correction reason is required.');
  const row=await this.db.prepare(`SELECT r.inventory_result_json FROM sales_event_states s
    JOIN sales_event_attempts a ON a.company_id=s.company_id AND a.event_key=s.event_key
    JOIN sales_event_attempt_results r ON r.company_id=a.company_id AND r.attempt_id=a.attempt_id
    WHERE s.company_id=? AND s.event_key=? AND s.state='applied' AND r.outcome='applied' AND r.inventory_result_json IS NOT NULL
    ORDER BY r.completed_at DESC LIMIT 1`).bind(companyId,eventKey).first<{inventory_result_json:string}>();
  if(!row)throw new SalesIngestionError('invalid_state','Corrections may be requested only for an applied inventory deduction.');
  const applied=json<InventoryConsumptionApplied>(row.inventory_result_json,'inventory result');
  if(applied.status!=='applied'||applied.companyId!==companyId||!Array.isArray(applied.changes)||!applied.changes.length)throw new SalesIngestionError('invalid_state','This event has no ingredient deduction to correct.');
  const productIds=new Set<string>();for(const change of applied.changes){if(productIds.has(change.productId))throw new SalesIngestionError('corrupt_store','Inventory result contains duplicate products.');productIds.add(change.productId);minor(change.consumed.minor);}
  const balances=await Promise.all(applied.changes.map(change=>this.balance(companyId,change.productId)));
  const correctionId=this.id(),requestedAt=this.now().toISOString(),identity=actorId(actor);
  const statements:D1PreparedStatement[]=[this.db.prepare(`INSERT INTO sales_event_corrections(company_id,correction_id,event_key,status,actor,reason,requested_at)
    SELECT ?,?,?,'pending',?,?,? WHERE NOT EXISTS(SELECT 1 FROM sales_event_corrections WHERE company_id=? AND event_key=?)`).bind(companyId,correctionId,eventKey,identity,clean,requestedAt,companyId,eventKey)];
  applied.changes.forEach((change,index)=>{const balance=balances[index];if(!balance||balance.dimension!==change.consumed.dimension)throw new SalesIngestionError('stale_inventory','Inventory configuration changed before correction review.');statements.push(this.db.prepare(`INSERT INTO sales_event_correction_items(company_id,correction_id,product_id,dimension,suggested_minor,approved_minor,expected_balance_version)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_event_corrections WHERE company_id=? AND correction_id=?)`).bind(companyId,correctionId,change.productId,change.consumed.dimension,change.consumed.minor,change.consumed.minor,balance.version,companyId,correctionId));});
  statements.push(this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
    SELECT ?,?,?,'correction_requested',?,?,?,NULL WHERE EXISTS(SELECT 1 FROM sales_event_corrections WHERE company_id=? AND correction_id=?)`).bind(companyId,this.id(),eventKey,identity,requestedAt,clean,companyId,correctionId));
  const result=await this.db.batch(statements);if(result.some(entry=>changes(entry)!==1))throw new SalesIngestionError('invalid_state','This sale already has a correction record.');
  return (await this.get(companyId,correctionId))!;
 }

 async apply(companyId:string,correctionId:string,actor:Actor,approved:Array<{productId:string;minor:string}>):Promise<CorrectionView>{
  const correction=await this.get(companyId,correctionId);if(!correction)throw new SalesIngestionError('not_found','Correction was not found.');if(correction.status==='applied')return correction;
  if(approved.length!==correction.items.length||new Set(approved.map(item=>item.productId)).size!==approved.length)throw new SalesIngestionError('invalid_quantity','Provide one reviewed amount for every correction item.');
  const amounts=new Map(approved.map(item=>[item.productId,minor(item.minor)]));if(correction.items.some(item=>!amounts.has(item.productId)))throw new SalesIngestionError('invalid_quantity','Provide one reviewed amount for every correction item.');
  const balances=await Promise.all(correction.items.map(item=>this.balance(companyId,item.productId)));
  const appliedAt=this.now().toISOString(),identity=actorId(actor),resultChanges=correction.items.map((item,index)=>{
    const balance=balances[index];if(!balance||balance.dimension!==item.dimension||balance.version!==item.expectedBalanceVersion)throw new SalesIngestionError('stale_inventory','Stock changed after correction review. Request a new correction.');
    const quantity=amounts.get(item.productId)!,before=minor(balance.on_hand_minor),used=minor(balance.estimated_used_minor),after=before+quantity,afterUsed=used-quantity;
    if(after<MIN||after>MAX||afterUsed<MIN||afterUsed>MAX)throw new SalesIngestionError('invalid_quantity','Correction would exceed the supported inventory range.');
    return {item,balance,quantity,before,after,afterUsed,eventId:this.id()};
  });
  const resultJson=JSON.stringify({appliedAt,confirmedBy:identity,changes:resultChanges.map(value=>({productId:value.item.productId,quantityMinor:String(value.quantity),balanceVersionBefore:value.balance.version,balanceVersionAfter:value.balance.version+1}))});
  const statements:D1PreparedStatement[]=[this.db.prepare(`INSERT INTO sales_event_correction_results(company_id,correction_id,result_json,confirmed_by,applied_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_event_corrections WHERE company_id=? AND correction_id=? AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM sales_event_correction_items i LEFT JOIN inventory_balances_exact b ON b.company_id=i.company_id AND b.product_id=i.product_id
      WHERE i.company_id=? AND i.correction_id=? AND (b.product_id IS NULL OR b.version<>i.expected_balance_version))`).bind(companyId,correctionId,resultJson,identity,appliedAt,companyId,correctionId,companyId,correctionId)];
  for(const value of resultChanges){
    const legacy=value.balance.legacy_data===null?null:json<Record<string,unknown>>(value.balance.legacy_data,'legacy inventory');if(legacy){legacy.onHand=legacyValue(value.after,value.balance);legacy.estimatedUsed=legacyValue(value.afterUsed,value.balance);legacy.version=value.balance.version+1;legacy.updated=appliedAt;}
    statements.push(this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor=?,estimated_used_minor=?,version=version+1,updated_at=?
      WHERE company_id=? AND product_id=? AND version=? AND EXISTS(SELECT 1 FROM sales_event_correction_results WHERE company_id=? AND correction_id=?)`).bind(String(value.after),String(value.afterUsed),appliedAt,companyId,value.item.productId,value.balance.version,companyId,correctionId));
    if(legacy)statements.push(this.db.prepare(`UPDATE inventory SET data=?,version=? WHERE company_id=? AND product_id=? AND version=?
      AND EXISTS(SELECT 1 FROM sales_event_correction_results WHERE company_id=? AND correction_id=?)`).bind(JSON.stringify(legacy),value.balance.version+1,companyId,value.item.productId,value.balance.legacy_version,companyId,correctionId));
    statements.push(this.db.prepare(`INSERT INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,balance_version_before,balance_version_after,effective_at,recorded_at,actor,note,consumption_key)
      SELECT ?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM sales_event_correction_results WHERE company_id=? AND correction_id=?)`).bind(companyId,value.eventId,value.item.productId,value.balance.config_id,'sale_correction',value.item.dimension,String(value.quantity),value.balance.version,value.balance.version+1,appliedAt,appliedAt,identity,correction.reason,companyId,correctionId));
    statements.push(this.db.prepare(`INSERT INTO sales_event_correction_adjustments(company_id,correction_id,inventory_event_id,product_id,dimension,quantity_minor,balance_version_before,balance_version_after)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_event_correction_results WHERE company_id=? AND correction_id=?)`).bind(companyId,correctionId,value.eventId,value.item.productId,value.item.dimension,String(value.quantity),value.balance.version,value.balance.version+1,companyId,correctionId));
    statements.push(this.db.prepare(`UPDATE sales_event_correction_items SET approved_minor=? WHERE company_id=? AND correction_id=? AND product_id=?
      AND EXISTS(SELECT 1 FROM sales_event_correction_results WHERE company_id=? AND correction_id=?)`).bind(String(value.quantity),companyId,correctionId,value.item.productId,companyId,correctionId));
  }
  statements.push(this.db.prepare(`UPDATE sales_event_corrections SET status='applied' WHERE company_id=? AND correction_id=? AND status='pending'
    AND EXISTS(SELECT 1 FROM sales_event_correction_results WHERE company_id=? AND correction_id=?)`).bind(companyId,correctionId,companyId,correctionId));
  statements.push(this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
    SELECT ?,?,event_key,'correction_applied',?,?,reason,NULL FROM sales_event_corrections WHERE company_id=? AND correction_id=? AND status='applied'`).bind(companyId,this.id(),identity,appliedAt,companyId,correctionId));
  let result:D1Result<unknown>[];
  try{result=await this.db.batch(statements);}catch(error){const replay=await this.get(companyId,correctionId);if(replay?.status==='applied')return replay;throw error;}
  if(result.some(entry=>changes(entry)!==1)){const replay=await this.get(companyId,correctionId);if(replay?.status==='applied')return replay;throw new SalesIngestionError('stale_inventory','Stock changed while the correction was applied. No correction was recorded.');}
  return (await this.get(companyId,correctionId))!;
 }

 async list(companyId:string,limit=50){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SalesIngestionError('invalid_limit','List limit must be between 1 and 100.');const rows=await this.db.prepare(`SELECT correction_id FROM sales_event_corrections WHERE company_id=? ORDER BY requested_at DESC LIMIT ?`).bind(companyId,limit).all<{correction_id:string}>();return Promise.all(rows.results.map(row=>this.get(companyId,row.correction_id))).then(values=>values.filter((value):value is CorrectionView=>value!==null));}

 private async balance(companyId:string,productId:string){return this.db.prepare(`SELECT b.product_id,b.config_id,b.dimension,b.on_hand_minor,b.estimated_used_minor,b.version,
    i.data AS legacy_data,i.version AS legacy_version,u.numerator,u.denominator FROM inventory_balances_exact b
    JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
    JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
    LEFT JOIN inventory i ON i.company_id=b.company_id AND i.product_id=b.product_id WHERE b.company_id=? AND b.product_id=?`).bind(companyId,productId).first<BalanceRow>();}
 private async get(companyId:string,correctionId:string):Promise<CorrectionView|null>{
  const row=await this.db.prepare(`SELECT correction_id,event_key,status,actor,reason,requested_at FROM sales_event_corrections WHERE company_id=? AND correction_id=?`).bind(companyId,correctionId).first<{correction_id:string;event_key:string;status:'pending'|'applied';actor:string;reason:string;requested_at:string}>();if(!row)return null;
  const items=await this.db.prepare(`SELECT product_id,dimension,suggested_minor,approved_minor,expected_balance_version FROM sales_event_correction_items WHERE company_id=? AND correction_id=? ORDER BY product_id`).bind(companyId,correctionId).all<ItemRow>();
  const result=await this.db.prepare(`SELECT result_json FROM sales_event_correction_results WHERE company_id=? AND correction_id=?`).bind(companyId,correctionId).first<{result_json:string}>();
  return {correctionId:row.correction_id,eventKey:row.event_key,status:row.status,reason:row.reason,requestedAt:row.requested_at,requestedBy:row.actor,items:items.results.map(item=>({productId:item.product_id,dimension:item.dimension,suggestedMinor:item.suggested_minor,approvedMinor:item.approved_minor,expectedBalanceVersion:item.expected_balance_version})),result:result?json<CorrectionView['result']>(result.result_json,'correction result'):null};
 }
}
