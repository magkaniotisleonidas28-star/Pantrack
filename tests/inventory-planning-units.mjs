import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-inventory-management.ts','src/lib/inventory.ts','src/lib/inventory-planning-units.ts'],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/bug04-test'});
const {D1InventoryManagementService}=await import('../.sites-runtime/bug04-test/d1-inventory-management.js');
const {recommendation}=await import('../.sites-runtime/bug04-test/inventory.js');
const {readPlanningRecords}=await import('../.sites-runtime/bug04-test/inventory-planning-units.js');
class Statement{
  constructor(db,query,values=[]){Object.assign(this,{db,query,values});}
  bind(...values){return new Statement(this.db,this.query,values);}
  async first(){return this.db.prepare(this.query).get(...this.values)??null;}
  async all(){return {results:this.db.prepare(this.query).all(...this.values)};}
  runSync(){const result=this.db.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
  async run(){return this.runSync();}
}
class Database{
  constructor(sql){this.sql=sql;}
  prepare(query){return new Statement(this.sql,query);}
  async batch(statements){this.sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.runSync());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
const now='2026-03-01T00:00:00.000Z';
function fixture(productId='milk',stockUnit={kind:'curated',id:'mL'}){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const {tag} of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
  for(const companyId of ['company-a','company-b']){
    sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(companyId,companyId,now);
    sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(companyId,productId,JSON.stringify({id:productId,name:productId}));
  }
  const db=new Database(sql),service=new D1InventoryManagementService(db,{clock:{now:()=>new Date(now)}});
  const configure=(overrides={})=>service.configure({companyId:'company-a',productId,operationId:'config-1',actor:'manager',stockUnit,purchaseUnitLabel:'pack',purchaseAmount:'1000',openingAmount:'900',effectiveAt:now,...overrides});
  const record=()=>JSON.parse(sql.prepare('SELECT data FROM inventory WHERE company_id=? AND product_id=?').get('company-a',productId).data);
  const save=(mutate)=>{const r=record();mutate(r);sql.prepare('UPDATE inventory SET data=? WHERE company_id=? AND product_id=?').run(JSON.stringify(r),'company-a',productId);};
  const plan=()=>recommendation(record(),Date.parse(now));
  return {sql,db,service,configure,record,save,plan,productId};
}
const f=fixture();await f.configure();
f.save(r=>Object.assign(r.settings,{targetStock:2000,dailyUse:100,safety:200,capacity:5000,shelfDays:null}));
assert.equal(f.plan().packs,2);
await f.configure({operationId:'config-2',stockUnit:{kind:'curated',id:'L'},purchaseAmount:'1',openingAmount:undefined});
assert.equal(f.plan().packs,2,'Changing mL to L must keep the physical restock suggestion, never inflate it to 999 packs.');
assert.deepEqual([f.record().settings.targetStock,f.record().settings.dailyUse,f.record().settings.safety,f.record().settings.capacity],[2,.1,.2,5]);
const beforeReplay=f.record();await f.configure({operationId:'config-2',stockUnit:{kind:'curated',id:'L'},purchaseAmount:'1',openingAmount:undefined});
assert.deepEqual(f.record(),beforeReplay,'Receipt replay never rescales twice.');
await f.configure({operationId:'config-3',stockUnit:{kind:'curated',id:'mL'},purchaseAmount:'1000',openingAmount:undefined});
assert.deepEqual([f.record().settings.targetStock,f.record().settings.dailyUse,f.record().settings.safety,f.record().settings.capacity],[2000,100,200,5000]);
assert.equal(f.plan().packs,2);
assert.deepEqual({...f.sql.prepare('SELECT on_hand_minor,incoming_minor,estimated_used_minor,latest_count_effective_at FROM inventory_balances_exact').get()},{on_hand_minor:'900000000',incoming_minor:'0',estimated_used_minor:'0',latest_count_effective_at:now});

for(const [from,to] of [['g','kg'],['kg','g'],['L','mL']]){
  const x=fixture('beans',{kind:'curated',id:from});await x.configure({openingAmount:'0',purchaseAmount:'1'});
  x.save(r=>Object.assign(r.settings,{targetStock:from==='g'?2000:2,dailyUse:from==='g'?100:.1,safety:0,capacity:null}));
  const values=x.record().settings;
  await x.configure({operationId:'config-2',stockUnit:{kind:'curated',id:to},openingAmount:undefined,purchaseAmount:to==='g'||to==='mL'?'1000':'1'});
  const factor=from==='g'?.001:1000;
  assert.equal(x.record().settings.targetStock,values.targetStock*factor);assert.equal(x.record().settings.dailyUse,values.dailyUse*factor);
  assert.equal(x.record().settings.capacity,null);assert.equal(x.record().settings.safety,0);assert.equal(x.record().planningReviewRequired,undefined);
}
const custom={kind:'custom',id:'scoop',label:'scoop',dimension:'mass',numerator:'10',denominator:'1'};
const c=fixture('beans',custom);await c.configure({openingAmount:'2',purchaseAmount:'2'});
c.save(r=>Object.assign(r.settings,{targetStock:10,dailyUse:2,safety:1,capacity:20}));
await c.configure({operationId:'config-2',stockUnit:{...custom,numerator:'20'},purchaseAmount:'1',openingAmount:undefined});
assert.deepEqual([c.record().settings.targetStock,c.record().settings.dailyUse,c.record().settings.safety,c.record().settings.capacity],[5,1,.5,10]);
assert.deepEqual(c.record().planningUnit,{unitId:'scoop',version:2});
assert.equal(c.sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact').get().on_hand_minor,'20000000');
const planned=c.record().settings;
await c.configure({operationId:'config-3',stockUnit:{...custom,numerator:'20'},purchaseAmount:'3',openingAmount:undefined});
assert.deepEqual(c.record().settings,{...planned,unitsPerPack:3},'Package-only edits keep dimensional planning fields unchanged.');

for(const absent of [true,false]){
 const x=fixture();await x.configure();x.save(r=>{if(absent)delete r.settings.targetStock;else r.settings.targetStock=null;Object.assign(r.settings,{dailyUse:0,safety:0,capacity:0});});
 await x.configure({operationId:'config-2',stockUnit:{kind:'curated',id:'L'},openingAmount:undefined,purchaseAmount:'1'});
 assert.equal(Object.hasOwn(x.record().settings,'targetStock'),!absent);assert.equal(x.record().settings.targetStock,absent?undefined:null);assert.equal(x.record().settings.capacity,0);assert.equal(x.record().settings.dailyUse,0);
}
for(const [from,to,value] of [['mL','L',.001],['L','mL',10000000]]){
 const x=fixture('milk',{kind:'curated',id:from});await x.configure({openingAmount:'0',purchaseAmount:'1'});x.save(r=>Object.assign(r.settings,{targetStock:value,dailyUse:1}));
 const previous=x.record().settings;
 await x.configure({operationId:'config-2',stockUnit:{kind:'curated',id:to},openingAmount:undefined,purchaseAmount:'1'});
 assert.equal(x.record().planningReviewRequired,true);assert.equal(x.plan().packs,0);assert.equal(x.plan().wantedPacks,0);assert.equal(x.plan().reason,'Review planning measurements');
 assert.equal(x.record().settings.targetStock,previous.targetStock,'Unsafe conversion does not partially rewrite planning values.');
}
const history=fixture();await history.configure();
history.save(r=>Object.assign(r.settings,{targetStock:2000,dailyUse:100}));
await history.configure({operationId:'config-2',stockUnit:{kind:'curated',id:'L'},openingAmount:undefined,purchaseAmount:'1'});
history.save(r=>{delete r.planningUnit;delete r.planningReviewRequired;Object.assign(r.settings,{targetStock:2000,dailyUse:100});});
const damaged=history.record();
const [held]=await readPlanningRecords(history.db,'company-a');assert.equal(held.planningReviewRequired,true);assert.equal(recommendation(held,Date.parse(now)).packs,0);
assert.deepEqual(history.record(),damaged,'Reading old ambiguous values adds a hold without changing persisted records or history.');
assert.deepEqual(await readPlanningRecords(history.db,'company-b'),[],'Planning history cannot cross company boundaries.');
await history.configure({operationId:'config-3',stockUnit:{kind:'curated',id:'mL'},openingAmount:undefined,purchaseAmount:'1000'});
assert.equal(history.record().planningReviewRequired,true,'Another configuration edit cannot erase an unresolved historical hold.');
assert.equal(history.plan().packs,0);
const legacyCustom=fixture('beans',custom);await legacyCustom.configure();legacyCustom.save(r=>{delete r.planningUnit;r.settings.targetStock=100;});
assert.equal((await readPlanningRecords(legacyCustom.db,'company-a'))[0].planningReviewRequired,true);
const unknown=fixture();unknown.sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run('company-a','milk',JSON.stringify({...damaged,version:1,settings:{...damaged.settings,unit:'unknown old bottle'}}),1);
await unknown.configure();assert.equal(unknown.record().planningReviewRequired,true);assert.equal(unknown.plan().packs,0);

const preserved=fixture();await preserved.configure({effectiveAt:'2026-02-27T00:00:00Z'});
await preserved.service.recordMovement({companyId:'company-a',productId:'milk',operationId:'incoming',expectedVersion:1,actor:'manager',action:'incoming',amount:'100',unitId:'mL',effectiveAt:'2026-02-28T00:00:00Z',note:''});
await preserved.service.recordMovement({companyId:'company-a',productId:'milk',operationId:'use',expectedVersion:2,actor:'manager',action:'use',amount:'10',unitId:'mL',effectiveAt:'2026-02-28T01:00:00Z',note:''});
preserved.save(r=>Object.assign(r.settings,{targetStock:2000,dailyUse:100,safety:200,capacity:5000}));
await preserved.service.saveRecipeDraft({companyId:'company-a',recipeId:'drink',draftId:'drink-v1',actor:'manager',name:'Fictional drink',ingredients:[{productId:'milk',amount:'10',unitId:'mL'}]});
await preserved.service.activateRecipe({companyId:'company-a',recipeId:'drink',versionId:'drink-v1',actor:'manager',expectedActiveVersionId:null,effectiveAt:'2026-02-28T02:00:00Z'});
const balanceBefore=preserved.sql.prepare('SELECT on_hand_minor,incoming_minor,estimated_used_minor,latest_count_effective_at FROM inventory_balances_exact').get();
const immutableTables=['inventory_reconciliations','inventory_events_exact','recipe_versions','recipe_version_ingredients'];
const immutableBefore=immutableTables.map(name=>preserved.sql.prepare(`SELECT * FROM ${name}`).all());
await preserved.configure({operationId:'config-2',stockUnit:{kind:'curated',id:'L'},purchaseAmount:'1',openingAmount:undefined});
assert.deepEqual(preserved.sql.prepare('SELECT on_hand_minor,incoming_minor,estimated_used_minor,latest_count_effective_at FROM inventory_balances_exact').get(),balanceBefore);
assert.deepEqual(immutableTables.map(name=>preserved.sql.prepare(`SELECT * FROM ${name}`).all()),immutableBefore);
assert.deepEqual([preserved.record().onHand,preserved.record().incoming,preserved.record().estimatedUsed],[.89,.1,.01]);
globalThis.bug04Db=history.db;globalThis.bug04User={userId:'manager',email:'manager@example.test'};globalThis.bug04Company='company-a';
await build({entryPoints:['src/app/api/inventory/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/bug04-inventory-api.mjs',plugins:[{name:'local-auth',setup(b){
 b.onResolve({filter:/^@\/(db\/raw|lib\/(chatgpt-auth|company-access|authorization|exact-inventory-gate))$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('db/raw')?'export const database=()=>globalThis.bug04Db':path.endsWith('chatgpt-auth')?'export const getChatGPTUser=async()=>globalThis.bug04User':path.endsWith('company-access')?'export const companyAccess=async(_user,company)=>company===globalThis.bug04Company?{role:"manager"}:null':path.endsWith('authorization')?'export const withCompanyRoute=(_name,handler)=>handler':'export const exactInventoryPreviewEnabled=()=>false'}));
}}]});
const api=await import('../.sites-runtime/bug04-inventory-api.mjs');
const get=company=>api.GET(new Request(`http://localhost/api/inventory?companyId=${company}`));
assert.equal((await get('company-b')).status,403);globalThis.bug04User=null;assert.equal((await get('company-a')).status,401);
globalThis.bug04User={userId:'manager',email:'manager@example.test'};
const response=await get('company-a');assert.equal(response.status,200);assert.equal((await response.json()).records[0].planningReviewRequired,true,'Actual inventory GET exposes the historical hold even when the exact preview is disabled.');
writeFileSync('.sites-runtime/bug04-browser-fixtures.json',JSON.stringify({good:f.record(),held:history.record(),view:await f.service.read('company-a'),now:Date.parse(now)}));
console.log('Planning measurements: exact conversions, custom revisions, package edits, absent/null/zero, precision holds, old-record holds, canonical balances, history, receipts and isolation passed.');
