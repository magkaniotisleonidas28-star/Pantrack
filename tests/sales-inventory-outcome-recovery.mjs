import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';

const fenceStatements=unstable_splitSqlQuery(readFileSync('drizzle/0034_sales_inventory_outcome_fence.sql','utf8'));
assert.equal(fenceStatements.length,4,'Wrangler must retain each trigger as a complete statement.');
const applyFence=sql=>{for(const statement of fenceStatements)sql.exec(statement);};

mkdirSync('.sites-runtime',{recursive:true});
const mocks={name:'outcome-recovery-mocks',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$|^@\/db\/raw$/},args=>({path:args.path,namespace:'mock'}));
 builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.testEnv':'export function database(){return globalThis.testDB}'}));
}};
for(const [name,path] of [['sync','src/lib/clover-sync.ts'],['crypto','src/lib/vendor-adapter.ts'],['sales','src/lib/sales-ingestion.ts'],['store','src/lib/d1-sales-event-store.ts'],['inventory','src/lib/d1-inventory-consumption.ts'],['runtime','src/lib/d1-sales-runtime.ts']]){
 await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',outfile:`.sites-runtime/outcome-recovery-${name}.mjs`,plugins:[mocks]});
}
globalThis.testEnv={CLOVER_ENVIRONMENT:'sandbox',CLOVER_CLIENT_ID:'fictional-app',CLOVER_CLIENT_SECRET:'fictional-secret',VENDOR_ENCRYPTION_KEY:btoa('a'.repeat(32)),PANTRACK_CLOVER_SYNC_ENABLED:'enabled'};
const {syncClover}=await import('../.sites-runtime/outcome-recovery-sync.mjs');
const {encrypt}=await import('../.sites-runtime/outcome-recovery-crypto.mjs');
const {SalesIngestionService}=await import('../.sites-runtime/outcome-recovery-sales.mjs');
const {D1SalesEventStore}=await import('../.sites-runtime/outcome-recovery-store.mjs');
const {D1InventoryConsumptionPort}=await import('../.sites-runtime/outcome-recovery-inventory.mjs');
const {D1SalesMappingPort}=await import('../.sites-runtime/outcome-recovery-runtime.mjs');

class Statement{
 constructor(db,query,values=[]){this.db=db;this.query=query;this.values=values;}
 bind(...values){return new Statement(this.db,this.query,values);}
 async first(){
  if(this.db.failResultRead&&/^\s*SELECT request_fingerprint,result_json FROM inventory_consumption_applications/.test(this.query)&&this.db.sql.prepare('SELECT 1 FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=?').get(...this.values)){
   this.db.failResultRead=false;throw new Error('Injected lost post-commit inventory response.');
  }
  return this.db.sql.prepare(this.query).get(...this.values)??null;
 }
 async all(){return {success:true,results:this.db.sql.prepare(this.query).all(...this.values),meta:{changes:0}};}
 runSync(){
  const statement=this.db.sql.prepare(this.query);
  if(/^\s*SELECT\b/i.test(this.query))return {success:true,results:statement.all(...this.values),meta:{changes:0}};
  const result=statement.run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};
 }
 async run(){return this.runSync();}
}
class Database{
 constructor(sql){this.sql=sql;this.failResultRead=false;this.beforeInventoryCommit=null;}
 prepare(query){return new Statement(this,query);}
 async batch(statements){
  if(this.beforeInventoryCommit&&statements.some(statement=>statement.query.includes('INSERT OR IGNORE INTO inventory_consumption_applications'))){
   const hook=this.beforeInventoryCommit;this.beforeInventoryCommit=null;await hook();
  }
  this.sql.exec('BEGIN IMMEDIATE');
  try{const results=statements.map(statement=>statement.runSync());this.sql.exec('COMMIT');return results;}
  catch(error){this.sql.exec('ROLLBACK');throw error;}
 }
}

