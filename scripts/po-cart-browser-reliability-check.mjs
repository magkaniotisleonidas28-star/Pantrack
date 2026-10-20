import {assertGateSource} from './po-cart-worker/full-gate-runtime.mjs';
import './po-cart-worker/offline-boundary.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
import {readPrivate,writePrivate} from './po-cart-worker/private-files.mjs';
import {AiBudgetLedger} from './cart-preview/ai-budget.mjs';
import {mockedReader} from './po-cart-worker/mock-ai-reader.mjs';
import {runTargetedReliability} from './po-cart-worker/targeted-reliability-run.mjs';
import {sourceSnapshot} from './po-cart-worker/acceptance-gate.mjs';
import {verifyAdditionAttempts} from './po-cart-worker/second-addition-case.mjs';

await build({stdin:{contents:"export * from './scripts/po-cart-worker/browser-adapter';export * from './scripts/po-cart-worker/ai-reader';export * from './scripts/cart-preview/ai-provider';export * from './scripts/cart-preview/fixture';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/browser-reliability.mjs',logLevel:'silent'});
const api=await import('../.sites-runtime/browser-reliability.mjs');
Object.assign(process.env,{OPENAI_API_KEY:'fictional-test-only',PANTRACK_CART_AI_MODEL:'gpt-5.4-mini-2026-03-17',PANTRACK_CART_INPUT_USD_PER_MILLION:'0.75',PANTRACK_CART_OUTPUT_USD_PER_MILLION:'4.50'});
if(process.argv.includes('--targeted')){
 if(process.argv.includes('--acceptance'))throw Error('Targeted investigation and post-fix acceptance are separate runs.');
 await runTargetedReliability(api);
}else{
const acceptance=process.argv.includes('--acceptance'),root='.sites-runtime/po-cart-workers/reliability-'+randomUUID(),results=[],source=sourceSnapshot();
console.log('Private reliability evidence: '+root+'/report.json');
// Diagnosis is bounded to exactly 60 fresh jobs, balanced over each combination.
// Acceptance is a separate consecutive 30-job gate, five/layout/mock delay.
for(let repeat=0;repeat<5;repeat++)for(const delay of [0,750,1500])for(const mode of acceptance?['stagehand']:['deterministic','stagehand'])for(const layout of ['rows','compact']){
 const start=Date.now(),caseRoot=root+'/'+results.length;let f,worker;
 const result={layout,mode,delay,passed:false,elapsedMs:0};
 try{
  f=await seedLocalBrowserJob({layout,scenario:'normal',root:caseRoot});
  const initial=structuredClone(f.readSession().entries),ledger=new AiBudgetLedger(caseRoot+'/mock-budget.json',caseRoot+'/absent.json');
  worker=new api.LocalBrowserCartWorker({credentialFile:f.credentialFiles[0],journalFile:caseRoot+'/journal.json',fixtureFile:f.fixtureFile,origin:f.origin,
   diagnosticFile:acceptance?undefined:caseRoot+'/diagnostics.jsonl',reader:mode==='stagehand'?mockedReader(api,f,ledger,delay):undefined,
   // Deterministic workers have no model requests: delay their application reads.
   fetchImpl:mode==='deterministic'?async(url,options)=>{const r=await fetch(url,options);if(options.method==='GET'&&delay)await new Promise(ok=>setTimeout(ok,delay));return r;}:fetch});
  try{(assertGateSource(),await worker.tick());}catch{}
  const current=await f.request(`/api/po-cart-jobs?companyId=${f.companyId}&jobId=${f.jobId}`),session=f.readSession();
  const expected=[...initial,...api.catalog.map((l,i)=>({sku:l.sku,unitLabel:l.unitLabel,packs:String(i+1),unitMinor:l.unitMinor}))];
  result.state=current.job.state;result.additions=worker.state.calls.length;result.network=worker.state.browserNetwork;
  result.attemptsVerified=verifyAdditionAttempts(current);result.networkCoverageComplete=result.network?.pageIntercepted===true;
  result.cleanupVerified=!!result.network&&result.network.proxyClosed&&result.network.driverClosed&&result.network.browserClosed&&result.network.cleanupErrors===0;
  result.exact=JSON.stringify(session.entries)===JSON.stringify(expected);
  result.inventoryUnchanged=JSON.stringify(await f.request('/api/inventory?companyId='+f.companyId))===JSON.stringify(f.inventory);
  result.reservationUnchanged=JSON.stringify(current.authorization.reservation)===JSON.stringify(f.reservation);
  result.requests=mode==='stagehand'?(await ledger.snapshot()).reservations.filter(r=>r.status==='completed').length:0;
  result.completedRequests=result.requests;
  assert.equal(result.state,'ready');assert.equal(result.additions,3);assert.ok(result.exact&&result.inventoryUnchanged&&result.reservationUnchanged);
  assert.equal(result.network.externalRequests,0);assert.equal(result.network.checkoutSubmissions,0);assert.equal(result.requests,mode==='stagehand'?10:0);
  assert.ok(result.attemptsVerified&&result.networkCoverageComplete&&result.cleanupVerified);result.passed=true;
 }catch{result.passed=false;}
 finally{
  worker?.close();result.credentialsRevoked=!!f;if(f)for(const file of f.credentialFiles){
   await fixtureCredential({execute:f.execute,file,companyId:f.companyId,action:'revoke'});
   assert.equal((await fetch(f.origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+readPrivate(file).secret}})).status,401);
  }
  result.elapsedMs=Date.now()-start;results.push(result);writePrivate(root+'/report.json',{evidence:'offline-served-browser-reliability',source,acceptance,results});
 }
 console.log(`${result.passed?'PASS':'FAIL'} ${results.length} ${layout}/${mode}/${delay}ms`);
 if(acceptance&&!result.passed)throw Error('Consecutive reliability gate failed; retained private evidence: '+root);
}
console.log('Private reliability evidence: '+root+'/report.json');
if(results.some(r=>!r.passed))process.exitCode=1;
}
