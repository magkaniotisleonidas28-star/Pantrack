import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {jobFixture,operation,fenced,enqueue,cancel,snapshot,conflict} from './helpers/po-cart-jobs.mjs';
import {cartCore,command,connectionVersion,supplier} from './helpers/po-cart-authorizations.mjs';

for(const atCommit of [false,true])for(const change of ['membership','config','policy','connection','proposal','clover','mapping','profile']){
  const f=await jobFixture();
  try{
    let extra={},mutate;
    if(['proposal','clover'].includes(change)){
      const h=await f.proposed('source',{clover:change==='clover'});extra={source:'proposals',proposals:[{id:h.proposalId,revision:h.revision}]};
      mutate=()=>change==='clover'?f.sql.exec("UPDATE clover_sync_state SET last_success='2026-09-01T00:00:00.000Z'"):
        f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE product_id='source'");
    }else if(['mapping','profile'].includes(change)){
      const line=await f.stock('mapped'),registry=new cartCore.D1PurchasingSuppliers(f.db,f.options);
      const profile={name:supplier.name,email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'',
        emailAcceptance:{status:'unknown',note:''},accounts:[{id:'account',reference:supplier.accountId,status:'active'}],
        locations:[{id:'location',accountId:'account',reference:supplier.locationId,address:supplier.deliveryAddress,status:'active'}]};
      await registry.saveProfile({action:'save_profile',companyId:'a',supplierId:supplier.id,expectedVersion:0,operationId:randomUUID(),reason:'Fixture profile',profile});
      await registry.saveMapping({action:'save_mapping',companyId:'a',mappingId:'mapped',expectedVersion:0,operationId:randomUUID(),reason:'Fixture mapping',
        supplierId:supplier.id,expectedSupplierVersion:1,accountId:'account',locationId:'location',productId:'mapped',expectedConfigId:line.expectedConfigId,
        expectedConfigVersion:1,sku:'MAPPED',description:'Mapped stock',unitLabel:'supplier case of 6',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:'100'});
      extra={source:'registry',supplierRef:{id:supplier.id,version:1,accountId:'account',locationId:'location'},lines:[{kind:'stock',mappingId:'mapped',mappingVersion:1,packs:'2'}]};
      // Advance the same head exactly as a saved new version would; the frozen job must remain unchanged.
      mutate=()=>f.sql.exec(`UPDATE ${change==='mapping'?'purchasing_mappings':'purchasing_suppliers'} SET version=version+1 WHERE company_id='a'`);
    }else{
      extra={lines:[await f.stock('source')]};
      mutate={membership:()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'"),
        config:()=>f.sql.exec("UPDATE inventory_config_versions SET status='replaced',replaced_at='2026-10-01T12:00:00.000Z' WHERE product_id='source'"),
        policy:()=>f.sql.exec("INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES('a',2,50000,100000)"),
        connection:()=>connectionVersion(f.sql,{paused:true})}[change];
    }
    let po;
    if(extra.source==='registry'){
      const input=f.createInput(extra);delete input.supplier;po=await f.drafts.create(input);po=await f.drafts.review({...command(po),action:'review',acknowledgeWarnings:true});
    }else po=await f.reviewed(extra);
    const a=(await f.service().authorize(command(po))).current.authorization;
    const queued=await f.jobs().enqueue(enqueue(a)),j=queued.current.job,claimed=await f.worker().claim(operation(j));
    const before=snapshot(f),b={...fenced(j,claimed.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId};
    if(atCommit)f.db.beforeBatch=mutate;else mutate();
    await assert.rejects(f.worker().beginAttempt(b));assert.equal(snapshot(f),before,`${change}: atomic first attempt/start rollback`);
    f.setUser('owner');const held=await f.jobs().get({companyId:'a',jobId:j.id});assert.equal(held.valid,false);
    assert.equal(held.authorization.reservation.state,'reserved');assert.equal(held.ownership.jobId,j.id);
    assert.equal(held.attempts.length,0);assert.equal(held.authorization.authorization.startedAt,null);
    const released=await f.jobs().cancel(cancel(held.job));
    assert.equal(released.current.authorization.reservation.state,'released');assert.equal(released.current.ownership.jobId,null);
  }finally{f.sql.close();}
}

// All source predicates also participate in claim and result commits, not just attempt creation.
for(const action of ['claim','recordResult']){
  const f=await jobFixture();try{
    const q=await f.queued(),j=q.current.job;let input=operation(j);
    if(action==='recordResult'){
      const c=await f.worker().claim(input),b=await f.worker().beginAttempt({...fenced(j,c.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId});
      input={...fenced(j,c.receipt.fence),attemptId:b.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]};
    }
    const before=snapshot(f);f.db.beforeBatch=()=>connectionVersion(f.sql,{paused:true});await assert.rejects(f.worker()[action](input),conflict);assert.equal(snapshot(f),before);
  }finally{f.sql.close();}
}

// A failure after authorization start must roll back the attempt, start, audit and receipt together.
const f=await jobFixture();try{
  const q=await f.queued(),j=q.current.job,c=await f.worker().claim(operation(j)),before=snapshot(f),batch=f.db.batch.bind(f.db);
  f.db.batch=statements=>batch(statements.some(s=>s.query.startsWith('INSERT INTO po_cart_attempts'))?
    [...statements,f.db.prepare('INSERT INTO table_does_not_exist VALUES(1)')]:statements);
  await assert.rejects(f.worker().beginAttempt({...fenced(j,c.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId}),conflict);
  assert.equal(snapshot(f),before);f.db.batch=batch;
  // Started PO invalidation retains all holds and fences out the old worker atomically.
  const b=await f.worker().beginAttempt({...fenced(j,c.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId});
  const po=await f.drafts.get('a',q.a.orderId);await f.drafts.cancel({...command(po),action:'cancel',reason:'Cancel started PO'});
  const held=await f.jobs().get({companyId:'a',jobId:j.id});assert.equal(held.job.state,'review_needed');assert.equal(held.authorization.reservation.state,'reserved');
  assert.equal(held.ownership.jobId,j.id);assert.equal(held.ownership.workerId,null);assert.ok(held.ownership.fence>c.receipt.fence);
  assert.equal(held.events.at(-1).actor,'manager');
  await assert.rejects(f.worker().recordResult({...fenced(j,c.receipt.fence),attemptId:b.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]}));
  const done=await f.jobs().cancel(cancel(held.job));assert.equal(done.current.authorization.reservation.state,'reserved');assert.equal(done.current.ownership.jobId,j.id);
}finally{f.sql.close();}

// A cancellation between source inspection and the final status snapshot cannot return old reservations/history.
const reading=await jobFixture();try{
  const q=await reading.queued(),j=q.current.job,batch=reading.db.batch.bind(reading.db);let canceled=false;
  reading.db.batch=async statements=>{
    if(!canceled&&statements[0].query==='SELECT * FROM po_cart_jobs WHERE company_id=? AND id=?'){
      canceled=true;
      reading.sql.prepare("INSERT INTO po_cart_events VALUES(?,?,2,'cancel','manager','Cancel during status read','2026-10-01T12:00:00.000Z')").run('a',q.a.id);
      reading.sql.prepare("UPDATE po_cart_authorizations SET revision=2,status='canceled',released_at='2026-10-01T12:00:00.000Z' WHERE company_id='a' AND id=?").run(q.a.id);
    }
    return batch(statements);
  };
  const current=await reading.jobs().get({companyId:'a',jobId:j.id});assert.equal(current.job.state,'canceled');assert.equal(current.valid,false);
  assert.equal(current.authorization.authorization.status,'canceled');assert.equal(current.authorization.valid,false);
  assert.equal(current.authorization.reservation.state,'released');assert.equal(current.authorization.events.at(-1).kind,'cancel');
  assert.equal(current.ownership.jobId,null);
}finally{reading.sql.close();}
console.log('PASS: membership/configuration/proposal/Clover/mapping/profile/connection/policy use guards, commit-time races, atomic start rollback and retained started invalidation.');
