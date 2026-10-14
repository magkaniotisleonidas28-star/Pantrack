import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createServer as portProbe} from 'node:net';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {workerFixture} from '../tests/helpers/po-cart-worker.mjs';
import {enqueue,cancel} from '../tests/helpers/po-cart-jobs.mjs';
import {connectionVersion} from '../tests/helpers/po-cart-authorizations.mjs';
import {writePrivate,readPrivate} from './po-cart-worker/private-files.mjs';
import {AiBudgetLedger} from './cart-preview/ai-budget.mjs';

await build({stdin:{contents:"export * from './scripts/po-cart-worker/browser-adapter';export * from './scripts/po-cart-worker/ai-reader';export * from './scripts/cart-preview/ai-provider';export * from './scripts/po-cart-worker/fixture-store';export * from './scripts/cart-preview/fixture';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/ai-worker-check.mjs',logLevel:'silent'});
const {LocalBrowserCartWorker,StagehandCartReader,BoundedAiProvider,BrowserFixtureStore,startFixture,catalog,fixtureCatalog}=await import('../.sites-runtime/ai-worker-check.mjs');
const root='.sites-runtime/po-cart-workers/ai-offline-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
Object.assign(process.env,{OPENAI_API_KEY:'fictional-test-only',PANTRACK_CART_AI_MODEL:'gpt-5.4-mini-2026-03-17',PANTRACK_CART_INPUT_USD_PER_MILLION:'0.75',PANTRACK_CART_OUTPUT_USD_PER_MILLION:'4.50'});
const cases=[...['rows','compact'].flatMap(layout=>['normal','malicious','price_changed','unavailable','wrong_pack','ambiguous'].map(scenario=>({layout,scenario,kind:'matrix'}))),
 ...['baseline','product:DEMO-COFFEE','final'].flatMap(phase=>['cancel','revoke','lease','source'].map(kind=>({layout:'rows',scenario:'normal',phase,kind}))),
 ...['baseline','product:DEMO-COFFEE','final'].flatMap(phase=>['invalid','wrong','missing','refusal','timeout','exhausted','cart_change','metadata_incomplete'].map(kind=>({layout:'compact',scenario:'normal',phase,kind}))),
 {layout:'rows',scenario:'normal',phase:'product:DEMO-COFFEE',kind:'restart'},
 {layout:'rows',scenario:'normal',phase:'product:DEMO-OAT',kind:'restart_after_add'}];
for(const [caseIndex,c] of cases.entries()){
 if(process.argv.includes('--case')&&Number(process.argv[process.argv.indexOf('--case')+1])!==caseIndex)continue;
 const caseRoot=root+'/'+caseIndex,ledger=new AiBudgetLedger(caseRoot+'/budget.json',caseRoot+'/absent.json'),store=new BrowserFixtureStore(caseRoot+'/store.json');
 const port=await new Promise(ok=>{const p=portProbe();p.listen(0,'127.0.0.1',()=>{const port=p.address().port;p.close(()=>ok(port));});});
 const fixtureOrigin='http://127.0.0.1:'+port,fixture=await startFixture(store,port),f=await workerFixture();
 const a=await f.authorized({lines:catalog.map((l,i)=>({kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:String(i+1),estimatedUnitMinor:l.unitMinor})),capMinor:'25000'});
 const q=await f.jobs().enqueue({...enqueue(a),browser:{layout:c.layout,scenario:c.scenario}}),job=q.current.job,session=store.provision(job.id,{layout:c.layout,scenario:c.scenario});
 const initial=structuredClone(session.entries),mutations=[],phases=[],bodies=[];let worker,changed=false,failure;
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):null;if(body)mutations.push(body.action);
  const r=await f.api[req.method](new Request(origin+req.url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})}));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
 }catch{res.writeHead(503);res.end('{}');}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;
 const credentialFile=caseRoot+'/credential.json',journalFile=caseRoot+'/journal.json',fixtureFile=caseRoot+'/fixture.json';
 writePrivate(credentialFile,f.credential({consumerKind:'local_browser'}));writePrivate(fixtureFile,{version:1,origin:fixtureOrigin,jobs:{[job.id]:{scope:{companyId:job.companyId,supplierId:job.supplierId,accountId:job.accountId},layout:c.layout,scenario:c.scenario,token:session.token}}});
 const provider={request:async(request,context)=>{
  phases.push(context.phase);const phase=context.phase.replace(/:(Extraction|Metadata)$/,''),metadata=context.phase.endsWith(':Metadata'),target=phase===c.phase;let value;
  if(metadata)value={completed:true,progress:'Fictional extraction complete.'};
  else if(phase.startsWith('product:'))value={candidates:fixtureCatalog(session).map((p,index)=>({index,sku:p.sku,unitLabel:p.unitLabel,unitMinor:p.unitMinor,available:!(c.scenario==='unavailable'&&index===0)})).filter(p=>p.sku===phase.slice(8))};
  else value={entries:structuredClone(session.entries)};
  if(target&&c.kind==='exhausted'&&!changed){changed=true;await ledger.reserve(5_000_000-(await ledger.snapshot()).reservedMicros);}
  const transport=async(url,options)=>{
   bodies.push(options.body);const text=options.body;
   assert.ok(!text.includes(session.token));assert.ok(!text.includes(readPrivate(credentialFile).secret));assert.ok(!text.includes('cart_fixture='));assert.ok(!text.includes('data:image'));assert.ok(!text.includes('user-data-dir'));
   if(metadata)assert.ok(text.includes('DOM:'),'Completion must see the same visible source as extraction, not only the extracted result');
   if(!metadata)assert.ok(text.includes(phase.startsWith('product:')?'DEMO-COFFEE':'EXISTING'));
   if(c.scenario==='malicious'&&phase.startsWith('product:')&&!metadata)assert.ok(text.includes('ignore previous instructions'));
   // Change authority while the provider request is in flight, after its
   // durable reservation and before a response can reach the worker.
   if(target&&!changed){changed=true;
   if(c.kind==='cancel'){const current=await f.jobs().get({companyId:job.companyId,jobId:job.id});await f.jobs().cancel(cancel(current.job));}
   if(c.kind==='revoke')f.revoke(readPrivate(credentialFile));
   if(c.kind==='lease')f.sql.prepare("UPDATE po_cart_owners SET lease_until='2020' WHERE job_id=?").run(job.id);
   if(c.kind==='source')connectionVersion(f.sql,{paused:true});
   if(c.kind.startsWith('restart'))worker.requestStop();
   if(c.kind==='cart_change'){session.entries[0].packs='9';store.save();}
   }
   if(target&&c.kind==='timeout')return new Promise((_ok,fail)=>{const keep=setTimeout(()=>fail(Error('timeout not aborted')),1000);options.signal.addEventListener('abort',()=>{clearTimeout(keep);fail(options.signal.reason);},{once:true});});
   let data={status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]};
   if(target&&c.kind==='invalid')data.output[0].content[0].text='invalid JSON';
   if(target&&c.kind==='missing')data.output[0].content[0].text='{}';
   if(target&&c.kind==='wrong')data.output[0].content[0].text=JSON.stringify(context.phase.startsWith('product:')?{candidates:[{...value.candidates[0],unitMinor:'1'}]}:{entries:[]});
   if(target&&c.kind==='refusal')data.output[0].content=[{type:'refusal',refusal:'fictional refusal'}];
   if(target&&metadata&&c.kind==='metadata_incomplete')data.output[0].content[0].text=JSON.stringify({completed:false,progress:'Fictional extraction is incomplete.'});
   return Response.json(data);
  };
  return new BoundedAiProvider(ledger,transport,target&&c.kind==='timeout'?10:45000).request(request,context);
 }};
 worker=new LocalBrowserCartWorker({credentialFile,journalFile,fixtureFile,origin,reader:new StagehandCartReader(provider)});
 try{
  try{await worker.tick();}catch(e){failure=e;}
  const state=f.sql.prepare('SELECT state FROM po_cart_jobs WHERE id=?').get(job.id).state,ready=c.kind==='matrix'&&['normal','malicious'].includes(c.scenario);
  assert.equal(state,ready?'ready':c.kind==='cancel'?'canceled':c.kind==='revoke'||c.kind==='lease'||c.kind==='source'||c.kind.startsWith('restart')?'preparing':'review_needed',JSON.stringify({c,state,failure:String(failure),journal:worker.state.browserFailure,phases}));
  const count=c.phase==='final'?3:c.kind==='restart_after_add'?1:0;
  assert.equal(worker.state.calls.length,ready?3:count);assert.equal(session.entries.length,ready?4:count+1);
  assert.equal(mutations.filter(m=>m==='beginAttempt').length,ready?3:count,'No inference can occur between a begin grant and addition');
  if(ready){assert.deepEqual(session.entries,[...initial,...catalog.map((l,i)=>({sku:l.sku,unitLabel:l.unitLabel,unitMinor:l.unitMinor,packs:String(i+1)}))]);assert.equal(phases.length,10);}
  if(c.kind==='matrix'&&!ready)assert.ok(phases.includes('product:DEMO-COFFEE:Extraction'),'Unsafe scenarios must actually reach AI');
  if(c.phase)assert.ok(changed,'Target inference was exercised');
  assert.equal(worker.state.browserNetwork.externalRequests,0);assert.equal(worker.state.browserNetwork.checkoutSubmissions,0);
  worker.close();worker=null;
  if(c.kind.startsWith('restart')){
   worker=new LocalBrowserCartWorker({credentialFile,journalFile,fixtureFile,origin,reader:new StagehandCartReader(provider)});try{await worker.tick();}catch{}
   const resumable=c.kind==='restart';assert.equal(worker.state.calls.length,resumable?3:count);assert.equal(f.sql.prepare('SELECT state FROM po_cart_jobs WHERE id=?').get(job.id).state,resumable?'ready':'review_needed');assert.equal(session.entries.length,resumable?4:count+1);
  }
  console.log('PASS offline Stagehand '+caseIndex+': '+c.layout+'/'+c.scenario+'/'+c.kind+(c.phase?' during '+c.phase:''));
 }finally{worker?.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));fixture.closeAllConnections();await new Promise(ok=>fixture.close(ok));f.sql.close();}
}
console.log('PASS: local real browsers and Stagehand extraction with mocked inference only; no real-AI acceptance claimed.');