async function fixture({through=Infinity}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.filter(entry=>entry.idx<=through)){
  if(entry.idx===34)applyFence(sql);else sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
 }
 const now=Date.now(),cutoff=new Date(now-600_000).toISOString(),started=now-300_000;
 for(const company of ['a','b'])sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company,company,cutoff);
 sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a','cup','{}');
 sql.prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)').run('a','cup','canonical',1,'curated','count','canonical','1','1','fixture',cutoff);
 sql.prepare('INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)').run('a','cup','active',1,'active','canonical',1,'unit','1',cutoff,'fixture',cutoff);
 sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)").run('a','cup','active','count','10',1,cutoff,cutoff);
 sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run('a','drink','fixture',cutoff);
 sql.prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)").run('a','drink','drink-v1','Drink','fixture',cutoff);
 sql.prepare("INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)").run('a','drink','drink-v1',0,'cup','count','1','1');
 sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='a' AND recipe_id='drink'").run(cutoff);
 sql.prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)').run('a','sandbox','merchant','item','drink');
 const token={access_token:'fictional-access',refresh_token:'fictional-refresh',access_token_expiration:Math.floor(now/1000)+3600,refresh_token_expiration:Math.floor(now/1000)+86400};
 sql.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)').run('a','merchant','sandbox',await encrypt(JSON.stringify(token),'clover:a'),cutoff,null);
 sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)').run('a','sandbox','merchant',started,started);
 const order={id:'order',createdTime:now-240_000,modifiedTime:now-190_000,total:500,paymentState:'PAID',payments:{elements:[{id:'payment',createdTime:now-200_000}]},lineItems:{elements:[{id:'line',item:{id:'item'},modifications:{elements:[]}}]}};
 const db=new Database(sql);globalThis.testDB=db;
 globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/orders'))return Response.json({elements:url.searchParams.getAll('filter').some(value=>value.startsWith('deletedTime'))?[]:[{id:order.id,modifiedTime:order.modifiedTime}]});
  if(url.pathname.endsWith('/orders/'+order.id))return Response.json(order);
  throw new Error('Unexpected provider request; all provider access must be mocked.');
 };
 const balance=()=>sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id='cup'").get().on_hand_minor;
 const state=revision=>sql.prepare("SELECT s.state,s.last_reason FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a' AND e.external_order_id='order' AND e.revision=?").get(revision);
 let clockTime=now,sequence=0;
 const clock={now:()=>new Date(clockTime)},idFactory=()=>`recovery-${++sequence}`;
 const store=new D1SalesEventStore(db,idFactory),inventory=new D1InventoryConsumptionPort(db,{clock,idFactory});
 const service=options=>new SalesIngestionService(store,new D1SalesMappingPort(db),inventory,{clock,idFactory,...options});
 const source={kind:'native',provider:'clover',environment:'sandbox',connectionId:'clover:a',merchantId:'merchant',locationId:'merchant'};
 const context={companyId:'a',source,actor:{kind:'machine',machineId:'mock-clover',companyId:'a',source}};
 const draft=(revision=1,count=1,overrides={})=>({schemaVersion:'pantrack.sales.v1',externalEventId:`direct-${revision}`,externalOrderId:'direct-order',revision,eventType:'sale',orderStatus:'completed',preparationStatus:'fulfilled',occurredAt:new Date(now-200_000).toISOString(),timeQuality:'provider',lines:Array.from({length:count},(_,index)=>({externalLineId:`direct-line-${index}`,externalItemId:'item',quantity:'1',modifiers:[]})),...overrides});
 return {sql,db,order,now,balance,state,store,inventory,service,context,draft,setNow:value=>{clockTime=value;}};
}

const eventRow=(h,eventKey)=>h.sql.prepare("SELECT e.application_key,s.state,s.lease_attempt_id,s.lease_expires_at FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a' AND e.event_key=?").get(eventKey);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const closed=h=>{assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);h.sql.close();};

