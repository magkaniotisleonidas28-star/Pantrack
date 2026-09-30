import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

await build({entryPoints:[
  'src/lib/d1-replenishment-review.ts',
  'src/lib/d1-replenishment-settings.ts',
  'src/lib/replenishment-proposal.ts',
  'src/lib/replenishment-lifecycle.ts',
  'src/lib/c4-fake-supplier-consumer.ts',
  'src/lib/d1-replenishment-proposal-origins.ts',
  'src/lib/d1-replenishment-lifecycle.ts',
],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/a8-clover-review',outExtension:{'.js':'.mjs'}});
const dir='../.sites-runtime/a8-clover-review/';
const {D1ReplenishmentReview}=await import(`${dir}d1-replenishment-review.mjs`);
const {D1ReplenishmentSettingsStore}=await import(`${dir}d1-replenishment-settings.mjs`);
const {buildReviewProposal}=await import(`${dir}replenishment-proposal.mjs`);
const {buildProposalHandoff}=await import(`${dir}replenishment-lifecycle.mjs`);
const {C4FakeSupplierConsumer}=await import(`${dir}c4-fake-supplier-consumer.mjs`);
const {D1ReplenishmentProposalOrigins}=await import(`${dir}d1-replenishment-proposal-origins.mjs`);
const {D1ReplenishmentLifecycle}=await import(`${dir}d1-replenishment-lifecycle.mjs`);

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries){
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
}
const at='2026-09-29T12:00:00.000Z',now=Date.parse(at),minute=60_000;
for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,`Fictional ${company}`,at);
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,'milk','{"name":"Milk"}');
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
    VALUES (?,?,?,1,'curated','volume','mL','1','1','fictional-manager',?,NULL)`).run(company,'milk','mL',at);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
    VALUES (?,?,?,1,'active','mL',1,'case','250000000',NULL,?,NULL,'fictional-manager',?)`).run(company,'milk','config-1',at,at);
  sql.prepare(`INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at)
    VALUES (?,?,'config-1','volume','200000000','100000000','0',1,'2026-09-28T12:00:00.000Z',?)`).run(company,'milk',at);
}
class Statement{
  constructor(db,query,values=[]){this.db=db;this.query=query;this.values=values;}
  bind(...values){return new Statement(this.db,this.query,values);}
  async first(){return this.db.sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {success:true,results:this.db.sql.prepare(this.query).all(...this.values),meta:{changes:0}};}
  async run(){
    if(this.query.includes('INSERT INTO replenishment_proposal_origins')&&this.db.beforeInsert){
      const action=this.db.beforeInsert;this.db.beforeInsert=null;action();
    }
    if(this.query.includes('UPDATE replenishment_proposal_states')&&this.db.beforeStateUpdate){
      const action=this.db.beforeStateUpdate;this.db.beforeStateUpdate=null;action();
    }
    const result=this.db.sql.prepare(this.query).run(...this.values);
    return {success:true,results:[],meta:{changes:Number(result.changes)}};
  }
}
const db={sql,cloverReads:0,heldReads:0,onSecondCloverRead:null,onSecondHeldRead:null,prepare(query){
  if(query.includes('SELECT COUNT(*) AS n FROM sales_events e')){
    this.heldReads++;
    if(this.heldReads===2 && this.onSecondHeldRead){const action=this.onSecondHeldRead;this.onSecondHeldRead=null;action();}
  }
  if(query.includes('FROM clover_sync_state s LEFT JOIN')){
    this.cloverReads++;
    if(this.cloverReads===2 && this.onSecondCloverRead){const action=this.onSecondCloverRead;this.onSecondCloverRead=null;action();}
  }
  return new Statement(this,query);
}};
const actor={companyId:'a',userId:'fictional-manager',role:'manager'};
const q=minor=>({dimension:'volume',minor:String(minor)});
const settings={target:q(1000000000),capacity:q(1200000000),dailyUse:q(100000000),shelfDays:8,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'5'};
await new D1ReplenishmentSettingsStore(db,{clock:{now:()=>new Date(at)}}).save({
  companyId:'a',productId:'milk',changeId:'settings-1',expectedVersion:0,
  expectedConfigId:'config-1',expectedConfigVersion:1,actor,reason:'Fictional target',settings,
});
sql.prepare('INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)')
  .run('a','merchant-a','sandbox','encrypted-fictional-placeholder',at,at);
sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until) VALUES (?,?,?,?,?,?,?,?,0)')
  .run('a','sandbox','merchant-a',now-60*minute,now-minute,at,new Date(now-minute).toISOString(),null);
const supplier={companyId:'a',source:'fictional_fixture',mappingId:'mapping-1',mappingVersion:1,supplierId:'fake-supplier',accountId:'fake-account',locationId:'fake-location',sku:'MILK-CASE'};
const priceEstimate={companyId:'a',source:'fictional_fixture',currency:'USD',perPackMinor:'725'};
const request={companyId:'a',productId:'milk',actor,supplier,priceEstimate};
const policy={syncEnabled:true,maxLagMs:10*minute};
const review=new D1ReplenishmentReview(db,{clock:{now:()=>new Date(at)}});
const changesBefore=sql.prepare('SELECT total_changes() AS n').get().n;
const result=await review.buildWithClover(request,policy);
assert.equal(result.kind,'snapshot');
assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,changesBefore,'Clover review must be read-only.');
const snapshot=result.snapshot;
assert.equal(snapshot.contract,'pantrack.replenishment-review.v2');
assert.equal(snapshot.salesReadiness.source,'clover_sync');
assert.equal(snapshot.salesReadiness.status,'current');
assert.equal(snapshot.salesReadiness.companyId,'a');
assert.equal(snapshot.salesReadiness.merchantId,'merchant-a');
assert.equal(snapshot.salesReadiness.checkpointAt,new Date(now-minute).toISOString());
assert.equal(snapshot.explanation.recommendedPacks,'2');
assert.ok(!snapshot.explanation.reviewReasons.includes('sales_not_current'));
assert.equal(buildReviewProposal(snapshot).contract,snapshot.contract,'Persisted v2 shape revalidates.');
const origin={companyId:'a',id:'review-1',productId:'milk',snapshot};
const versions={inventoryVersion:1,inventoryConfigId:'config-1',inventoryConfigVersion:1,settingsChangeId:'settings-1',settingsVersion:1};
const handoff=buildProposalHandoff(origin,'review_required',1,versions);
assert.equal(handoff.contract,'pantrack.replenishment-handoff.v2');
assert.equal(handoff.mode,'review_only');
assert.equal(handoff.supplierSubmissionAllowed,false);
const consumer=new C4FakeSupplierConsumer();
const oldFetch=globalThis.fetch;let calls=0;
globalThis.fetch=()=>{calls++;throw new Error('No supplier request is allowed.');};
try{
  assert.equal(consumer.consume(handoff,'a').kind,'held');
  assert.equal(consumer.consume(JSON.parse(JSON.stringify(handoff)),'a').kind,'held');
  assert.throws(()=>consumer.consume(handoff,'b'),error=>error.code==='forbidden');
  assert.throws(()=>consumer.consume({...handoff,contract:'pantrack.replenishment-handoff.v1'},'a'),error=>error.code==='invalid_handoff');
  assert.throws(()=>consumer.consume({...handoff,salesReadiness:{...handoff.salesReadiness,companyId:'b'}},'a'),error=>error.code==='invalid_handoff');
  assert.throws(()=>consumer.consume({...handoff,salesReadiness:{...handoff.salesReadiness,merchantId:null}},'a'),error=>error.code==='invalid_handoff');
  assert.throws(()=>consumer.consume({...handoff,salesReadiness:{...handoff.salesReadiness,checkpointAt:null}},'a'),error=>error.code==='invalid_handoff');
  assert.throws(()=>consumer.consume({...handoff,supplierSubmissionAllowed:true},'a'),error=>error.code==='invalid_handoff');
  assert.equal(calls,0);
}finally{globalThis.fetch=oldFetch;}

