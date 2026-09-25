import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-replenishment-review.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-review-d1.mjs'});
const {D1ReplenishmentReview}=await import('../.sites-runtime/replenishment-review-d1.mjs');
await build({entryPoints:['src/lib/d1-replenishment-settings.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-review-settings.mjs'});
const {D1ReplenishmentSettingsStore}=await import('../.sites-runtime/replenishment-review-settings.mjs');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
for(const entry of entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
const at='2026-09-25T12:00:00.000Z';
for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,`Fictional ${company}`,at);
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,'milk','{"name":"Milk"}');
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
  if(query.includes('AS balance_version')&&this.onVersionCheck){const action=this.onVersionCheck;this.onVersionCheck=null;action();}
  return new Statement(this,query);
}};
const actor={companyId:'a',userId:'fictional-manager',role:'manager'};
const q=minor=>({dimension:'volume',minor:String(minor)});
const settings={target:q(1000000000),capacity:q(1200000000),dailyUse:q(100000000),shelfDays:8,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'5'};
const store=new D1ReplenishmentSettingsStore(database,{clock:{now:()=>new Date(at)}});
await store.save({companyId:'a',productId:'milk',changeId:'settings-1',expectedVersion:0,expectedConfigId:'config-1',expectedConfigVersion:1,actor,reason:'Fictional target',settings});
const sales={companyId:'a',source:'fictional_fixture',status:'current',heldEventCount:0};
const supplier={companyId:'a',source:'fictional_fixture',supplierId:'fake-supplier',accountId:'fake-account',locationId:'fake-location',sku:'MILK-CASE'};
const input={companyId:'a',productId:'milk',actor,sales,supplier};
const review=new D1ReplenishmentReview(database,{clock:{now:()=>new Date(at)}});
const changesBefore=sql.prepare('SELECT total_changes() AS n').get().n;
const result=await review.build(input);
assert.equal(result.kind,'snapshot');
const snapshot=result.snapshot;
assert.equal(snapshot.mode,'review_only');
assert.equal(snapshot.salesReadiness.source,'fictional_fixture');
assert.equal(snapshot.supplier.source,'fictional_fixture');
assert.equal(snapshot.expiryStatus,'not_checked');
assert.ok(snapshot.explanation.reviewReasons.includes('expiry_not_checked'));
assert.equal(snapshot.inventoryVersion,1);
assert.equal(snapshot.inventoryConfigId,'config-1');
assert.equal(snapshot.inventoryConfigVersion,1);
assert.equal(snapshot.settingsChangeId,'settings-1');
assert.equal(snapshot.settingsVersion,1);
assert.equal(snapshot.settingsChangedBy,'fictional-manager');
assert.equal(snapshot.quantities.pack.minor,'250000000');
assert.equal(snapshot.quantities.incoming.minor,'100000000');
assert.equal(snapshot.quantities.shelfLimit.minor,'800000000');
assert.equal(snapshot.explanation.shortfall.minor,'700000000');
assert.equal(snapshot.explanation.wantedPacks,'3');
assert.equal(snapshot.explanation.capacityPacks,'3');
assert.equal(snapshot.explanation.shelfLifePacks,'2');
assert.equal(snapshot.explanation.recommendedPacks,'2');
assert.deepEqual(snapshot.explanation.limitedBy,['shelf_life']);
assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.quantities));
assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,changesBefore,'Review must not write stock, settings, or proposals.');

await assert.rejects(review.build({...input,actor:null}),error=>error?.code==='forbidden');
await assert.rejects(review.build({...input,actor:{...actor,companyId:'b'}}),error=>error?.code==='forbidden');
await assert.rejects(review.build({...input,sales:{...sales,companyId:'b'}}),/fixtures must belong/);
await assert.rejects(review.build({...input,supplier:{...supplier,companyId:'b'}}),/fixtures must belong/);
await assert.rejects(review.build({...input,sales:{...sales,heldEventCount:-1}}),/sales fixture is invalid/);
await assert.rejects(review.build({...input,supplier:{...supplier,sku:''}}),/supplier fixture is invalid/);
assert.equal((await review.build({...input,actor:{...actor,role:'employee'}})).kind,'snapshot');
assert.deepEqual(await review.build({...input,companyId:'b',actor:{companyId:'b',userId:'fictional-b',role:'manager'},sales:{...sales,companyId:'b'},supplier:{...supplier,companyId:'b'}}),{kind:'unavailable',reason:'settings_missing'});
const held=await review.build({...input,sales:{...sales,status:'degraded',heldEventCount:2}});
assert.deepEqual(held.snapshot.explanation.reviewReasons,['expiry_not_checked','sales_not_current','held_sales_events']);

sql.prepare("UPDATE inventory_balances_exact SET incoming_minor='600000000',version=2 WHERE company_id='a'").run();
const incoming=await review.build(input);
assert.equal(incoming.snapshot.explanation.shortfall.minor,'200000000');
assert.equal(incoming.snapshot.explanation.recommendedPacks,'0','Confirmed incoming reaches the shelf-life ceiling.');
sql.prepare("UPDATE inventory_balances_exact SET incoming_minor='100000000',version=3,latest_count_effective_at='2026-09-01T12:00:00Z' WHERE company_id='a'").run();
assert.ok((await review.build(input)).snapshot.explanation.reviewReasons.includes('stale_count'));
sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at=NULL,version=4 WHERE company_id='a'").run();
assert.equal((await review.build(input)).snapshot.explanation.recommendedPacks,'0');
sql.prepare("UPDATE inventory_balances_exact SET on_hand_minor='-1',version=5 WHERE company_id='a'").run();
assert.deepEqual(await review.build(input),{kind:'unavailable',reason:'invalid_balance'});
sql.prepare("UPDATE inventory_balances_exact SET on_hand_minor='200000000',version=6 WHERE company_id='a'").run();

database.onVersionCheck=()=>sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a'").run();
assert.deepEqual(await review.build(input),{kind:'unavailable',reason:'source_changed'});
sql.prepare("UPDATE inventory_config_versions SET status='archived',replaced_at=? WHERE company_id='a' AND id='config-1'").run(at);
sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
  VALUES ('a','milk','config-2',2,'active','mL',1,'case','250000000',NULL,?,NULL,'fictional-manager',?)`).run(at,at);
sql.prepare("UPDATE inventory_balances_exact SET config_id='config-2',version=version+1 WHERE company_id='a'").run();
assert.deepEqual(await review.build(input),{kind:'unavailable',reason:'settings_stale'});
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log('PASS: A6 D1 review reads versioned settings and exact stock, caps shelf life, flags stale or unhealthy inputs, isolates companies, and writes nothing.');
