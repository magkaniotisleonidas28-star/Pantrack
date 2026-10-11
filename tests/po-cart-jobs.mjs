import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced,cancel,conflict,snapshot} from './helpers/po-cart-jobs.mjs';
import {command,cancelCommand,connectionVersion,tables} from './helpers/po-cart-authorizations.mjs';

const f=await jobFixture();
const get=j=>f.jobs().get({companyId:j.companyId,jobId:j.id});
async function unchanged(fn,code='conflict'){const before=snapshot(f);await assert.rejects(fn,e=>e.code===code);assert.equal(snapshot(f),before);}
try{
  const line=await f.stock('job-coffee'),a=await f.authorized({lines:[line]});
  const inventory=tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact']);
  const quantities=tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','po_cart_reservations','po_cart_commitments']);
  const input=enqueue(a),[first,retry]=await Promise.all([f.jobs().enqueue(input),f.jobs().enqueue(input)]);
  assert.deepEqual(first,retry);let j=first.current.job;
  assert.equal(j.state,'queued');assert.equal(first.current.valid,true);assert.deepEqual(j.inputs,a.inputs);
  assert.equal(tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','po_cart_reservations','po_cart_commitments']),quantities);
  await unchanged(()=>f.jobs().enqueue({...input,operationId:randomUUID()}));
  await unchanged(()=>f.jobs().enqueue({...input,expectedRevision:999}));
  f.setUser('owner');await unchanged(()=>f.jobs().enqueue(input));f.setUser('manager');
  const other=await f.authorized();await unchanged(()=>f.jobs().enqueue(enqueue(other)));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_jobs').get().n,1);
  // The key cannot be partitioned by a delivery location or a connection version.
  const columns=f.sql.prepare('PRAGMA table_info(po_cart_owners)').all().filter(r=>r.pk).sort((a,b)=>a.pk-b.pk).map(r=>r.name);
  assert.deepEqual(columns,['company_id','supplier_id','account_id']);
  await f.service().cancel(cancelCommand(other));

  const claim=operation(j),races=await Promise.allSettled([f.worker().claim(claim),f.worker('two').claim(operation(j))]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races[1].status,'rejected');
  const claimed=races[0].value,fence=claimed.receipt.fence;assert.equal(fence,1);assert.equal(claimed.current.authorization.authorization.startedAt,null);
  assert.deepEqual(await f.worker().claim(claim),claimed);
  await unchanged(()=>f.worker('two').heartbeat(fenced(j,fence)));
  f.setTime('2026-10-01T12:00:30.000Z');const hb=fenced(j,fence),heartbeat=await f.worker().heartbeat(hb);
  assert.equal(heartbeat.current.ownership.leaseUntil,'2026-10-01T12:01:30.000Z');
  assert.deepEqual(await f.worker().heartbeat(hb),heartbeat);
  f.setTime('2026-10-01T12:01:30.000Z');await unchanged(()=>f.worker().heartbeat(fenced(j,fence)));
  const expiredRetry=await f.worker().heartbeat(hb);assert.deepEqual(expiredRetry.receipt,heartbeat.receipt);assert.equal(expiredRetry.current.valid,false);
  const recover=operation(j),recovered=await f.worker('recovery').recoverExpired(recover);assert.equal(recovered.current.job.state,'queued');
  assert.equal(recovered.current.authorization.authorization.startedAt,null);assert.equal(recovered.current.ownership.jobId,j.id);
  assert.deepEqual(await f.worker('recovery').recoverExpired(recover),recovered);
  const next=await f.worker('two').claim(operation(j)),newFence=next.receipt.fence;assert.ok(newFence>fence);
  await unchanged(()=>f.worker().beginAttempt({...fenced(j,fence),lineId:j.inputs.preflight.lines[0].lineId}));
  const begin={...fenced(j,newFence),lineId:j.inputs.preflight.lines[0].lineId};
  const attempted=await f.worker('two').beginAttempt(begin);assert.equal(attempted.providerCallAllowed,true);
  assert.ok(attempted.current.authorization.authorization.startedAt);assert.equal(attempted.current.attempts.length,1);
  assert.equal(attempted.current.authorization.events.at(-1).kind,'start');
  const repeated=await f.worker('two').beginAttempt(begin);assert.equal(repeated.providerCallAllowed,false);assert.deepEqual(repeated.receipt,attempted.receipt);
  await unchanged(()=>f.worker('two').beginAttempt({...begin,operationId:randomUUID()}));
  const result={...fenced(j,newFence),attemptId:attempted.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]};
  const ready=await f.worker('two').recordResult(result);assert.equal(ready.current.job.state,'ready');assert.equal(ready.current.valid,true);
  assert.equal(ready.current.job.purchaseState,'not_confirmed');assert.equal(ready.current.job.deliveryState,'outstanding');
  assert.equal(ready.current.ownership.jobId,j.id);assert.equal(ready.current.ownership.workerId,null);
  assert.deepEqual(await f.worker('two').recordResult(result),ready);await unchanged(()=>f.worker('two').recordResult({...result,operationId:randomUUID()}));
  assert.equal(tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact']),inventory);
  assert.equal(f.sql.prepare("SELECT SUM(total_minor) n FROM po_cart_reservations WHERE state='reserved'").get().n,15000);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM po_cart_commitments WHERE active=1').get().n,1);
  const canceled=await f.jobs().cancel(cancel(ready.current.job));assert.equal(canceled.current.job.state,'canceled');
  assert.equal(canceled.current.authorization.reservation.state,'reserved');assert.equal(canceled.current.authorization.commitments[0].active,true);
  assert.equal(canceled.current.ownership.jobId,j.id);assert.equal(canceled.current.job.purchaseState,'not_confirmed');
  const old=await f.jobs().enqueue(input);assert.deepEqual(old.receipt,first.receipt);assert.equal(old.current.job.state,'canceled');assert.equal(old.current.valid,false);
  await unchanged(()=>f.worker('two').recordResult({...result,operationId:randomUUID()}),'source_changed');
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{f.sql.close();}

// Safe cancellation, PO changes, uncertainty and fake calls use isolated carts.
for(const scenario of ['cancel','po_cancel','po_edit','auth_cancel','crash_before','crash_after','lost_attempt_ack','mismatch','uncertain','source','revocation','race']){
  const f=await jobFixture();
  try{
    const {a,input,current}=await f.queued(),j=current.job;
    const balances=tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','orders']);
    const claimed=await f.worker().claim(operation(j)),fence=claimed.receipt.fence;
    if(['cancel','po_cancel','po_edit','auth_cancel'].includes(scenario)){
      if(scenario==='cancel'){
        const c=cancel(claimed.current.job),done=await f.jobs().cancel(c);assert.deepEqual(await f.jobs().cancel(c),done);
        await assert.rejects(f.jobs().cancel({...c,reason:'Different reason'}),conflict);
      }else if(scenario==='auth_cancel')await f.service().cancel(cancelCommand(a));
      else{
        const po=await f.drafts.get('a',a.orderId);
        if(scenario==='po_cancel')await f.drafts.cancel({...command(po),action:'cancel',reason:'Cancel test PO'});
        else await f.drafts.edit({...f.createInput(),...command(po),action:'edit',capMinor:'16000',reason:'Change reviewed cap'});
      }
      const done=await f.jobs().get({companyId:'a',jobId:j.id});assert.equal(done.job.state,'canceled');assert.equal(done.ownership.jobId,null);
      assert.equal(done.authorization.reservation.state,'released');assert.equal(done.events.at(-1).actor,'manager');
      const next=await f.queued();assert.ok(next.current.ownership.fence>fence);
      await assert.rejects(f.worker().beginAttempt({...fenced(j,fence),lineId:j.inputs.preflight.lines[0].lineId}),e=>['conflict','source_changed'].includes(e.code));
    }else if(scenario==='crash_before'){
      f.setTime('2026-10-01T12:01:00.000Z');const r=await f.worker('replacement').recoverExpired(operation(j));assert.equal(r.current.job.state,'queued');
      assert.equal(r.current.attempts.length,0);assert.equal(r.current.authorization.authorization.startedAt,null);
    }else{
      const b={...fenced(j,fence),lineId:j.inputs.preflight.lines[0].lineId};let calls=0;
      if(scenario==='lost_attempt_ack')f.db.loseAcknowledgment=true;
      if(scenario==='source')f.db.beforeBatch=()=>connectionVersion(f.sql,{paused:true});
      if(scenario==='revocation')f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
      if(scenario==='race')f.db.beforeBatch=()=>{f.setTime('2026-10-01T12:01:00.000Z');};
      let attempt;
      if(['source','revocation'].includes(scenario)){
        await assert.rejects(f.worker().beginAttempt(b),conflict);assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,0);
        assert.equal(f.sql.prepare('SELECT started_at FROM po_cart_authorizations WHERE id=?').get(a.id).started_at,null);
      }else{
        attempt=await f.worker().beginAttempt(b);
        if(attempt.providerCallAllowed){calls++;assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,1);}
        const repeat=await f.worker().beginAttempt(b);assert.equal(repeat.providerCallAllowed,false);
        if(scenario==='lost_attempt_ack')assert.equal(calls,0);
        if(['mismatch','uncertain'].includes(scenario)){
          const done=await f.worker().recordResult({...fenced(j,fence),attemptId:attempt.receipt.attemptId,
            outcome:scenario==='uncertain'?'uncertain':'verified',observation:{...j.inputs.preflight.lines[0],packs:'999'}});
          assert.equal(done.current.job.state,'review_needed');assert.equal(done.current.ownership.jobId,j.id);
          assert.notEqual(done.current.results[0].outcome,'verified');
        }
      }
      if(!['mismatch','uncertain'].includes(scenario)){
        f.setTime('2026-10-01T12:01:00.000Z');const r=await f.worker('replacement').recoverExpired(operation(j));
        assert.equal(r.current.job.state,'review_needed');assert.equal(r.current.ownership.jobId,j.id);
        assert.equal(r.current.authorization.reservation.state,'reserved');await assert.rejects(f.worker('replacement').claim(operation(j)),conflict);
      }
    }
    assert.equal(tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','orders']),balances);
  }finally{f.sql.close();}
}
console.log('PASS: durable cart jobs, exclusive ownership, fenced claims/heartbeats, exact results, replay/current status, safe cancellation and conservative crash recovery.');
