import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {fileHash} from '../scripts/po-cart-worker/acceptance-gate.mjs';
import {displayOnRoot,displayOnCases,displayOnSuccess,displayOnDelay,displayOnPreparation,rejectDisplayOnArguments,finishDisplayOnRun} from '../scripts/po-cart-worker/display-on-investigation.mjs';
import {displayOnPower,inspectPowerLog,assertionEvidence} from '../scripts/po-cart-worker/display-on-power.mjs';
import {runInvestigation,investigationRoot} from '../scripts/po-cart-worker/second-addition-investigation.mjs';
import {caseExecutor,delayedApplicationReads} from '../scripts/po-cart-worker/second-addition-case.mjs';

const root=mkdtempSync(join(tmpdir(),'pantrack-display-on-'));
const source={files:1,sha256:'fixed'},snapshot=()=>({...source});
const passed={passed:true,evidenceHealthy:true,diagnosticWriterHealthy:true,credentialsRevoked:true,workerClosed:true,browserClosed:true,lifecycleComplete:true,networkCoverageComplete:true,cleanupVerified:true};
const cases=displayOnCases(),now=Date.parse('2026-10-15T05:00:00Z');
try{
 assert.equal(displayOnRoot,'.sites-runtime/po-cart-workers/second-addition-display-on-task-20261015');
 assert.equal(investigationRoot,'.sites-runtime/po-cart-workers/second-addition-compatibility-task-20261014');
 assert.equal(cases.length,12);assert.equal(displayOnDelay,1500);
 assert.deepEqual(cases.map(c=>[c.diagnosticMode,c.reader,c.layout]),['passive','form','off'].flatMap(d=>['stagehand','deterministic'].flatMap(r=>['rows','compact'].map(l=>[d,r,l]))));
 for(const c of cases){assert.equal(c.delayMs,1500);assert.equal(c.delayMechanism,c.reader==='stagehand'?'mocked_provider_response':'application_get_response');}
 for(const args of [['--resume'],['--root',root],['--retry'],['--help']]){
  assert.throws(()=>rejectDisplayOnArguments(args));
  const child=spawnSync(process.execPath,['scripts/po-cart-second-addition-display-on-check.mjs',...args],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/accepts no arguments/);
 }
 assert.match(readFileSync('scripts/po-cart-second-addition-display-on-check.mjs','utf8'),/^import \{originalFetch\} from '.\/po-cart-worker\/offline-boundary.mjs';/);
 const preparation=join(root,'preparation'),steps=['typecheck','test','db:check','build','db:migrate:local','test:local'];
 const pipeline={source,passed:true,startedAt:new Date(now-60000).toISOString(),finishedAt:new Date(now-1000).toISOString(),results:steps.map(id=>{
  const path=preparation+'/pipeline-final-'+id.replaceAll(':','-')+'.log';writePrivate(path,{passed:true});
  return {id,passed:true,exitCode:0,sourceBefore:source.sha256,sourceAfter:source.sha256,log:{path,sha256:fileHash(path)}};
 })};
 writePrivate(preparation+'/pipeline-final.json',pipeline);assert.deepEqual(displayOnPreparation(preparation,snapshot,now),source);
 for(const change of [p=>p.results[0].passed=false,p=>p.results.reverse(),p=>p.results[0].sourceAfter='other',p=>p.startedAt=new Date(now-7200001).toISOString(),p=>p.finishedAt=new Date(now+1).toISOString(),p=>p.results[0].log.sha256='changed',p=>p.results[0].log.path=root+'/another-task.log']){
  const p=structuredClone(pipeline);change(p);writePrivate(preparation+'/pipeline-final.json',p);assert.throws(()=>displayOnPreparation(preparation,snapshot,now));
 }

 const used=join(root,'used');let calls=0;
 const report=await runInvestigation({root:used,expectedSource:source,sourceSnapshot:snapshot,cases,successStatus:displayOnSuccess,runCase:async(spec,index)=>{
  assert.equal(readPrivate(used+'/task.json').slots.length,index+1);assert.deepEqual(spec,cases[index]);calls++;return passed;
 }});
 assert.equal(calls,12);assert.equal(report.status,displayOnSuccess);
 const before=readFileSync(used+'/report.json');await assert.rejects(runInvestigation({root:used,expectedSource:source,sourceSnapshot:snapshot,cases,runCase:async()=>assert.fail()}));assert.deepEqual(readFileSync(used+'/report.json'),before);
 for(const reason of ['failure','evidence','cleanup','interruption','power','source']){
  let changed=false,calls=0;const control={stopping:false};
  const r=await runInvestigation({root:join(root,reason),expectedSource:source,sourceSnapshot:()=>changed?{files:1,sha256:'changed'}:source,cases,control,runCase:async()=>{
   calls++;if(reason==='interruption'||reason==='power')control.stopping=true;if(reason==='power')control.powerFailed=true;
   if(reason==='source')changed=true;
   return {...passed,passed:reason!=='failure',evidenceHealthy:reason!=='evidence',cleanupVerified:reason!=='cleanup'};
  }});
  assert.equal(calls,1);assert.equal(r.results[0].passed,false);
  assert.equal(r.status,reason==='power'?'inconclusive_power':reason==='source'?'source_changed':reason==='interruption'?'interrupted':'stopped');
  assert.equal(readPrivate(join(root,reason,'task.json')).slots.length,1);
 }
 const order=[],response=new Response();
 const delayed=delayedApplicationReads(async()=>{order.push('response');return response;},1500,async ms=>{assert.equal(ms,1500);order.push('delay');});
 assert.equal(await delayed('http://127.0.0.1',{method:'GET'}),response);assert.deepEqual(order,['response','delay']);
 order.length=0;await delayed('http://127.0.0.1',{method:'POST'});assert.deepEqual(order,['response']);
 // Exercise the real mocked transport via injected non-browser worker dependencies.
 // One permitted call receives the configured delay; the next call is refused.
 let firstDuration=0,options;
 const fakeApi={catalog:[],fixtureCatalog:()=>[],browserDiagnostics:()=>({emit(){},close(){},healthy:()=>true}),
  StagehandCartReader:class{constructor(o){this.request=o.request;}},
  BoundedAiProvider:class{constructor(_ledger,transport){this.transport=transport;}async request(_request,context){return this.transport('https://api.openai.com/v1/responses',{body:'{}',signal:context.signal});}},
  LocalBrowserCartWorker:class{constructor(o){options=o;this.state={calls:[],browserNetwork:{pageIntercepted:true,proxyClosed:true,driverClosed:true,browserClosed:true,cleanupErrors:0}};}
   async tick(){const start=performance.now();await options.reader.request({}, {phase:'baseline:Extraction'});firstDuration=performance.now()-start;
    await assert.rejects(options.reader.request({}, {phase:'baseline:Metadata'}),/Mock request bound/);}
   close(){}save(){}}};
 await caseExecutor(fakeApi,{stopping:false},{root:join(root,'fake-case'),assertSource:()=>{},delay:1500,requestLimit:1,seedJob:async({root:dir})=>{
  mkdirSync(dir,{recursive:true});return {readSession:()=>({entries:[],token:'private-token'}),credentialFiles:[],request:async()=>{throw Error('End non-browser fixture');}};
 }})(cases[0],0);
 assert.ok(firstDuration>=1450,'1500ms reaches the mocked response transport');assert.equal(options.retainFailureMessage,false);

 const raw=(extra='')=>'2026-10-15 00:59:00 +0000 Notification Display is turned on\n'+extra+'2026-10-15 01:00:00 +0000 : Showing all currently held IOKit power assertions\n';
 const clock=Date.parse('2026-10-15T01:00:00Z');
 assert.equal(inspectPowerLog(raw(),clock-10000,clock).verified,true);
 for(const bad of ['2026-10-15 00:59:59 +0000 Notification Display is turned off\n','2026-10-15 00:59:59 +0000 Sleep Entering Sleep\n','2026-10-15 00:59:59 +0000 DarkWake DarkWake from Deep Idle\n'])assert.equal(inspectPowerLog(raw(bad),clock-10000,clock).verified,false);
 assert.equal(inspectPowerLog('',clock-10000,clock).verified,false);assert.equal(inspectPowerLog(raw(),clock-10000,clock+5000).verified,false);
 const assertions=pid=>`pid ${pid}(caffeinate): [0x1] 00:00:00 PreventUserIdleDisplaySleep named: "caffeinate command-line tool"\npid ${pid}(caffeinate): [0x2] 00:00:00 PreventUserIdleSystemSleep named: "caffeinate command-line tool"\n`;
 assert.deepEqual(assertionEvidence(assertions(101),101),{display:true,system:true});assert.deepEqual(assertionEvidence(assertions(101),102),{display:false,system:false});
 function fixture(name){
  const control={stopping:false,worker:{requestStop(){control.stopped=true;}}},child=new EventEmitter();child.pid=101;
  let alive=false,time=clock,identity='fixed',assertionLost=false,logFailed=false;const signals=[];
  const io={now:()=>time,spawn:()=>{alive=true;return child;},pause:async()=>{time+=100;},
   snapshot:()=>alive?[{pid:101,parent:process.pid,identity,zombie:false,command:'/usr/bin/caffeinate -di -w '+process.pid}]:[],
   signal:(pid,kind)=>{signals.push({pid,kind});alive=false;child.emit('exit');},
   assertions:()=>alive&&!assertionLost?assertions(101):'',log:()=>{if(logFailed)throw Error('Unavailable');return raw();}};
  return {control,signals,guard:displayOnPower({root:join(root,name),control,io}),lose:()=>{assertionLost=true;},reuse:()=>{identity='reused';},badLog:()=>{logFailed=true;}};
 }
 {const f=fixture('power-ok');await f.guard.start();f.guard.sample();f.guard.check('after_case');assert.equal((await f.guard.close()).verified,true);assert.deepEqual(f.signals,[{pid:101,kind:'SIGTERM'}]);assert.equal(f.control.stopping,false);}
 for(const failure of ['lose','reuse','badLog']){
  const f=fixture('power-'+failure);await f.guard.start();f[failure]();assert.throws(()=>failure==='badLog'?f.guard.check('after_case'):f.guard.sample());
  assert.equal(f.control.powerFailed,true);assert.equal(f.control.stopped,true);
  const cleanup=await f.guard.close();if(failure==='reuse'){assert.equal(f.signals.length,0);assert.equal(cleanup.verified,false);}else assert.equal(cleanup.verified,true);
 }
 for(const failure of ['audit','closePreview','ports','closePower']){
  const actions=[],dependencies={};
  for(const key of ['audit','closePreview','ports','closePower'])dependencies[key]=async()=>{
   actions.push(key);if(key===failure)throw Error('private error');
   return key==='audit'?{passed:true}:key==='ports'?{portsFree:true,failures:[]}:{verified:true,childExited:true,groupEmpty:true,failures:[]};
  };
  const final=await finishDisplayOnRun({status:displayOnSuccess},dependencies);
  assert.deepEqual(actions,['audit','closePreview','ports','closePower']);assert.equal(final.status,'cleanup_failed');
 }
 console.log('PASS: fixed delayed matrix, source/fresh pipeline binding, exclusive durable slots, stop/interruption, real mocked delay/request bound, distinct GET delay, owned assertion lifecycle, display/sleep/log failures and conservative cleanup; no browser jobs.');
}finally{rmSync(root,{recursive:true,force:true});}
