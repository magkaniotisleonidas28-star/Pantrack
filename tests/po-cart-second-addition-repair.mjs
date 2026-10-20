import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {offlineFetch,inspectDiagnostics,safeResult} from '../scripts/po-cart-worker/second-addition-investigation.mjs';
import {cleanupTaskBrowser,finishCase} from '../scripts/po-cart-worker/second-addition-cleanup.mjs';
import {localFixtureCookie} from '../scripts/po-cart-worker/local-browser-fixture.mjs';

const root=mkdtempSync(join(tmpdir(),'pantrack-runner-repair-'));
await build({stdin:{contents:"export * from './scripts/cart-preview/browser-session';export * from './scripts/po-cart-worker/browser-diagnostics';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/second-addition-repair-tests.mjs',logLevel:'silent'});
const {openLocalCartBrowser,closeLocalCartBrowser,browserProxy,browserDiagnostics}=await import('../.sites-runtime/second-addition-repair-tests.mjs');
try{
 let transports=0,lastOptions;
 const guarded=offlineFetch(async(input,options)=>{transports++;lastOptions=options;return new Response();});
 for(const url of ['https://127.0.0.1:9876/json/version','http://localhost:9876','http://[::1]:9876','http://127.0.0.2:9876','https://api.openai.com/v1/responses','http://user:pass@127.0.0.1:9876'])assert.throws(()=>guarded(url));
 assert.equal(transports,0);
 for(const input of ['http://127.0.0.1:49152/json/version',new Request('http://127.0.0.1:49153/json/version',{redirect:'follow'})]){
  await guarded(input,{redirect:'follow'});assert.equal(lastOptions.redirect,'error');
 }
 let redirectedHits=0;
 const server=createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'/provider'});res.end();}
  else if(req.url==='/signin-with-chatgpt?return_to=/'){res.writeHead(302,{location:'https://provider.invalid','set-cookie':'fixture=private; HttpOnly'});res.end();}
  else{redirectedHits++;res.end('local debugging');}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const transport=offlineFetch(fetch);const r=await transport(origin+'/json/version');assert.equal(await r.text(),'local debugging');
  const before=redirectedHits;await assert.rejects(()=>transport(new Request(origin+'/redirect',{redirect:'follow'}),{redirect:'follow'}));assert.equal(redirectedHits,before);
  assert.equal(await localFixtureCookie(origin),'fixture=private');assert.equal(redirectedHits,before);
  assert.throws(()=>localFixtureCookie('https://provider.invalid'));
 }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 // Model the SDK's import-time fetch capture in a separate process. The runner's
 // first dependency must install the guard before any SDK-bearing import.
 const boundary=pathToFileURL(resolve('scripts/po-cart-worker/offline-boundary.mjs')).href;
 writeFileSync(join(root,'capture.mjs'),'export const captured=globalThis.fetch;');
 writeFileSync(join(root,'import-order.mjs'),`import ${JSON.stringify(boundary)};import {captured} from './capture.mjs';let blocked=false;try{captured('https://api.openai.com/v1/responses');}catch{blocked=true;}if(!blocked||process.env.OPENAI_API_KEY!=='fictional-test-only')process.exitCode=1;`);
 assert.equal(spawnSync(process.execPath,[join(root,'import-order.mjs')],{encoding:'utf8'}).status,0);
 assert.match(readFileSync('scripts/po-cart-second-addition-check.mjs','utf8'),/^import \{originalFetch\} from '.\/po-cart-worker\/offline-boundary.mjs';/);

 async function fixture({failure,slow=false,closeFailure=false,driverFailure=false,proxyFailure=false,mode='passive'}={}){
  const events=[],snapshots=[],order=[];let proxy,browserClosed=false,driverClosed=false;
  const stream=browserDiagnostics(mode==='off'?undefined:join(root,'diag-'+Math.random()+'.jsonl'));
  const emit=(event,fields)=>{events.push(event);stream.emit(event,fields);};
  const browser={close:async()=>{order.push('browser_start');if(slow)await new Promise(ok=>setTimeout(ok,30));if(closeFailure)throw Error('private close error');browserClosed=true;order.push('browser_end');}};
  const page={setDefaultTimeout(){},on(){}};
  const context={route:async()=>{if(failure==='route')throw Error('original route failure');},pages:()=>[page]};
  const driver={contexts:()=>[context],on(){},close:async()=>{if(driverFailure)throw Error('private driver failure');driverClosed=true;order.push('driver_end');}};
  const hooks={closeTimeoutMs:slow?5:100,onEvidence:e=>snapshots.push(e),
   createProxy:async(...args)=>{proxy=await browserProxy(...args);
    if(proxyFailure){const close=proxy.server.close.bind(proxy.server);proxy.server.close=cb=>close(()=>cb(Error('private proxy failure')));}
    args[3]('http://example.invalid/background','GET');args[3](origin+'/checkout','POST');return proxy;},
   launch:async()=>{if(failure==='launch')throw Error('original launch failure');return browser;},
   connect:async()=>{if(failure==='connect')throw Error('original connection failure');return driver;}};
  let session;
  try{session=await openLocalCartBrowser(origin,join(root,'profile-'+Math.random()),true,'automation',()=>true,emit,hooks);
   assert.equal(session.network.pageIntercepted,true);await closeLocalCartBrowser(session);
  }catch(e){assert.match(e.message,new RegExp('original '+(failure==='route'?'route':failure==='connect'?'connection':'launch')+' failure'));}
  stream.close();const last=snapshots.at(-1);
  assert.equal(last.blockedBackgroundRequests,1);assert.equal(last.checkoutSubmissions,1,'Pre-connection counters survive failure');
  assert.equal(last.proxyClosed,!proxyFailure);assert.equal(proxy.server.address(),null,'Proxy closure awaited');
  if(failure==='launch'){assert.equal(last.pageIntercepted,false);assert.equal(last.browserClosed,false);assert.ok(!events.includes('closed'));}
  else{assert.equal(last.browserAcquired,true);if(failure!=='connect'){assert.equal(last.driverAcquired,true);assert.equal(driverClosed,!driverFailure);}}
  if(slow||closeFailure||driverFailure||proxyFailure){assert.equal(last.cleanupErrors,1);assert.equal(last.browserClosed,!slow&&!closeFailure);assert.ok(!events.includes('closed'));}
  else if(failure!=='launch'){assert.equal(browserClosed,true);assert.equal(last.browserClosed,true);assert.equal(events.at(-1),'closed');assert.ok(order.indexOf('browser_end')<order.indexOf('driver_end')||failure==='connect');}
  if(slow){await new Promise(ok=>setTimeout(ok,35));assert.equal(browserClosed,true);assert.equal(snapshots.at(-1).cleanupErrors,1,'Late SDK cleanup cannot erase a timeout');}
  return last;
 }
 for(const failure of ['launch','connect','route'])await fixture({failure});
 await fixture();await fixture({slow:true});await fixture({failure:'route',closeFailure:true});await fixture({driverFailure:true});await fixture({proxyFailure:true});await fixture({mode:'off'});

 const path=resolve(root,'task-profile'),owned={pid:101,parent:202,identity:'fixed',command:'Chrome --user-data-dir='+path},unrelated={pid:303,parent:404,identity:'other',command:'Chrome --user-data-dir='+path+'-other'};
 function controls({forced=false,changed=false,never=false}={}){
  let time=0,list=[{...owned},{...unrelated}],killAt,termAt;const log=[];
  return {log,io:{snapshot:()=>{log.push(['inspect',time]);return list;},now:()=>time,
   pause:async()=>{time+=1000;if(changed&&termAt!==undefined)list[0]={...owned,identity:'reused'};
    if(!never&&((!forced&&termAt!==undefined&&time>=termAt+1000)||(killAt!==undefined&&time>=killAt+2000)))list=list.filter(p=>p.pid!==owned.pid);},
   signal:(pid,kind)=>{assert.equal(pid,owned.pid);log.push([kind,time]);if(kind==='SIGTERM')termAt=time;else killAt=time;}
  }};
 }
 for(const forced of [false,true]){
  const {io,log}=controls({forced});const r=await cleanupTaskBrowser(path,{workerPid:202,io,canonical:p=>p});
  assert.equal(r.verified,true);assert.equal(r.forced,forced);assert.equal(log.filter(x=>x[0]==='SIGKILL').length,forced?1:0);
  if(forced)assert.equal(log.find(x=>x[0]==='SIGKILL')[1],5000);
  assert.equal(log.at(-1)[0],'inspect','Verification follows final termination');assert.ok(io.snapshot().some(p=>p.pid===303),'Unrelated process survives');
 }
 for(const setup of [io=>({...io,snapshot:()=>[{...owned,parent:999}]}),io=>({...io,snapshot:()=>[{...owned,command:owned.command+' --type=renderer'}]})]){
  const {io,log}=controls();await assert.rejects(()=>cleanupTaskBrowser(path,{workerPid:202,io:setup(io),canonical:p=>p}));assert.ok(!log.some(x=>x[0].startsWith('SIG')));
 }
 {const {io,log}=controls({forced:true,changed:true});await assert.rejects(()=>cleanupTaskBrowser(path,{workerPid:202,io,canonical:p=>p}));assert.equal(log.filter(x=>x[0]==='SIGKILL').length,0);}
 {const {io}=controls({forced:true,never:true});await assert.rejects(()=>cleanupTaskBrowser(path,{workerPid:202,io,canonical:p=>p}),/exit unverified/);}
 {const {io,log}=controls();await assert.rejects(()=>cleanupTaskBrowser(path,{workerPid:202,io,canonical:p=>p+'-symlink'}));assert.equal(log.length,0);}
 {const {io}=controls();let calls=0;await assert.rejects(()=>cleanupTaskBrowser(path,{workerPid:202,io:{...io,pause:async()=>{await io.pause();}},canonical:p=>++calls>1?p+'-replaced':p}));}
 const actions=[];
 const cleanup=await finishCase({closeBrowser:async()=>{actions.push('browser');throw Error('private failure');},closeWorker:async()=>{actions.push('worker');throw Error('private failure');},revoke:async()=>{actions.push('revoke');return true;}});
 assert.deepEqual(actions,['browser','worker','revoke']);assert.equal(cleanup.credentialsRevoked,true);assert.equal(cleanup.cleanupVerified,false);
 const failure=safeResult({error:'worker_failed',stage:'launch',...cleanup,externalRequests:0,networkCoverageComplete:false});
 assert.equal(failure.error,'worker_failed');assert.equal(failure.stage,'launch');assert.equal(failure.externalRequests,0);assert.equal(failure.networkCoverageComplete,false);assert.equal(failure.cleanupError,true);
 const file=join(root,'close-failure.jsonl'),stream=browserDiagnostics(file,{write(){},close(){throw Error('private');}});stream.close();assert.equal(stream.healthy(),false);assert.equal(inspectDiagnostics(file,'passive',stream.healthy()).healthy,false);
 console.log('PASS: ephemeral loopback transport, redirect/import boundary, partial launch/CDP/late teardown, process identity and escalation, exit verification, independent revocation and truthful private evidence; no browser jobs.');
}finally{rmSync(root,{recursive:true,force:true});}
