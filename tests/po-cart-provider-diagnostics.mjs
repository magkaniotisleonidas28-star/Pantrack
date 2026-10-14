import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AiBudgetLedger} from '../scripts/cart-preview/ai-budget.mjs';
await build({stdin:{contents:"export * from './scripts/cart-preview/ai-provider';export * from './scripts/po-cart-worker/browser-diagnostics';export * from './scripts/po-cart-worker/evaluation-diagnostics';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/provider-diagnostics-test.mjs',logLevel:'silent'});
const {BoundedAiProvider,browserDiagnostics,providerPhases,verifyEvaluationDiagnostics}=await import('../.sites-runtime/provider-diagnostics-test.mjs');
Object.assign(process.env,{OPENAI_API_KEY:'fictional-test-only',PANTRACK_CART_AI_MODEL:'gpt-5.4-mini-2026-03-17',PANTRACK_CART_INPUT_USD_PER_MILLION:'0.75',PANTRACK_CART_OUTPUT_USD_PER_MILLION:'4.50'});
const root=mkdtempSync(join(tmpdir(),'pantrack-provider-diagnostics-'));
const request={instructions:'secret-prompt',input:'secret-body',format:{type:'json_schema',name:'fixture',strict:true,schema:{type:'object'}}};
const reply=()=>Response.json({status:'completed',usage:{input_tokens:1,output_tokens:1},output:[{content:[{type:'output_text',text:'{"secret-output":true}'}]}]},{headers:{'set-cookie':'secret-cookie'}});
try{
 for(const kind of ['complete','interrupted','aborted','http-failed']){
  const path=join(root,kind+'.jsonl'),d=browserDiagnostics(path),ledger=new AiBudgetLedger(join(root,kind+'.json'),join(root,'absent.json')),abort=new AbortController();let calls=0,canceled=false;
  const provider=new BoundedAiProvider(ledger,async()=>{calls++;
   if(kind==='complete')return reply();if(kind==='http-failed')return new Response('secret-output',{status:429});
   return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));queueMicrotask(()=>{if(kind==='aborted')abort.abort();controller.error(Error('secret-interruption'));});},cancel(){canceled=true;}}));
  });
  const context={caseId:'secret-case',phase:'baseline:Extraction',signal:abort.signal,diagnostic:d.emit};
  if(kind==='complete')await provider.request(request,context);else await assert.rejects(provider.request(request,context),/AI_READER_FAILED/);
  d.close();const raw=readFileSync(path,'utf8'),events=raw.trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(calls,1);assert.deepEqual(events.map(e=>e.event),['provider_reserved','provider_start','provider_headers',kind==='complete'?'provider_complete':kind==='aborted'?'provider_aborted':'provider_failed']);
  assert.ok(events.every(e=>e.phaseId===0&&Number.isSafeInteger(e.durationMs)));assert.ok(events.every((e,i)=>!i||e.durationMs>=events[i-1].durationMs));
  assert.equal(events[2].status,kind==='http-failed'?429:200);assert.ok(!raw.includes('secret'));assert.ok(!/prompt|cookie|https|body|output|header"/.test(raw));
  const r=(await ledger.snapshot()).reservations;assert.equal(r.length,1);assert.equal(r[0].status,kind==='complete'?'completed':'reserved');
 }
 const ledger=new AiBudgetLedger(join(root,'logging.json'),join(root,'absent.json'));
 await new BoundedAiProvider(ledger,async()=>reply()).request(request,{caseId:'offline',phase:'baseline:Extraction',diagnostic:()=>{throw Error('disk failure');}});
 let calls=0;const abort=new AbortController();abort.abort();const provider=new BoundedAiProvider(ledger,async()=>{calls++;return reply();});
 const before=(await ledger.snapshot()).reservedMicros;await assert.rejects(provider.request(request,{caseId:'offline',phase:'baseline:Extraction',signal:abort.signal}));assert.equal(calls,0);assert.equal((await ledger.snapshot()).reservedMicros,before);
 assert.equal(providerPhases.length,10);assert.equal(new Set(providerPhases).size,10);
 const coverage=join(root,'coverage.jsonl'),d=browserDiagnostics(coverage);d.emit('ownership_check');
 for(const phaseId of [0,1]){
  for(const event of ['provider_reserved','provider_start','provider_headers','provider_complete'])d.emit(event,{phaseId,durationMs:1,status:200});
  if(phaseId===1)d.emit('metadata_verdict',{phaseId,classification:0});
 }
 d.emit('closed');d.close();assert.equal(verifyEvaluationDiagnostics(coverage,providerPhases.slice(0,2),0),true);
 assert.equal(verifyEvaluationDiagnostics(coverage,providerPhases.slice(0,1),0),false);assert.equal(verifyEvaluationDiagnostics(coverage,[providerPhases[1],providerPhases[0]],0),false);
 assert.equal(verifyEvaluationDiagnostics(coverage,providerPhases.slice(0,2),1),false);
 const original=readFileSync(coverage,'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const verdict=original.find(e=>e.event==='metadata_verdict'),index=original.indexOf(verdict);
 const check=events=>{writeFileSync(coverage,events.map(e=>JSON.stringify(e)).join('\n')+'\n');return verifyEvaluationDiagnostics(coverage,providerPhases.slice(0,2),0);};
 for(const classification of [0,1,2,3])assert.equal(check(original.map(e=>e===verdict?{...e,classification}:e)),true,'Diagnostic evidence never authorizes readiness');
 for(const classification of [-1,4,'true',null])assert.equal(check(original.map(e=>e===verdict?{...e,classification}:e)),false);
 assert.equal(check(original.filter(e=>e!==verdict)),false);
 assert.equal(check([...original.slice(0,index),verdict,...original.slice(index)]),false);
 assert.equal(check([...original.slice(0,index-1),verdict,original[index-1],...original.slice(index+1)]),false);
 assert.equal(check(original.map(e=>e===verdict?{...e,phaseId:3}:e)),false);
 assert.equal(check(original.map(e=>e===verdict?{...e,progress:'private'}:e)),false);
 console.log('PASS: provider event ordering, fixed phase IDs, privacy, interrupted response and abort reservations, no retries and logging-error isolation.');
}finally{rmSync(root,{recursive:true,force:true});}
