import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {readPrivate,writePrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {investigationCases,createInvestigation,runInvestigation,classifyFailure,inspectDiagnostics,safeResult,offlineFetch} from '../scripts/po-cart-worker/second-addition-investigation.mjs';
import {verifyAdditionAttempts} from '../scripts/po-cart-worker/second-addition-case.mjs';

const root=mkdtempSync(join(tmpdir(),'pantrack-second-addition-'));
const sourceSnapshot=()=>({files:1,sha256:'fixed-source'});
const passed={passed:true,evidenceHealthy:true,credentialsRevoked:true,workerClosed:true,browserClosed:true,diagnosticWriterHealthy:true,lifecycleComplete:true,networkCoverageComplete:true,cleanupVerified:true,error:'none'};
const evidence=names=>({healthy:true,events:names.map(event=>({event,status:303}))});
try{
 const cases=investigationCases();assert.equal(cases.length,12);assert.equal(new Set(cases.map(c=>JSON.stringify(c))).size,12);
 assert.deepEqual(cases.map(c=>c.diagnosticMode),['passive','form','off'].flatMap(v=>Array(4).fill(v)));
 assert.deepEqual(cases.slice(0,4).map(c=>[c.reader,c.layout]),[['stagehand','rows'],['stagehand','compact'],['deterministic','rows'],['deterministic','compact']]);
 const lines=[0,1,2].map(i=>({lineId:String(i),sku:'fixture-'+i,packs:String(i+1),unitMinor:'100',unitLabel:'case'}));
 const current={job:{inputs:{preflight:{lines}}},attempts:lines.map((line,i)=>({id:'attempt-'+i,lineId:line.lineId,intent:line})),
  results:lines.map((line,i)=>({attemptId:'attempt-'+i,outcome:'verified',observation:line}))};
 assert.equal(verifyAdditionAttempts(current),true,'Verify the independent manager projection, including exact intents/results');
 for(const change of [c=>c.attempts.push(c.attempts[0]),c=>c.attempts[1].lineId='0',c=>c.results[1].observation.packs='99',c=>c.results[1].outcome='uncertain']){
  const changed=JSON.parse(JSON.stringify(current));change(changed);assert.equal(verifyAdditionAttempts(changed),false);
 }
 const classify=(names,stage='addition',extra={})=>classifyFailure({stage,additions:2,attempts:2,evidence:evidence(['click_dispatch','add_request','add_response','add_finished','proxy_end',...names]),...extra});
 assert.equal(classify([],undefined,{additions:0,attempts:0}),'before_addition');
 assert.equal(classify([],'catalog'),'before_addition','A later catalog failure precedes its next addition');
 assert.equal(classify([],undefined,{evidence:evidence(['click_dispatch','click_dispatch','failure'])}),'no_observed_request');
 assert.equal(classify(['click_dispatch','add_request']),'request_without_response');
 assert.equal(classify(['click_dispatch','proxy_add']),'request_without_response');
 assert.equal(classify(['click_dispatch','add_request','add_response']),'incomplete_response');
 assert.equal(classify(['click_dispatch','add_request','add_response','add_finished','proxy_end'],'verify_line'),'post_response_verification_failure');
 assert.equal(classify([],undefined,{evidence:{healthy:false,events:[]}}),'insufficient_evidence');
 assert.equal(classify([],undefined,{evidence:evidence([])}),'insufficient_evidence','Off mode cannot imply no request');
 assert.equal(classify(['failure']),'insufficient_evidence','Prior addition evidence cannot diagnose a missing later dispatch');
 assert.equal(classify(['click_dispatch','add_response','add_finished','proxy_end'],'final'),'insufficient_evidence');
 const privateText='secret prompt credential DOM provider body screenshot';
 assert.ok(!JSON.stringify(safeResult({...passed,stage:privateText,error:privateText,state:privateText,message:privateText,additions:privateText})).includes('secret'));

 await build({stdin:{contents:"export * from './scripts/po-cart-worker/browser-diagnostics';export * from './scripts/po-cart-worker/browser-adapter';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/second-addition-tests.mjs',logLevel:'silent'});
 const {browserDiagnostics,LocalBrowserCartWorker}=await import('../.sites-runtime/second-addition-tests.mjs');
 for(const mode of ['passive','form','off']){
  const file=join(root,mode+'.jsonl'),credentialFile=join(root,mode+'-credential.json');writePrivate(credentialFile,{workerId:'fictional-offline'});
  const worker=new LocalBrowserCartWorker({credentialFile,journalFile:join(root,mode+'-journal.json'),fixtureFile:'unused',diagnosticMode:mode,diagnosticFile:file});
  worker.diagnostic.emit('launch',{prompt:privateText,status:200});worker.diagnostic.emit('closed');worker.close();
  assert.equal(worker.diagnostic.enabled,mode!=='off');assert.equal(existsSync(file),mode!=='off');
  assert.equal(inspectDiagnostics(file,mode,worker.diagnostic.healthy()).healthy,true);
  if(mode!=='off')assert.ok(!readFileSync(file,'utf8').includes(privateText));
 }
 const file=join(root,'bad.jsonl');
 for(const bad of [JSON.stringify({event:'closed',at:new Date().toISOString(),elapsedMs:0,prompt:privateText})+'\n','{','']){
  writeFileSync(file,bad,{mode:0o600});assert.equal(inspectDiagnostics(file,'passive').healthy,false);
 }
 const closed=JSON.stringify({event:'closed',at:new Date().toISOString(),elapsedMs:0})+'\n';
 writeFileSync(file,closed.repeat(501));assert.equal(inspectDiagnostics(file,'form').healthy,false);
 writeFileSync(file,' '.repeat(128001));assert.equal(inspectDiagnostics(file,'form').healthy,false);
 const d=browserDiagnostics(join(root,'unhealthy.jsonl'),{write(){throw Error(privateText);},close(){}});d.emit('closed');d.close();
 assert.equal(inspectDiagnostics(join(root,'unhealthy.jsonl'),'form',d.healthy()).healthy,false);
 writeFileSync(file,'{}\n');assert.equal(inspectDiagnostics(file,'off').healthy,false);
 let realCalls=0;const transport=offlineFetch(async()=>{realCalls++;return new Response();});
 assert.throws(()=>transport('https://api.openai.com/v1/responses'));assert.throws(()=>transport('http://example.invalid'));
 await transport('http://127.0.0.1:5181/api/internal/po-cart-worker');assert.equal(realCalls,1);

 const exclusive=join(root,'exclusive'),task=createInvestigation(exclusive,sourceSnapshot());
 assert.throws(()=>createInvestigation(exclusive,sourceSnapshot()),'Concurrent same-process rejection');
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import {createInvestigation} from './scripts/po-cart-worker/second-addition-investigation.mjs';try{createInvestigation(process.argv[1],{});process.exitCode=1;}catch{process.exitCode=0;}",exclusive],{encoding:'utf8'});
 assert.equal(child.status,0,'Concurrent process rejection');
 task.consume(cases[0]);assert.equal(readPrivate(exclusive+'/task.json').slots.length,1);task.release();
 assert.throws(()=>createInvestigation(exclusive,sourceSnapshot()),'Used invocation cannot be resumed');
 const bounded=createInvestigation(join(root,'bounded'),sourceSnapshot());
 for(const spec of cases)bounded.consume(spec);
 assert.throws(()=>bounded.consume(cases[0]),'No thirteenth slot');bounded.release();
 const crash=join(root,'crash');
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',"import {createInvestigation} from './scripts/po-cart-worker/second-addition-investigation.mjs';createInvestigation(process.argv[1],{}).consume({});",crash],{encoding:'utf8'}).status,0);
 assert.throws(()=>createInvestigation(crash,sourceSnapshot()),'Dead process lock never restores a slot');
 assert.equal(readPrivate(crash+'/task.json').slots.length,1);

 let attempts=0;
 const success=await runInvestigation({root:join(root,'success'),sourceSnapshot,expectedSource:sourceSnapshot(),runCase:async(spec,index)=>{
  assert.equal(readPrivate(join(root,'success/task.json')).slots.length,index+1,'Slot saved before setup');attempts++;return passed;
 }});
 assert.equal(attempts,12);assert.equal(success.status,'not reproduced; cause unresolved');
 for(const [name,value] of [['failure',{...passed,passed:false,error:'worker_failed'}],...['evidenceHealthy','diagnosticWriterHealthy','credentialsRevoked','lifecycleComplete','networkCoverageComplete','cleanupVerified'].map(key=>[key,{...passed,[key]:false}])]){
  let n=0;const r=await runInvestigation({root:join(root,name),sourceSnapshot,expectedSource:sourceSnapshot(),runCase:async()=>{n++;return value;}});assert.equal(n,1);assert.equal(r.status,'stopped');assert.equal(r.results[0].passed,false);
 }
 const interrupted={stopping:false};
 const r=await runInvestigation({root:join(root,'interrupt'),sourceSnapshot,expectedSource:sourceSnapshot(),control:interrupted,runCase:async()=>{interrupted.stopping=true;return passed;}});
 assert.equal(r.results.length,1);assert.equal(r.status,'interrupted');assert.equal(r.results[0].passed,false);
 const before=await runInvestigation({root:join(root,'interrupt-before'),sourceSnapshot,expectedSource:sourceSnapshot(),control:{stopping:true},runCase:async()=>{throw Error('Must not seed');}});
 assert.equal(before.results.length,0);assert.equal(readPrivate(join(root,'interrupt-before/task.json')).slots.length,0);assert.equal(before.status,'interrupted');
 const thrown=await runInvestigation({root:join(root,'throw'),sourceSnapshot,expectedSource:sourceSnapshot(),runCase:async()=>{throw Error(privateText);}});
 assert.equal(thrown.results.length,1);assert.ok(!JSON.stringify(thrown).includes(privateText));
 let changed=false;const changedSource=()=>({files:1,sha256:changed?'changed':'fixed'});
 const changedReport=await runInvestigation({root:join(root,'changed'),sourceSnapshot:changedSource,expectedSource:changedSource(),runCase:async()=>{changed=true;return passed;}});
 assert.equal(changedReport.status,'source_changed');assert.equal(changedReport.results.length,1);
 console.log('PASS: six milestone classifications, privacy/bounds, actual off-mode worker, provider denial, exclusive/concurrent/crashed task records, durable slots, interruption and stop-on-failure/source/evidence/cleanup.');
}finally{rmSync(root,{recursive:true,force:true});}
