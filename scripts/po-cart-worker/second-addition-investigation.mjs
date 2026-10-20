import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,existsSync,readFileSync,lstatSync} from 'node:fs';
import {profileLock,writePrivate} from './private-files.mjs';

export const investigationRoot='.sites-runtime/po-cart-workers/second-addition-compatibility-task-20261014';
export const investigationCases=()=>['passive','form','off'].flatMap(diagnosticMode=>
 ['stagehand','deterministic'].flatMap(reader=>['rows','compact'].map(layout=>({diagnosticMode,reader,layout}))));
const stages=new Set(['session','launch','baseline','catalog','begin','addition','verify_line','final']);
const events=new Set(('proxy_created interception_ready cleanup_failed launch connected disconnected page_closed page_crashed closing closed stop '+
 'provider_reserved provider_start provider_headers provider_complete provider_failed provider_aborted metadata_verdict '+
 'catalog_ready quantity_filled attempt_ack ownership_check click_dispatch heartbeat_start heartbeat_ok heartbeat_failed '+
 'ownership_ok ownership_lost inspection_start inspection_ok form_ready click_start click_done click_failed form_events '+
 'add_request add_response add_finished add_failed proxy_add proxy_forward proxy_response proxy_end proxy_aborted proxy_error failure').split(' '));
const fields=new Set(['elapsedMs','status','valid','enabled','connected','owned','count','clicked','submitted','invalid','focused','stage','phaseId','durationMs','classification']);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v));

// Treat missing/truncated/unsafe evidence as inconclusive, never as an absent request.
export function inspectDiagnostics(path,mode,streamHealthy=true){
 if(mode==='off')return {healthy:streamHealthy&&!existsSync(path),events:[]};
 try{
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128000||(process.platform!=='win32'&&(stat.mode&0o777)!==0o600))throw Error();
  const raw=readFileSync(path,'utf8');if(!raw.endsWith('\n'))throw Error();
  const parsed=raw.trim().split('\n').map(s=>JSON.parse(s));
  if(!parsed.length||parsed.length>500||parsed.some((e,i)=>!events.has(e.event)||!timestamp(e.at)
   ||!Number.isSafeInteger(e.elapsedMs)||e.elapsedMs<0||(i&&e.elapsedMs<parsed[i-1].elapsedMs)
   ||Object.entries(e).some(([k,v])=>!['at','event'].includes(k)&&(!fields.has(k)||!(typeof v==='boolean'||Number.isSafeInteger(v)&&v>=0)))
   ||mode==='passive'&&['form_ready','form_events'].includes(e.event)))throw Error();
  return {healthy:streamHealthy,events:parsed};
 }catch{return {healthy:false,events:[]};}
}

export function classifyFailure({stage,additions,attempts,evidence}){
 if(['session','launch','baseline','catalog','begin'].includes(stage))return 'before_addition';
 if(additions===0&&attempts===0)return 'before_addition';
 if(!evidence?.healthy||!evidence.events.length)return 'insufficient_evidence';
 const dispatches=evidence.events.filter(e=>e.event==='click_dispatch');
 if(dispatches.length!==additions||!dispatches.length)return 'insufficient_evidence';
 const tail=evidence.events.slice(evidence.events.lastIndexOf(dispatches.at(-1))),has=name=>tail.some(e=>e.event===name);
 if(!has('add_request')&&!has('proxy_add'))return stage==='addition'?'no_observed_request':'insufficient_evidence';
 if(!has('add_response')&&!has('proxy_response'))return 'request_without_response';
 if(tail.some(e=>['add_response','proxy_response'].includes(e.event)&&e.status>=400)||!has('add_finished')||!has('proxy_end'))return 'incomplete_response';
 return ['verify_line','final'].includes(stage)?'post_response_verification_failure':'insufficient_evidence';
}

const booleans=['passed','exactCart','safeCart','inventoryUnchanged','reservationUnchanged','attemptsVerified','evidenceHealthy','diagnosticModeVerified','credentialsRevoked','workerClosed','browserClosed','diagnosticWriterHealthy','lifecycleComplete','networkCoverageComplete','cleanupVerified','powerVerified'];
const counts=['additions','attempts','verifiedResults','requests','completedRequests','externalRequests','checkoutSubmissions','elapsedMs'];
const failures=new Set(['before_addition','no_observed_request','request_without_response','incomplete_response','post_response_verification_failure','insufficient_evidence']);
const errors=new Set(['none','setup_failed','worker_failed','inspection_failed','cleanup_failed','interrupted','evidence_failed','source_changed']);
export function safeResult(value={}){
 const result={};
 for(const k of booleans)result[k]=value[k]===true;
 for(const k of counts)result[k]=Number.isSafeInteger(value[k])&&value[k]>=0?value[k]:null;
 result.stage=stages.has(value.stage)?value.stage:null;
 result.state=['queued','preparing','ready','review_needed','canceled'].includes(value.state)?value.state:null;
 result.failure=failures.has(value.failure)?value.failure:null;
 result.error=errors.has(value.error)?value.error:'inspection_failed';
 result.cleanupError=value.cleanupError===true;
 for(const k of ['startedAt','finishedAt'])result[k]=timestamp(value[k])?value[k]:null;
 return result;
}

