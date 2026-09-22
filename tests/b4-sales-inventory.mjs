import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-sales-runtime.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/b4-sales-runtime.mjs'});
await build({entryPoints:['src/lib/d1-sales-corrections.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/b4-sales-corrections.mjs'});
const {ingestLocalSale,d1SalesService,localUserActor,bridgeActor}=await import('../.sites-runtime/b4-sales-runtime.mjs');
const {D1SalesCorrectionService}=await import('../.sites-runtime/b4-sales-corrections.mjs');

class Statement{constructor(database,query,values=[]){this.database=database;this.query=query;this.values=values;}bind(...values){return new Statement(this.database,this.query,values);}async first(){return this.database.prepare(this.query).get(...this.values)??null;}async all(){return {success:true,results:this.database.prepare(this.query).all(...this.values),meta:{changes:0}};}runSync(){const statement=this.database.prepare(this.query);if(/^\s*SELECT\b/i.test(this.query))return {success:true,results:statement.all(...this.values),meta:{changes:0}};const result=statement.run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}async run(){return this.runSync();}}
class Database{constructor(sql){this.sql=sql;}prepare(query){return new Statement(this.sql,query);}async batch(statements){this.sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.runSync());this.sql.exec('COMMIT');return results;}catch(error){this.sql.exec('ROLLBACK');throw error;}}}

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));for(const entry of journal.entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
const db=new Database(sql),cutoff='2026-01-01T00:00:00.000Z';
for(const company of ['company-a','company-b'])sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company,company,cutoff);
function stock(productId,dimension,onHand,version){
 sql.prepare('INSERT INTO products VALUES (?,?,?)').run('company-a',productId,JSON.stringify({id:productId,name:productId}));
 sql.prepare(`INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).run('company-a',productId,'canonical',1,'curated',dimension,'canonical','1','1','fixture',cutoff);
 sql.prepare(`INSERT INTO inventory_config_versions VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)`).run('company-a',productId,'active',1,'active','canonical',1,'unit','1',cutoff,'fixture',cutoff);
 const display=dimension==='count'?Number(onHand):Number(onHand)/1_000_000;
 sql.prepare('INSERT INTO inventory VALUES (?,?,?,?)').run('company-a',productId,JSON.stringify({productId,settings:{unit:'canonical'},onHand:display,incoming:0,lastCount:cutoff,updated:cutoff,version,estimatedUsed:0}),version);
 sql.prepare(`INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)`).run('company-a',productId,'active',dimension,onHand,version,cutoff,cutoff);
}
stock('milk','volume','200000000',1);stock('cup','count','100',1);
sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run('company-a','latte','fixture',cutoff);
sql.prepare(`INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)`).run('company-a','latte','latte-v1','Latte','fixture',cutoff);
sql.prepare(`INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)`).run('company-a','latte','latte-v1',0,'milk','volume','10000000','10');
sql.prepare(`INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)`).run('company-a','latte','latte-v1',1,'cup','count','1','1');
sql.prepare(`UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='company-a' AND recipe_id='latte'`).run(cutoff);
const mappingKey=JSON.stringify(['Test POS','location-a','latte-item']);
sql.prepare('INSERT INTO register_mappings VALUES (?,?,?)').run('company-a',mappingKey,JSON.stringify({key:mappingKey,recipeId:'latte'}));
const manager=localUserActor({userId:'manager-a'},'company-a','manager');
const sale=(source,reference,extra={})=>ingestLocalSale({db,companyId:'company-a',source,reference,occurredAt:'2026-02-01T12:00:00Z',lines:[source==='manual'||source==='recipe_csv'?{recipeId:'latte',quantity:1}:{mappingKey,quantity:1}],actor:source==='bridge'?bridgeActor('company-a'):manager,...extra});

const manual=await sale('manual','same-reference');assert.equal(manual.state,'applied');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'190000000');
const duplicate=await sale('manual','same-reference');assert.equal(duplicate.replayed,true);assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'190000000');
for(const source of ['recipe_csv','mapped_csv','bridge']){const result=await sale(source,'same-reference');assert.equal(result.state,'applied',source);}
assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_consumption_applications').get().count,4,'Source namespaces do not collide.');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,'160000000');
const beforeConcurrent=sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor;
const concurrent=await Promise.all([sale('manual','concurrent-reference'),sale('manual','concurrent-reference')]);assert.deepEqual(concurrent.map(result=>Boolean(result.replayed)).sort(),[false,true]);
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,String(BigInt(beforeConcurrent)-BigInt(10_000_000)),'Concurrent duplicate changes inventory once.');

const beforeAtomic=sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor;
const heldWhole=await ingestLocalSale({db,companyId:'company-a',source:'manual',reference:'whole-event-hold',occurredAt:'2026-02-01T12:00:00Z',lines:[{recipeId:'latte',quantity:1},{recipeId:'missing-recipe',quantity:1}],actor:manager});
assert.equal(heldWhole.state,'held');assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,beforeAtomic,'One unknown recipe holds every ingredient.');

sql.prepare('INSERT INTO sales_imports VALUES (?,?,?,?)').run('company-a','old-reference','{}',cutoff);
const eventsBeforeLegacy=sql.prepare('SELECT count(*) AS count FROM sales_events').get().count;
const legacy=await sale('manual','old-reference');assert.equal(legacy.legacy,true);assert.equal(sql.prepare('SELECT count(*) AS count FROM sales_events').get().count,eventsBeforeLegacy,'Legacy reference never enters exact application.');

const oldBridge=await ingestLocalSale({db,companyId:'company-a',source:'bridge',reference:'old-bridge',lines:[{mappingKey,quantity:1}],actor:bridgeActor('company-a')});
assert.equal(oldBridge.state,'held');
const service=d1SalesService(db);await service.confirmOccurrence('company-a',oldBridge.eventKey,manager,'2026-02-02T12:00:00Z','Confirmed against register close');
assert.equal((await service.process('company-a',oldBridge.eventKey)).state,'applied');

const concurrentBridge=await ingestLocalSale({db,companyId:'company-a',source:'bridge',reference:'concurrent-old-bridge',lines:[{mappingKey,quantity:1}],actor:bridgeActor('company-a')});
assert.equal(concurrentBridge.state,'held');
const confirmations=await Promise.allSettled([
 service.confirmOccurrence('company-a',concurrentBridge.eventKey,manager,'2026-02-02T13:00:00Z','First register-close review'),
 service.confirmOccurrence('company-a',concurrentBridge.eventKey,manager,'2026-02-02T14:00:00Z','Second register-close review'),
]);
assert.deepEqual(confirmations.map(result=>result.status).sort(),['fulfilled','rejected'],'Only one concurrent occurrence confirmation succeeds.');
assert.equal(sql.prepare("SELECT count(*) AS count FROM sales_event_audits WHERE company_id='company-a' AND event_key=? AND action='occurrence_confirmed'").get(concurrentBridge.eventKey).count,1,'A rejected concurrent confirmation leaves no extra audit record.');
assert.equal((await service.process('company-a',concurrentBridge.eventKey)).state,'applied');

const missingKey=JSON.stringify(['Test POS','location-a','unknown-item']);
const held=await ingestLocalSale({db,companyId:'company-a',source:'mapped_csv',reference:'mapping-review',occurredAt:'2026-02-03T12:00:00Z',lines:[{mappingKey:missingKey,quantity:1}],actor:manager});
assert.equal(held.state,'held');
sql.prepare('INSERT INTO register_mappings VALUES (?,?,?)').run('company-a',missingKey,JSON.stringify({key:missingKey,recipeId:'latte'}));
await service.replay('company-a',held.eventKey,manager,'Mapping reviewed and saved');assert.equal((await service.process('company-a',held.eventKey)).state,'applied');

const summaries=await service.listStatus('company-a',manager,20);assert.ok(summaries.every(item=>!('lines' in item)&&!('sourcePayloadSha256' in item)),'Status reads expose no payload or ingredient detail.');
const history=await service.readHistory('company-a',manual.eventKey,manager,20);assert.ok(history.some(item=>item.kind==='attempt'&&item.label==='applied'));assert.ok(history.every(item=>!('inventoryResult' in item)&&!('actor' in item)),'Bounded history excludes inventory results and actor identities.');
await assert.rejects(()=>service.readHistory('company-b',manual.eventKey,localUserActor({userId:'owner-b'},'company-b','owner'),20),error=>error.code==='not_found');
const corrections=new D1SalesCorrectionService(db,()=>new Date('2026-09-01T00:00:00Z'));
const request=await corrections.request('company-a',manual.eventKey,{userId:'manager-a',email:'manager@example.test',role:'manager'},'Sale was entered in error');
assert.deepEqual(request.items.map(item=>[item.productId,item.suggestedMinor]),[['cup','1'],['milk','10000000']]);
const beforeCorrection=sql.prepare("SELECT on_hand_minor,version FROM inventory_balances_exact WHERE product_id='milk'").get();
const edited=request.items.map(item=>({productId:item.productId,minor:item.productId==='milk'?'5000000':'0'}));
const applied=await corrections.apply('company-a',request.correctionId,{userId:'owner-a',email:'owner@example.test',role:'owner'},edited);
assert.equal(applied.status,'applied');assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='milk'").get().on_hand_minor,String(BigInt(beforeCorrection.on_hand_minor)+BigInt(5_000_000)));
assert.equal(sql.prepare("SELECT approved_minor FROM sales_event_correction_items WHERE correction_id=? AND product_id='milk'").get(request.correctionId).approved_minor,'5000000','Reviewed edit is permanent.');
assert.equal(sql.prepare('SELECT count(*) AS count FROM sales_event_correction_adjustments WHERE correction_id=?').get(request.correctionId).count,2);
const replayedCorrection=await corrections.apply('company-a',request.correctionId,{userId:'manager-a',email:'manager@example.test',role:'manager'},request.items.map(item=>({productId:item.productId,minor:item.suggestedMinor})));assert.equal(replayedCorrection.status,'applied');

const concurrentCorrectionSale=await sale('manual','concurrent-correction');
const concurrentCorrection=await corrections.request('company-a',concurrentCorrectionSale.eventKey,{userId:'manager-a',email:'manager@example.test',role:'manager'},'Concurrent correction review');
const concurrentApproved=concurrentCorrection.items.map(item=>({productId:item.productId,minor:item.suggestedMinor}));
const beforeConcurrentCorrection=sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='company-a' AND product_id='milk'").get().on_hand_minor;
const concurrentApplications=await Promise.all([
 corrections.apply('company-a',concurrentCorrection.correctionId,{userId:'manager-a',email:'manager@example.test',role:'manager'},concurrentApproved),
 corrections.apply('company-a',concurrentCorrection.correctionId,{userId:'owner-a',email:'owner@example.test',role:'owner'},concurrentApproved),
]);
assert.ok(concurrentApplications.every(value=>value.status==='applied'),'Concurrent correction confirmations return the one permanent result.');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='company-a' AND product_id='milk'").get().on_hand_minor,String(BigInt(beforeConcurrentCorrection)+BigInt(10_000_000)),'Concurrent correction confirmation changes inventory once.');
assert.equal(sql.prepare('SELECT count(*) AS count FROM sales_event_correction_adjustments WHERE correction_id=?').get(concurrentCorrection.correctionId).count,2,'Concurrent correction confirmation creates one linked adjustment per product.');

const later=await sale('manual','stale-correction');const stale=await corrections.request('company-a',later.eventKey,{userId:'manager-a',email:'manager@example.test',role:'manager'},'Review stale stock');
sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='company-a' AND product_id='milk'").run();
await assert.rejects(()=>corrections.apply('company-a',stale.correctionId,{userId:'manager-a',email:'manager@example.test',role:'manager'},stale.items.map(item=>({productId:item.productId,minor:item.suggestedMinor}))),error=>error.code==='stale_inventory');
assert.equal(sql.prepare('SELECT count(*) AS count FROM sales_event_correction_results WHERE correction_id=?').get(stale.correctionId).count,0);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log('PASS: B4 routes all local sale namespaces through durable exact application, holds old bridge time, replays mappings, blocks legacy duplicates, exposes safe status, and applies reviewed corrections atomically once.');
