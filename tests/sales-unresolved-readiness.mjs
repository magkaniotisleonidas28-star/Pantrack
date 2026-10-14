import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
const mocks={name:'readiness-mocks',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$|^@\/db\/raw$/},args=>({path:args.path,namespace:'mock'}));
 builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.testEnv':'export function database(){return globalThis.testDB}'}));
}};
for(const [name,path] of [['sync','clover-sync'],['crypto','vendor-adapter'],['sales','sales-ingestion'],['store','d1-sales-event-store'],['inventory','d1-inventory-consumption'],['runtime','d1-sales-runtime'],['readiness','d1-replenishment-sales-readiness'],['guard','d1-replenishment-clover-source'],['settings','d1-replenishment-settings'],['origins','d1-replenishment-proposal-origins'],['lifecycle','d1-replenishment-lifecycle'],['review','d1-replenishment-review'],['proposal','replenishment-proposal'],['handoff','replenishment-lifecycle'],['consumer','c4-fake-supplier-consumer']]){
 await build({entryPoints:[`src/lib/${path}.ts`],bundle:true,platform:'node',format:'esm',outfile:`.sites-runtime/unresolved-${name}.mjs`,plugins:[mocks]});
}
globalThis.testEnv={CLOVER_ENVIRONMENT:'sandbox',CLOVER_CLIENT_ID:'fictional-app',CLOVER_CLIENT_SECRET:'fictional-secret',VENDOR_ENCRYPTION_KEY:btoa('a'.repeat(32)),PANTRACK_CLOVER_SYNC_ENABLED:'enabled'};
const {syncClover}=await import('../.sites-runtime/unresolved-sync.mjs');
const {encrypt}=await import('../.sites-runtime/unresolved-crypto.mjs');
const {SalesIngestionService}=await import('../.sites-runtime/unresolved-sales.mjs');
const {D1SalesEventStore}=await import('../.sites-runtime/unresolved-store.mjs');
const {D1InventoryConsumptionPort}=await import('../.sites-runtime/unresolved-inventory.mjs');
const {D1SalesMappingPort}=await import('../.sites-runtime/unresolved-runtime.mjs');
const {D1ReplenishmentSalesReadiness}=await import('../.sites-runtime/unresolved-readiness.mjs');
const {cloverSourceGuard}=await import('../.sites-runtime/unresolved-guard.mjs');
const {D1ReplenishmentSettingsStore}=await import('../.sites-runtime/unresolved-settings.mjs');
const {D1ReplenishmentProposalOrigins}=await import('../.sites-runtime/unresolved-origins.mjs');
const {D1ReplenishmentLifecycle}=await import('../.sites-runtime/unresolved-lifecycle.mjs');
const {D1ReplenishmentReview}=await import('../.sites-runtime/unresolved-review.mjs');
const {buildReviewProposal}=await import('../.sites-runtime/unresolved-proposal.mjs');
const {buildProposalHandoff}=await import('../.sites-runtime/unresolved-handoff.mjs');
const {C4FakeSupplierConsumer}=await import('../.sites-runtime/unresolved-consumer.mjs');
const policy={syncEnabled:true,maxLagMs:600_000};

