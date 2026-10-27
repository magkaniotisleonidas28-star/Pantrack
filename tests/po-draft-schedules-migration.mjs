import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';
import {entries,LocalD1} from './helpers/supplier-simulation.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-po-draft-schedules.ts';export * from './src/lib/d1-purchasing-suppliers.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-draft-schedules-migration-tests.mjs'});
const {D1PoDraftSchedules,D1PoDraftScheduler,D1PurchasingSuppliers}=await import('../.sites-runtime/po-draft-schedules-migration-tests.mjs');
const m=entries.find(e=>e.tag==='0043_po_draft_schedules');assert.ok(m,'Missing weekly schedule migration');
const statements=unstable_splitSqlQuery(readFileSync(`drizzle/${m.tag}.sql`,'utf8'));
assert.equal(statements.filter(s=>/CREATE TRIGGER/.test(s)).length,6,'All six triggers are separate statements');
for(const s of statements){
  assert.ok((s.match(/CREATE TRIGGER/g)??[]).length<=1,'Each trigger must be a separate Wrangler statement');
  if(/CREATE TRIGGER/.test(s))assert.match(s.trim(),/END;?$/,'Wrangler kept each trigger body whole');
}
for(const populated of [false,true]){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  try{
    for(const e of entries.filter(e=>e.idx<m.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
    let now='2026-10-28T15:00:00.000Z';
    const db=new LocalD1(sql),options={identity:async()=>'manager',clock:{now:()=>new Date(now)}};
    if(populated){
      // A company with a time zone and a supplier, set up before the upgrade.
      sql.exec("INSERT INTO companies VALUES('a','Populated schedule upgrade','2026-10-28');INSERT INTO memberships VALUES('manager','a','manager'),('owner','a','owner')");
      sql.prepare('INSERT INTO company_time_zones(company_id,version,time_zone,actor,created_at,operation_id,fingerprint) VALUES(?,?,?,?,?,?,?)').run('a',1,'America/New_York','owner',now,randomUUID(),'fp');
      await new D1PurchasingSuppliers(db,options).saveProfile({action:'save_profile',companyId:'a',operationId:randomUUID(),reason:'Before the upgrade',supplierId:'six',expectedVersion:0,
        profile:{name:'Fictional supplier',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'',emailAcceptance:{status:'unknown',note:''},
          accounts:[{id:'account',reference:'A-1',status:'active'}],locations:[{id:'location',accountId:'account',reference:'North',address:'1 Fictional Street',status:'active'}]}});
    }
    const tables=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
    const snapshot=()=>JSON.stringify(tables.map(t=>[t,sql.prepare(`SELECT * FROM "${t}"`).all()]));
    const before=snapshot();for(const s of statements)sql.exec(s);
    assert.equal(snapshot(),before,'Every existing table is unchanged');
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,tables.length+3);
    if(populated){
      // The supplier and time zone saved before the upgrade back a schedule after it; its first week is recorded once.
      await new D1PoDraftSchedules(db,options).save({action:'save',companyId:'a',scheduleId:'weekly',expectedVersion:0,operationId:randomUUID(),supplierId:'six',accountId:'account',
        locationId:'location',weekday:1,localTime:'09:00',marginPercent:10,responsibleUserId:'manager',reason:''});
      now='2026-11-02T14:00:00.000Z';const scheduler=new D1PoDraftScheduler(db,{clock:options.clock,salesPolicy:{syncEnabled:true,maxLagMs:600_000}});
      assert.deepEqual((await scheduler.tick('a')).weeks.map(w=>[w.weekKey,w.state]),[['2026-11-02','held']],'No sales connection: held, never guessed');
      assert.deepEqual((await scheduler.tick('a')).weeks,[]);
    }
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{sql.close();}
}
console.log('PASS: Wrangler-split 0043 fresh/populated upgrades keep every table; a supplier and time zone saved before the upgrade back a schedule whose first week is recorded once.');
