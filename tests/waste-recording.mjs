import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime',{recursive:true});
for(const [name,path] of [['waste','src/lib/d1-waste.ts'],['management','src/lib/d1-inventory-management.ts'],['client','src/lib/waste-client.ts']])await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/w1-'+name+'.mjs'});
const {D1WasteService}=await import('../.sites-runtime/w1-waste.mjs');
const {D1InventoryManagementService}=await import('../.sites-runtime/w1-management.mjs');
const {sendWasteSave,sendSaveRequest,wasteStorageKey}=await import('../.sites-runtime/w1-client.mjs');
class Statement{
 constructor(db,query,values=[]){Object.assign(this,{db,query,values});}
 bind(...values){return new Statement(this.db,this.query,values);}
 async first(){return this.db.sql.prepare(this.query).get(...this.values)??null;}
 async all(){return {results:this.db.sql.prepare(this.query).all(...this.values)};}
 async run(){return this.runSync();}
 runSync(){const result=this.db.sql.prepare(this.query).run(...this.values);return {results:[],meta:{changes:this.db.misleading?99:Number(result.changes)}};}
}
class Database{
 constructor(sql){this.sql=sql;this.failAfterCommit=false;this.misleading=false;}
 prepare(query){return new Statement(this,query);}
 async batch(statements){this.sql.exec('BEGIN IMMEDIATE');let results;try{results=statements.map(s=>s.runSync());this.sql.exec('COMMIT');}catch(e){this.sql.exec('ROLLBACK');throw e;}if(this.failAfterCommit){this.failAfterCommit=false;throw new Error('Lost acknowledgment');}return results;}
}
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
for(const entry of journal.entries)sql.exec(readFileSync('drizzle/'+entry.tag+'.sql','utf8'));
const db=new Database(sql),inventory=new D1InventoryManagementService(db),waste=new D1WasteService(db);
for(const companyId of ['a','b']){
 sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(companyId,'Fictional '+companyId,'2026-01-01');
 for(const productId of ['milk','beans','cups','unconfigured'])sql.prepare('INSERT INTO products VALUES (?,?,?)').run(companyId,productId,JSON.stringify({id:productId,name:productId,price:999999,supplier:'Private supplier',sku:'private-sku'}));
}
async function configure(productId,unitId,amount,extra={}){return inventory.configure({companyId:'a',productId,operationId:crypto.randomUUID(),actor:'manager',stockUnit:{kind:'curated',id:unitId},purchaseUnitLabel:'pack',purchaseAmount:amount,openingAmount:amount,effectiveAt:'2026-01-01T00:00:00Z',...extra});}
await configure('milk','mL','1000');await configure('beans','g','100');await configure('cups','each','10');
const base={companyId:'a',productId:'milk',operationId:crypto.randomUUID(),expectedVersion:1,amount:'200',unitId:'mL',effectiveAt:'2026-02-01T00:00:00Z',reason:'spilled',note:''};
const stock=id=>sql.prepare('SELECT on_hand_minor,version FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get('a',id);
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
assert.deepEqual((await waste.options('b')).items,[],'Other company never inherits options.');
const options=await waste.options('a');assert.equal(options.items.length,3);assert.ok(!JSON.stringify(options).includes('Private supplier'));assert.ok(!JSON.stringify(options).includes('999999'));
await waste.record(base,'employee');assert.equal(stock('milk').on_hand_minor,'800000000');
await waste.record(base,'employee');assert.equal(stock('milk').version,2);
for(const change of [{amount:'201'},{reason:'other'},{note:'changed'},{effectiveAt:'2026-02-02T00:00:00Z'}])await reject(waste.record({...base,...change},'employee'),'operation_conflict');
await reject(waste.record(base,'another-worker'),'operation_conflict');
await reject(waste.record({...base,operationId:crypto.randomUUID(),companyId:'b'},'employee'),'inventory_not_configured');
await assert.rejects(waste.record({...base,reason:undefined},'employee'));
for(const amount of ['0','-1','1e3','0.0000001'])await assert.rejects(waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:2,amount},'employee'));
await reject(waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:2,amount:'801'},'employee'),'invalid_quantity');
await reject(waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:2,unitId:'g'},'employee'),'unit_unclassified');
await reject(waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:2,effectiveAt:'2026-01-01T00:00:00Z'},'employee'),'before_count_cutoff');
await reject(waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:2,effectiveAt:'2999-01-01T00:00:00Z'},'employee'),'invalid_time');
const same={...base,operationId:crypto.randomUUID(),expectedVersion:2,amount:'10'};
const duplicates=await Promise.allSettled([waste.record(same,'employee'),waste.record(same,'employee')]);assert.ok(duplicates.every(r=>r.status==='fulfilled'));assert.equal(stock('milk').on_hand_minor,'790000000');
const different={...same,operationId:crypto.randomUUID(),expectedVersion:3};
const race=await Promise.allSettled([waste.record(different,'employee'),waste.record({...different,reason:'spoiled'},'employee')]);assert.deepEqual(race.map(r=>r.status).sort(),['fulfilled','rejected']);assert.equal(race.find(r=>r.status==='rejected').reason.code,'operation_conflict');assert.equal(stock('milk').on_hand_minor,'780000000');
const competing={...base,operationId:crypto.randomUUID(),expectedVersion:4,amount:'10'};
const differentIds=await Promise.allSettled([waste.record(competing,'employee'),waste.record({...competing,operationId:crypto.randomUUID()},'employee')]);assert.deepEqual(differentIds.map(r=>r.status).sort(),['fulfilled','rejected']);assert.equal(stock('milk').on_hand_minor,'770000000');
const unknown={...base,operationId:crypto.randomUUID(),expectedVersion:5,amount:'10'};
db.failAfterCommit=true;await assert.rejects(waste.record(unknown,'employee'),/Lost acknowledgment/);assert.equal(stock('milk').on_hand_minor,'760000000');await waste.record(unknown,'employee');assert.equal(stock('milk').on_hand_minor,'760000000');
db.misleading=true;await reject(waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:1},'employee'),'concurrent_update');assert.equal(stock('milk').on_hand_minor,'760000000');db.misleading=false;
await inventory.recordCount({companyId:'a',productId:'milk',operationId:'later-count',expectedVersion:6,actor:'manager',amount:'750',unitId:'mL',effectiveAt:'2026-03-01T00:00:00Z',note:''});await waste.record(unknown,'employee');assert.equal(stock('milk').on_hand_minor,'750000000','Unknown retry after later count confirms the receipt, never deducts again.');
const current=(await waste.options('a')).items.find(i=>i.productId==='milk');
const shortcutInput={companyId:'a',productId:'milk',configId:current.configId,expectedRevision:0,operationId:crypto.randomUUID(),shortcuts:[{label:'Small spill',amount:'200',unitId:'mL'}]};
assert.equal((await waste.saveShortcuts(shortcutInput,'manager')).revision,1);assert.equal((await waste.saveShortcuts(shortcutInput,'manager')).revision,1);
await reject(waste.saveShortcuts({...shortcutInput,shortcuts:[{label:'Different',amount:'200',unitId:'mL'}]},'manager'),'operation_conflict');
await reject(waste.saveShortcuts({...shortcutInput,operationId:crypto.randomUUID(),shortcuts:[{label:'Bad',amount:'1',unitId:'g'}]},'manager'),'unit_incompatible');
await assert.rejects(waste.saveShortcuts({...shortcutInput,operationId:crypto.randomUUID(),shortcuts:[{label:'Zero',amount:'0',unitId:'mL'}]},'manager'));
const shortcutRace=await Promise.allSettled([waste.saveShortcuts({...shortcutInput,expectedRevision:1,operationId:crypto.randomUUID()},'manager'),waste.saveShortcuts({...shortcutInput,expectedRevision:1,operationId:crypto.randomUUID()},'manager')]);assert.deepEqual(shortcutRace.map(r=>r.status).sort(),['fulfilled','rejected']);
await configure('milk','L','1',{openingAmount:undefined,effectiveAt:'2026-04-01T00:00:00Z'});assert.deepEqual((await waste.options('a')).items.find(i=>i.productId==='milk').shortcuts,[],'Unit reclassification invalidates old shortcuts.');
// A historical compatible entry unit must not change the legacy stock unit.
const version=stock('milk').version;await waste.record({...base,operationId:crypto.randomUUID(),expectedVersion:version,amount:'100',effectiveAt:'2026-04-02T00:00:00Z'},'employee');
const legacy=JSON.parse(sql.prepare("SELECT data FROM inventory WHERE company_id='a' AND product_id='milk'").get().data);assert.equal(legacy.settings.unit,'L');assert.equal(legacy.onHand,0.65);
await configure('beans','scoop','10',{stockUnit:{kind:'custom',id:'scoop',label:'18 g scoop',dimension:'mass',numerator:'18',denominator:'1'},openingAmount:undefined,effectiveAt:'2026-04-01T00:00:00Z'});
const scoopWaste={...base,productId:'beans',operationId:crypto.randomUUID(),expectedVersion:2,amount:'1',unitId:'scoop',effectiveAt:'2026-04-02T00:00:00Z'};
await waste.record(scoopWaste,'employee');assert.equal(stock('beans').on_hand_minor,'82000000');
await configure('beans','scoop','3',{stockUnit:{kind:'custom',id:'scoop',label:'One-third gram scoop',dimension:'mass',numerator:'1',denominator:'3'},openingAmount:undefined,effectiveAt:'2026-04-03T00:00:00Z'});
await waste.record(scoopWaste,'employee');assert.equal(stock('beans').on_hand_minor,'82000000','An existing receipt remains confirmable after custom-unit conversion changes.');
await assert.rejects(waste.record({...base,productId:'cups',operationId:crypto.randomUUID(),amount:'0.5',unitId:'each'},'employee'));
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
// Browser retries always preserve the exact body, including after an ambiguous response.
const pending={kind:'waste',request:base};let sent=[];
assert.equal((await sendWasteSave(pending,async(_,init)=>{sent.push(init.body);throw new Error('offline');})).kind,'uncertain');
assert.equal((await sendWasteSave(pending,async(_,init)=>{sent.push(init.body);return Response.json({ok:true});})).kind,'saved');assert.equal(sent[0],sent[1]);
assert.equal((await sendWasteSave(pending,async()=>Response.json({error:'expired'},{status:401}))).kind,'uncertain','Expiry must not discard a possibly committed operation.');
assert.equal((await sendWasteSave(pending,async()=>Response.json({error:'access removed'},{status:403}))).kind,'uncertain');
assert.equal((await sendWasteSave(pending,async()=>Response.json({code:'preview_disabled'},{status:404}))).kind,'uncertain');
assert.equal((await sendWasteSave(pending,async()=>Response.json({error:'audit failed',uncertain:true},{status:503}))).kind,'uncertain');
assert.equal((await sendWasteSave(pending,async()=>Response.json({code:'concurrent_update'},{status:409}))).refresh,true);
for(const status of [400,404,409])assert.equal((await sendSaveRequest('/api/waste/entries',base,async(_,init)=>{assert.equal(init.body,JSON.stringify(base));return Response.json({error:'setup changed'},{status});},true)).kind,'uncertain','A later validation rejection cannot abandon an earlier ambiguous W2 identity.');
const malformedClientAck=await sendSaveRequest('/api/waste/entries',base,async()=>new Response('not json',{status:200}));assert.equal(malformedClientAck.kind,'uncertain');
assert.notEqual(wasteStorageKey('a','staff'),wasteStorageKey('b','staff'));assert.notEqual(wasteStorageKey('a','staff'),wasteStorageKey('a','other'));
// Existing events survive the additive migration with no invented reason.
const old=new DatabaseSync(':memory:');old.exec('PRAGMA foreign_keys=ON');for(const entry of journal.entries.filter(entry=>entry.idx<18))old.exec(readFileSync('drizzle/'+entry.tag+'.sql','utf8'));
old.exec("INSERT INTO companies VALUES ('legacy','Legacy','now'); INSERT INTO products VALUES ('legacy','milk','{}');");
// Seed the historical schema directly; today's service requires today's migrations.
old.exec("INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at) VALUES('legacy','milk','mL',1,'curated','volume','mL','1','1','manager','2026-01-01'); INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,effective_from,created_by,created_at) VALUES('legacy','milk','old-config',1,'active','mL',1,'carton','1000000000','2026-01-01','manager','2026-01-01');");
const oldConfig='old-config';
old.prepare(`INSERT INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,balance_version_before,balance_version_after,effective_at,recorded_at,actor,note) VALUES ('legacy','old-waste','milk',?,'waste','volume','-1','0.000001','mL',1,2,'2026-02-01','2026-02-01','manager','old')`).run(oldConfig);
old.exec(readFileSync('drizzle/'+journal.entries.find(entry=>entry.idx===18).tag+'.sql','utf8'));assert.equal(old.prepare('SELECT waste_reason FROM inventory_events_exact').get().waste_reason,null);old.close();sql.close();
console.log('PASS: W1 exact waste, structured reasons, concurrency, unknown outcomes, shortcuts, unit projections, privacy, browser retry contracts, and additive migration compatibility.');
