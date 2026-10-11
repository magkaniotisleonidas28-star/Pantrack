import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {workerFixture} from './helpers/po-cart-worker.mjs';
import {enqueue,cancel} from './helpers/po-cart-jobs.mjs';
import {connectionVersion} from './helpers/po-cart-authorizations.mjs';
await build({entryPoints:['src/lib/d1-po-cart-browser-sessions.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/browser-session-tests.mjs'});
const {D1PoCartBrowserSessions}=await import('../.sites-runtime/browser-session-tests.mjs');
const existing={sku:'EXISTING',unitLabel:'box',packs:'1',unitMinor:'350'};
async function setup({baseline=false,attempt=false,ready=false}={}){
 const f=await workerFixture();f.options.clock={now:()=>new Date()};
 const a=await f.authorized(),q=await f.jobs().enqueue({...enqueue(a),browser:{layout:'rows',scenario:'login_expired'}}),j=q.current.job,c=f.credential({consumerKind:'local_browser'});
 const mutation=async(action,extra={})=>{const r=await f.request(c,{action,jobId:j.id,operationId:randomUUID(),...extra});assert.equal(r.status,200,await r.clone().text());return r.json();};
 const claim=await mutation('claim'),fence=claim.receipt.fence;
 if(baseline||attempt||ready)await mutation('recordBaseline',{fence,cart:[existing]});
 if(attempt||ready)for(const line of j.inputs.preflight.lines){const b=await mutation('beginAttempt',{fence,lineId:line.lineId});await mutation('recordResult',{fence,attemptId:b.receipt.attemptId,outcome:'verified',observation:line});}
 if(ready)await mutation('finalizeCart',{fence,cart:[existing,...j.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))]});
 else await mutation('hold',{fence,reason:'sign_in_required'});
 const manager=()=>new D1PoCartBrowserSessions(f.db,f.options);
 const auth=await import('../.sites-runtime/po-cart-worker-api-tests.mjs');void auth;
 // Reuse real authentication rather than caller-provided kind or scope.
 await build({stdin:{contents:"export {authenticateCartWorker} from './src/lib/po-cart-worker-transport';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/session-auth-tests.mjs'});
 const {authenticateCartWorker}=await import('../.sites-runtime/session-auth-tests.mjs');
 const worker=async(cred=c)=>new D1PoCartBrowserSessions(f.db,{...f.options,identity:async()=>null,workerAccess:await authenticateCartWorker(f.db,'Bearer '+cred.secret)});
 const current=()=>f.jobs().get({companyId:'a',jobId:j.id});
 const request=async(purpose='sign_in')=>manager().requestBrowser({action:'requestBrowser',companyId:'a',jobId:j.id,expectedRevision:(await current()).job.revision,operationId:randomUUID(),purpose});
 const w=async(action,extra={})=>(await worker()).worker({action,operationId:randomUUID(),...extra});
 async function open(purpose='sign_in',cart=null){const requested=await request(purpose),sessionId=requested.receipt.sessionId;
  const claimed=await w('claim',{sessionId}),fence=claimed.current.session.fence;await w('opened',{sessionId,fence,cart});return {sessionId,fence};}
 async function close(s,cart=[existing]){const currentSession=await (await worker()).getWorker(s.sessionId),job=await current();
  await manager().closeBrowser({action:'closeBrowser',companyId:'a',jobId:j.id,expectedRevision:job.job.revision,sessionId:s.sessionId,expectedSessionRevision:currentSession.session.revision,operationId:randomUUID()});
  return w('complete',{...s,cart});}
 async function resume(s,operationId=randomUUID()){const currentSession=await (await worker()).getWorker(s.sessionId),job=await current();
  return manager().resume({action:'resume',companyId:'a',jobId:j.id,expectedRevision:job.job.revision,sessionId:s.sessionId,expectedSessionRevision:currentSession.session.revision,operationId});}
 return {...f,c,j,current,manager,worker,request,w,open,close,resume,mutation};
}
for(const baseline of [false,true]){
 const f=await setup({baseline});try{
  const before=f.sql.prepare('SELECT * FROM po_cart_authorizations').all(),s=await f.open();
  await assert.rejects(f.resume(s),e=>e.code==='conflict');
  const other=f.credential({consumerKind:'local_browser'});await assert.rejects((await f.worker(other)).worker({action:'claim',sessionId:s.sessionId,operationId:randomUUID()}),e=>e.code==='conflict');
  await f.close(s);const operationId=randomUUID(),session=await(await f.worker()).getWorker(s.sessionId),job=await f.current();
  const body={action:'resume',companyId:'a',jobId:f.j.id,expectedRevision:job.job.revision,sessionId:s.sessionId,expectedSessionRevision:session.session.revision,operationId};
  const resumed=await f.manager().resume(body);assert.deepEqual(await f.manager().resume(body),resumed);
  assert.equal(resumed.receipt.revision,(await f.current()).job.revision);assert.equal((await f.current()).job.state,'queued');assert.deepEqual(f.sql.prepare('SELECT * FROM po_cart_authorizations').all(),before);
  const claimed=await f.mutation('claim');
  if(baseline){await f.mutation('verifyBaseline',{fence:claimed.receipt.fence,cart:[existing]});assert.equal(f.sql.prepare("SELECT count(*) n FROM po_cart_browser_evidence WHERE kind='baseline'").get().n,1);}
  assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,0);
 }finally{f.sql.close();}
}
for(const change of ['attempt','uncertain','source','cancel','expiry','no_close','wrong_cart','duplicate','requested_sku','baseline_changed','membership','revoke']){
 const f=await setup({baseline:true,attempt:['attempt','uncertain'].includes(change)});try{
  if(['attempt','uncertain'].includes(change)){await assert.rejects(f.request(),e=>e.code==='conflict');const s=await f.open('inspect',[existing]);await f.close(s);await assert.rejects(f.resume(s),e=>e.code==='conflict');continue;}
  const s=await f.open();let cart=[existing];if(change==='wrong_cart')cart=[existing,{...existing,sku:'EXTRA'}];if(change==='duplicate')cart=[existing,existing];if(change==='requested_sku')cart=[existing,{...existing,sku:f.j.inputs.preflight.lines[0].sku}];if(change==='baseline_changed')cart=[{...existing,packs:'2'}];
  if(change!=='no_close')await f.close(s,cart);
  if(change==='source')connectionVersion(f.sql,{paused:true});
  if(change==='cancel')await f.jobs().cancel(cancel((await f.current()).job));
  if(change==='expiry')f.options.clock={now:()=>new Date(Date.now()+1900000)};
  if(change==='membership')f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
  if(change==='revoke'){f.revoke(f.c);await assert.rejects(f.worker());continue;}
  await assert.rejects(f.resume(s));assert.notEqual(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'queued');
 }finally{f.sql.close();}
}
for(const change of ['none','price','unexpected','unreadable','native_close','expiry']){
 const f=await setup({ready:true});try{
  const cart=[existing,...f.j.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))];
  const s=await f.open('inspect',cart);
  if(change==='price')cart[1].unitMinor='1';if(change==='unexpected')cart.push({...existing,sku:'OTHER'});
  if(change==='native_close')await f.w('fail',{...s,reason:'browser_closed'});
  else if(change==='expiry'){f.options.clock={now:()=>new Date(Date.now()+1900000)};await f.w('expire',{sessionId:s.sessionId});}
  else await f.close(s,change==='unreadable'?null:cart);
  assert.equal((await f.current()).job.state,change==='none'?'ready':'review_needed',change);
  assert.equal(f.sql.prepare("SELECT verified FROM po_cart_browser_evidence WHERE kind='final'").get().verified,1);
  assert.throws(()=>f.sql.exec('UPDATE po_cart_browser_observations SET verified=0'));assert.throws(()=>f.sql.exec('DELETE FROM po_cart_browser_observations'));
 }finally{f.sql.close();}
}
{
 const f=await setup();try{for(const identity of [null,'employee','outsider']){const service=new D1PoCartBrowserSessions(f.db,{...f.options,identity:async()=>identity});await assert.rejects(service.requestBrowser({action:'requestBrowser',companyId:'a',jobId:f.j.id,expectedRevision:(await f.current()).job.revision,operationId:randomUUID(),purpose:'inspect'}),e=>e.code==='forbidden');}
  await assert.rejects((await f.worker(f.credential())).getWorker(),e=>e.code==='forbidden');
  const before=f.sql.prepare('SELECT * FROM po_cart_browser_sessions').all();await assert.rejects(f.manager().requestBrowser({action:'requestBrowser',companyId:'b',jobId:f.j.id,expectedRevision:(await f.current()).job.revision,operationId:randomUUID(),purpose:'inspect'}));assert.deepEqual(f.sql.prepare('SELECT * FROM po_cart_browser_sessions').all(),before);
 }finally{f.sql.close();}
}

