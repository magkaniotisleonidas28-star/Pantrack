import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
writeFileSync('.sites-runtime/bug05-entry.ts',`export * from '../src/lib/sales-ingestion';export * from '../src/lib/d1-sales-event-store';export * from '../src/lib/d1-inventory-consumption';export * from '../src/lib/d1-sales-runtime';export {GET,POST} from '../src/app/api/sales/events/route';`);
await build({entryPoints:['.sites-runtime/bug05-entry.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/bug05-runtime.mjs',plugins:[{name:'local-auth',setup(b){
 b.onResolve({filter:/^@\/(db\/raw|lib\/(chatgpt-auth|company-access|authorization|exact-inventory-gate))$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('db/raw')?'export const database=()=>globalThis.bug05Db':path.endsWith('chatgpt-auth')?'export const getChatGPTUser=async()=>globalThis.bug05User':path.endsWith('company-access')?'export const companyAccess=async(_user,company)=>company==="a"?{role:globalThis.bug05Role}:null':path.endsWith('authorization')?'export const withCompanyRoute=(_name,handler)=>handler':'export const exactInventoryPreviewEnabled=()=>globalThis.bug05Enabled'}));
}}]});
const {SalesIngestionService,InMemorySalesEventStore,D1SalesEventStore,D1InventoryConsumptionPort,D1SalesMappingPort,GET,POST}=await import('../.sites-runtime/bug05-runtime.mjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const gate=()=>({entered:deferred(),release:deferred()});
class Statement{
 constructor(db,query,values=[]){Object.assign(this,{db,query,values});}
 bind(...values){return new Statement(this.db,this.query,values);}
 async first(){if(this.db.failLookup&&/^\s*SELECT request_fingerprint,result_json FROM inventory_consumption_applications/.test(this.query))throw new Error('Injected unreadable application outcome.');return this.db.sql.prepare(this.query).get(...this.values)??null;}
 async all(){const results=this.db.sql.prepare(this.query).all(...this.values);if(this.db.recoveryReads&&this.query.includes('SELECT event_key,lease_attempt_id')){const barrier=this.db.recoveryReads;if(++barrier.count===2)barrier.entered.resolve();await barrier.release.promise;}return {success:true,results,meta:{changes:0}};}
 runSync(){const s=this.db.sql.prepare(this.query);if(/^\s*SELECT\b/i.test(this.query))return {results:s.all(...this.values),meta:{changes:0}};const r=s.run(...this.values);return {success:true,results:[],meta:{changes:Number(r.changes)}};}
 async run(){return this.runSync();}
}
class Database{
 constructor(sql){this.sql=sql;}
 prepare(query){return new Statement(this,query);}
 async batch(statements){
  for(const [name,matches] of [['beforeCommit',s=>s.query.includes('INSERT OR IGNORE INTO inventory_consumption_applications')],['beforeCompletion',s=>s.query.includes('INSERT INTO sales_event_attempt_results')&&s.values[4]==='applied']]){
   if(this[name]&&statements.some(matches)){const pending=this[name];this[name]=null;pending.entered.resolve();await pending.release.promise;}
  }
  this.sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.runSync());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}
 }
}
export function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const {tag} of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
 const now=Date.now()-600000,cutoff=new Date(now-600000).toISOString();
 for(const company of ['a','b'])sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company,company,cutoff);
 sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a','cup','{}');
 sql.prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)').run('a','cup','canonical',1,'curated','count','canonical','1','1','fixture',cutoff);
 sql.prepare('INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)').run('a','cup','active',1,'active','canonical',1,'unit','1',cutoff,'fixture',cutoff);
 sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)").run('a','cup','active','count','10',1,cutoff,cutoff);
 sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run('a','drink','fixture',cutoff);
 sql.prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)").run('a','drink','drink-v1','Drink','fixture',cutoff);
 sql.prepare("INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)").run('a','drink','drink-v1',0,'cup','count','1','1');
 sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='a' AND recipe_id='drink'").run(cutoff);
 const db=new Database(sql),clock={now:()=>new Date(now)},store=new D1SalesEventStore(db),inventory=new D1InventoryConsumptionPort(db,{clock});
 const service=new SalesIngestionService(store,new D1SalesMappingPort(db),inventory,{clock});
 const source={kind:'manual',provider:'pantrack-manual',environment:'internal',connectionId:'manual',merchantId:'a',locationId:'default'};
 const owner={kind:'user',userId:'owner',companyId:'a',role:'owner'},context={companyId:'a',source,actor:owner};
 const draft=(revision=1,count=1,overrides={})=>({schemaVersion:'pantrack.sales.v1',externalEventId:`event-${revision}`,externalOrderId:'order',revision,eventType:'sale',orderStatus:'completed',preparationStatus:'fulfilled',occurredAt:new Date(now-200000).toISOString(),timeQuality:'confirmed',lines:Array.from({length:count},(_,i)=>({externalLineId:`line-${i}`,externalItemId:'drink',quantity:'1',modifiers:[]})),...overrides});
 globalThis.bug05Db=db;globalThis.bug05User={userId:'owner',email:'owner@example.test'};globalThis.bug05Role='owner';globalThis.bug05Enabled=true;
 const balance=()=>sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a'").get().on_hand_minor;
 return {sql,db,now,store,inventory,service,context,draft,owner,balance};
}
const server=createServer(async(req,res)=>{
 try{let body='';for await(const part of req)body+=part;const request=new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:{'Content-Type':'application/json'},...(req.method==='POST'?{body}:{})});
  const response=await (req.method==='POST'?POST:GET)(request);res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin=`http://127.0.0.1:${server.address().port}`;
const post=async(eventKey,overrides={})=>{const response=await fetch(origin+'/api/sales/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:'a',action:'recover',eventKey,reason:'Manager checked an interrupted sale.',...overrides})});return {status:response.status,body:await response.json()};};
try{
 const h=fixture(),pending=gate();h.db.beforeCommit=pending;const receipt=await h.service.receive(h.context,h.draft());
 const worker=h.service.process('a',receipt.eventKey).then(value=>({value}),error=>({error}));await pending.entered.promise;
 try{
  await assert.rejects(()=>h.service.process('a',receipt.eventKey),error=>error.code==='claim_conflict','Duplicate processing cannot reclaim an expired processing lease.');
  assert.equal((await post(receipt.eventKey,{action:'retry'})).status,409,'The original retry action cannot recover processing.');
  const recovered=await post(receipt.eventKey);assert.equal(recovered.status,200,'The runtime API must expose an authorized recovery action.');
  assert.equal(recovered.body.state,'failed');assert.equal(recovered.body.recovery,'not_applied');assert.equal(h.balance(),'10');
 }finally{pending.release.resolve();await worker;}
 assert.equal(h.balance(),'10','The expired worker cannot commit after the recovery fence.');
 assert.equal((await post(receipt.eventKey,{action:'retry'})).body.state,'applied');assert.equal(h.balance(),'9','Only an explicit audited retry applies the missing sale.');
 const next=await h.service.receive(h.context,h.draft(2,2));assert.equal((await h.service.process('a',next.eventKey)).state,'applied');assert.equal(h.balance(),'8');
 assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);h.sql.close();
 console.log('Runtime recovery: before-commit interruption, late-worker fence, explicit retry and next revision passed.');

 // Inventory committed, then the worker disappeared before saving its sales
 // result. Two runtime requests observe the old lease before either fences it.
 {
  const h=fixture(),pending=gate();h.db.beforeCompletion=pending;const receipt=await h.service.receive(h.context,h.draft());
  const worker=h.service.process('a',receipt.eventKey).then(value=>({value}),error=>({error}));await pending.entered.promise;
  const saved=h.sql.prepare('SELECT * FROM inventory_consumption_applications').get();assert.equal(h.balance(),'9');
  const readBarrier={...gate(),count:0};h.db.recoveryReads=readBarrier;
  try{
   const one=post(receipt.eventKey),two=post(receipt.eventKey);await readBarrier.entered.promise;readBarrier.release.resolve();
   const recovered=await Promise.all([one,two]);assert.deepEqual(recovered.map(r=>r.status),[200,200]);assert.ok(recovered.every(r=>r.body.state==='applied'));
   h.db.recoveryReads=null;
   assert.equal(h.balance(),'9');assert.deepEqual(h.sql.prepare('SELECT * FROM inventory_consumption_applications').get(),saved,'Recovery preserves the original inventory result byte for byte.');
   assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE action='lease_expired'").get().n,1);
   assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE action='inventory_reconciled'").get().n,1);
   assert.equal(h.sql.prepare("SELECT actor FROM sales_event_audits WHERE action='lease_expired'").get().actor,'user:owner');
   assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_attempt_results WHERE outcome='failed' AND error_code='interrupted'").get().n,1);
   assert.equal((await post(receipt.eventKey)).body.state,'applied');assert.equal(h.balance(),'9');
  }finally{readBarrier.release.resolve();pending.release.resolve();await worker;}
  assert.equal(h.balance(),'9','A late completion cannot repeat or overwrite recovered stock.');
  const next=await h.service.receive(h.context,h.draft(2,2));assert.equal((await h.service.process('a',next.eventKey)).state,'applied');assert.equal(h.balance(),'8','A newer revision deducts only its added line.');
  h.sql.close();
 }
 async function claim(h,receipt,{active=false,id='attempt'}={}){
  const time=active?Date.now():h.now;
  await h.store.claim('a',receipt.eventKey,{attemptId:id,eventKey:receipt.eventKey,startedAt:new Date(time).toISOString(),leaseExpiresAt:new Date(time+300000).toISOString()},new Date(time).toISOString());
 }
 // An active lease cannot be stolen, even with a misleading browser clock.
 {
  const h=fixture(),receipt=await h.service.receive(h.context,h.draft());await claim(h,receipt,{active:true});
  const before=h.sql.prepare('SELECT * FROM sales_event_states').all();const response=await post(receipt.eventKey);assert.equal(response.status,409);assert.match(response.body.error,/active processing lease/);
  assert.deepEqual(h.sql.prepare('SELECT * FROM sales_event_states').all(),before);assert.equal(h.balance(),'10');assert.equal(h.sql.prepare('SELECT count(*) AS n FROM sales_event_attempt_results').get().n,0);
  h.sql.close();
 }
 // A ledger outage clears/fences the expired lease but remains uncertain. A
 // repeat recovery verifies it later without replaying stock or expiry audits.
 {
  const h=fixture(),receipt=await h.service.receive(h.context,h.draft());await claim(h,receipt);h.db.failLookup=true;
  const failed=await post(receipt.eventKey);assert.equal(failed.status,503);assert.match(failed.body.error,/could not be verified/);assert.equal(await h.store.state('a',receipt.eventKey),'failed');assert.equal(h.balance(),'10');
  h.db.failLookup=false;assert.equal((await post(receipt.eventKey)).body.recovery,'not_applied');assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE action='lease_expired'").get().n,1);
  assert.equal((await post(receipt.eventKey,{action:'retry'})).body.state,'applied');assert.equal(h.balance(),'9');h.sql.close();
 }
 // Different recovery timestamps still append exactly one expiry audit.
 {
  const h=fixture(),receipt=await h.service.receive(h.context,h.draft());await claim(h,receipt);
  const barrier={...gate(),count:0};h.db.recoveryReads=barrier;
  const first=h.store.recoverExpired('a',new Date(h.now+360000).toISOString(),{eventKey:receipt.eventKey,limit:1,actor:'user:first',reason:'First manager check.'});
  const second=h.store.recoverExpired('a',new Date(h.now+361000).toISOString(),{eventKey:receipt.eventKey,limit:1,actor:'user:second',reason:'Second manager check.'});
  await barrier.entered.promise;barrier.release.resolve();assert.deepEqual((await Promise.all([first,second])).flat(),[receipt.eventKey]);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM sales_event_audits WHERE action='lease_expired'").get().n,1);h.sql.close();
 }
 // Bounded target action, actual route authentication/roles, input validation,
 // disabled gate, and read-only status/history behavior.
 {
  const h=fixture(),first=await h.service.receive(h.context,h.draft()),second=await h.service.receive(h.context,h.draft(1,1,{externalEventId:'other',externalOrderId:'other'}));
  await claim(h,first);await claim(h,second,{id:'other-attempt'});
  const before=h.sql.prepare('SELECT * FROM sales_event_states ORDER BY event_key').all();
  const get=await fetch(origin+'/api/sales/events?companyId=a');const status=await get.json();assert.ok(status.events.every(event=>event.leaseExpiresAt));
  await fetch(origin+'/api/sales/events?companyId=a&eventKey='+first.eventKey);assert.deepEqual(h.sql.prepare('SELECT * FROM sales_event_states ORDER BY event_key').all(),before,'GET status/history performs no recovery writes.');
  globalThis.bug05User=null;assert.equal((await post(first.eventKey)).status,401);globalThis.bug05User={userId:'owner',email:'owner@example.test'};
  assert.equal((await post(first.eventKey,{companyId:'b'})).status,403);globalThis.bug05Role='employee';assert.equal((await post(first.eventKey)).status,403);globalThis.bug05Role='manager';
  assert.equal((await post(first.eventKey,{reason:''})).status,400);assert.equal((await post(first.eventKey,{eventKey:undefined})).status,400);
  globalThis.bug05Enabled=false;assert.equal((await post(first.eventKey)).status,404);globalThis.bug05Enabled=true;
  await assert.rejects(()=>h.service.recover('a',first.eventKey,null,'Check'),e=>e.code==='unauthenticated');
  await assert.rejects(()=>h.service.recover('a',first.eventKey,{...h.owner,companyId:'b'},'Check'),e=>e.code==='wrong_company');
  await assert.rejects(()=>h.service.recover('a',first.eventKey,{...h.owner,role:'employee'},'Check'),e=>e.code==='forbidden_role');
  assert.deepEqual(h.sql.prepare('SELECT * FROM sales_event_states ORDER BY event_key').all(),before,'Rejected writes leave all leases untouched.');
  assert.equal((await post(first.eventKey)).body.state,'failed');assert.equal(await h.store.state('a',second.eventKey),'processing','Recovery targets exactly the selected sale.');assert.equal(h.balance(),'10');
  await assert.rejects(()=>h.store.recoverExpired('a',new Date().toISOString(),{limit:101}),e=>e.code==='invalid_limit');
  const memory=new InMemorySalesEventStore(),at=new Date(h.now).toISOString(),expiredAt=new Date(h.now+360000).toISOString();
  for(const [i,receipt] of [first,second].entries()){
   await memory.receive('a',await h.store.event('a',receipt.eventKey),'user:owner',at);
   await memory.claim('a',receipt.eventKey,{attemptId:`memory-${i}`,eventKey:receipt.eventKey,startedAt:at,leaseExpiresAt:new Date(h.now+300000).toISOString()},at);
  }
  assert.deepEqual(await memory.recoverExpired('b',expiredAt,{limit:1}),[]);
  assert.deepEqual(await memory.recoverExpired('a',expiredAt,{eventKey:second.eventKey,limit:1,actor:'user:manager',reason:'Checked selected sale.'}),[second.eventKey]);
  assert.equal(await memory.state('a',first.eventKey),'processing');assert.equal(memory.snapshot().audits.filter(a=>a.action==='lease_expired')[0].actor,'user:manager');
  await assert.rejects(()=>memory.recoverExpired('a',expiredAt,{limit:101}),e=>e.code==='invalid_limit');h.sql.close();
 }
 console.log('PASS: served recovery route handles pre/post-commit interruption, duplicate/concurrent recovery, late workers, new revisions, active leases, unreadable outcomes, bounded targeting, authorization, audits and disabled gates.');
}finally{await new Promise(ok=>server.close(ok));}
