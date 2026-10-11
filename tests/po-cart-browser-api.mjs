import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {fixtureCredential} from '../scripts/po-cart-worker/credentials.mjs';
import {readPrivate,writePrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {workerFixture} from './helpers/po-cart-worker.mjs';
import {enqueue,cancel,jobTables} from './helpers/po-cart-jobs.mjs';
import {tables,connectionVersion} from './helpers/po-cart-authorizations.mjs';
const line={kind:'non_stock',sku:'DEMO-COFFEE',description:'Coffee',unitLabel:'case of 6 × 1 lb',packs:'2',estimatedUnitMinor:'5400'};
const existing={sku:'EXISTING',unitLabel:'box',packs:'1',unitMinor:'350'};
const op=(action,j,extra={})=>({action,jobId:j.id,operationId:randomUUID(),...extra});
const json=async r=>{assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'private, no-store');return r.json();};
async function setup(stock=false){
 const f=await workerFixture(),poLine=stock?await f.stock('browser-guard-stock'):line,a=await f.authorized({lines:[poLine]}),intent={...enqueue(a),browser:{layout:'rows',scenario:'normal'}};
 const q=await f.jobs().enqueue(intent),j=q.current.job,c=f.credential({consumerKind:'local_browser'});
 const mutation=(action,extra={})=>f.request(c,op(action,j,extra));
 const claimed=await json(await mutation('claim')),fence=claimed.receipt.fence;
 const baseline=()=>mutation('recordBaseline',{fence,cart:[existing]});
 async function completeLines(cart=[existing]){await json(await mutation('recordBaseline',{fence,cart}));const begun=await json(await mutation('beginAttempt',{fence,lineId:j.inputs.preflight.lines[0].lineId}));
  const r=await json(await mutation('recordResult',{fence,attemptId:begun.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]}));
  assert.equal(r.current.job.state,'preparing');return begun;}
 return {...f,j,c,intent,fence,mutation,baseline,completeLines};
}
const rows=f=>tables(f.sql,[...jobTables,'po_cart_browser_evidence','inventory','inventory_balances_exact','inventory_events_exact']);
{
 const f=await setup();try{
  const fake=f.credential();assert.equal((await json(await f.request(fake))).current,null);
  for(const action of ['claim','heartbeat','beginAttempt','recordResult','recordBaseline','finalizeCart','hold']){
   const body=op(action,f.j,{fence:f.fence,...(action==='beginAttempt'?{lineId:f.j.inputs.preflight.lines[0].lineId}:{}),
    ...(action==='recordResult'?{attemptId:randomUUID(),outcome:'uncertain',observation:null}:{}),
    ...(['recordBaseline','finalizeCart'].includes(action)?{cart:[]}:{}),...(action==='hold'?{reason:'sign_in_required'}:{})});
   if(action==='claim')delete body.fence;
   assert.equal((await f.request(fake,body,null,{'x-consumer-kind':'local_browser'})).status,404,action);
  }
  assert.equal((await f.mutation('beginAttempt',{fence:f.fence,lineId:f.j.inputs.preflight.lines[0].lineId})).status,409);
  const before=rows(f);assert.equal((await f.mutation('hold',{fence:f.fence,reason:'arbitrary private text'})).status,400);assert.equal(rows(f),before);
  await f.completeLines();
  assert.throws(()=>f.sql.prepare("UPDATE po_cart_jobs SET revision=revision+1,state='ready',kind='recordResult' WHERE id=?").run(f.j.id));
  assert.throws(()=>f.sql.prepare('UPDATE po_cart_jobs SET browser_config_json=NULL WHERE id=?').run(f.j.id));
  assert.throws(()=>f.sql.prepare("UPDATE po_cart_worker_identities SET consumer_kind='fake',version=version+1 WHERE id=?").run(f.c.workerId));
  const cart=[existing,...f.j.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))];
  const body=op('finalizeCart',f.j,{fence:f.fence,cart}),ready=await json(await f.request(f.c,body));assert.equal(ready.current.job.state,'ready');
  assert.deepEqual(ready.current.verification.map(e=>[e.kind,e.verified]),[['baseline',true],['final',true]]);
  const manager=await f.jobs().getManager({view:'manager',companyId:'a',orderId:f.j.inputs.snapshot.id});
  assert.equal(manager.job.state,'ready');assert.equal(manager.job.lines.every(l=>l.verified),true);
  assert.deepEqual(manager.job.verification,ready.current.verification);
  assert.ok(!JSON.stringify(manager).match(/observation|workerId|ownership|token|profile|sessionUrl/));
  assert.deepEqual((await json(await f.request(f.c,body))).receipt,ready.receipt);
  assert.throws(()=>f.sql.exec('DELETE FROM po_cart_browser_evidence'));assert.throws(()=>f.sql.exec('UPDATE po_cart_browser_evidence SET verified=0'));
  const root='.sites-runtime/po-cart-workers/browser-rotation-'+randomUUID(),file=root+'/credential.json';
  try{writePrivate(file,f.c);await fixtureCredential({execute:async sql=>f.sql.exec(sql),file,action:'rotate'});
    const rotated=readPrivate(file);assert.equal(f.sql.prepare('SELECT consumer_kind FROM po_cart_worker_identities WHERE id=?').get(f.c.workerId).consumer_kind,'local_browser');
    assert.equal((await f.request(f.c,body)).status,401);assert.deepEqual((await json(await f.request(rotated,body))).receipt,ready.receipt);
  }finally{rmSync(root,{recursive:true,force:true});}
  const projection=JSON.stringify(ready);for(const key of ['cookie','token','profile','session','observation'])assert.ok(!projection.includes(key));
 }finally{f.sql.close();}
}
for(const cart of [[existing,existing],[{...existing,sku:line.sku}]]){
 const f=await setup();try{const held=await json(await f.mutation('recordBaseline',{fence:f.fence,cart}));assert.equal(held.current.job.state,'review_needed');assert.equal(held.current.verification[0].verified,false);assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,0);}finally{f.sql.close();}
}
for(const change of ['missing','duplicate','unexpected','baseline_changed','price','pack','quantity','cap']){
 const f=await setup();try{
  await f.completeLines(change==='cap'?[{...existing,unitMinor:'99999'}]:[existing]);let cart=[existing,{sku:line.sku,unitLabel:line.unitLabel,packs:line.packs,unitMinor:line.estimatedUnitMinor}];
  if(change==='missing')cart.pop();if(change==='duplicate')cart.push({...cart[1]});
  if(change==='unexpected')cart.push({...existing,sku:'UNEXPECTED'});if(change==='baseline_changed')cart[0]={...existing,packs:'2'};
  if(change==='price')cart[1].unitMinor='5500';if(change==='pack')cart[1].unitLabel='wrong';if(change==='quantity')cart[1].packs='3';
  if(change==='cap'){
   // Final cap includes unrelated baseline contents. Use a high baseline in its own separately authorized job below.
   cart[0]={...existing,unitMinor:'99999'};
  }
  const result=await json(await f.mutation('finalizeCart',{fence:f.fence,cart}));assert.equal(result.current.job.state,'review_needed',change);
  assert.equal(result.current.verification.find(e=>e.kind==='final').verified,false);
 }finally{f.sql.close();}
}
// Every new operation retains scope, auth, current permission, source and transaction-time lease guards.
for(const action of ['recordBaseline','finalizeCart','hold'])for(const change of ['revoke','expiry','source','cancel','membership','lease','version']){
 const f=await setup(true);try{
  if(action==='finalizeCart')await f.completeLines();
  const body=op(action,f.j,{fence:f.fence,...(action==='hold'?{reason:'verification_failed'}:{cart:action==='recordBaseline'?[existing]:[existing,...f.j.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))]})});
  for(const wrong of [null,f.credential({companyId:'b',consumerKind:'local_browser'}),f.credential({consumerKind:'local_browser',accountId:'wrong'})])assert.equal((await f.request(wrong,body)).status,wrong?404:401);
  assert.equal((await f.request(f.credential({consumerKind:'local_browser'}),body)).status,409);
  const original=f.db.batch.bind(f.db);let injected=false,baseline;
  f.db.batch=async statements=>{
   if(!injected&&statements.some(s=>s.query.startsWith('INSERT INTO po_cart_job_operations'))){injected=true;
    if(change==='revoke')f.revoke(f.c);
    if(change==='expiry')f.sql.function('strftime',{varargs:true},()=>new Date(Date.now()+7200000).toISOString());
    if(change==='source')connectionVersion(f.sql,{paused:true});
    if(change==='membership')f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
    if(change==='version')f.sql.prepare('UPDATE po_cart_worker_identities SET version=version+1 WHERE id=?').run(f.c.workerId);
    if(change==='lease')f.sql.prepare("UPDATE po_cart_owners SET lease_until='2020-01-01' WHERE job_id=?").run(f.j.id);
    if(change==='cancel'){const current=await f.jobs().get({companyId:'a',jobId:f.j.id});await f.jobs().cancel(cancel(current.job));}
    baseline=rows(f);
   }return original(statements);
  };
  const response=await f.request(f.c,body);assert.equal(response.status,['revoke','expiry','version'].includes(change)?401:409,action+'/'+change);
  assert.equal(injected,true);assert.equal(rows(f),baseline);
  assert.equal(f.sql.prepare('SELECT state FROM po_cart_reservations').get().state,change==='cancel'&&action!=='finalizeCart'?'released':'reserved');
 }finally{f.sql.close();}
}
console.log('PASS: browser-only scope, immutable baseline/config/kind/final evidence, final readiness/cap/cart checks, all new transaction-time guards and private responses.');
