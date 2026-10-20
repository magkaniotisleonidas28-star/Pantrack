import {assertGateSource} from './po-cart-worker/full-gate-runtime.mjs';
import {finishOfflineFixture} from './po-cart-worker/offline-case-cleanup.mjs';
import './po-cart-worker/offline-boundary.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createServer as portProbe} from 'node:net';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {workerFixture} from '../tests/helpers/po-cart-worker.mjs';
import {enqueue} from '../tests/helpers/po-cart-jobs.mjs';
import {tables} from '../tests/helpers/po-cart-authorizations.mjs';
import {readPrivate,writePrivate} from './po-cart-worker/private-files.mjs';

await build({stdin:{contents:"export * from './scripts/po-cart-worker/browser-adapter';export * from './scripts/po-cart-worker/fixture-store';export * from './scripts/cart-preview/fixture';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/browser-failure-check.mjs',logLevel:'silent'});
const {LocalBrowserCartWorker,BrowserFixtureStore,startFixture,catalog}=await import('../.sites-runtime/browser-failure-check.mjs');
const root='.sites-runtime/po-cart-workers/faults-'+randomUUID();
const diagnosticMode=process.argv.includes('--diagnostic-mode')?process.argv[process.argv.indexOf('--diagnostic-mode')+1]:'form';
if(!['off','passive','form'].includes(diagnosticMode))throw Error('Unknown diagnostic mode.');
for(const kind of ['missing_request','interrupted_response','disconnected','authority_lost']){
 const dir=root+'/'+kind,f=await workerFixture(),store=new BrowserFixtureStore(dir+'/store.json');
 const port=await new Promise(ok=>{const p=portProbe();p.listen(0,'127.0.0.1',()=>{const port=p.address().port;p.close(()=>ok(port));});});
 const storefront='http://127.0.0.1:'+port,fixture=await startFixture(store,port),scenario=kind==='interrupted_response'?'lost_response':'normal';
 const a=await f.authorized({lines:catalog.map((l,i)=>({kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:String(i+1),estimatedUnitMinor:l.unitMinor})),capMinor:'25000'});
 const q=await f.jobs().enqueue({...enqueue(a),browser:{layout:'compact',scenario}}),j=q.current.job,session=store.provision(j.id,{layout:'compact',scenario});
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
  const r=await f.api[req.method](new Request(origin+req.url,{method:req.method,headers:req.headers,...(body?{body}:{})}));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
 }catch{res.destroy();}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;
 const credentialFile=dir+'/credential.json',journalFile=dir+'/journal.json',fixtureFile=dir+'/sessions.json';
 let worker,injected=false,failureProbes=0;
 try{
 writePrivate(credentialFile,f.credential({consumerKind:'local_browser'}));writePrivate(fixtureFile,{version:1,origin:storefront,jobs:{[j.id]:{scope:{companyId:j.companyId,supplierId:j.supplierId,accountId:j.accountId},layout:'compact',scenario,token:session.token}}});
 const effects=()=>tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','po_cart_commitments','po_cart_reservations']),before=effects();
  worker=new LocalBrowserCartWorker({credentialFile,journalFile,fixtureFile,origin,diagnosticMode,diagnosticFile:dir+'/diagnostics.jsonl',fetchImpl:async(url,options)=>{
   const r=await fetch(url,options);
   if(options.body&&JSON.parse(options.body).action==='beginAttempt'&&!injected){injected=true;
    const page=worker.activeSession.page,evaluate=page.evaluate.bind(page);
    page.evaluate=(fn,...args)=>{if(String(fn).includes('__cartFormEvents'))failureProbes++;return evaluate(fn,...args);};
    if(kind==='missing_request')await worker.activeSession.page.locator('[data-product="0"] button').evaluate(b=>b.addEventListener('click',e=>e.preventDefault()));
    if(kind==='disconnected')await worker.activeSession.browser.close();
    if(kind==='authority_lost')f.revoke(readPrivate(credentialFile));
   }return r;
  }});
  await assert.rejects(worker.tick());assert.equal(injected,true);
  const calls=worker.state.calls.length,entries=session.entries.length;
  assert.equal(calls,kind==='authority_lost'?0:1);assert.equal(entries,kind==='interrupted_response'?2:1);assert.equal(effects(),before);
  assert.notEqual(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'ready');
  const path=dir+'/diagnostics.jsonl',events=diagnosticMode==='off'?[]:readFileSync(path,'utf8').trim().split('\n').map(s=>JSON.parse(s));
  if(diagnosticMode==='off')assert.equal(existsSync(path),false);
  if(diagnosticMode!=='form'){assert.equal(failureProbes,0,'Off/passive failure handling must not evaluate diagnostic DOM');assert.equal(events.some(e=>['form_ready','form_events'].includes(e.event)),false);}
  if(diagnosticMode!=='off'){
   if(kind==='missing_request'){assert.equal(events.some(e=>e.event==='add_request'),false);if(diagnosticMode==='form')assert.ok(events.some(e=>e.event==='form_events'&&e.clicked===true&&e.submitted===false));}
   if(kind==='interrupted_response')assert.ok(events.some(e=>e.event==='proxy_aborted'||e.event==='proxy_error'));
   if(kind==='disconnected')assert.ok(events.some(e=>e.event==='disconnected'));
   if(kind==='authority_lost')assert.ok(events.some(e=>e.event==='ownership_lost'&&e.status===401));
  }
  assert.equal(worker.state.browserNetwork.externalRequests,0);assert.equal(worker.state.browserNetwork.checkoutSubmissions,0);
  worker.close();worker=new LocalBrowserCartWorker({credentialFile,journalFile,fixtureFile,origin});try{(assertGateSource(),await worker.tick());}catch{}
  assert.equal(worker.state.calls.length,calls);assert.equal(session.entries.length,entries);assert.equal(effects(),before);
  assert.notEqual(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'ready');
  console.log('PASS injected '+kind+' ('+diagnosticMode+'): held, no duplicate addition or incorrect readiness after restart');
 }finally{const cleanup=await finishOfflineFixture({f,dir:dir,origin,worker});server.closeAllConnections();await new Promise(ok=>server.close(ok));fixture.closeAllConnections();await new Promise(ok=>fixture.close(ok));f.sql.close();assert.equal(cleanup.cleanupVerified,true);}
}
console.log('Private fault evidence: '+root);
