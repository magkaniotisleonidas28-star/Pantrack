import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({
 entryPoints:['src/lib/d1-inventory-consumption.ts'],
 bundle:true,
 platform:'node',
 format:'esm',
 outfile:'.sites-runtime/inventory-consumption-d1.mjs',
});
const {D1InventoryConsumptionPort}=await import('../.sites-runtime/inventory-consumption-d1.mjs');

class Statement{
 constructor(database,query,values=[]){this.database=database;this.query=query;this.values=values;}
 bind(...values){return new Statement(this.database,this.query,values);}
 async first(){return this.database.prepare(this.query).get(...this.values)??null;}
 async all(){return {success:true,results:this.database.prepare(this.query).all(...this.values),meta:{changes:0}};}
 runSync(){const result=this.database.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
 async run(){return this.runSync();}
}
class Database{
 constructor(sql){this.sql=sql;this.failAfter=null;}
 prepare(query){return new Statement(this.sql,query);}
 async batch(statements){
  this.sql.exec('BEGIN IMMEDIATE');
  try{
   const results=[];
   for(let index=0;index<statements.length;index++){
    if(this.failAfter===index){this.failAfter=null;throw new Error('injected batch failure');}
    results.push(statements[index].runSync());
   }
   this.sql.exec('COMMIT');return results;
  }catch(error){this.sql.exec('ROLLBACK');throw error;}
 }
}

const contract='pantrack.inventory-consumption.v1';
const now='2026-03-01T00:00:00.000Z';
const cutoff='2026-01-01T00:00:00.000Z';
const clock={now:()=>new Date(now)};
let sequence=0;
const idFactory=()=>`inventory-id-${++sequence}`;
const line=(lineId,recipeId,quantity='1',modifiers=[])=>({lineId,recipeId,quantity,modifiers});
const request=(idempotencyKey,occurredAt,lines,companyId='company-a')=>({contract,companyId,idempotencyKey,occurredAt,lines});
const issueCodes=result=>result.issues.map(issue=>issue.code);

function legacy(productId,onHand,version){
 return JSON.stringify({
  productId,settings:{unit:'canonical',unitsPerPack:1,targetStock:null,dailyUse:0,leadDays:2,safety:0,reviewDays:7,countEveryDays:30,location:'Stockroom',capacity:null,shelfDays:null,expiry:'',variancePct:5},
  onHand,incoming:0,lastCount:cutoff,updated:cutoff,version,estimatedUsed:0,
 });
}

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys = ON');
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 for(const entry of journal.entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
 for(const companyId of ['company-a','company-b'])sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(companyId,companyId,cutoff);

 const products=[
  ['milk','volume','200000000',4,cutoff,'active','curated'],
  ['oat','volume','200000000',2,cutoff,'active','curated'],
  ['coffee','mass','100000000',3,cutoff,'active','curated'],
  ['cup','count','100',8,cutoff,'active','curated'],
  ['legacy-syrup','volume','50000000',1,cutoff,'legacy_unclassified','legacy_unclassified'],
  ['uncounted','volume','50000000',1,null,'active','curated'],
 ];
 for(const [productId,dimension,onHand,version,countAt,status,kind] of products){
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run('company-a',productId,JSON.stringify({id:productId,name:productId,unit:'unit'}));
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).run('company-a',productId,'canonical',1,kind,kind==='legacy_unclassified'?null:dimension,'canonical',kind==='legacy_unclassified'?null:'1',kind==='legacy_unclassified'?null:'1','fixture',cutoff);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
   VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)`).run('company-a',productId,'active',1,status,'canonical',1,'unit',kind==='legacy_unclassified'?null:'1',cutoff,'fixture',cutoff);
  sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run('company-a',productId,legacy(productId,dimension==='count'?Number(onHand):Number(onHand)/1_000_000,version),version);
  sql.prepare(`INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at)
   VALUES (?,?,?,?,?,'0','0',?,?,?)`).run('company-a',productId,'active',dimension,onHand,version,countAt,cutoff);
 }
 sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run('company-a','ghost',JSON.stringify({id:'ghost',name:'ghost',unit:'unit'}));
 sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).run('company-a','ghost','canonical',1,'curated','volume','canonical','1','1','fixture',cutoff);

 for(const recipeId of ['latte','legacy-drink','uncounted-drink','broken-unit','missing-stock']){
  sql.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)').run('company-a',recipeId,'fixture',cutoff);
 }
 const addRecipe=(recipeId,id,status,from,to,ingredients)=>{
  sql.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at)
   VALUES (?,?,?,?,'draft',?,NULL,NULL,0,?,?)`).run('company-a',recipeId,id,id.endsWith('v2')?2:1,recipeId,'fixture',cutoff);
  ingredients.forEach((ingredient,position)=>sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label)
   VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)`).run('company-a',recipeId,id,position,ingredient.productId,ingredient.dimension,ingredient.minor,ingredient.minor));
  sql.prepare('UPDATE recipe_versions SET status=?,active_from=?,active_to=? WHERE company_id=? AND recipe_id=? AND id=?').run(status,from,to,'company-a',recipeId,id);
 };
 addRecipe('latte','latte-v1','archived','2026-01-01T00:00:00.000Z','2026-02-01T00:00:00.000Z',[{productId:'milk',dimension:'volume',minor:'10000000'},{productId:'cup',dimension:'count',minor:'1'}]);
 addRecipe('latte','latte-v2','active','2026-02-01T00:00:00.000Z',null,[{productId:'milk',dimension:'volume',minor:'12000000'},{productId:'cup',dimension:'count',minor:'1'}]);
 addRecipe('legacy-drink','legacy-v1','active',cutoff,null,[{productId:'legacy-syrup',dimension:'volume',minor:'1000000'}]);
 addRecipe('uncounted-drink','uncounted-v1','active',cutoff,null,[{productId:'uncounted',dimension:'volume',minor:'1000000'}]);
 addRecipe('broken-unit','broken-v1','active',cutoff,null,[{productId:'milk',dimension:'mass',minor:'1000000'}]);
 addRecipe('missing-stock','missing-stock-v1','active',cutoff,null,[{productId:'ghost',dimension:'volume',minor:'1000000'}]);

 for(const [modifierId,deltas] of [
  ['extra-shot',[{productId:'coffee',dimension:'mass',minor:'2000000'}]],
  ['oat-swap',[{productId:'milk',dimension:'volume',minor:'-12000000'},{productId:'oat',dimension:'volume',minor:'12000000'}]],
 ]){
  sql.prepare('INSERT INTO recipe_modifier_lineages(company_id,recipe_id,id,name,created_by,created_at) VALUES (?,?,?,?,?,?)').run('company-a','latte',modifierId,modifierId,'fixture',cutoff);
  sql.prepare(`INSERT INTO recipe_modifier_versions(company_id,recipe_id,modifier_id,id,version,status,active_from,active_to,created_by,created_at)
   VALUES (?,?,?,?,1,'draft',NULL,NULL,?,?)`).run('company-a','latte',modifierId,`${modifierId}-v1`,'fixture',cutoff);
  deltas.forEach((delta,position)=>sql.prepare(`INSERT INTO recipe_modifier_deltas(company_id,recipe_id,modifier_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id)
   VALUES (?,?,?,?,?,?,'canonical',1,?,?,?,'canonical')`).run('company-a','latte',modifierId,`${modifierId}-v1`,position,delta.productId,delta.dimension,delta.minor,delta.minor));
  sql.prepare("UPDATE recipe_modifier_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=?").run(cutoff,'company-a','latte',modifierId,`${modifierId}-v1`);
 }
 return {sql,database:new Database(sql)};
}

function port(database){return new D1InventoryConsumptionPort(database,{clock,idFactory});}

{
 const {sql,database}=fixture();
 const service=port(database);
 const sale=request('sale-v1','2026-01-15T12:00:00Z',[line('line-1','latte','2')]);
 const applied=await service.consume(sale);
 assert.equal(applied.status,'applied');
 assert.equal(applied.replayed,false);
 assert.equal(applied.selectedVersions[0].recipeVersionId,'latte-v1');
 assert.deepEqual(applied.changes.map(change=>[change.productId,change.consumed.minor]),[['cup','2'],['milk','20000000']]);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='company-a' AND product_id='milk'").get().on_hand_minor,'180000000');
 assert.equal(JSON.parse(sql.prepare("SELECT data FROM inventory WHERE company_id='company-a' AND product_id='milk'").get().data).onHand,180,'Legacy projection follows exact inventory.');
 assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_events_exact WHERE company_id='company-a' AND consumption_key='sale-v1'").get().count,2);

 const restarted=port(database);
 const replayed=await restarted.consume(sale);
 assert.equal(replayed.status,'applied');
 assert.equal(replayed.replayed,true);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='company-a' AND product_id='milk'").get().on_hand_minor,'180000000');
 const conflict=await restarted.consume({...sale,lines:[line('line-1','latte')]});
 assert.equal(conflict.status,'rejected');
 assert.deepEqual(issueCodes(conflict),['idempotency_conflict']);
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 sql.close();
}

{
 const {sql,database}=fixture();
 const service=port(database);
 const sale=request('concurrent','2026-02-15T12:00:00Z',[line('line-1','latte')]);
 const results=await Promise.all([service.consume(sale),service.consume(sale)]);
 assert.ok(results.every(result=>result.status==='applied'));
 assert.deepEqual(results.map(result=>result.replayed).sort(),[false,true]);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'188000000');
 assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_events_exact WHERE consumption_key='concurrent'").get().count,2);
 sql.close();
}

{
 const {sql,database}=fixture();
 const result=await port(database).consume(request('modifiers','2026-02-15T12:00:00-05:00',[
  line('line-1','latte','2',[{modifierId:'oat-swap',quantity:'2'},{modifierId:'extra-shot',quantity:'2'}]),
 ]));
 assert.equal(result.status,'applied');
 assert.equal(result.occurredAt,'2026-02-15T17:00:00.000Z');
 assert.deepEqual(result.selectedVersions[0].modifiers.map(modifier=>modifier.modifierVersionId),['oat-swap-v1','extra-shot-v1']);
 assert.deepEqual(result.changes.map(change=>[change.productId,change.consumed.minor]),[['coffee','4000000'],['cup','2'],['oat','24000000']]);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'200000000');
 sql.close();
}

{
 const {sql,database}=fixture();
 const result=await port(database).consume(request('negative-modifier','2026-01-15T12:00:00Z',[
  line('line-1','latte','1',[{modifierId:'oat-swap',quantity:'1'}]),
 ]));
 assert.equal(result.status,'held');
 assert.ok(issueCodes(result).includes('negative_modifier_result'));
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'200000000');
 assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_consumption_applications').get().count,0);
 sql.close();
}

{
 const cases=[
  ['cutoff',request('cutoff',cutoff,[line('line-1','latte')]),'before_count_cutoff'],
  ['unclassified',request('unclassified','2026-02-15T00:00:00Z',[line('line-1','legacy-drink')]),'unit_unclassified'],
  ['opening',request('opening','2026-02-15T00:00:00Z',[line('line-1','uncounted-drink')]),'opening_count_required'],
  ['unit',request('unit','2026-02-15T00:00:00Z',[line('line-1','broken-unit')]),'unit_incompatible'],
  ['inventory',request('inventory','2026-02-15T00:00:00Z',[line('line-1','missing-stock')]),'inventory_not_configured'],
  ['recipe',request('recipe','2026-02-15T00:00:00Z',[line('line-1','missing')]),'recipe_version_not_found'],
  ['modifier',request('modifier','2026-02-15T00:00:00Z',[line('line-1','latte','1',[{modifierId:'missing',quantity:'1'}])]),'modifier_version_not_found'],
 ];
 for(const [name,input,code] of cases){
  const {sql,database}=fixture();
  const before=sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor;
  const result=await port(database).consume(input);
  assert.equal(result.status,'held',name);
  assert.ok(issueCodes(result).includes(code),name);
  assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,before,name);
  assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_consumption_applications').get().count,0,name);
  sql.close();
 }
}

{
 const invalidCases=[
  [{...request('future','2026-04-01T00:00:00Z',[line('line-1','latte')])},'invalid_occurrence_time'],
  [{...request('timezone','2026-02-01T00:00:00',[line('line-1','latte')])},'invalid_occurrence_time'],
  [{...request('calendar','2026-02-30T00:00:00Z',[line('line-1','latte')])},'invalid_occurrence_time'],
  [{...request('contract','2026-02-01T00:00:00Z',[line('line-1','latte')]),contract:'pantrack.inventory-consumption.v0'},'invalid_contract'],
  [request('fraction','2026-02-15T00:00:00Z',[line('line-1','latte','1.5')]),'invalid_quantity'],
  [request('duplicate-lines','2026-02-15T00:00:00Z',[line('same','latte'),line('same','latte')]),'invalid_request'],
  [request('duplicate-modifiers','2026-02-15T00:00:00Z',[line('line-1','latte','1',[{modifierId:'extra-shot',quantity:'1'},{modifierId:'extra-shot',quantity:'1'}])]),'invalid_request'],
 ];
 for(const [input,code] of invalidCases){
  const {sql,database}=fixture();
  const result=await port(database).consume(input);
  assert.equal(result.status,'rejected');
  assert.deepEqual(issueCodes(result),[code]);
  assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_consumption_applications').get().count,0);
  sql.close();
 }
}

{
 const {sql,database}=fixture();
 const before=sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor;
 const result=await port(database).consume(request('atomic','2026-02-15T00:00:00Z',[line('valid','latte'),line('invalid','missing')]));
 assert.equal(result.status,'held');
 assert.deepEqual(issueCodes(result),['recipe_version_not_found']);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,before);
 sql.close();
}

{
 const {sql,database}=fixture();
 const before=sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor;
 const foreign=await port(database).consume(request('foreign','2026-02-15T00:00:00Z',[line('line-1','latte')],'company-b'));
 assert.equal(foreign.status,'held');
 assert.deepEqual(issueCodes(foreign),['recipe_version_not_found']);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,before);
 sql.close();
}

{
 const {sql,database}=fixture();
 database.failAfter=2;
 const service=port(database);
 await assert.rejects(()=>service.consume(request('rollback','2026-02-15T00:00:00Z',[line('line-1','latte')])),/injected batch failure/);
 assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_consumption_applications').get().count,0);
 assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_events_exact').get().count,0);
 assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'200000000');
 sql.close();
}

{
 const {sql,database}=fixture();
 const service=port(database);
 const sale=request('corrupt','2026-02-15T00:00:00Z',[line('line-1','latte')]);
 assert.equal((await service.consume(sale)).status,'applied');
 sql.prepare("UPDATE inventory_consumption_applications SET result_json='{}' WHERE company_id='company-a' AND idempotency_key='corrupt'").run();
 await assert.rejects(()=>port(database).consume(sale),/failed validation/);
 sql.close();
}

console.log('PASS: D1 inventory consumption persists exact atomic deductions, immutable versions, cutoff holds, tenant isolation, idempotent replay, legacy projections, restart recovery, and transactional rollback.');
