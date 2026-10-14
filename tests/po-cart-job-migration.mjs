import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {unstable_splitSqlQuery} from 'wrangler';
import {LocalD1,entries} from './helpers/supplier-simulation.mjs';
import {cartCore,configure,supplier,command,tables,connectionVersion} from './helpers/po-cart-authorizations.mjs';
import {D1PoCartJobs,jobFixture,enqueue,operation,fenced,cancel,conflict,snapshot} from './helpers/po-cart-jobs.mjs';

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const e of entries.filter(e=>e.idx<29))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
sql.exec("INSERT INTO companies VALUES('a','Populated job migration cafe','2026-10-01'); INSERT INTO memberships VALUES('manager','a','manager')");configure(sql);
sql.exec("INSERT INTO inventory VALUES('a','historical','{\"onHand\":42}',1)");
const options={identity:async()=>'manager',clock:{now:()=>new Date('2026-10-01T12:00:00.000Z')}},db=new LocalD1(sql);
const drafts=new cartCore.D1PurchaseOrderDrafts(db,options),auth=new cartCore.D1PoCartAuthorizations(db,options);
async function saved(){
  let po=await drafts.create({action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Populated historical PO',
    lines:[{kind:'non_stock',sku:'OLD',description:'Practice item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
  po=await drafts.review({...command(po),action:'review',acknowledgeWarnings:true});return auth.authorize(command(po));
}
const historical=await saved(),legacy=await saved();
await auth.markPreparationStarted({action:'start',companyId:'a',authorizationId:legacy.current.authorization.id,expectedRevision:1,operationId:randomUUID()});
const names=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),before=tables(sql,names);
assert.equal(names.length,90);
const migration=entries.find(e=>e.idx===29);assert.equal(migration.tag,'0029_po_cart_jobs');
for(const statement of unstable_splitSqlQuery(readFileSync(`drizzle/${migration.tag}.sql`,'utf8')))sql.exec(statement);
assert.equal(tables(sql,names),before);assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,96);
const jobs=new D1PoCartJobs(db,options),queued=await jobs.enqueue(enqueue(historical.current.authorization));
await assert.rejects(jobs.enqueue(enqueue({...legacy.current.authorization,revision:2})),conflict);
assert.equal((await auth.get({companyId:'a',orderId:legacy.current.authorization.orderId})).reservation.state,'reserved');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);sql.close();

// Disk close/reopen with a separate service and no user session for the internal worker.
const root=mkdtempSync(join(tmpdir(),'pantrack-job-restart-')),filename=join(root,'jobs.sqlite'),f=await jobFixture();
try{
  const q=await f.queued(),j=q.current.job,claim=await f.worker().claim(operation(j));
  const begun=await f.worker().beginAttempt({...fenced(j,claim.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId});
  const state=snapshot(f);f.sql.prepare('VACUUM INTO ?').run(filename);
  let disk=new DatabaseSync(filename);disk.exec('PRAGMA foreign_keys=ON');let local=new LocalD1(disk);
  let manager=new D1PoCartJobs(local,f.options),worker=new D1PoCartJobs(local,{...f.options,identity:async()=>null,workerId:'one'});
  assert.deepEqual(await manager.get({companyId:'a',jobId:j.id}),begun.current);
  const replay=await worker.beginAttempt({...fenced(j,claim.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId,operationId:begun.receipt.operationId});
  assert.equal(replay.providerCallAllowed,false);assert.deepEqual(replay.receipt,begun.receipt);disk.close();
  f.setTime('2026-10-01T12:01:00.000Z');disk=new DatabaseSync(filename);disk.exec('PRAGMA foreign_keys=ON');local=new LocalD1(disk);
  worker=new D1PoCartJobs(local,{...f.options,identity:async()=>null,workerId:'recovery'});manager=new D1PoCartJobs(local,f.options);
  const recover=operation(j),held=await worker.recoverExpired(recover);assert.equal(held.current.job.state,'review_needed');
  assert.equal(held.current.authorization.reservation.state,'reserved');assert.equal(held.current.ownership.jobId,j.id);disk.close();
  disk=new DatabaseSync(filename);local=new LocalD1(disk);worker=new D1PoCartJobs(local,{...f.options,identity:async()=>null,workerId:'recovery'});
  assert.deepEqual(await worker.recoverExpired(recover),held);assert.equal(snapshot(f),state,'Disk consumer never mutates the original database');disk.close();
}finally{f.sql.close();rmSync(root,{recursive:true,force:true});}

// Multi-line ordering, replay/lost responses and exclusive ownership across connection versions/companies.
const multi=await jobFixture();try{
  const lines=[{kind:'non_stock',sku:'ONE',description:'One',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'},
    {kind:'non_stock',sku:'TWO',description:'Two',unitLabel:'case',packs:'2',estimatedUnitMinor:'100'}];
  const q=await multi.queued({lines}),j=q.current.job;
  const claimInput=operation(j);multi.db.loseAcknowledgment=true;const claimed=await multi.worker().claim(claimInput);
  assert.deepEqual(await multi.worker().claim(claimInput),claimed);const fence=claimed.receipt.fence;
  const first=await multi.worker().beginAttempt({...fenced(j,fence),lineId:j.inputs.preflight.lines[0].lineId});
  const before=snapshot(multi);await assert.rejects(multi.worker().beginAttempt({...fenced(j,fence),lineId:j.inputs.preflight.lines[1].lineId}),conflict);assert.equal(snapshot(multi),before);
  await assert.rejects(multi.worker().recordResult({...fenced(j,fence),attemptId:randomUUID(),outcome:'verified',observation:j.inputs.preflight.lines[0]}),conflict);
  const result={...fenced(j,fence),attemptId:first.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]};
  multi.db.loseAcknowledgment=true;const partial=await multi.worker().recordResult(result);assert.equal(partial.current.job.state,'preparing');
  assert.deepEqual(await multi.worker().recordResult(result),partial);
  const second=await multi.worker().beginAttempt({...fenced(j,fence),lineId:j.inputs.preflight.lines[1].lineId});
  const ready=await multi.worker().recordResult({...fenced(j,fence),attemptId:second.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[1]});
  assert.equal(ready.current.job.state,'ready');assert.equal(ready.current.results.length,2);
  connectionVersion(multi.sql,{});const newAuthorization=await multi.authorized(),prior=snapshot(multi);
  await assert.rejects(multi.jobs().enqueue(enqueue(newAuthorization)),conflict);assert.equal(snapshot(multi),prior,'Connection version cannot split an owned account cart');
  configure(multi.sql,'b');multi.setUser('b-manager');const other=await multi.queued({companyId:'b'});
  assert.equal(other.current.job.accountId,j.accountId);assert.equal(other.current.ownership.jobId,other.current.job.id);
  assert.equal(multi.sql.prepare('SELECT count(*) n FROM po_cart_owners WHERE job_id IS NOT NULL').get().n,2);
  for(const table of ['po_cart_attempts','po_cart_results','po_cart_job_events','po_cart_job_operations']){
    assert.throws(()=>multi.sql.exec(`UPDATE ${table} SET company_id=company_id`),/immutable/);assert.throws(()=>multi.sql.exec(`DELETE FROM ${table}`),/immutable/);
  }
  assert.throws(()=>multi.sql.exec("UPDATE po_cart_jobs SET inputs_json='{}'"),/Invalid cart job transition/);
  assert.throws(()=>multi.sql.exec('UPDATE po_cart_owners SET job_id=NULL,worker_id=NULL,lease_until=NULL,fence=fence+1'),/Unsafe/);
  assert.deepEqual(multi.sql.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{multi.sql.close();}

// Exercise the actual database clock predicate, independently of the injected application clock.
const timed=await jobFixture();try{
  const q=await timed.queued(),j=q.current.job,worker=new D1PoCartJobs(timed.db,{...timed.options,clock:undefined,workerId:'database-clock'});
  const c=await worker.claim(operation(j)),before=snapshot(timed);
  // Simulate the transaction waiting until after expiry, while the request's clock is still earlier.
  timed.sql.function('strftime',{varargs:true},()=>new Date(Date.parse(c.current.ownership.leaseUntil)+1).toISOString());
  await assert.rejects(worker.beginAttempt({...fenced(j,c.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId}),conflict);
  assert.equal(snapshot(timed),before);assert.equal(timed.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,0);
}finally{timed.sql.close();}

// Storage-level fixture: future delivery locations sharing a login cannot partition its cart.
// The public authorization allowlist still supports only DEMO-CAFE; this does not enable another location.
const shared=await jobFixture();try{
  const q=await shared.queued(),j=q.current.job;
  const po=await shared.reviewed({supplier:{...supplier,locationId:'SECOND-CAFE'}}),id=randomUUID();
  const c={...q.a.inputs.preflight.connection,id:'second-location',locationId:'SECOND-CAFE'};
  shared.sql.prepare('INSERT INTO po_cart_connections VALUES(?,?,?,?)').run('a',c.id,1,JSON.stringify(c));
  const inputs={...q.a.inputs,snapshot:po.snapshot,preflight:{...q.a.inputs.preflight,
    request:{companyId:'a',orderId:po.snapshot.id,expectedRevision:po.revision,operationId:randomUUID()},connection:c,
    lines:q.a.inputs.preflight.lines.map((l,i)=>({...l,lineId:po.snapshot.lines[i].id}))}};
  shared.sql.prepare(`INSERT INTO po_cart_authorizations VALUES(?,?,?,1,1,'authorized',?,1,1,?,?,NULL,NULL)`)
    .run('a',id,po.snapshot.id,c.id,JSON.stringify(inputs),po.snapshot.createdAt);
  const jobId=randomUUID(),before=snapshot(shared);
  await assert.rejects(shared.db.batch([
    shared.db.prepare(`INSERT INTO po_cart_jobs(company_id,id,authorization_id,authorization_revision,inputs_json,supplier_id,account_id,requested_by,revision,state,purchase_state,delivery_state,kind,actor,reason,created_at,updated_at) VALUES(?,?,?,1,?,?,?,'manager',1,'queued','not_confirmed','outstanding','enqueue','manager','Fixture second location',?,?)`)
      .bind('a',jobId,id,JSON.stringify(inputs),j.supplierId,j.accountId,po.snapshot.createdAt,po.snapshot.createdAt),
    shared.db.prepare('INSERT INTO po_cart_owners VALUES(?,?,?,?,0,NULL,NULL)').bind('a',j.supplierId,j.accountId,jobId),
  ]),/UNIQUE constraint failed: po_cart_owners/);
  assert.equal(snapshot(shared),before);assert.equal(shared.sql.prepare('SELECT job_id FROM po_cart_owners').get().job_id,j.id);
}finally{shared.sql.close();}
console.log('PASS: Wrangler-split populated 90-table upgrade, disk restarts/retained uncertainty, multiline ordering, lost responses, company isolation and connection-independent cart ownership.');