// Real D1 services with mocked Clover: the first deduction committed, but its
// response was lost. The next complete revision must consume only its new line.
{
 const h=await fixture(),firstRevision=h.order.modifiedTime;h.db.failResultRead=true;
 await assert.rejects(()=>syncClover('a'),/could not be applied/);
 assert.equal(h.balance(),'9');assert.equal(h.state(firstRevision).state,'failed');
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,1);
 h.order.modifiedTime+=1000;
 h.order.lineItems.elements.push({id:'line-added',item:{id:'item'},modifications:{elements:[]}});
 await syncClover('a');
 assert.equal(h.balance(),'8','A later revision must not repeat the already committed deduction.');
 assert.equal(h.state(firstRevision).state,'applied','The known committed predecessor is reconciled before supersession.');
 const original=h.sql.prepare("SELECT r.* FROM sales_event_attempt_results r JOIN sales_events e ON e.company_id=r.company_id AND e.event_key=r.event_key WHERE e.company_id='a' AND e.revision=? AND r.outcome='failed'").get(firstRevision);
 assert.equal(original.error_code,'inventory_unavailable','The original failed attempt remains immutable.');
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE action='inventory_reconciled'").get().n,1);
 await syncClover('a');assert.equal(h.balance(),'8','Repeated scans do not change inventory.');
 h.order.modifiedTime+=1000;h.order.lineItems.elements.push({id:'line-third',item:{id:'item'},modifications:{elements:[]}});
 await syncClover('a');assert.equal(h.balance(),'7','Successive revisions each consume only their additional line.');
 await syncClover('a');assert.equal(h.balance(),'7');
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM inventory_events_exact WHERE action='sale_consumption'").get().n,3);
 closed(h);
}

// Same-key retry reads the original recipe/mapping outcome even after mappings
// and the current stock cutoff have changed. No recalculation or stock write.
{
 const h=await fixture(),service=h.service();h.db.failResultRead=true;
 const receipt=await service.receive(h.context,h.draft());
 assert.equal((await service.process('a',receipt.eventKey)).state,'failed');assert.equal(h.balance(),'9');
 const row=eventRow(h,receipt.eventKey),stored=h.sql.prepare('SELECT result_json FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=?').get('a',row.application_key).result_json;
 h.sql.prepare("DELETE FROM clover_item_mappings WHERE company_id='a'").run();
 h.sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at=? WHERE company_id='a' AND product_id='cup'").run(new Date(h.now-1000).toISOString());
 const owner={kind:'user',userId:'owner',companyId:'a',role:'owner'};
 await service.retry('a',receipt.eventKey,owner,'Verify the original committed application');
 assert.equal((await service.process('a',receipt.eventKey)).state,'applied');assert.equal(h.balance(),'9');
 const result=h.sql.prepare("SELECT inventory_result_json FROM sales_event_attempt_results WHERE company_id='a' AND event_key=? AND outcome='applied'").get(receipt.eventKey);
 assert.equal(JSON.parse(result.inventory_result_json).selectedVersions[0].recipeVersionId,'drink-v1');
 assert.equal(JSON.parse(result.inventory_result_json).replayed,true);
 assert.equal(h.sql.prepare('SELECT result_json FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=?').get('a',row.application_key).result_json,stored);
 assert.equal(await h.inventory.lookupApplied('b',row.application_key),null,'Result lookup is company-scoped.');
 await assert.rejects(()=>h.store.reconcileApplied('b',receipt.eventKey,JSON.parse(result.inventory_result_json),new Date(h.now).toISOString()),/does not belong/);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,1);closed(h);
}

// A crash between inventory commit and terminal sales completion is reconciled
// after the lease is fenced, without replacing the interrupted audit result.
{
 const h=await fixture(),crashed=h.service({afterInventoryApply:()=>{throw new Error('Injected crash after commit.');}});
 const receipt=await crashed.receive(h.context,h.draft());
 await assert.rejects(()=>crashed.process('a',receipt.eventKey),/crash after commit/);
 assert.equal(h.balance(),'9');assert.equal(eventRow(h,receipt.eventKey).state,'processing');
 h.setNow(h.now+360_000);const restarted=h.service();
 assert.deepEqual(await restarted.recoverExpiredLeases('b'),[]);
 const recoveries=await Promise.all([restarted.recoverExpiredLeases('a'),restarted.recoverExpiredLeases('a')]);
 assert.deepEqual(recoveries.flat(),[receipt.eventKey]);
 assert.equal(eventRow(h,receipt.eventKey).state,'applied');assert.equal(h.balance(),'9');
 const interrupted=h.sql.prepare("SELECT error_code FROM sales_event_attempt_results WHERE event_key=? AND outcome='failed'").get(receipt.eventKey);
 assert.equal(interrupted.error_code,'interrupted');
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE event_key=? AND action='inventory_reconciled'").get(receipt.eventKey).n,1);
 const newer=await restarted.receive(h.context,h.draft(2,2));
 assert.equal((await restarted.process('a',newer.eventKey)).state,'applied');assert.equal(h.balance(),'8');closed(h);
}

