import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-replenishment-lifecycle.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-lifecycle-d1.mjs'});
const {D1ReplenishmentLifecycle}=await import('../.sites-runtime/replenishment-lifecycle-d1.mjs');
await build({entryPoints:['src/lib/d1-replenishment-proposal-origins.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-lifecycle-origins.mjs'});
const {D1ReplenishmentProposalOrigins}=await import('../.sites-runtime/replenishment-lifecycle-origins.mjs');
await build({entryPoints:['src/lib/d1-replenishment-settings.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-lifecycle-settings.mjs'});
const {D1ReplenishmentSettingsStore}=await import('../.sites-runtime/replenishment-lifecycle-settings.mjs');

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
for(const entry of entries.filter(entry=>entry.idx<16))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
const at='2026-09-25T12:00:00.000Z';
for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,`Fictional ${company}`,at);
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,'milk','{"name":"Milk"}');
  sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run(company,'milk','{"legacy":true,"onHand":12}',3);
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
    VALUES (?,?,?,1,'curated','volume','mL','1','1','fictional-manager',?,NULL)`).run(company,'milk','mL',at);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
    VALUES (?,?,?,1,'active','mL',1,'case','250000000',NULL,?,NULL,'fictional-manager',?)`).run(company,'milk','config-1',at,at);
  sql.prepare(`INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at)
    VALUES (?,?,'config-1','volume','200000000','100000000','0',1,'2026-09-24T12:00:00Z',?)`).run(company,'milk',at);
}
class Statement{
  constructor(database,query,values=[]){this.database=database;this.query=query;this.values=values;}
  bind(...values){return new Statement(this.database,this.query,values);}
  async first(){return this.database.sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {success:true,results:this.database.sql.prepare(this.query).all(...this.values),meta:{changes:0}};}
  async run(){
    if(this.query.includes('UPDATE replenishment_proposal_states')&&this.database.beforeStateUpdate){
      const action=this.database.beforeStateUpdate;this.database.beforeStateUpdate=null;action();
    }
    const result=this.database.sql.prepare(this.query).run(...this.values);
    return {success:true,results:[],meta:{changes:Number(result.changes)}};
  }
}
const database={sql,prepare(query){return new Statement(this,query);}};
const q=minor=>({dimension:'volume',minor:String(minor)});
const settings={target:q(1000000000),capacity:q(1200000000),dailyUse:q(100000000),shelfDays:8,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'5'};
const settingsStore=new D1ReplenishmentSettingsStore(database,{clock:{now:()=>new Date(at)}});
for(const company of ['a','b'])await settingsStore.save({companyId:company,productId:'milk',changeId:'settings-1',expectedVersion:0,expectedConfigId:'config-1',expectedConfigVersion:1,actor:{companyId:company,userId:'fictional-manager',role:'manager'},reason:'Fictional target',settings});
const actor={companyId:'a',userId:'fictional-manager',role:'manager'};
const sales={companyId:'a',source:'fictional_fixture',status:'current',heldEventCount:0};
const supplier={companyId:'a',source:'fictional_fixture',mappingId:'fake-mapping',mappingVersion:1,supplierId:'fake-supplier',accountId:'fake-account',locationId:'fake-location',sku:'MILK-CASE'};
const priceEstimate={companyId:'a',source:'fictional_fixture',currency:'USD',perPackMinor:'725'};
const request={companyId:'a',productId:'milk',id:'proposal-1',createId:'create-1',actor,sales,supplier,priceEstimate};
const origins=new D1ReplenishmentProposalOrigins(database,{clock:{now:()=>new Date(at)}});
const first=await origins.create(request);
const bRequest={...request,companyId:'b',actor:{...actor,companyId:'b'},sales:{...sales,companyId:'b'},supplier:{...supplier,companyId:'b'},priceEstimate:{...priceEstimate,companyId:'b'}};
const bActor=bRequest.actor;
await origins.create(bRequest);
await origins.create({...bRequest,id:'proposal-legacy-duplicate',createId:'create-legacy-duplicate'});
const oldOrigin=sql.prepare("SELECT * FROM replenishment_proposal_origins WHERE company_id='a' AND id='proposal-1'").get();
const oldInventory=sql.prepare("SELECT * FROM inventory WHERE company_id='a'").get();
sql.exec(readFileSync(`drizzle/${entries.find(entry=>entry.idx===16).tag}.sql`,'utf8'));
assert.deepEqual(sql.prepare("SELECT * FROM replenishment_proposal_origins WHERE company_id='a' AND id='proposal-1'").get(),oldOrigin);
assert.deepEqual(sql.prepare("SELECT * FROM inventory WHERE company_id='a'").get(),oldInventory);
assert.deepEqual({...sql.prepare("SELECT status,packs,revision FROM replenishment_proposal_states WHERE company_id='a'").get()},{status:'review_required',packs:'2',revision:1});
assert.equal(sql.prepare("SELECT kind FROM replenishment_proposal_events WHERE company_id='a'").get().kind,'create');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_states WHERE company_id='b'").get().n,2);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_events WHERE company_id='b'").get().n,2);

