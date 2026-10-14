import type {InventoryRecord,InventorySettings} from './inventory';
import type {UnitDefinition} from './inventory-quantities';

const fields=['targetStock','dailyUse','safety','capacity'] as const;
export type PlanningUnitRow={product_id:string;status:string;unit_id:string;version:number;label:string;kind:string;dimension:string;numerator:string;denominator:string};
export const planningUnitsSql=`SELECT c.product_id,c.status,u.unit_id,u.version,u.label,u.kind,u.dimension,u.numerator,u.denominator
 FROM inventory_config_versions c JOIN product_unit_versions u
 ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
 WHERE c.company_id=?`;
const hasQuantities=(settings:InventorySettings)=>fields.some(field=>settings[field]!==undefined&&settings[field]!==null&&settings[field]!==0);
const sameFactor=(a:PlanningUnitRow,b:PlanningUnitRow)=>a.dimension===b.dimension&&BigInt(a.numerator)*BigInt(b.denominator)===BigInt(b.numerator)*BigInt(a.denominator);

// Old JSON has no attestation of the measurement in which its planning values
// were entered. Historical factor changes cannot be repaired by guessing.
export function holdAmbiguousPlanning(record:InventoryRecord,history:PlanningUnitRow[]):InventoryRecord{
 const current=history.find(row=>row.status==='active');
 if(!current||!hasQuantities(record.settings))return record;
 const attested=record.planningUnit;
 const unsafe=record.settings.unit!==current.label||(attested
  ?attested.unitId!==current.unit_id||attested.version!==current.version
  :current.kind==='custom'||history.some(row=>!sameFactor(row,current)));
 return unsafe?{...record,planningReviewRequired:true}:record;
}

export async function readPlanningRecords(db:D1Database,companyId:string):Promise<InventoryRecord[]>{
 const [records,units]=await Promise.all([
  db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(companyId).all<{data:string}>(),
  db.prepare(planningUnitsSql).bind(companyId).all<PlanningUnitRow>(),
 ]);
 return records.results.map(row=>{const record=JSON.parse(row.data) as InventoryRecord;return holdAmbiguousPlanning(record,units.results.filter(unit=>unit.product_id===record.productId));});
}

function thousandths(value:number):bigint{
 if(!Number.isFinite(value)||value<0||value>10000000)throw new Error('Planning amount out of bounds.');
 const match=/^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value));
 if(!match)throw new Error('Planning amount exceeds supported precision.');
 return BigInt(match[1])*BigInt(1000)+BigInt((match[2]??'').padEnd(3,'0'));
}

export function changePlanningUnit(record:InventoryRecord,previous:UnitDefinition|null,next:UnitDefinition):void{
 if(!record.planningReviewRequired){
  try{
   const settings={...record.settings};
   if(hasQuantities(settings)&&(!previous||previous.dimension!==next.dimension))throw new Error('Previous planning measurement is unknown.');
   for(const field of fields){
    const value=settings[field];if(value===null||value===undefined)continue;
    const numerator=thousandths(value)*(previous?BigInt(previous.numerator)*BigInt(next.denominator):BigInt(1));
    const denominator=previous?BigInt(previous.denominator)*BigInt(next.numerator):BigInt(1);
    if(numerator%denominator!==BigInt(0)||numerator/denominator>BigInt(10000000000))throw new Error('Conversion requires rounding or exceeds bounds.');
    settings[field]=Number(numerator/denominator)/1000;
   }
   record.settings=settings;
   record.planningUnit={unitId:next.id,version:next.version};
  }catch{record.planningReviewRequired=true;}
 }
}