// Creation is exclusive and durable, independently of the live-process lock.
// Even a crash before the first slot consumes this invocation permanently.
export function createInvestigation(root,source){
 mkdirSync(root,{recursive:true,mode:0o700});
 const release=profileLock(root+'/runner');
 try{
  const file=root+'/task.json',fd=openSync(file,'wx',0o600);
  const state={version:1,startedAt:new Date().toISOString(),source,maximumJobs:12,maximumRequests:60,slots:[]};
  try{writeFileSync(fd,JSON.stringify(state)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  if(process.platform!=='win32'){const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
  return {state,release,consume(spec){
   if(state.slots.length>=12)throw Error('Investigation slots exhausted.');
   const index=state.slots.length;state.slots.push({index,...spec,at:new Date().toISOString()});writePrivate(file,state);return index;
  }};
 }catch(e){release();throw e;}
}

export function requireInvestigationSource(sourceSnapshot,expected){
 const current=sourceSnapshot();
 if(!expected||!Number.isSafeInteger(expected.files)||expected.files<1||!expected.sha256
  ||current.files!==expected.files||current.sha256!==expected.sha256)throw Error('Frozen investigation source changed.');
 return {files:expected.files,sha256:expected.sha256};
}
export function validateInvestigationPipeline(pipeline,sourceSnapshot){
 const source=requireInvestigationSource(sourceSnapshot,pipeline?.source);
 const steps=['typecheck','test','db:check','build','db:migrate:local','test:local'];
 if(pipeline.passed!==true||pipeline.results?.length!==steps.length||pipeline.results.some((r,i)=>
  r.id!==steps[i]||r.passed!==true||r.exitCode!==0||r.sourceBefore!==source.sha256||r.sourceAfter!==source.sha256))throw Error('Fresh frozen-source local pipeline required.');
 return source;
}

// The CLI fixes the root/matrix. Tests inject execution without opening a browser.
export async function runInvestigation({root=investigationRoot,expectedSource,sourceSnapshot,runCase,control={stopping:false},cases=investigationCases(),successStatus='not reproduced; cause unresolved'}){
 if(cases.length!==12)throw Error('Exactly twelve bounded investigation slots required.');
 // Recheck inside the runner, immediately before exclusive durable creation.
 const source=requireInvestigationSource(sourceSnapshot,expectedSource),task=createInvestigation(root,source);
 const report={version:1,source,startedAt:task.state.startedAt,maximumJobs:12,maximumRequests:60,realProviderRequests:0,results:[],status:'running'};
 const save=()=>writePrivate(root+'/report.json',{...report,finishedAt:new Date().toISOString()});
 const assertSource=()=>{
  try{return requireInvestigationSource(sourceSnapshot,source);}catch(e){
   control.sourceChanged=true;control.stopping=true;control.worker?.requestStop();throw e;
  }
 };
 const unchanged=()=>{try{assertSource();return !control.sourceChanged;}catch{return false;}};
 try{
  save();
  for(const spec of cases){
   if(!unchanged()){report.status='source_changed';break;}
   if(control.stopping){report.status=control.powerFailed?'inconclusive_power':'interrupted';break;}
   const index=task.consume(spec);save();let value;
   try{value=await runCase(spec,index,assertSource);}catch{value={error:'setup_failed',failure:'insufficient_evidence'};}
   const result={index,...spec,...safeResult(value)};report.results.push(result);
   if(!unchanged()){result.passed=false;result.error='source_changed';report.status='source_changed';}
   else if(control.stopping){result.passed=false;result.error='interrupted';report.status=control.powerFailed?'inconclusive_power':'interrupted';}
   else if(!result.passed||!result.evidenceHealthy||!result.diagnosticWriterHealthy||!result.credentialsRevoked||!result.workerClosed||!result.browserClosed||!result.lifecycleComplete||!result.networkCoverageComplete||!result.cleanupVerified||result.cleanupError){result.passed=false;report.status='stopped';}
   save();if(report.status!=='running')break;
  }
  if(report.results.length===12&&report.results.every(r=>r.passed)&&report.status==='running')report.status=successStatus;
  if(report.status==='running')report.status='stopped';save();return report;
 }finally{task.release();}
}

// A separate boundary blocks accidental default provider fetch even if a reader
// loses its explicit mock. Stagehand polls an ephemeral loopback debugging port.
export function offlineFetch(transport){
 return (input,options)=>{
  const u=new URL(input instanceof Request?input.url:input);
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)throw Error('Offline transport boundary.');
  return transport(input,{...options,redirect:'error'});
 };
}