const rejects=(promise,code)=>assert.rejects(promise,error=>error?.code===code);
const origins=new D1ReplenishmentProposalOrigins(db,{clock:{now:()=>new Date(at)}});
const lifecycle=new D1ReplenishmentLifecycle(db,{clock:{now:()=>new Date(at)},salesPolicy:policy});
const durableRequest={...request,id:'durable-1',createId:'durable-create-1'};
await rejects(origins.createWithClover({...durableRequest,actor:null},policy),'forbidden');
await rejects(origins.createWithClover({...durableRequest,actor:{...actor,companyId:'b'}},policy),'forbidden');
await rejects(origins.createWithClover({...durableRequest,actor:{...actor,role:'employee'}},policy),'forbidden');
await rejects(origins.createWithClover({...durableRequest,supplier:{...supplier,companyId:'b'}},policy),'invalid_request');
await rejects(origins.createWithClover(durableRequest,{...policy,syncEnabled:false}),'source_unavailable');
const durable=await origins.createWithClover(durableRequest,policy);
assert.equal(durable.snapshot.contract,'pantrack.replenishment-review.v2');
assert.deepEqual(await origins.createWithClover(durableRequest,policy),durable);
await rejects(origins.createWithClover({...durableRequest,priceEstimate:{...priceEstimate,perPackMinor:'900'}},policy),'create_conflict');
const live=await lifecycle.get('a','durable-1',actor);
assert.equal(live.revision,1);
assert.equal(live.handoff.contract,'pantrack.replenishment-handoff.v2');
assert.equal(live.handoff.supplierSubmissionAllowed,false);
assert.deepEqual(live.handoff.invalidationReasons,[]);
await rejects(lifecycle.get('a','durable-1',null),'forbidden');
await rejects(lifecycle.get('a','durable-1',{...actor,companyId:'b'}),'forbidden');
assert.equal(await lifecycle.get('b','durable-1',{...actor,companyId:'b'}),null);

db.beforeInsert=()=>sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(now-2*minute,'a');
await rejects(origins.createWithClover({...durableRequest,id:'durable-race',createId:'durable-race'},policy),'source_changed');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_origins WHERE company_id='a'").get().n,1);
sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(now-minute,'a');
db.beforeStateUpdate=()=>sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(now-2*minute,'a');
await rejects(lifecycle.edit({companyId:'a',proposalId:'durable-1',expectedRevision:1,changeId:'durable-edit-race',actor,packs:'1',reason:'Fictional review edit'}),'source_changed');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_events WHERE company_id='a' AND proposal_id='durable-1'").get().n,1);
const stale=await lifecycle.get('a','durable-1',actor);
assert.equal(stale.revision,2);
assert.equal(stale.status,'review_required');
assert.equal(stale.invalidationReason,'source_unavailable');
assert.match(stale.events[1].reason,/Clover sales health changed/);
assert.deepEqual(stale.handoff.invalidationReasons,['source_unavailable']);
assert.equal((await lifecycle.get('a','durable-1',actor)).revision,2,'Repeated reads do not add audit events.');
await rejects(lifecycle.edit({companyId:'a',proposalId:'durable-1',expectedRevision:2,changeId:'durable-edit-stale',actor,packs:'1',reason:'Fictional review edit'}),'conflict');
await lifecycle.cancel({companyId:'a',proposalId:'durable-1',expectedRevision:2,changeId:'durable-cancel',actor,reason:'Replace stale review'});
sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(now-minute,'a');
await origins.createWithClover({...durableRequest,id:'durable-merchant',createId:'durable-merchant'},policy);
sql.prepare("UPDATE clover_sync_state SET merchant_id='merchant-new' WHERE company_id='a'").run();
sql.prepare("UPDATE clover_connections SET merchant_id='merchant-new' WHERE company_id='a'").run();
const merchantChanged=await lifecycle.get('a','durable-merchant',actor);
assert.equal(merchantChanged.invalidationReason,'source_unavailable','A different merchant invalidates even with the same checkpoint.');
await lifecycle.cancel({companyId:'a',proposalId:'durable-merchant',expectedRevision:2,changeId:'cancel-merchant',actor,reason:'Replace changed merchant review'});
sql.prepare("UPDATE clover_sync_state SET merchant_id='merchant-a' WHERE company_id='a'").run();
sql.prepare("UPDATE clover_connections SET merchant_id='merchant-a' WHERE company_id='a'").run();

