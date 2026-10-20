import {finishOfflineFixture} from './po-cart-worker/offline-case-cleanup.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createServer as probePort} from 'node:net';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,existsSync} from 'node:fs';
import {workerFixture} from '../tests/helpers/po-cart-worker.mjs';
import {enqueue,cancel} from '../tests/helpers/po-cart-jobs.mjs';
import {writePrivate,readPrivate,profileLock} from './po-cart-worker/private-files.mjs';
import {tables,connectionVersion} from '../tests/helpers/po-cart-authorizations.mjs';
import {captureOwnedBrowser,stopOwnedBrowser} from './po-cart-worker/owned-browser-process.mjs';
await build({stdin:{contents:"export * from './scripts/po-cart-worker/fixture-store.ts';export * from './scripts/cart-preview/fixture.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/browser-worker-fixture.mjs'});
const {BrowserFixtureStore,startFixture,catalog}=await import('../.sites-runtime/browser-worker-fixture.mjs');
const root='.sites-runtime/po-cart-workers/browser-acceptance-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
const store=new BrowserFixtureStore(root+'/store.json');let server,fixture,f,origin,fixtureOrigin,children=[],ownedBrowsers=[],hook=async()=>{},caseId=0;
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(check){const end=Date.now()+15000;while(!check()){if(Date.now()>end)throw Error('Browser acceptance condition timed out.');await pause(10);}}
async function start({layout='rows',scenario='normal',entries,lines=catalog.map((l,i)=>({kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:String(i+1),estimatedUnitMinor:l.unitMinor}))}={}){
 const port=await new Promise(ok=>{const p=probePort();p.listen(0,'127.0.0.1',()=>{const port=p.address().port;p.close(()=>ok(port));});});
 fixtureOrigin='http://127.0.0.1:'+port;fixture=await startFixture(store,port);
 f=await workerFixture();const a=await f.authorized({lines,capMinor:'25000'}),q=await f.jobs().enqueue({...enqueue(a),browser:{layout,scenario}}),j=q.current.job;
 const session=store.provision(j.id,{layout,scenario},entries);writePrivate(root+'/sessions.json',{version:1,origin:fixtureOrigin,jobs:{[j.id]:{scope:{companyId:j.companyId,supplierId:j.supplierId,accountId:j.accountId},layout,scenario,token:session.token}}});
 server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):null;
  if(await hook({phase:'before',body,res})===false)return;
  const r=await f.api[req.method](new Request(origin+req.url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})}));
  if(await hook({phase:'after',body,res,response:r})===false)return;
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
 }catch{res.writeHead(503);res.end('{}');}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));origin='http://127.0.0.1:'+server.address().port;caseId++;
 return {j,session,initial:effects()};
}
function launch(name){
 name=caseId+'-'+name;const credentialFile=`${root}/${name}-credential.json`,journalFile=`${root}/${name}-journal.json`;
 if(!existsSync(credentialFile))writePrivate(credentialFile,f.credential({consumerKind:'local_browser'}));
 const p=spawn(process.execPath,['scripts/po-cart-browser-worker.mjs','--credential',credentialFile,'--journal',journalFile,'--fixture',root+'/sessions.json','--origin',origin,'--once'],
  {stdio:['ignore','pipe','pipe'],env:Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','PANTRACK_FULL_OFFLINE_GATE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
 let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);children.push(p);
 return {p,credentialFile,journalFile,done:new Promise(ok=>p.on('exit',(code,signal)=>ok({code,signal,output})))};
}
async function stop(){for(const p of children)if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');children=[];
 for(const owned of ownedBrowsers)await stopOwnedBrowser(owned);ownedBrowsers=[];
 const cleanup=await finishOfflineFixture({f,dir:root+'/states/'+caseId,origin});server.closeAllConnections();await new Promise(ok=>server.close(ok));f.sql.close();fixture.closeAllConnections();await new Promise(ok=>fixture.close(ok));hook=async()=>{};assert.equal(cleanup.cleanupVerified,true);}
function profile(j){const key=createHash('sha256').update(JSON.stringify([fixtureOrigin,j.companyId,j.supplierId,j.accountId])).digest('hex');return resolve('.sites-runtime/po-cart-workers/browser-profiles',key);}
function capture(w,j){const owned=captureOwnedBrowser(w.p.pid,profile(j));ownedBrowsers.push(owned);return owned;}
const effects=()=>tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','po_cart_commitments','po_cart_reservations']);
const status=()=>f.sql.prepare('SELECT state FROM po_cart_jobs').get().state;
const calls=workers=>workers.flatMap(w=>readPrivate(w.journalFile).calls);
try{
 for(const layout of ['rows','compact'])for(const scenario of ['normal','malicious','unavailable','price_changed','wrong_pack','ambiguous','login_expired','lost_response']){
  const {j,session,initial}=await start({layout,scenario}),workers=[launch('one'),launch('two')],results=await Promise.all(workers.map(w=>w.done));
  const ready=['normal','malicious'].includes(scenario);assert.equal(status(),ready?'ready':'review_needed',layout+'/'+scenario+' '+JSON.stringify(results)+' '+JSON.stringify(workers.map(w=>readPrivate(w.journalFile).browserFailure)));
  assert.equal(session.entries.filter(e=>e.sku==='EXISTING').length,1);assert.equal(effects(),initial);
  if(ready){assert.equal(calls(workers).length,3);assert.equal(session.entries.length,4);for(const l of j.inputs.preflight.lines)assert.equal(session.entries.find(e=>e.sku===l.sku)?.packs,l.packs);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM po_cart_browser_evidence WHERE verified=1").get().n,2);}
  else{assert.ok(calls(workers).length<2);if(scenario==='lost_response'){assert.equal(session.entries.length,2);assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,1);}else assert.equal(session.entries.length,1);}
  for(const result of results){assert.ok(!result.output.includes(session.token));for(const w of workers)assert.ok(!result.output.includes(readPrivate(w.credentialFile).secret));}
  console.log('PASS browser HTTP '+layout+'/'+scenario+': '+status());await stop();
 }
 // Lost successful mutation replies replay the same UUID and never repeat an addition.
 for(const action of ['recordBaseline','recordResult','finalizeCart','beginAttempt']){
  const {session,initial}=await start();let dropped=false;
  hook=async({phase,body,res})=>{if(phase==='after'&&body?.action===action&&!dropped){dropped=true;res.destroy();return false;}};
  const w=launch('lost-'+action);await w.done;assert.equal(dropped,true);assert.equal(status(),action==='beginAttempt'?'review_needed':'ready');
  assert.equal(calls([w]).length,action==='beginAttempt'?0:3);assert.equal(session.entries.length,action==='beginAttempt'?1:4);assert.equal(effects(),initial);console.log('PASS recovery '+action);await stop();
 }
 // Crash before first attempt can resume; pending begin is never a reusable call grant.
 for(const phase of ['before_attempt','after_attempt','known_result']){
  const {j,session,initial}=await start();let blocked=false;
  hook=async({phase:p,body,res})=>{const action=phase==='before_attempt'?'claim':phase==='after_attempt'?'beginAttempt':'recordResult';
   if(p==='after'&&body?.action===action&&!blocked){blocked=true;res.destroy();await pause(500);return false;}};
  const w=launch('crash');await until(()=>blocked);const owned=phase==='before_attempt'?null:capture(w,j);w.p.kill('SIGKILL');await w.done;hook=async()=>{};
  if(owned)assert.throws(()=>profileLock(profile(j)),/still open/,'A crash orphan must block profile reuse before test cleanup');
  const resumed=launch('crash');await resumed.done;
  assert.equal(status(),phase==='before_attempt'?'ready':'review_needed');
  assert.equal(calls([resumed]).length,phase==='before_attempt'?3:phase==='after_attempt'?0:1);
  assert.equal(session.entries.length,phase==='before_attempt'?4:phase==='after_attempt'?1:2);assert.equal(effects(),initial);await stop();
 }
 // Unexpected/final cart changes are detected by the complete final server observation.
 for(const change of ['unexpected','baseline_changed','requested_present','duplicate']){
  const entries=[{sku:'EXISTING',unitLabel:'box',packs:'1',unitMinor:'350'}];
  if(change==='requested_present')entries.push({sku:catalog[0].sku,unitLabel:catalog[0].unitLabel,packs:'1',unitMinor:catalog[0].unitMinor});
  if(change==='duplicate')entries.push({...entries[0]});
  const {session}=await start({entries});
  hook=async({phase,body})=>{if(phase==='after'&&body?.action==='recordResult'){
   if(change==='unexpected'&&!session.entries.some(e=>e.sku==='UNEXPECTED'))session.entries.push({...entries[0],sku:'UNEXPECTED'});
   if(change==='baseline_changed')session.entries[0].packs='2';store.save();
  }};
  const w=launch(change);await w.done;assert.equal(status(),'review_needed');assert.ok(calls([w]).length<=1);await stop();
 }
 // A cancellation or source/credential/lease loss after begin prevents the browser call and all later commits.
 for(const change of ['cancel','source','revoke','lease']){
  const {j,session}=await start();let changed=false,w;
  hook=async({phase,body})=>{if(phase==='after'&&body?.action==='beginAttempt'&&!changed){changed=true;
   if(change==='cancel'){const current=await f.jobs().get({companyId:'a',jobId:j.id});await f.jobs().cancel(cancel(current.job));}
   if(change==='source')connectionVersion(f.sql,{paused:true});
   if(change==='revoke')f.revoke(readPrivate(w.credentialFile));
   if(change==='lease')f.sql.prepare("UPDATE po_cart_owners SET lease_until='2020' WHERE job_id=?").run(j.id);
  }};
  w=launch(change);await w.done;assert.equal(changed,true);assert.equal(calls([w]).length,0);assert.equal(session.entries.length,1);assert.notEqual(status(),'ready');
  assert.equal(f.sql.prepare('SELECT state FROM po_cart_reservations').get().state,'reserved');await stop();
 }
 // Reclaiming an expired application lease never overrides a live account-profile owner.
 {
  const {j,session}=await start(),c=f.credential({consumerKind:'local_browser'});
  assert.equal((await f.request(c,{action:'claim',jobId:j.id,operationId:randomUUID()})).status,200);
  f.sql.prepare("UPDATE po_cart_owners SET lease_until='2020' WHERE job_id=?").run(j.id);
  const key=createHash('sha256').update(JSON.stringify([fixtureOrigin,j.companyId,j.supplierId,j.accountId])).digest('hex');
  const release=profileLock(resolve('.sites-runtime/po-cart-workers/browser-profiles',key));
  try{const w=launch('profile-busy');await w.done;assert.equal(status(),'review_needed');assert.equal(calls([w]).length,0);assert.equal(session.entries.length,1);}
  finally{release();}console.log('PASS active profile survives expired application lease');await stop();
 }
 // Final cart changes after every line result still prevent readiness.
 for(const change of ['unexpected','baseline_changed']){
  const {session}=await start();let changed=false;
  hook=async({phase,body})=>{if(phase==='after'&&body?.action==='recordResult'&&f.sql.prepare('SELECT count(*) n FROM po_cart_results').get().n===3){changed=true;
   if(change==='unexpected')session.entries.push({sku:'UNEXPECTED',unitLabel:'box',packs:'1',unitMinor:'1'});else session.entries[0].packs='2';store.save();
  }};
  const w=launch('final-'+change);await w.done;assert.equal(changed,true);assert.equal(calls([w]).length,3);assert.equal(status(),'review_needed');
  assert.equal(f.sql.prepare("SELECT verified FROM po_cart_browser_evidence WHERE kind='final'").get().verified,0);console.log('PASS final observation '+change);await stop();
 }
 // Cancellation after an issued addition cannot undo it; it prevents the commit and every later addition.
 {
  const {j,session}=await start();let canceled=false;
  hook=async({phase,body})=>{if(phase==='before'&&body?.action==='recordResult'&&!canceled){canceled=true;const current=await f.jobs().get({companyId:j.companyId,jobId:j.id});await f.jobs().cancel(cancel(current.job));}};
  const w=launch('cancel-issued');await w.done;assert.equal(canceled,true);assert.equal(calls([w]).length,1);assert.equal(session.entries.length,2);assert.equal(status(),'canceled');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_results').get().n,0);assert.equal(f.sql.prepare('SELECT state FROM po_cart_reservations').get().state,'reserved');console.log('PASS cancellation retains issued addition/exposure');await stop();
 }
 // A process killed after the fixture writes but before its response is known never repeats the addition.
 {
  const {j,session,initial}=await start();
  fixture.prependListener('request',(req,res)=>{if(req.method==='POST'&&req.url==='/add'){const end=res.end;res.end=function(...args){const timer=setTimeout(()=>end.apply(this,args),30000);timer.unref();return this;};}});
  const w=launch('unknown-after-add');await until(()=>session.entries.length===2);capture(w,j);w.p.kill('SIGKILL');await w.done;
  assert.throws(()=>profileLock(profile(j)),/still open/,'Issued-addition orphan must block profile reuse');
  assert.equal(readPrivate(w.journalFile).attempt.outcome,null);
  const resumed=launch('unknown-after-add');await resumed.done;assert.equal(calls([resumed]).length,1);assert.equal(session.entries.length,2);assert.equal(status(),'review_needed');
  assert.equal(f.sql.prepare('SELECT outcome FROM po_cart_results').get().outcome,'uncertain');assert.equal(effects(),initial);console.log('PASS crash after issued addition retains uncertainty');await stop();
 }
}finally{if(server?.listening)await stop();if(fixture?.listening){fixture.closeAllConnections();await new Promise(ok=>fixture.close(ok));}}
console.log('PASS: separate real-browser workers, both layouts/all scenarios, one addition per line, durable HTTP replay, crashes, cart changes and stopped authorization.');
