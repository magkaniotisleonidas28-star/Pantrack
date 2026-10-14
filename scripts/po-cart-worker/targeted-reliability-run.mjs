import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {seedLocalBrowserJob} from './local-browser-fixture.mjs';
import {fixtureCredential} from './credentials.mjs';
import {readPrivate,writePrivate,profileLock} from './private-files.mjs';
import {AiBudgetLedger} from '../cart-preview/ai-budget.mjs';
import {mockedReader} from './mock-ai-reader.mjs';
import {targetedCases,targetedTiming} from './targeted-timing.mjs';

const taskRoot='.sites-runtime/po-cart-workers/targeted-task-20261013';
export function sourceSnapshot(){
 const files=execFileSync('rg',['--files','src','scripts','tests','package.json','pnpm-lock.yaml'],{encoding:'utf8'}).trim().split('\n').sort(),hash=createHash('sha256');
 for(const file of files)hash.update(file).update('\0').update(readFileSync(file));
 return {files:files.length,sha256:hash.digest('hex')};
}
export async function runTargetedReliability(api){
 const release=profileLock(taskRoot+'/investigation'),stateFile=taskRoot+'/investigation.json';
 const results=[];let stopping=false,worker;
 const stop=()=>{stopping=true;worker?.requestStop();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  if(existsSync(stateFile))throw Error('This bounded investigation was already attempted; retained evidence requires review.');
  const source=sourceSnapshot(),state={version:1,startedAt:new Date().toISOString(),maximumJobs:36,initialJobs:24,confirmationJobs:12,source,attempts:[]};
  writePrivate(stateFile,state);
  const report=()=>writePrivate(taskRoot+'/report.json',{evidence:'offline-targeted-served-browser-investigation',startedAt:state.startedAt,finishedAt:new Date().toISOString(),source,
   initialComplete:results.length===24,causalGatePassed:false,paidRequests:0,confirmationJobsUsed:0,
   conclusion:results.some(r=>!r.passed)?'failure_or_inconclusive_timing_requires_review':'no_causal_explanation',results});
  for(const [index,spec] of targetedCases().entries()){
   if(stopping)break;
   assert.equal(sourceSnapshot().sha256,source.sha256,'Source changed during served investigation.');
   const dir=taskRoot+'/initial/'+index,start=performance.now(),timing=targetedTiming(spec);
   let f;const result={...spec,passed:false,workerStopped:false,credentialsRevoked:false};
   // Consume a fresh-job slot before fixture creation; an attempted slot is never rerun.
   state.attempts.push({index,at:new Date().toISOString(),...spec});writePrivate(stateFile,state);
   try{
    f=await seedLocalBrowserJob({layout:spec.layout,scenario:'normal',root:dir});
    const initial=structuredClone(f.readSession().entries),ledger=new AiBudgetLedger(dir+'/mock-budget.json',dir+'/absent.json');
    class TimedWorker extends api.LocalBrowserCartWorker {
     mutate(action,...args){
      if(action==='beginAttempt')return timing.beforeBegin(this.inferenceAbort.signal).then(()=>super.mutate(action,...args));
      if(action==='heartbeat')timing.heartbeat();
      const result=super.mutate(action,...args);return action==='claim'?result.then(value=>{timing.claimed();return value;}):result;
     }
    }
    worker=new TimedWorker({credentialFile:f.credentialFiles[0],journalFile:dir+'/journal.json',fixtureFile:f.fixtureFile,origin:f.origin,
     diagnosticMode:spec.diagnosticMode,diagnosticFile:dir+'/diagnostics.jsonl',
     reader:spec.mode==='stagehand'?mockedReader(api,f,ledger,spec.responseDelayMs,context=>timing.beforeRequest(context)):undefined});
    try{await worker.tick();}catch{result.workerStopped=true;}
    const current=await f.request(`/api/po-cart-jobs?companyId=${f.companyId}&jobId=${f.jobId}`),session=f.readSession();
    const expected=[...initial,...api.catalog.map((l,i)=>({sku:l.sku,unitLabel:l.unitLabel,packs:String(i+1),unitMinor:l.unitMinor}))];
    result.state=current.job.state;result.additions=worker.state.calls.length;result.network=worker.state.browserNetwork;
    result.exact=JSON.stringify(session.entries)===JSON.stringify(expected);
    result.cartSafe=session.entries.length<=expected.length&&JSON.stringify(session.entries)===JSON.stringify(expected.slice(0,session.entries.length));
    result.inventoryUnchanged=JSON.stringify(await f.request('/api/inventory?companyId='+f.companyId))===JSON.stringify(f.inventory);
    result.reservationUnchanged=JSON.stringify(current.authorization.reservation)===JSON.stringify(f.reservation);
    result.requests=spec.mode==='stagehand'?(await ledger.snapshot()).reservations.filter(r=>r.status==='completed').length:0;
    result.timing=timing.report();result.failureStage=worker.state.browserFailure?.stage??null;
    result.addResponseTimeout=/waitForResponse: Timeout/.test(worker.state.browserFailure?.message??'');
    result.safetyPassed=result.cartSafe&&(result.state!=='ready'||result.exact)&&result.network?.externalRequests===0&&result.network?.checkoutSubmissions===0&&result.inventoryUnchanged&&result.reservationUnchanged;
    const diagnosticPath=dir+'/diagnostics.jsonl';result.diagnosticModeVerified=spec.diagnosticMode==='off'?!existsSync(diagnosticPath):true;
    if(spec.diagnosticMode!=='off'){
     const events=readFileSync(diagnosticPath,'utf8').trim().split('\n').map(s=>JSON.parse(s));
     const formEvents=events.filter(e=>e.event==='form_ready'||e.event==='form_events');
     result.diagnosticModeVerified=spec.diagnosticMode==='passive'?formEvents.length===0:formEvents.filter(e=>e.event==='form_ready').length===result.additions;
    }
    result.passed=result.safetyPassed&&result.state==='ready'&&result.additions===3&&result.exact&&result.requests===(spec.mode==='stagehand'?10:0)&&result.timing.timingMet&&result.diagnosticModeVerified;
   }catch{result.setupOrInspectionFailed=true;}
   finally{
    worker?.close();worker=undefined;let revoked=Boolean(f);
    if(f)for(const file of f.credentialFiles){try{
     await fixtureCredential({execute:f.execute,file,companyId:f.companyId,action:'revoke'});
     const r=await fetch(f.origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+readPrivate(file).secret}});await r.body?.cancel();assert.equal(r.status,401);
    }catch{revoked=false;}}
    result.credentialsRevoked=revoked;if(!revoked)result.passed=false;
    result.elapsedMs=Math.round(performance.now()-start);results.push(result);report();
   }
   console.log(`${result.passed?'PASS':'REVIEW'} targeted ${index+1}/24 ${spec.layout}/${spec.mode}/${spec.diagnosticMode}/${spec.profile}`);
   if(result.safetyPassed!==true||!result.credentialsRevoked){stopping=true;break;}
  }
  assert.equal(sourceSnapshot().sha256,source.sha256,'Source changed during served investigation.');report();
  console.log('Private targeted evidence: '+taskRoot+'/report.json; causal gate remains closed pending review.');
  if(results.length!==24||results.some(r=>!r.passed))process.exitCode=1;
  return results;
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);release();}
}