const lifecycle=new D1ReplenishmentLifecycle(database,{clock:{now:()=>new Date(at)}});
const rejects=(promise,code)=>assert.rejects(promise,error=>error?.code===code);
await rejects(lifecycle.get('a','proposal-1',null),'forbidden');
await rejects(lifecycle.get('a','proposal-1',{...actor,companyId:'b'}),'forbidden');
assert.equal((await lifecycle.get('b','proposal-1',bActor)).origin.companyId,'b');
assert.equal(await lifecycle.get('b','a-only-id',bActor),null);
const read=await lifecycle.get('a','proposal-1',{...actor,role:'employee'});
assert.equal(read.status,'review_required');
assert.equal(read.revision,1);
assert.equal(read.handoff.supplierSubmissionAllowed,false);
assert.equal(read.events[0].kind,'create');
assert.ok(Object.isFrozen(read) && Object.isFrozen(read.events));
await rejects(origins.create({...request,id:'proposal-2',createId:'create-2'}),'quantity_reserved');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_origins WHERE company_id='a'").get().n,1);
assert.equal((await origins.create(bRequest)).id,'proposal-1');
await rejects(origins.create({...bRequest,id:'proposal-new',createId:'create-new'}),'quantity_reserved');
await lifecycle.cancel({companyId:'b',proposalId:'proposal-1',expectedRevision:1,changeId:'b-cancel-1',actor:bActor,reason:'Legacy duplicate review'});
await rejects(origins.create({...bRequest,id:'proposal-new',createId:'create-new'}),'quantity_reserved');
await lifecycle.cancel({companyId:'b',proposalId:'proposal-legacy-duplicate',expectedRevision:1,changeId:'b-cancel-2',actor:bActor,reason:'Legacy duplicate review'});
assert.equal((await origins.create({...bRequest,id:'proposal-new',createId:'create-new'})).id,'proposal-new');
const zero=await lifecycle.edit({companyId:'b',proposalId:'proposal-new',expectedRevision:1,changeId:'b-zero',actor:bActor,packs:'0',reason:'No fictional quantity needed'});
assert.equal(zero.packs,'0');
assert.equal((await origins.create({...bRequest,id:'proposal-next',createId:'create-next'})).id,'proposal-next');
await rejects(lifecycle.edit({companyId:'b',proposalId:'proposal-new',expectedRevision:2,changeId:'b-reopen',actor:bActor,packs:'1',reason:'Fictional quantity reconsidered'}),'quantity_reserved');