class Statement{
 constructor(db,query,values=[]){this.db=db;this.query=query;this.values=values;}
 bind(...values){return new Statement(this.db,this.query,values);}
 async first(){
  if(/^\s*SELECT request_fingerprint,result_json FROM inventory_consumption_applications/.test(this.query)){
   const committed=this.db.sql.prepare('SELECT 1 FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=?').get(...this.values);
   if(this.db.failInitialLookup&&!committed){this.db.failInitialLookup=false;throw Error('Injected failure before inventory commit.');}
   if(this.db.failCommittedLookup&&committed){this.db.failCommittedLookup=false;throw Error('Injected lost committed result.');}
  }
  return this.db.sql.prepare(this.query).get(...this.values)??null;
 }
 async all(){return {success:true,results:this.db.sql.prepare(this.query).all(...this.values),meta:{changes:0}};}
 runSync(){
  const statement=this.db.sql.prepare(this.query);
  if(/^\s*SELECT\b/i.test(this.query))return {success:true,results:statement.all(...this.values),meta:{changes:0}};
  const result=statement.run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};
 }
 async run(){
  const key=this.query.includes('INSERT INTO replenishment_proposal_origins')?'beforeInsert':this.query.includes('UPDATE replenishment_proposal_states')?'beforeEdit':null;
  if(key&&this.db[key]){const hook=this.db[key];this.db[key]=null;await hook();}
  return this.runSync();
 }
}
class Database{
 constructor(sql){this.sql=sql;this.failInitialLookup=false;this.failCommittedLookup=false;this.beforeInsert=null;this.beforeEdit=null;}
 prepare(query){return new Statement(this,query);}
 async batch(statements){this.sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.runSync());this.sql.exec('COMMIT');return results;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}

async function fixture({through=Infinity}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.filter(entry=>entry.idx<=through))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
 const now=Date.now(),at=new Date(now).toISOString(),cutoff=new Date(now-600_000).toISOString(),started=now-300_000;
 const token={access_token:'fictional-access',refresh_token:'fictional-refresh',access_token_expiration:Math.floor(now/1000)+3600,refresh_token_expiration:Math.floor(now/1000)+86400};
 for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company,company,cutoff);
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company,'cup','{}');
  sql.prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)').run(company,'cup','canonical',1,'curated','count','canonical','1','1','fixture',cutoff);
  sql.prepare('INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)').run(company,'cup','active',1,'active','canonical',1,'unit','1',cutoff,'fixture',cutoff);
  sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)").run(company,'cup','active','count','10',1,cutoff,cutoff);
  sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run(company,'drink','fixture',cutoff);
  sql.prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)").run(company,'drink','drink-v1','Drink','fixture',cutoff);
  sql.prepare("INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)").run(company,'drink','drink-v1',0,'cup','count','1','1');
  sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id='drink'").run(cutoff,company);
  sql.prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)').run(company,'sandbox',`merchant-${company}`,'item','drink');
  sql.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)').run(company,`merchant-${company}`,'sandbox',await encrypt(JSON.stringify(token),`clover:${company}`),cutoff,null);
  sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,last_success,lease_until) VALUES (?,?,?,?,?,?,0)').run(company,'sandbox',`merchant-${company}`,started,now-1000,new Date(now-1000).toISOString());
 }
 const db=new Database(sql);globalThis.testDB=db;
 const order={id:'order',createdTime:now-240_000,modifiedTime:now-190_000,total:500,paymentState:'PAID',payments:{elements:[{id:'payment',createdTime:now-200_000}]},lineItems:{elements:[{id:'line',item:{id:'item'},modifications:{elements:[]}}]}};
 globalThis.fetch=async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/orders'))return Response.json({elements:url.searchParams.getAll('filter').some(value=>value.startsWith('deletedTime'))?[]:[{id:order.id,modifiedTime:order.modifiedTime}]});if(url.pathname.endsWith('/orders/'+order.id))return Response.json(order);throw Error('Unexpected provider request; all access must be mocked.');};
 const clock={now:()=>new Date()},actor={companyId:'a',userId:'fictional-manager',role:'manager'},owner={kind:'user',companyId:'a',userId:'fictional-owner',role:'owner'};
 let sequence=0;const idFactory=()=>`unresolved-${++sequence}`;
 const store=new D1SalesEventStore(db,idFactory),inventory=new D1InventoryConsumptionPort(db,{clock,idFactory}),service=new SalesIngestionService(store,new D1SalesMappingPort(db),inventory,{clock,idFactory});
 const reader=new D1ReplenishmentSalesReadiness(db,{...policy,clock}),origins=new D1ReplenishmentProposalOrigins(db,{clock}),lifecycle=new D1ReplenishmentLifecycle(db,{clock,salesPolicy:policy}),review=new D1ReplenishmentReview(db,{clock});
 const q=minor=>({dimension:'count',minor:String(minor)});
 await new D1ReplenishmentSettingsStore(db,{clock}).save({companyId:'a',productId:'cup',changeId:'settings-1',expectedVersion:0,expectedConfigId:'active',expectedConfigVersion:1,actor,reason:'Fictional cup target',settings:{target:q(20),capacity:q(30),dailyUse:q(1),shelfDays:null,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'20'}});
 const request={companyId:'a',productId:'cup',actor,supplier:{companyId:'a',source:'fictional_fixture',mappingId:'mapping-1',mappingVersion:1,supplierId:'fictional-supplier',accountId:'fictional-account',locationId:'fictional-location',sku:'CUPS'},priceEstimate:{companyId:'a',source:'fictional_fixture',currency:'USD',perPackMinor:'100'}};
 const context=(company='a',provider='clover')=>{const source={kind:'native',provider,environment:'sandbox',connectionId:`${provider}:${company}`,merchantId:`merchant-${company}`,locationId:`merchant-${company}`};return {companyId:company,source,actor:{kind:'machine',machineId:'fictional-pos',companyId:company,source}};};
 const draft=(id='manual',revision=1)=>({schemaVersion:'pantrack.sales.v1',externalEventId:`${id}-${revision}`,externalOrderId:id,revision,eventType:'sale',orderStatus:'completed',preparationStatus:'fulfilled',occurredAt:new Date(now-200_000).toISOString(),timeQuality:'provider',lines:[{externalLineId:'line',externalItemId:'item',quantity:'1',modifiers:[]}]});
 const health=(company='a')=>reader.read(company,{...actor,companyId:company});
 const allowed=sales=>{const guard=cloverSourceGuard(sales,policy,new Date());return sql.prepare(`SELECT ${guard.sql} AS allowed`).get(...guard.args).allowed;};
 const balance=(company='a')=>sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get(company,'cup').on_hand_minor;
 const create=id=>origins.createWithClover({...request,id,createId:`create-${id}`},policy);
 return {sql,db,at,now,actor,owner,store,inventory,service,reader,origins,lifecycle,review,request,context,draft,health,allowed,balance,create};
}
const closed=h=>{assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);h.sql.close();};
const rejects=(promise,code)=>assert.rejects(promise,error=>error?.code===code);