db.cloverReads=0;
db.onSecondCloverRead=()=>sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(now-2*minute,'a');
assert.deepEqual(await review.buildWithClover(request,policy),{kind:'unavailable',reason:'source_changed'},'Changed checkpoint during calculation must not produce a snapshot.');
const paused=await review.buildWithClover(request,{...policy,syncEnabled:false});
assert.equal(paused.snapshot.salesReadiness.status,'degraded');
assert.ok(paused.snapshot.explanation.reviewReasons.includes('sales_not_current'));
await origins.createWithClover({...durableRequest,id:'durable-paused',createId:'durable-paused'},policy);
const disabledLifecycle=new D1ReplenishmentLifecycle(db,{clock:{now:()=>new Date(at)},salesPolicy:{...policy,syncEnabled:false}});
const disabled=await disabledLifecycle.get('a','durable-paused',actor);
assert.equal(disabled.invalidationReason,'source_unavailable','A disabled sync gate invalidates a saved current proposal.');
await lifecycle.cancel({companyId:'a',proposalId:'durable-paused',expectedRevision:2,changeId:'cancel-paused',actor,reason:'Replace paused review'});
await origins.createWithClover({...durableRequest,id:'durable-held',createId:'durable-held'},policy);
const insertHeld=()=>{
  sql.prepare(`INSERT INTO sales_events(company_id,event_key,lineage_key,application_key,provider,environment,merchant_id,external_event_id,external_order_id,revision,occurred_at,received_at,source_payload_sha256,normalized_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('a','held-a','held-a','held-application','clover','sandbox','merchant-a','held-a','held-a',1,at,at,'fictional-hash','{}');
  sql.prepare(`INSERT INTO sales_event_states(company_id,event_key,lineage_key,revision,state,lease_attempt_id,lease_expires_at,last_reason,linked_event_key,transition_actor,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('a','held-a','held-a',1,'held',null,null,'unknown_modifier',null,'system',at);
};
db.heldReads=0;
db.onSecondHeldRead=insertHeld;
assert.deepEqual(await review.buildWithClover(request,policy),{kind:'unavailable',reason:'source_changed'},'A held sale during calculation must not produce a snapshot.');
const held=await review.buildWithClover(request,policy);
assert.equal(held.snapshot.salesReadiness.heldEventCount,1);
assert.ok(held.snapshot.explanation.reviewReasons.includes('held_sales_events'));
const heldInvalidation=await lifecycle.get('a','durable-held',actor);
assert.equal(heldInvalidation.invalidationReason,'source_unavailable','A held sale invalidates a saved current proposal.');
assert.deepEqual(heldInvalidation.handoff.invalidationReasons,['source_unavailable']);
assert.equal((await lifecycle.get('a','durable-held',actor)).revision,2);
await rejects(origins.createWithClover({...durableRequest,id:'durable-after-held',createId:'durable-after-held'},policy),'source_unavailable');
await assert.rejects(review.buildWithClover({...request,actor:{...actor,companyId:'b'}},policy),/Company access/);
await assert.rejects(review.buildWithClover({...request,actor:null},policy),/Company access/);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log('PASS: A8 v2 review and durable origin detect changed Clover health, block stale edits, audit invalidation, and hold the supplier handoff.');
