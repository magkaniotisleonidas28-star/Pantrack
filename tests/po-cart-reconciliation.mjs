import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconciliationFixture,existing,D1PoCartReconciliation} from './helpers/po-cart-reconciliation.mjs';
import {connectionVersion} from './helpers/po-cart-authorizations.mjs';
import {cancel} from './helpers/po-cart-jobs.mjs';
const dump=(f,table)=>JSON.stringify(f.sql.prepare('SELECT * FROM '+table).all());
for(const action of ['acceptVerifiedCart','abandonVerifiedCart'])for(const canceled of [false,true]){
 const f=await reconciliationFixture({stock:true});try{
  const history=dump(f,'po_cart_attempts')+dump(f,'po_cart_results'),stock=dump(f,'inventory_balances_exact'),started=(await f.current()).authorization.authorization.startedAt;
  if(canceled)await f.jobs().cancel(cancel((await f.current()).job));
  const cart=action==='acceptVerifiedCart'?f.full:[existing],s=await f.open(cart);await f.close(s,cart);const body=await f.body(s,action);
  if(canceled&&action==='acceptVerifiedCart'){await assert.rejects(f.reconcile().decide(body));continue;}
  const initialOwner=(await f.current()).ownership;
  assert.throws(()=>f.sql.exec("UPDATE po_cart_jobs SET revision=revision+1,state='ready',kind='finalizeCart'"));
  assert.throws(()=>f.sql.exec("UPDATE po_cart_authorizations SET revision=revision+1,status='canceled',released_at='2099-01-01'"));
  assert.throws(()=>f.sql.exec("UPDATE po_cart_reservations SET state='released'"));
  assert.throws(()=>f.sql.exec("UPDATE po_cart_commitments SET active=0"));
  assert.throws(()=>f.sql.exec("UPDATE po_cart_owners SET job_id=NULL,fence=fence+1"));

  f.loseDecision();const decision=await f.reconcile().decide(body);assert.deepEqual(await f.reconcile().decide(body),decision);
  const current=await f.current(),view=await f.jobs().getManager({companyId:'a',orderId:current.job.inputs.snapshot.id,view:'manager'});
  assert.equal(current.job.revision,decision.receipt.revision);assert.equal(current.job.state,action==='acceptVerifiedCart'?'ready':'canceled');
  assert.equal(current.authorization.authorization.startedAt,started);assert.equal(history,dump(f,'po_cart_attempts')+dump(f,'po_cart_results'));assert.equal(dump(f,'inventory_balances_exact'),stock);
  assert.equal(current.authorization.reservation.state,action==='acceptVerifiedCart'?'reserved':'released');assert.ok(current.authorization.commitments.every(c=>c.active===(action==='acceptVerifiedCart')));
  if(action==='acceptVerifiedCart'){assert.equal(view.job.verification.at(-1).verified,true);assert.equal(current.ownership.jobId,f.j.id);assert.equal(current.ownership.fence,initialOwner.fence);}
  else{assert.equal(current.ownership.jobId,null);assert.equal(current.ownership.fence,initialOwner.fence+1);const next=await f.service().authorize({action:'authorize',companyId:'a',orderId:current.job.inputs.snapshot.id,expectedRevision:current.job.inputs.preflight.request.expectedRevision,operationId:randomUUID()});assert.notEqual(next.current.authorization.id,current.authorization.authorization.id);}
  assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_reconciliations').get().n,1);
  await assert.rejects(f.reconcile().decide({...body,note:'changed note'}));
  for(const table of ['po_cart_reconciliation_evidence','po_cart_reconciliations']){assert.throws(()=>f.sql.exec('UPDATE '+table+' SET at=at'));assert.throws(()=>f.sql.exec('DELETE FROM '+table));}
 }finally{f.sql.close();}
}
for(const change of ['partial','price','pack','quantity','duplicate','unexpected','unrelated','unreadable','cap','baseline_missing','freshness','native_close','new_session','ownership','credential','credential_expiry','identity','cancel','source','role']){
 const f=await reconciliationFixture({baseline:change!=='baseline_missing',attempt:change!=='baseline_missing',...(change==='cap'?{baselineCart:[{...existing,unitMinor:'15000'}]}:{}),...(change==='credential_expiry'?{credentialTtl:30000}:{})});try{
  let cart=structuredClone(f.full);
  if(change==='partial')cart=cart.slice(0,1);if(change==='price')cart[1].unitMinor='1';if(change==='pack')cart[1].unitLabel='wrong';if(change==='quantity')cart[1].packs='2';if(change==='duplicate')cart.push(cart[1]);if(change==='unexpected')cart.push({...existing,sku:'OTHER'});if(change==='unrelated')cart[0].packs='2';if(change==='unreadable')cart=null;
  const s=await f.open(cart);
  if(change==='native_close'){await f.w('fail',{...s,reason:'browser_closed'});await assert.rejects(f.reconcile().decide(await f.body(s)));continue;}
  await f.close(s,cart);const body=await f.body(s);
  if(change==='freshness')f.advance(300000);if(change==='credential_expiry')f.advance(40000);if(change==='new_session')await f.open();
  if(change==='ownership')f.sql.exec('UPDATE po_cart_owners SET fence=fence+1');if(change==='credential')f.revoke(f.c);
  if(change==='identity')f.sql.exec('UPDATE po_cart_worker_identities SET version=version+1');if(change==='cancel')await f.jobs().cancel(cancel((await f.current()).job));
  if(change==='source')connectionVersion(f.sql,{paused:true});if(change==='role')f.sql.exec("DELETE FROM memberships WHERE user_id='manager' AND company_id='a'");
  const after=dump(f,'po_cart_reservations');await assert.rejects(f.reconcile().decide(body),change);assert.equal(dump(f,'po_cart_reservations'),after);assert.notEqual(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'ready');
  if(['price','pack','quantity','duplicate','unexpected','unrelated','unreadable','cap','baseline_missing','freshness','ownership','credential','credential_expiry','identity','cancel'].includes(change)){
   assert.throws(()=>f.sql.prepare("INSERT INTO po_cart_reconciliations SELECT e.company_id,?,e.session_id,e.job_id,j.authorization_id,e.job_revision,e.authorization_revision,e.fence,'manager','acceptVerifiedCart','Forged ready',?,'forged','{}',1 FROM po_cart_reconciliation_evidence e JOIN po_cart_jobs j ON j.company_id=e.company_id AND j.id=e.job_id").run(randomUUID(),f.options.clock.now().toISOString()),change);
   assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_reconciliations').get().n,0);
  }

 }finally{f.sql.close();}
}
for(const change of ['source','cancel','role','revoke','lease','new_session'])for(const action of ['acceptVerifiedCart','abandonVerifiedCart']){
 const f=await reconciliationFixture();try{
  const cart=action==='acceptVerifiedCart'?f.full:[existing],s=await f.open(cart);await f.close(s,cart);const body=await f.body(s,action);
  f.beforeDecision(()=>{if(change==='source')connectionVersion(f.sql,{paused:true});if(change==='cancel')f.sql.exec("UPDATE po_cart_authorizations SET revision=revision+1,status='canceled'");if(change==='role')f.sql.exec("DELETE FROM memberships WHERE user_id='manager' AND company_id='a'");if(change==='revoke')f.revoke(f.c);if(change==='lease')f.sql.exec('UPDATE po_cart_owners SET fence=fence+1');if(change==='new_session')f.sql.exec("UPDATE po_cart_owners SET fence=fence+1");});
  if(change==='source'&&action==='abandonVerifiedCart')await f.reconcile().decide(body);else await assert.rejects(f.reconcile().decide(body));
 }finally{f.sql.close();}
}
for(const change of ['source','cancel']){
 const f=await reconciliationFixture();try{
  if(change==='source')connectionVersion(f.sql,{paused:true});else await f.jobs().cancel(cancel((await f.current()).job));
  const s=await f.open([existing]);await f.close(s,[existing]);await f.reconcile().decide(await f.body(s,'abandonVerifiedCart'));assert.equal((await f.current()).authorization.reservation.state,'released');
 }finally{f.sql.close();}
}
{
 const f=await reconciliationFixture();try{const s=await f.open();await f.close(s);const body=await f.body(s);
  for(const user of [null,'employee','b-manager'])await assert.rejects(new D1PoCartReconciliation(f.db,{...f.options,identity:async()=>user}).decide(body),e=>e.code==='forbidden');
  await assert.rejects(f.reconcile().decide({...body,companyId:'b'}));
  const results=await Promise.allSettled([f.reconcile().decide(body),f.reconcile().decide({...body,operationId:randomUUID()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 }finally{f.sql.close();}
}
console.log('PASS: exact acceptance and baseline abandonment, retained uncertainty/history/stock, release once, replay, concurrency, freshness and transaction-time authority/credential/source/ownership guards.');
