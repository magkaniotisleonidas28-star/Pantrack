import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';
import {entries,LocalD1} from './helpers/supplier-simulation.mjs';
import {cartCore,configure,supplier,command} from './helpers/po-cart-authorizations.mjs';
import {D1PoCartJobs,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-po-cart-confirmations.ts';export * from './src/lib/d1-po-cart-deliveries.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-order-closures-migration-tests.mjs'});
const {D1PoCartConfirmations,D1PoCartDeliveries}=await import('../.sites-runtime/po-cart-order-closures-migration-tests.mjs');
const m=entries.find(e=>e.tag==='0041_po_cart_order_closures');assert.ok(m,'Missing order closure migration');
const statements=unstable_splitSqlQuery(readFileSync(`drizzle/${m.tag}.sql`,'utf8'));
for(const s of statements){
  assert.ok((s.match(/CREATE TRIGGER/g)??[]).length<=1,'Each trigger must be a separate Wrangler statement');
  if(/CREATE TRIGGER/.test(s))assert.match(s.trim(),/END;?$/,'Wrangler kept each trigger body whole');
}
assert.equal(statements.filter(s=>/CREATE TRIGGER/.test(s)).length,6,'All six triggers are separate statements');
for(const populated of [false,true]){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  try{
    for(const e of entries.filter(e=>e.idx<m.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
    let now='2026-10-10T12:00:00.000Z';
    const db=new LocalD1(sql),options={identity:async()=>'manager',clock:{now:()=>new Date(now)}};
    let job,confirmationId,authorizationId;
    if(populated){
      sql.exec("INSERT INTO companies VALUES('a','Populated delivery upgrade','2026-10-10');INSERT INTO memberships VALUES('manager','a','manager')");configure(sql);
      const drafts=new cartCore.D1PurchaseOrderDrafts(db,options),auth=new cartCore.D1PoCartAuthorizations(db,options),jobs=new D1PoCartJobs(db,options),worker=new D1PoCartJobs(db,{...options,workerId:'w'});
      let po=await drafts.create({action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Retained record',
        lines:[{kind:'non_stock',sku:'OLD',description:'Old item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
      po=await drafts.review({...command(po),action:'review',acknowledgeWarnings:true});
      const authorization=(await auth.authorize(command(po))).current.authorization;authorizationId=authorization.id;
      job=(await jobs.enqueue(enqueue(authorization))).current.job;
      const fence=(await worker.claim(operation(job))).receipt.fence,line=job.inputs.preflight.lines[0];
      const begun=await worker.beginAttempt({...fenced(job,fence),lineId:line.lineId});
      job=(await worker.recordResult({...fenced(job,fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current.job;
      assert.equal(job.state,'ready');now='2026-10-10T12:05:00.000Z';
      confirmationId=(await new D1PoCartConfirmations(db,options).record({action:'record',companyId:'a',jobId:job.id,expectedJobRevision:job.revision,operationId:randomUUID(),
        supplierReference:'SUP-UPGRADE',expectedDelivery:'2026-10-12',lines:job.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''})).receipt.confirmationId;
      // Everything was counted and approved before the upgrade (rows as 0040's service writes them).
      sql.exec(`INSERT INTO po_cart_deliveries(company_id,id,confirmation_id,job_id,delivered_at,count_json,count_note,counted_by,counted_at,count_operation_id,count_fingerprint,state)
        VALUES('a','before-upgrade','${confirmationId}','${job.id}','2026-10-10T12:06:00.000Z','[{"lineId":"${line.lineId}","receivedPacks":"1","damagedPacks":"0"}]','','manager','2026-10-10T12:07:00.000Z','${randomUUID()}','fp','counted');
        UPDATE po_cart_deliveries SET state='approved',decision_json='[{"lineId":"${line.lineId}","kind":"non_stock","acceptPacks":"1","excessPacks":"0","releasePacks":"0"}]',decision_note='',stock_receipt=0,
        decided_by='manager',decided_at='2026-10-10T12:08:00.000Z',decision_operation_id='${randomUUID()}',decision_fingerprint='fp' WHERE id='before-upgrade';`);
    }
    const tables=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
    const snapshot=()=>JSON.stringify(tables.map(t=>[t,sql.prepare(`SELECT * FROM "${t}"`).all()]));
    const before=snapshot();for(const s of statements)sql.exec(s);
    assert.equal(snapshot(),before,'Every existing table is unchanged');
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,tables.length+1);
    if(populated){
      // An order received in full before the upgrade is complete but still holds its budget; a manager closes it after.
      // Today's services also read later tables, so apply the migrations after 0041 first.
      for(const e of entries.filter(e=>e.idx>m.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
      now='2026-10-11T09:00:00.000Z';const deliveries=new D1PoCartDeliveries(db,options);
      const view=await deliveries.manager({companyId:'a',view:'manager',jobId:job.id});
      assert.deepEqual([view.complete,view.closure,view.hold],[true,null,'reserved']);
      const closed=await deliveries.close({action:'close',companyId:'a',confirmationId,operationId:randomUUID(),note:''});
      assert.equal(closed.receipt.kind,'complete');
      assert.equal(sql.prepare("SELECT state FROM po_cart_reservations WHERE company_id='a' AND authorization_id=?").get(authorizationId).state,'settled');
    }
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{sql.close();}
}
console.log('PASS: Wrangler-split 0041 fresh/populated upgrades keep every table, then an order received in full before the upgrade is closed after it and settles its hold.');