async function pending(h,state,{company='a',provider='clover',id=`private-${state}`}={}){
 const draft=h.draft(id);
 if(state==='held')draft.lines[0].externalItemId='unmapped';
 const receipt=await h.service.receive(h.context(company,provider),draft);
 if(state==='processing'){
  const startedAt=new Date().toISOString();
  assert.equal(await h.store.claim(company,receipt.eventKey,{attemptId:`attempt-${receipt.eventKey}`,eventKey:receipt.eventKey,startedAt,leaseExpiresAt:new Date(Date.now()+300_000).toISOString()},startedAt),true);
 }else if(state!=='received'){
  if(state==='failed')h.db.failInitialLookup=true;
  assert.equal((await h.service.process(company,receipt.eventKey)).state,state);
 }
 return receipt;
}

async function identityConflict(h,id='private-conflict',company='a',provider='clover'){
 const original=h.draft(id),context=h.context(company,provider);
 const canonical=await h.service.receive(context,original);
 if(provider==='clover')assert.equal((await h.service.process(company,canonical.eventKey)).state,'applied');
 const changed=structuredClone(original);changed.lines[0].quantity='2';
 const conflict=await h.service.receive(context,changed);assert.equal(conflict.kind,'conflict');
 return conflict;
}

async function lateOutcome(h,kind){
 if(kind==='failed')return ()=>pending(h,'failed');
 const original=h.draft('late-conflict'),canonical=await h.service.receive(h.context(),original);
 assert.equal((await h.service.process('a',canonical.eventKey)).state,'applied');
 const changed=structuredClone(original);changed.lines[0].quantity='2';
 return async()=>{assert.equal((await h.service.receive(h.context(),changed)).kind,'conflict');};
}

