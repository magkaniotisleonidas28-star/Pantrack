import {database} from '@/db/raw';
import type {InventoryRecord} from '@/lib/inventory';
type Recipe={id:string;name:string;ingredients:{productId:string;quantity:number;unit:string}[]};
export type SalesLine={recipeId?:string;mappingKey?:string;quantity:number};
export async function importSales(companyId:string,reference:string,lines:SalesLine[],actor:string){
 const db=database(),rows=await db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(companyId).all<{data:string}>(),records=rows.results.map(x=>JSON.parse(x.data) as InventoryRecord);

 if(await db.prepare('SELECT reference FROM sales_imports WHERE company_id=? AND reference=?').bind(companyId,reference).first())return {ok:true,replayed:true};
 const mapped=await db.prepare('SELECT data FROM register_mappings WHERE company_id=?').bind(companyId).all<{data:string}>();
 const mappings=mapped.results.map(x=>JSON.parse(x.data) as {key:string;recipeId:string});
 const resolvedLines=lines.map(line=>{const recipeId=line.recipeId||mappings.find(m=>m.key===line.mappingKey)?.recipeId;if(!recipeId)throw new Error('Unmapped register item. Map every item before importing; no stock was deducted.');return {...line,recipeId};});
 const rs=await db.prepare('SELECT data FROM recipes WHERE company_id=?').bind(companyId).all<{data:string}>(),recipes=rs.results.map(x=>JSON.parse(x.data) as Recipe),usage=new Map<string,number>();
 for(const line of resolvedLines){const recipe=recipes.find(r=>r.id===line.recipeId);if(!recipe)throw new Error('Recipe not found.');
 for(const i of recipe.ingredients){const record=records.find(r=>r.productId===i.productId);if(!record||record.settings.unit!==i.unit)throw new Error('An ingredient unit changed. Update the recipe first.');usage.set(i.productId,(usage.get(i.productId)||0)+i.quantity*line.quantity);}}
 if(usage.size>20)throw new Error('Import at most 20 distinct ingredients per batch.');
 const used=[...usage].map(([id,quantity])=>({record:records.find(r=>r.productId===id)!,quantity}));for(const i of used){if(!i.record.lastCount)throw new Error('Record an opening count for every ingredient first.');if(i.quantity>10000000)throw new Error('Sales quantities are too large.');}
 const attempt=crypto.randomUUID(),now=new Date().toISOString(),event={attempt,reference:reference,created:now,lines:resolvedLines,usage:used.map(i=>({productId:i.record.productId,quantity:i.quantity,unit:i.record.settings.unit})),actor:actor};
 const guards=used.map(()=>'EXISTS (SELECT 1 FROM inventory WHERE company_id=? AND product_id=? AND version=?)').join(' AND ');
 const batch=[db.prepare('INSERT OR IGNORE INTO sales_imports(company_id,reference,data,created) SELECT ?,?,?,? WHERE '+guards).bind(companyId,reference,JSON.stringify(event),now,...used.flatMap(i=>[companyId,i.record.productId,i.record.version]))];
 for(const i of used){const old=i.record.version;i.record.onHand=Math.round((i.record.onHand-i.quantity)*1000)/1000;i.record.estimatedUsed=(i.record.estimatedUsed||0)+i.quantity;i.record.version++;i.record.updated=now;
 batch.push(db.prepare('UPDATE inventory SET data=?,version=? WHERE company_id=? AND product_id=? AND version=? AND EXISTS (SELECT 1 FROM sales_imports WHERE company_id=? AND reference=? AND json_extract(data,\'$.attempt\')=?)').bind(JSON.stringify(i.record),i.record.version,companyId,i.record.productId,old,companyId,reference,attempt));
 batch.push(db.prepare('INSERT OR IGNORE INTO inventory_events(company_id,id,product_id,data,created) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sales_imports WHERE company_id=? AND reference=? AND json_extract(data,\'$.attempt\')=?)').bind(companyId,'sale:'+reference+':'+i.record.productId,i.record.productId,JSON.stringify({id:'sale:'+reference,productId:i.record.productId,action:'sale',quantity:i.quantity,note:reference,actor:actor,created:now}),now,companyId,reference,attempt));
 }
 await db.batch(batch);
 if(!await db.prepare('SELECT reference FROM sales_imports WHERE company_id=? AND reference=?').bind(companyId,reference).first())throw new Error('Inventory changed during import. Refresh and retry.');
 return {ok:true};
}