for(const change of ['source','membership','cancel']){
 const f=await setup({baseline:true});try{
  const s=await f.open();
  assert.throws(()=>f.sql.prepare("UPDATE po_cart_owners SET worker_id='other',lease_until='2099-01-01',fence=fence+1 WHERE job_id=?").run(f.j.id));
  await f.close(s);
  f.db.beforeBatch=()=>{if(change==='source')connectionVersion(f.sql,{paused:true});if(change==='membership')f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");if(change==='cancel')f.sql.prepare("UPDATE po_cart_authorizations SET revision=revision+1,status='invalidated' WHERE company_id='a'").run();};
  await assert.rejects(f.resume(s));assert.notEqual(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'queued');
 }finally{f.sql.close();}
}

{
 const f=await setup();try{
  const s=await f.open(),deadline=(await(await f.worker()).getWorker(s.sessionId)).session.expiresAt;
  for(let at=Date.now()+50000;at<Date.parse(deadline)-10000;at+=50000){f.options.clock={now:()=>new Date(at)};await f.w('heartbeat',s);}
  f.options.clock={now:()=>new Date(Date.parse(deadline)-10000)};
  const beat=await f.w('heartbeat',s);assert.equal(beat.current.session.leaseUntil,deadline);assert.equal(beat.current.session.expiresAt,deadline);
  f.options.clock={now:()=>new Date(Date.parse(deadline)+1)};
  await assert.rejects(f.w('heartbeat',s));await f.w('expire',{sessionId:s.sessionId});await assert.rejects(f.resume(s));
 }finally{f.sql.close();}
}
console.log('PASS: supervised sign-in/inspection, explicit zero-attempt resume, immutable baseline/final, revocation/source/cancel/expiry guards and manager authorization.');