// Real Clover poll, sales store and inventory port: a pre-commit failure remains
// unresolved after a successful duplicate scan, despite its fresh checkpoint.
{
 const h=await fixture();h.db.failInitialLookup=true;
 await assert.rejects(()=>syncClover('a'),/could not be applied/);
 assert.equal(h.balance(),'10');
 const failed=h.sql.prepare("SELECT e.event_key,s.state FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a'").get();
 assert.equal(failed.state,'failed');assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,0);
 const duplicate=await syncClover('a');assert.equal(duplicate.created,0);assert.equal(duplicate.duplicates,1);assert.equal(duplicate.held,0);
 const sync=h.sql.prepare("SELECT last_success,last_error FROM clover_sync_state WHERE company_id='a'").get();
 assert.ok(sync.last_success);assert.equal(sync.last_error,null);assert.equal(h.balance(),'10');
 const health=await h.health();
 assert.deepEqual({status:health.status,allowed:h.allowed(health)},{status:'degraded',allowed:0},'A successful duplicate poll must not hide the unapplied sale or permit a durable write.');
 assert.equal(health.heldEventCount,0);assert.ok(health.reasons.includes('unresolved_events'));assert.equal(h.allowed(health),0);
 await rejects(h.create('failed-sale-review'),'source_unavailable');
 await h.service.retry('a',failed.event_key,h.owner,'Retry the verified unapplied sale');
 assert.equal((await h.service.process('a',failed.event_key)).state,'applied');assert.equal(h.balance(),'9');
 const applied=await h.health();assert.equal(applied.status,'current');assert.equal(h.allowed(applied),1);
 await h.create('applied-sale-review');
 await syncClover('a');assert.equal(h.balance(),'9');assert.equal((await h.health()).status,'current');
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n,1);closed(h);
}

// Every active state blocks both the reader and a previously captured current
// source. Employee health contains no order/event references or failure details.
for(const state of ['received','processing','held','failed']){
 const h=await fixture(),before=await h.health();assert.equal(h.allowed(before),1);
 await pending(h,state);
 const changes=h.sql.prepare('SELECT total_changes() AS n').get().n,health=await h.health();
 assert.equal(health.status,'degraded');assert.ok(health.reasons.includes('unresolved_events'));
 assert.equal(health.heldEventCount,state==='held'?1:0);
 assert.equal(h.allowed(before),0,'An old current snapshot cannot bypass live sales state.');
 assert.equal(h.allowed(health),0);assert.equal(h.sql.prepare('SELECT total_changes() AS n').get().n,changes,'Readiness is read-only.');
 await rejects(h.create(`blocked-${state}`),'source_unavailable');
 const employee=await h.reader.read('a',{...h.actor,role:'employee'});
 assert.equal(employee.status,'degraded');assert.ok(!JSON.stringify(employee).includes(`private-${state}`));
 await assert.rejects(()=>h.reader.read('a',null),/Company access/);
 await assert.rejects(()=>h.reader.read('a',{...h.actor,companyId:'b'}),/Company access/);
 assert.equal(h.balance(),'10');closed(h);
}

// Canonical source/company bindings cover both active records and conflict
// receipts. Other providers and other companies never taint company A's health.
{
 const h=await fixture();
 await pending(h,'failed',{company:'b'});await identityConflict(h,'private-b-conflict','b');
 await pending(h,'held',{provider:'other-pos'});await identityConflict(h,'private-other-conflict','a','other-pos');
 const health=await h.health();assert.equal(health.status,'current');assert.equal(health.heldEventCount,0);assert.equal(h.allowed(health),1);
 assert.equal((await h.health('b')).status,'degraded');
 assert.ok(!JSON.stringify(health).includes('private-b'));assert.equal(h.balance(),'10');
 await h.create('isolated-review');closed(h);
}

