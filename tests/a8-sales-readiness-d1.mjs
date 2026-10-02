import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

await build({entryPoints:['src/lib/d1-replenishment-sales-readiness.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/a8-sales-readiness-d1.mjs'});
const {D1ReplenishmentSalesReadiness}=await import('../.sites-runtime/a8-sales-readiness-d1.mjs');
await build({entryPoints:['src/lib/d1-replenishment-clover-source.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/a8-clover-source-policy.mjs'});
const {cloverSourceGuard}=await import('../.sites-runtime/a8-clover-source-policy.mjs');
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries){
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
}
const at='2026-09-29T12:00:00.000Z',now=Date.parse(at),minute=60_000;
for(const company of ['a','b'])sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,`Fictional ${company}`,at);
let queries=0;
const db={prepare(query){queries++;let values=[];return {bind(...bound){values=bound;return this;},async first(){return sql.prepare(query).get(...values)??null;}};}};
const actor={companyId:'a',userId:'fictional-owner',role:'owner'};
const options={syncEnabled:true,maxLagMs:10*minute,clock:{now:()=>new Date(now)}};
const reader=new D1ReplenishmentSalesReadiness(db,options);
assert.throws(()=>new D1ReplenishmentSalesReadiness(db,{...options,maxLagMs:0}),/policy is invalid/);
const beforeAuthorization=queries;
await assert.rejects(reader.read('a',null),/Company access/);
await assert.rejects(reader.read('a',{...actor,companyId:'b'}),/Company access/);
await assert.rejects(reader.read('a',{...actor,role:'guest'}),/Company access/);
assert.equal(queries,beforeAuthorization,'Forbidden actors must not read another company.');
const read=()=>reader.read('a',actor);
assert.deepEqual((await read()).reasons,['sync_not_configured']);
const started=now-60*minute,checkpoint=now-minute;
sql.prepare('INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)')
  .run('a','merchant-a','sandbox','encrypted-fictional-placeholder',at,at);
sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until) VALUES (?,?,?,?,?,?,?,?,0)')
  .run('a','sandbox','merchant-a',started,checkpoint,at,new Date(checkpoint).toISOString(),null);
const changesBefore=sql.prepare('SELECT total_changes() AS n').get().n;
const current=await read();
assert.equal(current.source,'clover_sync');
assert.equal(current.status,'current');
assert.equal(current.heldEventCount,0);
assert.deepEqual(current.reasons,[]);
assert.equal(current.checkpointAt,new Date(checkpoint).toISOString());
assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,changesBefore,'A8 health reads must not write D1.');
for(const [checkpointAge,successAge,status,reason] of [
  [10*minute-1,10*minute-1,'current',null],
  [10*minute,10*minute,'current',null],
  [10*minute,minute,'current',null],
  [minute,10*minute,'current',null],
  [10*minute+1,minute,'degraded','sync_stale'],
  [minute,10*minute+1,'degraded','sync_stale'],
  [-1,minute,'unknown','invalid_sync_state'],
  [minute,-1,'unknown','invalid_sync_state'],
]){
  sql.prepare('UPDATE clover_sync_state SET checkpoint=?,last_success=? WHERE company_id=?')
    .run(now-checkpointAge,new Date(now-successAge).toISOString(),'a');
  const health=await read();
  assert.equal(health.status,status,`Checkpoint age ${checkpointAge}, success age ${successAge}`);
  assert.deepEqual(health.reasons,reason===null?[]:[reason]);
  const guard=cloverSourceGuard(health,options,new Date(now));
  assert.equal(sql.prepare(`SELECT ${guard.sql} AS allowed`).get(...guard.args).allowed,
    status==='current'?1:0,'The database write guard must enforce the same freshness rule');
  if(status==='current'&&(checkpointAge===10*minute||successAge===10*minute)){
    const expired=cloverSourceGuard(health,options,new Date(now+1));
    assert.equal(sql.prepare(`SELECT ${expired.sql} AS allowed`).get(...expired.args).allowed,0,
      'A current snapshot must be rejected if it expires before the write');
  }
}
sql.prepare('UPDATE clover_sync_state SET checkpoint=?,last_success=? WHERE company_id=?')
  .run(checkpoint,new Date(checkpoint).toISOString(),'a');
