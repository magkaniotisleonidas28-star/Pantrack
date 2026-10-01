import {D1InventoryManagementService,InventoryManagementError} from './d1-inventory-management';
import type {PackageStockInput} from './inventory-management-contract';
import type {UnitDimension} from './inventory-consumption-contract';
import {curatedUnit,customUnit,formatCanonical} from './inventory-quantities';
import {packageTotal} from './stock-pack-quantities';

/** The raw entry receipt and the stock movement commit in the same guarded batch. */
export async function recordPackageStock(db:D1Database,input:PackageStockInput){
  const fingerprint=JSON.stringify(input),result={productId:input.productId};
  const receipt=async()=>{
    const row=await db.prepare('SELECT kind,fingerprint FROM inventory_setup_operations WHERE company_id=? AND operation_id=?').bind(input.companyId,input.operationId).first<{kind:string;fingerprint:string}>();
    if(!row)return false;
    if(row.kind!=='stock_packages'||row.fingerprint!==fingerprint)throw new InventoryManagementError('operation_conflict','This package entry reference has different details.');
    return true;
  };
  // Confirm before looking at today's package configuration or count cutoff.
  if(await receipt())return result;
  const row=await db.prepare(`SELECT b.config_id,b.dimension,b.version,c.purchase_quantity_minor,
    c.stock_unit_id,c.stock_unit_version,u.kind,u.label,u.numerator,u.denominator
    FROM inventory_balances_exact b JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
    JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
    WHERE b.company_id=? AND b.product_id=?`).bind(input.companyId,input.productId).first<{config_id:string;dimension:UnitDimension;version:number;purchase_quantity_minor:string;stock_unit_id:string;stock_unit_version:number;kind:string;label:string;numerator:string;denominator:string}>();
  if(!row)throw new InventoryManagementError('not_found','Set up this stock item first.');
  if(row.config_id!==input.configId||row.version!==input.expectedVersion)throw new InventoryManagementError('concurrent_update','Stock or package size changed. Refresh before saving.');
  if(input.fromIncoming&&input.action!=='receive')throw new InventoryManagementError('invalid_input','Incoming delivery selection applies only to receiving.');
  const id=(input.action==='count'?'count:':'movement:')+input.operationId;
  if(await db.prepare('SELECT 1 AS found FROM inventory_events_exact WHERE company_id=? AND id=?').bind(input.companyId,id).first())throw new InventoryManagementError('operation_conflict','This stock reference was already used.');
  const scope={companyId:input.companyId,productId:input.productId};
  const measurement=row.kind==='custom'?customUnit({...scope,id:row.stock_unit_id,version:row.stock_unit_version,label:row.label,dimension:row.dimension,numerator:row.numerator,denominator:row.denominator}):curatedUnit(row.stock_unit_id);
  const total=packageTotal({dimension:row.dimension,minor:row.purchase_quantity_minor},input.quantity,measurement,scope);
  const canonicalId={mass:'g',volume:'mL',count:'each'}[row.dimension];
  const prefix=[db.prepare(`INSERT INTO inventory_setup_operations(company_id,operation_id,kind,fingerprint,result_json,write_guard,created_at)
    VALUES (?,?,'stock_packages',?,?,CASE WHEN EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND config_id=? AND version=?) THEN 1 ELSE 0 END,?)`).bind(input.companyId,input.operationId,fingerprint,JSON.stringify(result),input.companyId,input.productId,input.configId,input.expectedVersion,new Date().toISOString())];
  const common={companyId:input.companyId,productId:input.productId,operationId:input.operationId,actor:input.actor,expectedVersion:input.expectedVersion,amount:formatCanonical(total),unitId:canonicalId,effectiveAt:input.effectiveAt,note:input.note};
  const service=new D1InventoryManagementService(db);
  try{
    if(input.action==='count')await service.recordCount(common,prefix,true);
    else await service.recordMovement({...common,action:input.action,fromIncoming:input.fromIncoming},prefix,true);
  }catch(error){
    if(await receipt())return result;
    if(String(error).includes('inventory_setup_write_guard'))throw new InventoryManagementError('concurrent_update','Stock or package size changed. Refresh before saving.');
    throw error;
  }
  return result;
}