// An applied canonical event does not resolve a contradictory identity receipt.
// Only the audited, authorized conflict dismissal releases that hold.
{
 const h=await fixture(),before=await h.health(),conflict=await identityConflict(h);
 const ledger=h.sql.prepare('SELECT * FROM inventory_consumption_applications').all();
 assert.equal((await h.health()).status,'degraded');assert.equal(h.allowed(before),0);assert.equal(h.balance(),'9');
 await rejects(h.create('conflict-review'),'source_unavailable');
 for(const actor of [null,{...h.owner,companyId:'b'},{...h.owner,role:'employee'}]){
  await assert.rejects(()=>h.service.dismissConflict('a',conflict.conflictId,actor,'Review conflict'),error=>['unauthenticated','wrong_company','forbidden_role'].includes(error.code));
 }
 await h.service.dismissConflict('a',conflict.conflictId,h.owner,'Reviewed the conflicting duplicate');
 const health=await h.health();assert.equal(health.status,'current');assert.equal(h.allowed(health),1);
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM sales_event_conflicts').get().n,1,'The original conflict remains immutable.');
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM sales_event_conflict_resolutions').get().n,1);
 assert.deepEqual(h.sql.prepare('SELECT * FROM inventory_consumption_applications').all(),ledger);closed(h);
}

// Simulate a failure or identity conflict immediately before the real origin
// insert or edit statement. No stock change or sync timestamp change is needed.
for(const kind of ['failed','conflict']){
 const h=await fixture();
 h.db.beforeInsert=await lateOutcome(h,kind);
 const insertStock=h.balance();
 await rejects(h.create(`insert-race-${kind}`),'source_changed');
 assert.equal(h.sql.prepare('SELECT count(*) AS n FROM replenishment_proposal_origins').get().n,0);
 assert.equal(h.balance(),insertStock,'The write must detect the unresolved outcome even without a stock/version change.');
 closed(h);

 const edit=await fixture(),change=await lateOutcome(edit,kind),origin=await edit.create(`edit-race-${kind}`),editStock=edit.balance();
 const snapshotJson=edit.sql.prepare('SELECT snapshot_json FROM replenishment_proposal_origins WHERE id=?').get(origin.id).snapshot_json;
 edit.db.beforeEdit=change;
 await rejects(edit.lifecycle.edit({companyId:'a',proposalId:origin.id,expectedRevision:1,changeId:'race-edit',actor:edit.actor,packs:'1',reason:'Review fewer packs'}),'source_changed');
 assert.equal(edit.sql.prepare('SELECT count(*) AS n FROM replenishment_proposal_events').get().n,1,'The failed edit appends no false success.');
 assert.equal(edit.balance(),editStock,'No stock change can mask the conflict/failure guard.');
 const invalid=await edit.lifecycle.get('a',origin.id,edit.actor);
 assert.equal(invalid.revision,2);assert.equal(invalid.status,'review_required');assert.equal(invalid.invalidationReason,'source_unavailable');
 assert.equal((await edit.lifecycle.get('a',origin.id,edit.actor)).revision,2,'Invalidation is audited once.');
 assert.equal(edit.sql.prepare('SELECT snapshot_json FROM replenishment_proposal_origins WHERE id=?').get(origin.id).snapshot_json,snapshotJson,'Immutable historical proposal inputs stay unchanged.');
 await edit.lifecycle.cancel({companyId:'a',proposalId:origin.id,expectedRevision:2,changeId:'cancel-invalid',actor:edit.actor,reason:'Replace unresolved sales review'});
 assert.equal(edit.sql.prepare('SELECT snapshot_json FROM replenishment_proposal_origins WHERE id=?').get(origin.id).snapshot_json,snapshotJson);closed(edit);
}

