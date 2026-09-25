import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-replenishment-settings.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-settings-d1.mjs'});
const {D1ReplenishmentSettingsStore}=await import('../.sites-runtime/replenishment-settings-d1.mjs');
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
for(const entry of entries.filter(entry=>entry.idx<14))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
const at='2026-09-25T12:00:00.000Z';
for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,`Fictional ${company}`,at);
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,'milk','{"name":"Milk"}');
  sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run(company,'milk','{"onHand":12,"legacy":true}',3);
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
    VALUES (?,?,?,1,'curated','volume','mL','1','1','fictional-manager',?,NULL)`).run(company,'milk','mL',at);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
    VALUES (?,?,?,1,'active','mL',1,'case','1000000000',NULL,?,NULL,'fictional-manager',?)`).run(company,'milk','config-1',at,at);
}
const before=sql.prepare('SELECT company_id,product_id,data,version FROM inventory ORDER BY company_id').all();
sql.exec(readFileSync(`drizzle/${entries.find(entry=>entry.idx===14).tag}.sql`,'utf8'));
assert.deepEqual(sql.prepare('SELECT company_id,product_id,data,version FROM inventory ORDER BY company_id').all(),before,'Migration must leave legacy inventory unchanged.');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM replenishment_settings_versions').get().n,0,'Migration invents no planning settings.');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);

class Statement {
  constructor(query,values=[]){this.query=query;this.values=values;}
  bind(...values){return new Statement(this.query,values);}
  async first(){return sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {success:true,results:sql.prepare(this.query).all(...this.values),meta:{changes:0}};}
  async run(){const result=sql.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
}
const store=new D1ReplenishmentSettingsStore({prepare:query=>new Statement(query)},{clock:{now:()=>new Date(at)}});
const q=minor=>({dimension:'volume',minor:String(minor)});
const settings={target:q(1000000000),capacity:q(1500000000),dailyUse:q(100000000),shelfDays:5,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'5'};
const manager={companyId:'a',userId:'fictional-manager',role:'manager'};
const save=(changes={})=>store.save({companyId:'a',productId:'milk',changeId:'change-1',expectedVersion:0,expectedConfigId:'config-1',expectedConfigVersion:1,actor:manager,reason:'Set reviewed target',settings,...changes});
const rejects=async(promise,code)=>assert.rejects(promise,error=>error?.code===code);
await rejects(save({actor:null}),'forbidden');
await rejects(save({actor:{...manager,companyId:'b'}}),'forbidden');
await rejects(save({actor:{...manager,role:'employee'}}),'forbidden');
await rejects(store.current('a','milk',{...manager,companyId:'b'}),'forbidden');
await rejects(save({expectedConfigVersion:2}),'config_changed');
await rejects(save({settings:{...settings,target:q(-1)}}),'invalid_request');
await rejects(save({settings:{...settings,target:{dimension:'mass',minor:'1'}}}),'invalid_request');
await rejects(save({settings:{...settings,dailyUse:q(0)}}),'invalid_request');
await rejects(save({settings:{...settings,orderMultiplePacks:'0'}}),'invalid_request');
assert.equal((await store.current('a','milk',manager)),null);

const first=await save();
assert.equal(first.version,1);
assert.equal(first.settings.target.minor,'1000000000');
assert.equal(first.changedBy,'fictional-manager');
assert.equal(first.changeReason,'Set reviewed target');
assert.equal(first.inventoryConfigVersion,1);
assert.deepEqual(await save(),first,'Same change ID and payload replay the original version.');
await rejects(save({settings:{...settings,target:q(1200000000)}}),'change_conflict');
const employee={...manager,role:'employee'};
assert.equal((await store.current('a','milk',employee)).version,1,'Employee may read company settings.');
assert.deepEqual(await store.history('b','milk',{companyId:'b',userId:'other-manager',role:'manager'}),[],'Other company sees no A settings.');
const other=await save({companyId:'b',actor:{companyId:'b',userId:'other-manager',role:'manager'},settings:{...settings,target:q(0)}});
assert.equal(other.version,1,'Another company has its own version sequence and may reuse a change ID.');
assert.equal((await store.current('b','milk',{companyId:'b',userId:'other-manager',role:'manager'})).settings.target.minor,'0');

const competing=await Promise.allSettled([
  save({changeId:'change-2',expectedVersion:1,reason:'Count changed',settings:{...settings,target:q(1100000000)}}),
  save({changeId:'change-3',expectedVersion:1,reason:'Forecast changed',settings:{...settings,target:q(1200000000)}}),
]);
assert.deepEqual(competing.map(result=>result.status).sort(),['fulfilled','rejected']);
assert.equal(competing.find(result=>result.status==='rejected').reason.code,'concurrent_update');
const versions=await store.history('a','milk',manager);
assert.deepEqual(versions.map(value=>value.version),[1,2]);
assert.equal(versions[0].settings.target.minor,'1000000000','Earlier settings remain unchanged.');
assert.equal(versions[1].changedBy,'fictional-manager');

assert.throws(()=>sql.prepare("UPDATE replenishment_settings_versions SET settings_json='{}' WHERE company_id='a'").run(),/immutable/);
assert.throws(()=>sql.prepare("DELETE FROM replenishment_settings_versions WHERE company_id='a'").run(),/immutable/);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM replenishment_settings_versions WHERE company_id=?').get('a').n,2);
await rejects(save({changeId:'change-4',expectedVersion:1}),'concurrent_update');

sql.prepare("UPDATE inventory_config_versions SET status='archived',replaced_at=? WHERE company_id='a' AND product_id='milk' AND id='config-1'").run(at);
sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
  VALUES ('a','milk','config-2',2,'active','mL',1,'case','1000000000',NULL,?,NULL,'fictional-manager',?)`).run(at,at);
assert.deepEqual(await save(),first,'Retry of an earlier change stays idempotent after the inventory config changes.');
await rejects(save({changeId:'change-5',expectedVersion:2}),'config_changed');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
sql.close();
console.log('PASS: A6 additive settings migration preserves old rows; D1 history is company-scoped, authorized, versioned, replay-safe, and immutable.');
