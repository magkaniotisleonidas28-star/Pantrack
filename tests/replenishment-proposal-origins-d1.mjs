import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-replenishment-proposal-origins.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-proposal-origins-d1.mjs'});
const {D1ReplenishmentProposalOrigins,initialProposalStatus}=await import('../.sites-runtime/replenishment-proposal-origins-d1.mjs');
await build({entryPoints:['src/lib/d1-replenishment-settings.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-proposal-origin-settings.mjs'});
const {D1ReplenishmentSettingsStore}=await import('../.sites-runtime/replenishment-proposal-origin-settings.mjs');
await build({entryPoints:['src/lib/replenishment-proposal.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-proposal-origin-builder.mjs'});
const {buildReviewProposal}=await import('../.sites-runtime/replenishment-proposal-origin-builder.mjs');

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
for(const entry of entries.filter(entry=>entry.idx<15))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
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
  async run(){const result=this.database.sql.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
}
const database={sql,prepare(query){
  if(query.includes('INSERT INTO replenishment_proposal_origins')&&this.beforeInsert){const action=this.beforeInsert;this.beforeInsert=null;action();}
  return new Statement(this,query);
}};
const q=minor=>({dimension:'volume',minor:String(minor)});
const settings={target:q(1000000000),capacity:q(1200000000),dailyUse:q(100000000),shelfDays:8,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'5'};
const settingsStore=new D1ReplenishmentSettingsStore(database,{clock:{now:()=>new Date(at)}});
for(const company of ['a','b'])await settingsStore.save({companyId:company,productId:'milk',changeId:'settings-1',expectedVersion:0,expectedConfigId:'config-1',expectedConfigVersion:1,actor:{companyId:company,userId:'fictional-manager',role:'manager'},reason:'Fictional target',settings});
const legacyBefore=sql.prepare('SELECT * FROM inventory ORDER BY company_id').all();
const settingsBefore=sql.prepare('SELECT company_id,product_id,version,settings_json FROM replenishment_settings_versions ORDER BY company_id').all();
sql.exec(readFileSync(`drizzle/${entries.find(entry=>entry.idx===15).tag}.sql`,'utf8'));
assert.deepEqual(sql.prepare('SELECT * FROM inventory ORDER BY company_id').all(),legacyBefore);
assert.deepEqual(sql.prepare('SELECT company_id,product_id,version,settings_json FROM replenishment_settings_versions ORDER BY company_id').all(),settingsBefore);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM replenishment_proposal_origins').get().n,0);

const actor={companyId:'a',userId:'fictional-manager',role:'manager'};
const sales={companyId:'a',source:'fictional_fixture',status:'current',heldEventCount:0};
const supplier={companyId:'a',source:'fictional_fixture',mappingId:'fake-mapping',mappingVersion:1,supplierId:'fake-supplier',accountId:'fake-account',locationId:'fake-location',sku:'MILK-CASE'};
const priceEstimate={companyId:'a',source:'fictional_fixture',currency:'USD',perPackMinor:'725'};
const request={companyId:'a',productId:'milk',id:'proposal-1',createId:'create-1',actor,sales,supplier,priceEstimate};
const origins=new D1ReplenishmentProposalOrigins(database,{clock:{now:()=>new Date(at)}});
const rejects=(promise,code)=>assert.rejects(promise,error=>error?.code===code);
await rejects(origins.create({...request,actor:null}),'forbidden');
await rejects(origins.create({...request,actor:{...actor,companyId:'b'}}),'forbidden');
await rejects(origins.create({...request,actor:{...actor,role:'employee'}}),'forbidden');
await rejects(origins.create({...request,sales:{...sales,companyId:'b'}}),'invalid_request');
await rejects(origins.create({...request,supplier:{...supplier,companyId:'b'}}),'invalid_request');
await rejects(origins.create({...request,priceEstimate:{...priceEstimate,companyId:'b'}}),'invalid_request');
await rejects(origins.create({...request,productId:'missing'}),'source_unavailable');
assert.equal((await origins.get('a','proposal-1',actor)),null);

const first=await origins.create(request);
assert.equal(first.initialStatus,'review_required');
assert.equal(first.snapshot.mode,'review_only');
assert.equal(first.snapshot.inventoryVersion,1);
assert.equal(first.snapshot.settingsChangeId,'settings-1');
assert.equal(first.snapshot.explanation.recommendedPacks,'2');
assert.ok(first.snapshot.explanation.reviewReasons.includes('expiry_not_checked'));
assert.equal(first.createdBy,'fictional-manager');
assert.deepEqual(await origins.create(request),first,'Same create ID and fixtures replay the saved origin.');
assert.ok(Object.isFrozen(first) && Object.isFrozen(first.snapshot));
assert.deepEqual(await origins.get('a','proposal-1',{...actor,role:'employee'}),first);
await rejects(origins.get('a','proposal-1',null),'forbidden');
await rejects(origins.get('a','proposal-1',{...actor,companyId:'b'}),'forbidden');
assert.equal(await origins.get('b','proposal-1',{companyId:'b',userId:'fictional-manager',role:'manager'}),null);
await rejects(origins.create({...request,priceEstimate:{...priceEstimate,perPackMinor:'900'}}),'create_conflict');
await rejects(origins.create({...request,id:'proposal-2'}),'create_conflict');
await rejects(origins.create({...request,createId:'create-2'}),'id_conflict');
const clean=buildReviewProposal({...first.snapshot,expiryStatus:'checked'});
assert.equal(initialProposalStatus(clean),'draft');
assert.equal(initialProposalStatus(first.snapshot),'review_required');

database.beforeInsert=()=>sql.prepare("UPDATE inventory_balances_exact SET version=2 WHERE company_id='a' AND product_id='milk'").run();
await rejects(origins.create({...request,id:'proposal-2',createId:'create-2'}),'source_changed');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_origins WHERE company_id='a'").get().n,1);
const refreshed=await origins.create({...request,id:'proposal-2',createId:'create-2'});
assert.equal(refreshed.snapshot.inventoryVersion,2);
assert.deepEqual(await origins.create(request),first,'An old create ID replays its original snapshot after inventory changes.');
database.beforeInsert=()=>sql.prepare(`INSERT INTO replenishment_settings_versions
  (company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,dimension,settings_json,changed_by,change_reason,changed_at)
  SELECT company_id,product_id,2,'settings-2',inventory_config_id,inventory_config_version,dimension,settings_json,changed_by,'Fictional revision',changed_at
  FROM replenishment_settings_versions WHERE company_id='a' AND product_id='milk' AND version=1`).run();
await rejects(origins.create({...request,id:'proposal-3',createId:'create-3'}),'source_changed');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_origins WHERE company_id='a'").get().n,2);
const settingsRefreshed=await origins.create({...request,id:'proposal-3',createId:'create-3'});
assert.equal(settingsRefreshed.snapshot.settingsVersion,2);
assert.deepEqual(await origins.create(request),first,'An old create ID also replays after settings change.');
const secondCompany=await origins.create({...request,companyId:'b',actor:{companyId:'b',userId:'fictional-manager',role:'manager'},sales:{...sales,companyId:'b'},supplier:{...supplier,companyId:'b'},priceEstimate:{...priceEstimate,companyId:'b'}});
assert.equal(secondCompany.id,'proposal-1','A second company may reuse IDs without seeing the first company.');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM replenishment_proposal_origins').get().n,4);
assert.throws(()=>sql.prepare("UPDATE replenishment_proposal_origins SET initial_status='draft' WHERE company_id='a'").run(),/immutable/);
assert.throws(()=>sql.prepare("DELETE FROM replenishment_proposal_origins WHERE company_id='a'").run(),/immutable/);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
sql.close();
console.log('PASS: A7 origin migration preserves old rows; company-scoped review origins are immutable, replay-safe, authorized, and reject source changes at insert.');