// A failed batch with no commit leaves the whole new revision to be consumed.
{
 const h=await fixture(),service=h.service();h.db.beforeInventoryCommit=()=>{throw new Error('Injected failure before commit.');};
 const first=await service.receive(h.context,h.draft());
 assert.equal((await service.process('a',first.eventKey)).state,'failed');assert.equal(h.balance(),'10');
 assert.equal(await h.inventory.lookupApplied('a',eventRow(h,first.eventKey).application_key),null);
 const newer=await service.receive(h.context,h.draft(2,2));
 assert.equal(eventRow(h,first.eventKey).state,'superseded');
 assert.equal((await service.process('a',newer.eventKey)).state,'applied');assert.equal(h.balance(),'8');
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,1);closed(h);
}

// Deterministic race: an old worker is paused immediately before its batch.
// Recovery fences it, a newer revision commits, then the old worker resumes.
{
 const h=await fixture(),service=h.service(),entered=deferred(),resume=deferred();
 h.db.beforeInventoryCommit=async()=>{entered.resolve();await resume.promise;};
 const first=await service.receive(h.context,h.draft());
 const pending=service.process('a',first.eventKey);
 const staleRejected=assert.rejects(pending,/lease|processing|Attempt is missing/);
 await entered.promise;assert.equal(h.balance(),'10');
 h.setNow(h.now+360_000);assert.deepEqual(await service.recoverExpiredLeases('a'),[first.eventKey]);
 assert.equal(await h.inventory.lookupApplied('a',eventRow(h,first.eventKey).application_key),null);
 const newer=await service.receive(h.context,h.draft(2,2));
 assert.equal((await service.process('a',newer.eventKey)).state,'applied');assert.equal(h.balance(),'8');
 resume.resolve();await staleRejected;assert.equal(h.balance(),'8','An expired worker cannot create a late deduction.');
 assert.equal(await h.inventory.lookupApplied('a',eventRow(h,first.eventKey).application_key),null);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,1);closed(h);
}

// Direct receipt and claim paths cannot bypass outcome reconciliation.
{
 const h=await fixture(),service=h.service();h.db.failResultRead=true;
 const first=await service.receive(h.context,h.draft());await service.process('a',first.eventKey);
 const original=await h.store.event('a',first.eventKey),at=new Date(h.now).toISOString();
 const newer=structuredClone(original);newer.event.external={...newer.event.external,externalEventId:'direct-store-newer',eventIdempotencyKey:'direct-store-newer',revision:2};
 newer.event.lines.push({...newer.event.lines[0],externalLineId:'added'});newer.event.integrity.sourcePayloadSha256='direct-store-hash';newer.applicationKey='direct-store-application';
 await h.store.receive('a',newer,'worker',at);
 assert.equal(eventRow(h,first.eventKey).state,'failed','Receipt trigger keeps a committed predecessor unresolved.');
 assert.equal(await h.store.claim('a','direct-store-newer',{attemptId:'bypass-attempt',eventKey:'direct-store-newer',startedAt:at,leaseExpiresAt:new Date(h.now+300_000).toISOString()},at),false);
 assert.equal(eventRow(h,first.eventKey).state,'failed','Claim-time supersession also preserves the committed predecessor.');
 const saved=await h.inventory.lookupApplied('a',original.applicationKey);
 assert.equal(await h.store.reconcileApplied('a',first.eventKey,saved,at),true);
 assert.equal(await h.store.reconcileApplied('a',first.eventKey,saved,at),false,'Reconciliation is idempotent.');
 assert.equal((await service.process('a','direct-store-newer')).state,'applied');assert.equal(h.balance(),'8');closed(h);
}

// A replacement attempt may apply the same key after fencing the old worker.
// Resuming the old worker cannot overwrite the replacement's terminal result.
{
 const h=await fixture(),service=h.service(),entered=deferred(),resume=deferred();
 h.db.beforeInventoryCommit=async()=>{entered.resolve();await resume.promise;};
 const first=await service.receive(h.context,h.draft()),pending=service.process('a',first.eventKey);
 const staleRejected=assert.rejects(pending,/lease|processing|Attempt is missing/);await entered.promise;
 h.setNow(h.now+360_000);await service.recoverExpiredLeases('a');
 await service.retry('a',first.eventKey,{kind:'user',userId:'owner',companyId:'a',role:'owner'},'Retry after fencing the expired worker');
 assert.equal((await service.process('a',first.eventKey)).state,'applied');assert.equal(h.balance(),'9');
 const terminal=h.sql.prepare("SELECT * FROM sales_event_attempt_results WHERE company_id='a' AND event_key=? ORDER BY attempt_id").all(first.eventKey);
 resume.resolve();await staleRejected;assert.equal(h.balance(),'9');
 assert.deepEqual(h.sql.prepare("SELECT * FROM sales_event_attempt_results WHERE company_id='a' AND event_key=? ORDER BY attempt_id").all(first.eventKey),terminal);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,1);closed(h);
}