assert.equal((await new D1ReplenishmentSalesReadiness(db,{...options,syncEnabled:false}).read('a',actor)).status,'degraded');
assert.deepEqual((await new D1ReplenishmentSalesReadiness(db,{...options,syncEnabled:false}).read('a',actor)).reasons,['sync_disabled']);
sql.prepare('UPDATE clover_sync_state SET checkpoint=?,last_success=? WHERE company_id=?')
  .run(now-20*minute,new Date(now-20*minute).toISOString(),'a');
assert.deepEqual((await read()).reasons,['sync_stale']);
sql.prepare('UPDATE clover_sync_state SET checkpoint=?,last_success=?,last_error=? WHERE company_id=?')
  .run(checkpoint,new Date(checkpoint).toISOString(),'provider unavailable','a');
assert.deepEqual((await read()).reasons,['sync_error']);
sql.prepare('UPDATE clover_sync_state SET last_error=NULL,last_success=NULL WHERE company_id=?').run('a');
assert.equal((await read()).status,'unknown');
assert.deepEqual((await read()).reasons,['never_synced']);
sql.prepare('UPDATE clover_sync_state SET last_success=?,checkpoint=? WHERE company_id=?')
  .run(new Date(checkpoint).toISOString(),now+minute,'a');
assert.deepEqual((await read()).reasons,['invalid_sync_state']);
sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(Number.MAX_SAFE_INTEGER,'a');
assert.equal((await read()).checkpointAt,null,'Out-of-range checkpoints must fail closed without throwing.');
sql.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(checkpoint,'a');
sql.prepare('UPDATE clover_connections SET merchant_id=? WHERE company_id=?').run('merchant-other','a');
assert.deepEqual((await read()).reasons,['merchant_changed']);
sql.prepare('DELETE FROM clover_connections WHERE company_id=?').run('a');
assert.deepEqual((await read()).reasons,['clover_disconnected']);
sql.prepare('INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)')
  .run('a','merchant-a','sandbox','encrypted-fictional-placeholder',at,at);
sql.prepare('UPDATE clover_sync_state SET environment=? WHERE company_id=?').run('production','a');
assert.equal((await read()).status,'unknown');
assert.deepEqual((await read()).reasons,['merchant_changed','unaccepted_environment']);
sql.prepare('UPDATE clover_sync_state SET environment=? WHERE company_id=?').run('sandbox','a');

function hold(company,event){
  sql.prepare(`INSERT INTO sales_events(company_id,event_key,lineage_key,application_key,provider,environment,merchant_id,external_event_id,external_order_id,revision,occurred_at,received_at,source_payload_sha256,normalized_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(company,event,event,`${event}-application`,'clover','sandbox',`merchant-${company}`,event,event,1,at,at,'fictional-hash','{}');
  sql.prepare(`INSERT INTO sales_event_states(company_id,event_key,lineage_key,revision,state,lease_attempt_id,lease_expires_at,last_reason,linked_event_key,transition_actor,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(company,event,event,1,'held',null,null,'unknown_modifier',null,'system',at);
}
hold('a','held-a');
hold('b','held-b');
const held=await read();
assert.equal(held.status,'degraded');
assert.equal(held.heldEventCount,1,'Other-company events must not enter the count.');
assert.deepEqual(held.reasons,['held_events']);
assert.deepEqual((await reader.read('b',{...actor,companyId:'b'})).reasons,['sync_not_configured','held_events']);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log('PASS: A8 company-scoped Clover health is read-only, fail-closed, and reports paused, stale, failed, held, or disconnected sync without cross-company data.');