const editInput={companyId:'a',proposalId:'proposal-1',expectedRevision:1,changeId:'edit-1',actor,packs:'1',reason:'Fictional count correction'};
await rejects(lifecycle.edit({...editInput,actor:{...actor,role:'employee'}}),'forbidden');
await rejects(lifecycle.edit({...editInput,actor:{...actor,companyId:'b'}}),'forbidden');
await rejects(lifecycle.edit({...editInput,reason:' '}),'invalid_request');
await rejects(lifecycle.edit({...editInput,packs:'02'}),'invalid_request');
const edited=await lifecycle.edit(editInput);
assert.equal(edited.revision,2);
assert.equal(edited.packs,'1');
assert.equal(edited.handoff.packs,'1');
assert.equal(edited.handoff.estimatedLineTotal.minor,'725');
assert.equal(edited.events[1].kind,'edit');
assert.deepEqual(await lifecycle.edit(editInput),edited);
await rejects(lifecycle.edit({...editInput,packs:'2'}),'conflict');
await rejects(lifecycle.edit({...editInput,changeId:'edit-stale',expectedRevision:1}),'conflict');
await rejects(origins.create({...request,id:'proposal-2',createId:'create-2'}),'quantity_reserved');
assert.throws(()=>sql.prepare("UPDATE replenishment_proposal_events SET reason='tampered' WHERE company_id='a'").run(),/immutable/);
assert.throws(()=>sql.prepare("DELETE FROM replenishment_proposal_events WHERE company_id='a'").run(),/immutable/);
assert.throws(()=>sql.prepare("DELETE FROM replenishment_proposal_states WHERE company_id='a'").run(),/cannot be deleted/);
assert.throws(()=>sql.prepare(`UPDATE replenishment_proposal_states
  SET revision=revision+1,status='approved',change_id='raw-approval',kind='supplier',changed_by='fake',reason='Unsafe approval'
  WHERE company_id='a' AND proposal_id='proposal-1'`).run(),/transition/);

const cancelInput={companyId:'a',proposalId:'proposal-1',expectedRevision:2,changeId:'cancel-1',actor,reason:'Replacing stale fictional proposal'};
await rejects(lifecycle.cancel({...cancelInput,actor:{...actor,role:'employee'}}),'forbidden');
const canceled=await lifecycle.cancel(cancelInput);
assert.equal(canceled.status,'canceled');
assert.equal(canceled.revision,3);
assert.equal(canceled.events[2].kind,'cancel');
assert.deepEqual(await lifecycle.cancel(cancelInput),canceled);
await rejects(lifecycle.cancel({...cancelInput,changeId:'cancel-stale'}),'conflict');
const second=await origins.create({...request,id:'proposal-2',createId:'create-2'});
assert.equal(second.snapshot.explanation.recommendedPacks,'2');
assert.equal((await lifecycle.get('a','proposal-2',actor)).revision,1);
await rejects(origins.create({...request,id:'proposal-3',createId:'create-3'}),'quantity_reserved');

sql.prepare("UPDATE inventory_balances_exact SET version=2 WHERE company_id='a' AND product_id='milk'").run();
const invalidated=await lifecycle.get('a','proposal-2',actor);
assert.equal(invalidated.revision,2);
assert.equal(invalidated.status,'review_required');
assert.equal(invalidated.invalidationReason,'inventory_changed');
assert.equal(invalidated.events[1].kind,'invalidate');
assert.deepEqual(invalidated.handoff.invalidationReasons,['inventory_changed']);
assert.equal((await lifecycle.get('a','proposal-2',actor)).revision,2,'Repeated reads do not add audit noise.');
await rejects(lifecycle.edit({companyId:'a',proposalId:'proposal-2',expectedRevision:2,changeId:'edit-after-change',actor,packs:'1',reason:'Fictional edit'}),'conflict');
await rejects(origins.create({...request,id:'proposal-3',createId:'create-3'}),'quantity_reserved');
const canceledStale=await lifecycle.cancel({companyId:'a',proposalId:'proposal-2',expectedRevision:2,changeId:'cancel-stale-2',actor,reason:'Recalculate from new stock'});
assert.equal(canceledStale.status,'canceled');
const third=await origins.create({...request,id:'proposal-3',createId:'create-3'});
assert.equal(third.snapshot.inventoryVersion,2);

database.beforeStateUpdate=()=>sql.prepare("UPDATE inventory_balances_exact SET version=3 WHERE company_id='a' AND product_id='milk'").run();
await rejects(lifecycle.edit({companyId:'a',proposalId:'proposal-3',expectedRevision:1,changeId:'race-edit',actor,packs:'1',reason:'Fictional race check'}),'source_changed');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_events WHERE company_id='a' AND proposal_id='proposal-3'").get().n,1);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
sql.close();
console.log('PASS: A7 state migration preserves old rows, atomically holds quantities, audits authorized edits/cancel/invalidation, and blocks stale races.');