// A worker can also stall after committing inventory but before completing its
// sales attempt. Recovery and a newer revision win; its late completion fails.
{
 const h=await fixture(),entered=deferred(),resume=deferred();
 const old=h.service({afterInventoryApply:async()=>{entered.resolve();await resume.promise;}}),restarted=h.service();
 const first=await old.receive(h.context,h.draft()),pending=old.process('a',first.eventKey);
 const staleRejected=assert.rejects(pending,/lease|processing|Attempt is missing/);await entered.promise;
 assert.equal(h.balance(),'9');h.setNow(h.now+360_000);await restarted.recoverExpiredLeases('a');
 const newer=await restarted.receive(h.context,h.draft(2,2));await restarted.process('a',newer.eventKey);assert.equal(h.balance(),'8');
 const history=h.sql.prepare("SELECT * FROM sales_event_attempt_results WHERE company_id='a' ORDER BY attempt_id").all();
 resume.resolve();await staleRejected;assert.equal(h.balance(),'8');
 assert.deepEqual(h.sql.prepare("SELECT * FROM sales_event_attempt_results WHERE company_id='a' ORDER BY attempt_id").all(),history);closed(h);
}

// Database enforcement also rejects old code that omits the lease context.
{
 const h=await fixture(),service=h.service(),first=await service.receive(h.context,h.draft());
 const at=new Date(h.now).toISOString(),attempt={attemptId:'raw-attempt',eventKey:first.eventKey,startedAt:at,leaseExpiresAt:new Date(h.now+300_000).toISOString()};
 assert.equal(await h.store.claim('a',first.eventKey,attempt,at),true);
 const request={contract:'pantrack.inventory-consumption.v1',companyId:'a',idempotencyKey:eventRow(h,first.eventKey).application_key,occurredAt:h.draft().occurredAt,lines:[{lineId:'direct-line-0',recipeId:'drink',quantity:'1',modifiers:[]}]};
 await assert.rejects(()=>h.inventory.consume(request),/no longer owns/);assert.equal(h.balance(),'10');
 await assert.rejects(()=>h.inventory.consume(request,{eventKey:'wrong-event',attemptId:'raw-attempt'}),/Inventory kept changing/);assert.equal(h.balance(),'10');
 const result=await h.inventory.consume(request,{eventKey:first.eventKey,attemptId:'raw-attempt'});
 assert.equal(result.status,'applied');assert.equal(h.balance(),'9');assert.equal(result._salesAttemptId,undefined,'Private fencing data never enters the public result.');closed(h);
}

// Unauthorized receipt attempts cannot trigger automatic reconciliation, and
// malformed or foreign durable results block new processing without stock use.
{
 const h=await fixture(),service=h.service();h.db.failResultRead=true;
 const first=await service.receive(h.context,h.draft());await service.process('a',first.eventKey);
 for(const actor of [null,{kind:'user',userId:'employee',companyId:'a',role:'employee'},{...h.context.actor,companyId:'b'}]){
  await assert.rejects(()=>service.receive({...h.context,actor},h.draft(2,2)),error=>['unauthenticated','source_mismatch','forbidden_role','wrong_company'].includes(error.code));
  assert.equal(eventRow(h,first.eventKey).state,'failed');
 }
 const key=eventRow(h,first.eventKey).application_key,row=h.sql.prepare('SELECT result_json FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=?').get('a',key);
 for(const mutate of [result=>({...result,companyId:'b'}),result=>({...result,idempotencyKey:'other'}),result=>({...result,selectedVersions:[{...result.selectedVersions[0],recipeVersionId:null}]})]){
  h.sql.prepare('UPDATE inventory_consumption_applications SET result_json=? WHERE company_id=? AND idempotency_key=?').run(JSON.stringify(mutate(JSON.parse(row.result_json))),'a',key);
  await assert.rejects(()=>service.receive(h.context,h.draft(2,2)),/failed validation/);assert.equal(h.balance(),'9');
  assert.equal(eventRow(h,first.eventKey).state,'failed');assert.equal(h.sql.prepare('SELECT count(*) AS n FROM sales_events').get().n,1);
 }
 h.sql.prepare('UPDATE inventory_consumption_applications SET result_json=? WHERE company_id=? AND idempotency_key=?').run(row.result_json,'a',key);closed(h);
}

