import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync,statSync,closeSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AiBudgetLedger} from '../scripts/cart-preview/ai-budget.mjs';
import {evaluationPreflight,validatePaidAllowance,consumePaidAllowance,matrixReservationMicros,paidAllowanceFile} from '../scripts/po-cart-worker/evaluation-preflight.mjs';
import {readPrivate,writePrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {gatePolicy,gateSteps,sourceSnapshot,fileHash,validateGate} from '../scripts/po-cart-worker/acceptance-gate.mjs';
import {createMetadataAllowance} from '../scripts/po-cart-worker/metadata-allowance.mjs';
await build({stdin:{contents:"export * from './scripts/po-cart-worker/ai-evaluate';export * from './scripts/po-cart-worker/browser-diagnostics';export {EvaluationPreflightError} from './scripts/po-cart-worker/evaluation-preflight.mjs';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/evaluation-preflight-test.mjs',logLevel:'silent'});
const {runEvaluation,browserDiagnostics,EvaluationPreflightError}=await import('../.sites-runtime/evaluation-preflight-test.mjs');
Object.assign(process.env,{OPENAI_API_KEY:'fictional-test-only',PANTRACK_CART_AI_MODEL:'gpt-5.4-mini-2026-03-17',PANTRACK_CART_INPUT_USD_PER_MILLION:'0.75',PANTRACK_CART_OUTPUT_USD_PER_MILLION:'4.50'});
const root=mkdtempSync(join(tmpdir(),'pantrack-preflight-'));
const ready=async url=>new Response('{}',{status:401,headers:{'content-type':url.includes(':5181/')?'application/json':'text/html'}});
try{
 for(const reason of ['application_unavailable','storefront_unavailable','matrix_budget_unavailable','diagnostic_setup_unavailable','metadata_setup_unavailable','paid_allowance_unavailable']){
  const ledger=new AiBudgetLedger(join(root,reason+'.json'),join(root,'absent.json'));let fixtures=0,providerRequests=0;
  if(reason==='matrix_budget_unavailable')await ledger.reserve(5_000_000-matrixReservationMicros+1);
  const before=(await ledger.snapshot()).reservedMicros;
  const report=await runEvaluation(async()=>{fixtures++;throw Error('Fixtures must not be created.');},{offline:true,ledger,
   diagnosticMode:'passive',diagnostics:path=>{if(reason==='diagnostic_setup_unavailable')throw Error('private setup failure');return browserDiagnostics(path);},
   ...(reason==='metadata_setup_unavailable'?{metadataEvidence:()=>{throw Error('private setup failure');}}:{}),
   allowanceCheck:()=>{if(reason==='paid_allowance_unavailable'){assert.throws(()=>consumePaidAllowance('blocked',join(root,'missing.json')));throw new EvaluationPreflightError(reason);}},
   readinessTransport:async url=>{if(['application_unavailable','storefront_unavailable'].includes(reason)&&url.includes(reason==='application_unavailable'?':5181/':':5182/'))throw Error('private transport error');return ready(url);},
   reader:()=>({cart:async()=>{providerRequests++;},discover:async()=>{providerRequests++;}})});
  assert.equal(report.preflight.reason,reason);assert.equal(fixtures,0);assert.equal(providerRequests,0);assert.equal(report.requests.length,0);assert.equal(report.acceptanceComplete,false);
  assert.equal((await ledger.snapshot()).reservedMicros,before);process.exitCode=0;
 }
 const ledger=new AiBudgetLedger(join(root,'exact.json'),join(root,'absent.json'));await ledger.reserve(5_000_000-matrixReservationMicros);
 assert.equal((await evaluationPreflight(ledger,ready)).remainingMicros,matrixReservationMicros);
 for(const status of [200,303,404,503])await assert.rejects(evaluationPreflight(ledger,async()=>new Response('{}',{status})),/application_unavailable/);
 const allowance=join(root,'allowance.json');
 assert.equal(paidAllowanceFile,'.sites-runtime/po-cart-workers/metadata-repair-acceptance/allowance.json');
 writePrivate(allowance,{version:1,matrices:1,state:'blocked_offline',offlineGatePassed:false});assert.throws(()=>consumePaidAllowance('one',allowance),/paid_allowance/);
 const source=sourceSnapshot(),evidence=join(root,'evidence.json'),gateFile=join(root,'gate.json');writePrivate(evidence,{offline:true});
 const gate={policy:gatePolicy,source,passed:true,results:gateSteps.map(([id,args])=>({id,args,exitCode:0,passed:true,sourceBefore:source.sha256,sourceAfter:source.sha256,references:[{path:evidence,sha256:fileHash(evidence)}]}))};
 const pricing={model:'gpt-5.4-mini-2026-03-17',reasoning:'none',inputUsdPerMillion:0.75,outputUsdPerMillion:4.5,source:'https://developers.openai.com/api/docs/models/gpt-5.4-mini',checkedAt:new Date().toISOString()};
 writePrivate(gateFile,gate);assert.equal(validateGate(gateFile).source.sha256,source.sha256);
 for(const bad of [{...gate,source:{...source,sha256:'stale'}},{...gate,results:gate.results.slice(1)},{...gate,results:gate.results.map((r,i)=>i? r:{...r,exitCode:1})}]){writePrivate(gateFile,bad);assert.throws(()=>validateGate(gateFile));}
 writePrivate(gateFile,gate);writePrivate(evidence,{changed:true});assert.throws(()=>validateGate(gateFile),/evidence changed/);writePrivate(evidence,{offline:true});
 const prior=join(root,'prior.json'),priorData={version:1,matrices:1,state:'consumed',runId:'historical',consumedAt:new Date().toISOString()};writePrivate(prior,priorData);
 const original=fileHash(prior),newAllowance=join(root,'new-allowance.json'),options={gateReport:gateFile,pricing,authorizationReference:'offline test authorization only'};
 assert.throws(()=>createMetadataAllowance({...options,authorizationReference:''},newAllowance,prior),/authorization/);
 assert.throws(()=>createMetadataAllowance({...options,pricing:{...pricing,checkedAt:'invalid'}},newAllowance,prior),/verification/);
 assert.throws(()=>createMetadataAllowance(options,prior,prior),/separate/);
 assert.throws(()=>createMetadataAllowance(options,allowance,prior),/EEXIST/);
 writePrivate(prior,{...priorData,state:'authorized'});assert.throws(()=>createMetadataAllowance(options,newAllowance,prior),/consumed/);writePrivate(prior,priorData);
 createMetadataAllowance(options,newAllowance,prior);assert.equal(validatePaidAllowance(newAllowance,prior).previousAllowance.sha256,original);
 assert.throws(()=>createMetadataAllowance(options,newAllowance,prior),/EEXIST/);assert.equal(fileHash(prior),original);
 if(process.platform!=='win32')assert.equal(statSync(newAllowance).mode&0o777,0o600);
 const fresh=readPrivate(newAllowance);
 for(const [label,mutate,restore] of [
  ['stale-source',()=>writePrivate(newAllowance,{...fresh,source:{...fresh.source,sha256:'stale'}}),()=>writePrivate(newAllowance,fresh)],
  ['stale-pricing',()=>writePrivate(newAllowance,{...fresh,pricing:{...pricing,checkedAt:new Date(Date.now()-600000).toISOString()}}),()=>writePrivate(newAllowance,fresh)],
  ['changed-pricing',()=>writePrivate(newAllowance,{...fresh,pricing:{...pricing,outputUsdPerMillion:1}}),()=>writePrivate(newAllowance,fresh)],
  ['changed-gate',()=>writePrivate(gateFile,{...gate,altered:true}),()=>writePrivate(gateFile,gate)],
  ['changed-evidence',()=>writePrivate(evidence,{changed:true}),()=>writePrivate(evidence,{offline:true})],
  ['changed-prior',()=>writePrivate(prior,{...priorData,altered:true}),()=>writePrivate(prior,priorData)],
  ['old-consumed',()=>{},()=>{}],
 ]){
  mutate();let fixtures=0,requests=0;
  const ledger=new AiBudgetLedger(join(root,label+'.json'),join(root,'absent.json'));
  const report=await runEvaluation(async()=>{fixtures++;throw Error('Must block before fixture creation');},{offline:true,ledger,readinessTransport:ready,
   allowanceCheck:()=>validatePaidAllowance(label==='old-consumed'?prior:newAllowance,prior),reader:()=>({cart:async()=>{requests++;},discover:async()=>{requests++;}})});
  assert.equal(report.preflight.passed,false,label);assert.equal(fixtures,0);assert.equal(requests,0);assert.equal(report.requests.length,0);process.exitCode=0;restore();
 }
 // Consumption is durable before fixture creation. A subsequent fixture failure
 // never restores it and never reaches a provider or browser addition.
 const orderLedger=new AiBudgetLedger(join(root,'ordered.json'),join(root,'absent.json'));let fixtures=0,requests=0;
 const failed=await runEvaluation(async()=>{fixtures++;assert.equal(readPrivate(newAllowance).state,'consumed');throw Error('Interrupted fixture setup');},{offline:true,ledger:orderLedger,readinessTransport:ready,
  allowanceCheck:()=>validatePaidAllowance(newAllowance,prior),allowanceConsume:runId=>consumePaidAllowance(runId,newAllowance,prior),reader:()=>({cart:async()=>{requests++;},discover:async()=>{requests++;}})});
 assert.equal(fixtures,1);assert.equal(requests,0);assert.equal(failed.acceptanceComplete,false);assert.equal(readPrivate(newAllowance).state,'consumed');process.exitCode=0;
 assert.throws(()=>consumePaidAllowance('two',newAllowance,prior),/paid_allowance/);assert.throws(()=>createMetadataAllowance(options,newAllowance,prior),/EEXIST/);
 // Race independent processes for both exclusive creation and consumption.
 const concurrent=join(root,'concurrent.json'),child=join(root,'race.mjs');
 writeFileSync(child,`import {createMetadataAllowance,consumeMetadataAllowance} from ${JSON.stringify('file://'+resolve('scripts/po-cart-worker/metadata-allowance.mjs'))};\ntry{if(process.argv[2]==='create')createMetadataAllowance(JSON.parse(process.argv[5]),process.argv[3],process.argv[4]);else consumeMetadataAllowance('race-'+process.pid,process.argv[3],process.argv[4]);process.exitCode=0;}catch{process.exitCode=2;}`);
 const race=mode=>Promise.all(Array.from({length:4},()=>new Promise((ok,fail)=>{const p=spawn(process.execPath,[child,mode,concurrent,prior,JSON.stringify(options)],{stdio:'ignore'});p.once('error',fail);p.once('exit',ok);} )));
 assert.equal((await race('create')).filter(code=>code===0).length,1);assert.equal((await race('consume')).filter(code=>code===0).length,1);
 assert.equal(readPrivate(concurrent).state,'consumed');assert.equal(fileHash(prior),original);
 const path=join(root,'diagnostic.jsonl'),d=browserDiagnostics(path);
 for(let i=0;i<600;i++)d.emit('form_ready',{valid:true,status:200,cookie:'secret-cookie',url:'secret-url',count:NaN});
 d.emit('secret-category');d.close();d.emit('closing');
 const raw=readFileSync(path,'utf8');assert.equal(raw.trim().split('\n').length,500);assert.ok(!raw.includes('secret'));assert.ok(!raw.includes('cookie'));assert.ok(!raw.includes('NaN'));
 if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600);assert.throws(()=>browserDiagnostics(path));
 assert.equal(d.healthy(),false,'Exceeding the event cap invalidates acceptance evidence');
 let closed=false;const broken=browserDiagnostics(join(root,'broken.jsonl'),{write:()=>{throw Error('private write failure');},close:fd=>{closed=true;closeSync(fd);throw Error('private close failure');}});
 assert.doesNotThrow(()=>broken.emit('closing'));assert.equal(broken.healthy(),false);assert.doesNotThrow(()=>broken.close());assert.equal(closed,true);
 console.log('PASS: readiness/budget/evidence/allowance failures seed no fixtures and make zero requests; exclusive creation, prior fingerprint, source/pricing/gate binding, concurrent durable consumption before fixtures, no restoration, bounded private diagnostics.');
}finally{rmSync(root,{recursive:true,force:true});}
