import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {AiBudgetLedger} from './cart-preview/ai-budget.mjs';
import {readPrivate} from './po-cart-worker/private-files.mjs';
await build({stdin:{contents:"export * from './scripts/po-cart-worker/ai-evaluate';export * from './scripts/po-cart-worker/ai-reader';export * from './scripts/cart-preview/ai-provider';export * from './scripts/cart-preview/fixture';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/ai-worker-served-check.mjs',logLevel:'silent'});
const {runEvaluation,StagehandCartReader,BoundedAiProvider,fixtureCatalog}=await import('../.sites-runtime/ai-worker-served-check.mjs');
Object.assign(process.env,{OPENAI_API_KEY:'fictional-test-only',PANTRACK_CART_AI_MODEL:'gpt-5.4-mini-2026-03-17',PANTRACK_CART_INPUT_USD_PER_MILLION:'0.75',PANTRACK_CART_OUTPUT_USD_PER_MILLION:'4.50'});
const root='.sites-runtime/po-cart-workers/ai-served-mock-'+randomUUID(),ledger=new AiBudgetLedger(root+'/ledger.json',root+'/absent.json');
const diagnosticMode=process.argv.includes('--diagnostic-mode')?process.argv[process.argv.indexOf('--diagnostic-mode')+1]:'off';
assert.ok(['off','passive'].includes(diagnosticMode));
const report=await runEvaluation(seedLocalBrowserJob,{offline:true,ledger,diagnosticMode,reader:(f,evidence)=>new StagehandCartReader({request:async(request,context)=>{
 const session=f.readSession(),phase=context.phase.replace(/:(Extraction|Metadata)$/,'');
 const value=context.phase.endsWith(':Metadata')?{completed:true,progress:'Fictional extraction complete.'}:phase.startsWith('product:')?
  {candidates:fixtureCatalog(session).map((p,index)=>({index,sku:p.sku,unitLabel:p.unitLabel,unitMinor:p.unitMinor,available:!(f.scenario==='unavailable'&&index===0)})).filter(p=>p.sku===phase.slice(8))}:{entries:session.entries};
 return new BoundedAiProvider(ledger,async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(!options.body.includes(session.token));for(const file of f.credentialFiles)assert.ok(!options.body.includes(readPrivate(file).secret));
  return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 }).request(request,context);
}},evidence)});
assert.equal(report.matrixPassed,true);assert.equal(report.acceptanceComplete,false);assert.equal(report.evidence,'offline-mocked-model-served-durable-worker');assert.equal(report.results.length,12);assert.equal(report.requests.length,72);
assert.ok(report.results.every(r=>r.passed&&r.credentialsRevoked&&r.diagnosticsComplete&&r.metadataComplete&&r.metadataFiles.length===5));console.log('PASS: served local D1 and Stagehand, 12 independently inspected exact/held fixture carts, 72 mocked requests and private Metadata capture ('+diagnosticMode+'); real-AI acceptance remains pending.');