// An independent provider/merchant lineage with the same order reference never
// inherits another lineage's consumption baseline. Negative corrections hold.
{
 const h=await fixture(),service=h.service();h.db.failResultRead=true;
 const first=await service.receive(h.context,h.draft());await service.process('a',first.eventKey);
 const source={...h.context.source,provider:'other-pos'},other={...h.context,source,actor:{...h.context.actor,source}};
 const separate=await service.receive(other,h.draft(2,2));
 assert.equal((await service.process('a',separate.eventKey)).state,'held');assert.equal(eventRow(h,first.eventKey).state,'failed');
 const newer=await service.receive(h.context,h.draft(2,2));await service.process('a',newer.eventKey);assert.equal(h.balance(),'8');
 const correction=await service.receive(h.context,h.draft(3,1));
 assert.equal((await service.process('a',correction.eventKey)).state,'held');assert.equal(h.balance(),'8');
 const refund=await service.receive(h.context,h.draft(4,1,{eventType:'refund',orderStatus:'refunded'}));
 assert.equal((await service.process('a',refund.eventKey)).state,'applied');assert.equal(h.balance(),'8');
 const cancel=await service.receive(h.context,h.draft(5,1,{eventType:'cancellation',orderStatus:'canceled',preparationStatus:'not_started'}));
 assert.equal((await service.process('a',cancel.eventKey)).state,'applied');assert.equal(h.balance(),'8');closed(h);
}

// Populated upgrade changes triggers only: every existing table row, including
// failed sales results and immutable recipes/applications/movements, is retained.
{
 const h=await fixture({through:33}),service=h.service();h.db.failResultRead=true;
 const first=await service.receive(h.context,h.draft());await service.process('a',first.eventKey);
 // Older application records have no private sales token. Upgrade must retain
 // and recover them through their original public result and company/key.
 h.sql.prepare("UPDATE inventory_consumption_applications SET result_json=json_remove(result_json,'$._salesAttemptId')").run();
 const snapshot=()=>Object.fromEntries(h.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sql.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));
 const before=snapshot();applyFence(h.sql);
 assert.deepEqual(snapshot(),before,'Upgrade preserves all populated rows.');
 const newer=await service.receive(h.context,h.draft(2,2));
 assert.equal((await service.process('a',newer.eventKey)).state,'applied');assert.equal(h.balance(),'8');
 assert.equal(h.sql.prepare("SELECT count(*) AS n FROM inventory_events_exact WHERE action='sale_consumption'").get().n,2);
 closed(h);
}

// Upgrade also retains terminal supersession history from an earlier failure.
// Recovering its baseline never rewrites that history or adjusts existing stock.
{
 const h=await fixture({through:33}),service=h.service();h.db.failResultRead=true;
 const first=await service.receive(h.context,h.draft());await service.process('a',first.eventKey);
 h.sql.prepare("UPDATE sales_event_states SET state='superseded',last_reason='newer_revision' WHERE company_id='a' AND event_key=?").run(first.eventKey);
 const transitions=h.sql.prepare("SELECT * FROM sales_event_transitions WHERE event_key=? ORDER BY transition_id").all(first.eventKey);
 applyFence(h.sql);assert.equal(h.balance(),'9');
 const newer=await service.receive(h.context,h.draft(2,2));await service.process('a',newer.eventKey);assert.equal(h.balance(),'8');
 assert.equal(eventRow(h,first.eventKey).state,'superseded');
 assert.deepEqual(h.sql.prepare("SELECT * FROM sales_event_transitions WHERE event_key=? ORDER BY transition_id").all(first.eventKey),transitions);closed(h);
}

console.log('PASS: durable inventory outcomes protect later sales revisions from repeated stock deductions.');