// Explicitly reviewed no-application dismissals and replaced unapplied revisions
// are resolved. A historical terminal record with an unacknowledged committed
// ledger remains unresolved until BUG-02 appends its original applied outcome.
{
 const h=await fixture(),held=await pending(h,'held');
 await h.service.dismiss('a',held.eventKey,h.owner,'Reviewed unknown item without stock use');
 assert.equal((await h.health()).status,'current');
 const first=await pending(h,'failed',{id:'revised'}),newer=await h.service.receive(h.context(),h.draft('revised',2));
 assert.equal(await h.store.state('a',first.eventKey),'superseded');
 assert.equal((await h.service.process('a',newer.eventKey)).state,'applied');
 assert.equal((await h.health()).status,'current');assert.equal(h.balance(),'9');closed(h);
 const old=await fixture({through:33});old.db.failCommittedLookup=true;
 const receipt=await old.service.receive(old.context(),old.draft('historical'));
 assert.equal((await old.service.process('a',receipt.eventKey)).state,'failed');assert.equal(old.balance(),'9');
 old.sql.prepare("UPDATE sales_event_states SET state='superseded',last_reason='newer_revision' WHERE company_id='a' AND event_key=?").run(receipt.eventKey);
 old.sql.exec(readFileSync('drizzle/0034_sales_inventory_outcome_fence.sql','utf8'));
 assert.equal((await old.health()).status,'degraded');assert.equal(old.allowed(await old.health()),0);
 const event=await old.store.event('a',receipt.eventKey),saved=await old.inventory.lookupApplied('a',event.applicationKey);
 await old.store.reconcileApplied('a',receipt.eventKey,saved,new Date().toISOString());
 assert.equal(await old.store.state('a',receipt.eventKey),'superseded');assert.equal((await old.health()).status,'current');assert.equal(old.balance(),'9');closed(old);
}

// Existing immutable v1/v2 shapes still decode. The added v2 reason travels
// through a degraded preview and C4's fake handoff without permitting submission.
{
 const h=await fixture(),current=(await h.review.buildWithClover(h.request,policy)).snapshot;
 const oldJson=JSON.stringify(current);assert.deepEqual(buildReviewProposal(JSON.parse(oldJson)),current);
 const v1=buildReviewProposal({...current,salesReadiness:{source:'fictional_fixture',status:'current',heldEventCount:0}});
 assert.equal(v1.contract,'pantrack.replenishment-review.v1');assert.deepEqual(buildReviewProposal(JSON.parse(JSON.stringify(v1))),v1);
 await pending(h,'failed');
 const degraded=(await h.review.buildWithClover(h.request,policy)).snapshot;
 assert.equal(degraded.contract,'pantrack.replenishment-review.v2');assert.ok(degraded.salesReadiness.reasons.includes('unresolved_events'));assert.ok(degraded.explanation.reviewReasons.includes('sales_not_current'));
 assert.deepEqual(buildReviewProposal(JSON.parse(JSON.stringify(degraded))),degraded);
 const versions={inventoryVersion:1,inventoryConfigId:'active',inventoryConfigVersion:1,settingsChangeId:'settings-1',settingsVersion:1},consumer=new C4FakeSupplierConsumer();
 for(const [id,snapshot] of [['legacy-v1',v1],['legacy-v2',JSON.parse(oldJson)],['degraded-v2',degraded]]){
  const handoff=buildProposalHandoff({companyId:'a',id,productId:'cup',snapshot},'review_required',1,versions);
  assert.equal(consumer.consume(JSON.parse(JSON.stringify(handoff)),'a').kind,'held');assert.equal(handoff.supplierSubmissionAllowed,false);
 }
 assert.equal(JSON.stringify(buildReviewProposal(JSON.parse(oldJson))),oldJson);
 writeFileSync('.sites-runtime/bug03-preview-fixtures.json',JSON.stringify({current,degraded}));closed(h);
}

console.log('PASS: unresolved Clover states/conflicts, duplicate polling, write races, tenant isolation, audited invalidation, terminal policy and v1/v2 compatibility.');
