import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openSync,closeSync,writeFileSync,fsyncSync,existsSync,realpathSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createServer} from 'node:http';
import {createServer as portProbe} from 'node:net';
import {chromium} from 'playwright-core';
import {parseProcessSnapshot} from './second-addition-cleanup.mjs';
import {parseLegacyExecutables,reconcileLegacyObservation,legacyFailure} from './legacy-profile-verification.mjs';
import {fileHash,requireGateSource} from './acceptance-gate.mjs';
import {createLifecycleEvidence,startupDecision,startupPopulationHash,writeEmergencyResult} from './shutdown-lifecycle-evidence.mjs';

export const diagnosisRoot='.sites-runtime/po-cart-workers/shutdown-observation-diagnosis-task-20261015';
export const diagnosisPolicy='isolated-shutdown-observation-20261015';
export const historicalObservation='.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015/observations/000006.json';
export const historicalObservationHash='5d0f4586905663ec15f5437a8c8c286212fc6fd555ba53888382141797fe8f9e';
export const diagnosisCases=Object.freeze(['SIGTERM','protocol'].flatMap(method=>[0,10,50].flatMap(delay=>[1,2].map(repetition=>Object.freeze({
 id:`${method}-${delay}-${repetition}`,method,delay,repetition})))));
export const hash=s=>createHash('sha256').update(s).digest('hex');
export class DiagnosisError extends Error{
 constructor(category,pid){super(category);this.category=category;if(Number.isSafeInteger(pid))this.pid=pid;}
}
const fail=(category,pid)=>{throw new DiagnosisError(category,pid);};
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function bounded(operation,ms,category){
 let timer;
 try{return await Promise.race([operation(),new Promise((_,no)=>{timer=setTimeout(()=>no(new DiagnosisError(category)),Math.max(1,ms));})]);}
 finally{clearTimeout(timer);}
}
export const diagnosticIO={now:()=>performance.now(),pause,
 identityOutput:()=>execFileSync('ps',['-axo','pid=,ppid=,pgid=,stat=,lstart=,command='],{encoding:'utf8'}),
 executableOutput:()=>execFileSync('ps',['-axo','pid=,lstart=,comm='],{encoding:'utf8'}),signal:(pid,kind)=>process.kill(pid,kind)};
export function parseDiagnosticIdentity(output){
 const rows=parseProcessSnapshot(output),lines=output.split('\n').filter(s=>s.trim());
 if(new Set(rows.map(p=>p.pid)).size!==rows.length)fail('incomplete_collection');
 return rows.map((p,i)=>{
  const m=lines[i].match(/^\s*\d+\s+\d+\s+\d+\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
  if(!m||!Number.isFinite(Date.parse(m[2])))fail('incomplete_collection');
  return {...p,state:m[1],start:m[2],startHash:hash(m[2]),commandHash:hash(p.command)};
 });
}
const profileMatch=(p,path)=>p.command.split(/\s+/).includes('--user-data-dir='+path);
function relevantRows(rows,captured,profile,leader){
 const ids=new Set(captured.map(p=>p.pid));ids.add(leader);let changed=true;
 while(changed){changed=false;for(const p of rows)if(ids.has(p.parent)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
 return rows.filter(p=>ids.has(p.pid)||p.group===leader||p.command.includes(profile));
}
export function summarizeRows(rows,profile){
 return rows.map(p=>({pid:p.pid,parent:p.parent,group:p.group,identity:p.identity,commandHash:p.commandHash,
  startHash:p.startHash,start:p.start,startedMs:Date.parse(p.start),state:p.state,zombie:p.zombie,
  exactProfile:profileMatch(p,profile)}));
}
export function observationSignature(observation,captured){
 return captured.filter(old=>{
  const p=observation.before.find(p=>p.pid===old.pid);
  return p&&p.startHash===old.startHash&&p.identity!==old.identity&&p.commandHash!==old.commandHash
   &&!p.exactProfile&&!observation.after.some(p=>p.pid===old.pid)&&!observation.details.some(p=>p.pid===old.pid);
 }).map(p=>p.pid);
}
// Diagnostic evidence has no signal-authorizing meaning. ps text may change
// while a captured process exits; start/topology mismatches remain blockers.
export function analyzeDiagnosticObservation(observation,baseline,{phase='baseline'}={}){
 if(!['baseline','shutdown'].includes(phase))fail('invalid_observation_phase');
 const findings=[];
 const blocked=(category,pid)=>({phase,findings,signaturePids:[],allAbsentAfter:false,
  blockingFailure:{category,...(pid?{pid}:{})}});
 const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const rows=(value,metadata=false)=>Array.isArray(value)&&new Set(value.map(p=>p?.pid)).size===value.length&&value.every(p=>
  Number.isSafeInteger(p?.pid)&&p.pid>0&&digest(p.startHash)&&Number.isFinite(p.startedMs)
  &&(metadata?digest(p.executableHash):Number.isSafeInteger(p.parent)&&p.parent>=0&&Number.isSafeInteger(p.group)&&p.group>0
   &&digest(p.identity)&&digest(p.commandHash)&&typeof p.exactProfile==='boolean'&&typeof p.zombie==='boolean'&&typeof p.state==='string'));
 if(observation?.complete!==true||!rows(observation.before)||!rows(observation.after)||!rows(observation.details,true)
  ||!rows(baseline)||!baseline.length||baseline.some(p=>!digest(p.executableHash)))return blocked('incomplete_collection');
 const known=new Map(baseline.map(p=>[p.pid,p])),seen=[...observation.before,...observation.after,...observation.details];
 const unexpected=seen.find(p=>!known.has(p.pid));if(unexpected)return blocked('unexpected_fixture_membership',unexpected.pid);
 for(const old of baseline){
  const a=observation.before.find(p=>p.pid===old.pid),b=observation.after.find(p=>p.pid===old.pid),d=observation.details.find(p=>p.pid===old.pid);
  if([a,b,d].some(p=>p&&(p.startHash!==old.startHash||p.startedMs!==old.startedMs)))return blocked('observed_start_time_mismatch',old.pid);
  if([a,b].some(p=>p&&(p.group!==old.group||(p.parent!==old.parent&&(phase!=='shutdown'||p.parent!==1)))))return blocked('observed_topology_changed',old.pid);
  const note=kind=>findings.push({pid:old.pid,kind});
  if([a,b].some(p=>p&&p.commandHash!==old.commandHash))note('command_changed');
  if([a,b].some(p=>p&&!p.exactProfile))note('profile_reference_missing');
  if(d&&d.executableHash!==old.executableHash)note('executable_text_changed');
  if((a||b)&&!d)note('metadata_missing');
  if([a,b].some(p=>p&&(p.zombie||p.state.startsWith('Z'))))note('zombie');
  if(!b)note('absent_after');
  if(phase==='baseline'&&(!a||!b||!d||[a,b].some(p=>p&&(p.identity!==old.identity||!p.exactProfile||p.zombie||p.state.startsWith('Z')))
   ||d.executableHash!==old.executableHash))return blocked('fixture_baseline_unverified',old.pid);
 }
 findings.sort((a,b)=>a.pid-b.pid||a.kind.localeCompare(b.kind));
 return {phase,findings,blockingFailure:null,signaturePids:phase==='shutdown'?observationSignature(observation,baseline).sort((a,b)=>a-b):[],
  allAbsentAfter:phase==='shutdown'&&observation.after.length===0};
}
export function collectObservation({io=diagnosticIO,captured,profile,leader,record,phase='baseline'}){
 const startedMono=io.now();let before=[],details=[],after=[],stage='before';
 try{
  before=parseDiagnosticIdentity(io.identityOutput());stage='details';details=parseLegacyExecutables(io.executableOutput());
  stage='after';after=parseDiagnosticIdentity(io.identityOutput());
 }catch{
  record({complete:false,stage,startedMono,finishedMono:io.now()});fail('incomplete_collection');
 }
 let verdict;
 try{reconcileLegacyObservation({before,details,after,captured,root:dirname(profile)});verdict={passed:true};}
 catch(error){verdict={passed:false,...legacyFailure(error)};}
 const first=relevantRows(before,captured,profile,leader),last=relevantRows(after,captured,profile,leader);
 const ids=new Set([...first,...last,...captured].map(p=>p.pid));
 const observation={version:1,complete:true,startedMono,finishedMono:io.now(),before:summarizeRows(first,profile),
  details:details.filter(p=>ids.has(p.pid)).map(p=>({pid:p.pid,start:p.start,startHash:hash(p.start),startedMs:p.startedMs,executableHash:hash(p.executable)})),
  after:summarizeRows(last,profile),verdict};
 const baseline=summarizeRows(captured,profile).map(p=>({...p,executableHash:hash(captured.find(c=>c.pid===p.pid).executable)}));
 observation.analysis=analyzeDiagnosticObservation(observation,baseline,{phase});
 observation.signaturePids=observation.analysis.signaturePids;
 observation.reference=record(observation);
 if(observation.analysis.blockingFailure){const f=observation.analysis.blockingFailure;fail(f.category,f.pid);}
 return {observation,before,details,after};
}
export async function observeDiagnosticShutdown({baseline,collect,startedMono,firstDelay=0,io=diagnosticIO,checkSource=()=>{},control={stopping:false},onObservation=()=>{}}){
 const deadline=startedMono+5000;let signatureObserved=false,observations=0;
 const check=()=>{if(control.stopping)fail('interrupted');try{checkSource();}catch{fail('source_changed');}};
 check();await io.pause(firstDelay);
 for(;;){
  check();if(io.now()>deadline)fail('fixture_shutdown_timeout');
  const observation=collect(),analysis=analyzeDiagnosticObservation(observation,baseline,{phase:'shutdown'});
  check();if(analysis.blockingFailure){const f=analysis.blockingFailure;fail(f.category,f.pid);}
  observations++;signatureObserved||=analysis.signaturePids.length>0;onObservation({observation,analysis});
  if(io.now()>deadline)fail('fixture_shutdown_timeout');
  if(analysis.allAbsentAfter)return {signatureObserved,observations,finishedMono:io.now(),exitObserved:true};
  if(io.now()>=deadline)fail('fixture_shutdown_timeout');await io.pause(20);
 }
}
export function classifyDiagnosis(results){
 if(results.length!==12||results.some((r,i)=>r.id!==diagnosisCases[i].id||r.completed!==true||r.cleanup?.verified!==true))return 'blocked';
 const count=results.filter(r=>r.signatureObserved).length;
 return count>=2?'reproduced':count===1?'observed once':'not reproduced within this matrix';
}
export function validateDiagnosisPreparation(pipeline,snapshot){
 const source=requireGateSource(pipeline?.source,snapshot);
 if(!pipeline.passed||pipeline.results?.length!==3||pipeline.results.some((r,i)=>r.id!==['typecheck','test','build'][i]
  ||r.passed!==true||r.exitCode!==0||r.sourceBefore!==source.sha256||r.sourceAfter!==source.sha256||fileHash(r.log.path)!==r.log.sha256))fail('preparation_failed');
 return source;
}
export function consumeDiagnosis(root,source){
 const path=join(root,'diagnosis.json'),fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify({policy:diagnosisPolicy,source,cases:diagnosisCases,startedAt:new Date().toISOString()})+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
export async function denyProxy(){
 const events=[];
 const note=(kind,target)=>events.push({kind,targetHash:hash(target??''),at:performance.now()});
 const server=createServer((req,res)=>{note('http',req.url);res.writeHead(403);res.end('Denied');});
 server.on('connect',(req,socket)=>{note('connect',req.url);socket.on('error',()=>{});socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
 server.on('clientError',(_error,socket)=>socket.destroy());
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
 return {url:`http://127.0.0.1:${server.address().port}`,events,
  close:()=>new Promise((ok,no)=>{server.closeAllConnections();server.close(e=>e?no(e):ok());})};
}
async function freePort(){
 const server=portProbe();await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
 const port=server.address().port;await new Promise(ok=>server.close(ok));return port;
}
export function fixtureExecutable(){
 const path=resolve(process.env.HOME??'','Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
 if(process.platform!=='darwin'||!existsSync(path)||realpathSync(path)!==path)fail('fixture_executable_unavailable');
 return path;
}
function chromeExecutable(path,main){
 const contents=dirname(dirname(main));
 return path===main||path.startsWith(join(contents,'Frameworks/Google Chrome for Testing Framework.framework/Versions/149.0.7827.55/Helpers/'));
}
function currentRows(io){return parseDiagnosticIdentity(io.identityOutput());}
export function verifySignalTarget(p,{captured,profile,leader,runnerPid,forbiddenPids,main,io=diagnosticIO}){
 if(!p||p.pid<1||forbiddenPids.includes(p.pid))fail('forbidden_signal_target',p?.pid);
 const old=captured.find(c=>c.pid===p.pid),rows=currentRows(io),now=rows.find(c=>c.pid===p.pid);
 if(!now)return false;
 const details=parseLegacyExecutables(io.executableOutput()).find(d=>d.pid===p.pid);
 const final=currentRows(io).find(c=>c.pid===p.pid);if(!final)return false;
 if(!old||[now,final].some(c=>c.identity!==old.identity||c.start!==old.start||c.group!==leader||c.zombie
  ||!profileMatch(c,profile)||(c.parent!==old.parent&&c.parent!==1))
  ||!details||details.startedMs!==old.startedMs||details.executable!==old.executable||!chromeExecutable(details.executable,main)
  ||(p.pid===leader&&old.parent!==runnerPid))fail('signal_ownership_unverified',p.pid);
 return true;
}
export async function disposeFixture({driver,session,captured,profile,leader,runnerPid,forbiddenPids,main,io=diagnosticIO,record=()=>{}}){
 const remaining=()=>relevantRows(currentRows(io),captured,profile,leader);
 const wait=async()=>{const end=io.now()+5000;do{if(!remaining().length)return true;await io.pause(50);}while(io.now()<end);return !remaining().length;};
 const signals=[];
 try{
  if(remaining().length&&driver?.isConnected()){
   const close=session?session.send('Browser.close'):driver.newBrowserCDPSession().then(s=>s.send('Browser.close'));
   void close.catch(()=>{});
  }
  if(!await wait()){
   for(const kind of ['SIGTERM','SIGKILL']){
    const targets=kind==='SIGTERM'?captured.filter(p=>p.pid===leader):captured.slice().reverse();
    for(const p of targets)if(verifySignalTarget(p,{captured,profile,leader,runnerPid,forbiddenPids,main,io})){
     record({kind:'fixture_cleanup_signal',pid:p.pid,signal:kind});
     if(verifySignalTarget(p,{captured,profile,leader,runnerPid,forbiddenPids,main,io})){
      try{io.signal(p.pid,kind);signals.push({pid:p.pid,signal:kind});}catch(error){if(error.code!=='ESRCH')throw error;}
     }
    }
    if(await wait())break;
   }
  }
  if(remaining().length)fail('fixture_cleanup_unverified');
  return {verified:true,signals};
 }finally{
  if(driver)await Promise.race([driver.close().catch(()=>{}),io.pause(1000)]);
 }
}
export async function runDiagnosticTrial(spec,{root,forbiddenPids,checkSource,recordEvent,saveCase,io=diagnosticIO,control={stopping:false},dependencies={}}){
 const deps={executable:fixtureExecutable,proxy:denyProxy,port:freePort,spawn,connect:(url,options)=>chromium.connectOverCDP(url,options),
  canonical:realpathSync,bounded,open:openSync,close:closeSync,prepare:path=>mkdirSync(path,{recursive:true,mode:0o700}),
  emergency:writeEmergencyResult,...dependencies};
 const key=hash(spec.id),profile=resolve(root,'profiles',key),dir=resolve(root,'cases',spec.id);
 const result={...spec,lifecycleEvidenceVersion:2,evidenceOrigin:Object.keys(dependencies).length?'simulated':'collected',runnerPid:process.pid,completed:false,signatureObserved:false,observations:[],
  network:{proxyOnly:true,blockedRequests:0},cleanup:{verified:false},secondaryFailures:[]};
 const lifecycle=createLifecycleEvidence({caseId:spec.id,now:io.now,saveCase});result.lifecycle=lifecycle.references;
 let proxy,driver,session,child,leader,main,captured=[],sequence=0,childExitObserved=false,trialFinished=false;
 const error=(category,condition,pid,reference)=>Object.assign(new DiagnosisError(category,pid),{condition,reference});
 const emit=(event,fields)=>{try{return lifecycle.emit(event,fields);}catch{throw error('evidence_write_failed','lifecycle_write_failed');}};
 const assertRunning=()=>{try{checkSource();}catch{throw error('source_changed','frozen_source_changed');}if(control.stopping)throw error('interrupted','stop_requested');};
 const enter=name=>{try{lifecycle.enter(name);}catch{throw error('evidence_write_failed','lifecycle_write_failed');}assertRunning();};
 const failed=(cause,condition)=>{
  const fallback=cause instanceof DiagnosisError?cause.category:`${lifecycle.stage}_operation_failed`;
  const named=cause.condition??condition??fallback;
  const requested=cause.reference??(['baseline','observe'].includes(lifecycle.stage)?result.observations.at(-1):undefined);
  const reference=[...lifecycle.references,...result.observations].includes(requested)?requested:lifecycle.lastReference;
  const value={category:cause instanceof DiagnosisError?cause.category:'fixture_operation_failed',stage:lifecycle.stage,
   condition:typeof named==='string'&&/^[a-z_]{1,64}$/.test(named)?named:fallback,
   ...(Number.isSafeInteger(cause.pid)&&cause.pid>0?{pid:cause.pid}:{}),...(reference?{reference}:{})};
  if(!result.failure)result.failure=value;else result.secondaryFailures.push(value);result.completed=false;
  try{emit('failed',{failure:value});}catch{result.secondaryFailures.push({category:'evidence_write_failed',stage:lifecycle.stage,condition:'failure_evidence_write_failed',
   ...(lifecycle.lastReference?{reference:lifecycle.lastReference}:{})});}
 };
 const record=observation=>{const ref=`cases/${spec.id}/observation-${String(++sequence).padStart(4,'0')}.json`;
  try{saveCase(ref,observation);}catch{throw error('evidence_write_failed','observation_write_failed');}result.observations.push(ref);return ref;};
 try{
  enter('executable');main=deps.executable();deps.prepare(profile);deps.prepare(dir);emit('ready');
  enter('proxy');proxy=await deps.proxy();emit('ready');
  enter('port');const port=await deps.port();emit('ready');
  enter('spawn');
  const args=['--headless=new','--no-first-run','--no-default-browser-check','--use-mock-keychain','--password-store=basic',
   '--disable-background-networking','--disable-component-update','--disable-quic','--disable-breakpad','--disable-crash-reporter',
   '--disable-extensions','--disable-sync','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,
   `--user-data-dir=${profile}`,`--proxy-server=${proxy.url}`,`--proxy-bypass-list=<-loopback>;127.0.0.1:${port}`,'about:blank'];
  const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','TZ'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
  let fd,spawnFailure;
  try{fd=deps.open(join(dir,'chrome.log'),'wx',0o600);}catch{throw error('fixture_operation_failed','stdio_open_failed');}
  try{
   child=deps.spawn(main,args,{detached:true,stdio:['ignore','ignore',fd],env});
   child.once('exit',()=>{childExitObserved=true;});child.on('error',()=>{if(!trialFinished)result.childErrorObserved=true;});leader=child.pid;result.leader=leader;
   if(!Number.isSafeInteger(leader)||forbiddenPids.includes(leader))throw error('fixture_spawn_failed','invalid_or_forbidden_pid');
   recordEvent({kind:'fixture_spawned',pid:leader,caseId:spec.id});emit('ready',{pid:leader});
  }catch(cause){spawnFailure=cause;}
  try{deps.close(fd);}catch{
   const secondary=error('fixture_operation_failed','stdio_close_failed');
   if(spawnFailure)spawnFailure.secondaryFailures=[secondary];else spawnFailure=secondary;
  }
  if(spawnFailure)throw spawnFailure;
  enter('startup');const end=io.now()+20000;result.startupStartedMono=end-20000;result.startupDeadlineMono=end;let stable;
  while(io.now()<end){
   assertRunning();if(childExitObserved)throw error('fixture_startup_failed','child_exited');
   let rows,details,collectionStage='identity';
   try{rows=currentRows(io);collectionStage='metadata';details=parseLegacyExecutables(io.executableOutput());}
   catch(cause){emit('collection_failed',{operation:'leader_collection',collectionStage});cause.condition=`leader_${collectionStage}_collection_failed`;throw cause;}
   const p=rows.find(p=>p.pid===leader),d=details.find(d=>d.pid===leader);
   const owned=!!(p&&p.parent===process.pid&&p.group===leader&&profileMatch(p,profile));
   emit('leader_sample',{present:!!p,owned,mainExecutable:d?.executable===main,
    ...(p?{member:summarizeRows([p],profile)[0]}:{}),...(d?{executableHash:hash(d.executable)}:{})});
   if(owned&&d?.executable===main)captured=[{...p,...d,profile:key}];
   if(!captured.length){emit('waiting',{condition:'leader_not_ready'});await io.pause(50);continue;}
   if(!driver){
    emit('cdp_connect');
    try{driver=await deps.connect(`http://127.0.0.1:${port}`,{timeout:Math.max(1,Math.min(1000,end-io.now()))});}
    catch{emit('waiting',{condition:'cdp_unavailable'});await io.pause(50);continue;}
    emit('cdp_ready');emit('pages_initialize');
    let initializing=true;
    const initializationCheck=()=>{if(!initializing)throw error('fixture_startup_timeout','page_initialization_expired');assertRunning();};
    try{await deps.bounded(async()=>{
     initializationCheck();const context=driver.contexts()[0];await context.route('**/*',r=>r.abort());initializationCheck();
     const first=context.pages()[0]??await context.newPage();initializationCheck();
     const second=await context.newPage();initializationCheck();
     for(const [i,page] of [first,second].entries()){
      await page.goto('data:text/html,<title>Shutdown fixture '+i+'</title><p>Offline</p>',{timeout:Math.max(1,end-io.now())});initializationCheck();
     }
     session=await driver.newBrowserCDPSession();initializationCheck();
    },end-io.now(),'fixture_startup_timeout');}finally{initializing=false;}
    emit('pages_ready');
   }
   let members=[],metadata=[],populationStage='identity';
   try{members=relevantRows(currentRows(io),[],profile,leader);populationStage='metadata';metadata=parseLegacyExecutables(io.executableOutput());}
   catch(cause){emit('population_sample',{sample:{complete:false,collectionStage:populationStage,members:summarizeRows(members,profile),metadata:[]}});cause.condition=`population_${populationStage}_collection_failed`;throw cause;}
   const sample={complete:true,members:summarizeRows(members,profile),metadata:metadata.filter(d=>members.some(p=>p.pid===d.pid)).map(d=>{
    const member=members.find(p=>p.pid===d.pid),identity=hash(d.start+'\0'+member.command),allowed=chromeExecutable(d.executable,main);
    const value={pid:d.pid,startHash:hash(d.start),startedMs:d.startedMs,metadataIdentity:identity,executableHash:hash(d.executable),executableAllowed:allowed};
    if(identity===member.identity&&allowed){try{value.canonicalHash=hash(deps.canonical(d.executable));}catch{value.canonicalError=true;}}
    return value;
   })};
   const reference=emit('population_sample',{sample}); // Persist before evaluating any admission condition.
   const decision=startupDecision(sample);emit('population_decision',{sampleReference:reference,decision,
    ...(decision.kind==='candidate'?{populationHash:startupPopulationHash(sample)}:{})});
   if(decision.kind==='rejected')throw error(decision.condition==='executable_resolution_failed'?'fixture_operation_failed':'fixture_baseline_unverified',decision.condition,decision.pid,reference);
   const next=members.map(p=>({...p,...metadata.find(d=>d.pid===p.pid),profile:key}));
   const fingerprint=hash(JSON.stringify(next.map(p=>[p.pid,p.parent,p.group,p.identity,p.executable]).sort((a,b)=>a[0]-b[0])));
   if(stable?.hash===fingerprint&&io.now()-stable.at>=250){captured=next;result.startupStableReferences=[stable.reference,reference];break;}
   stable={hash:fingerprint,at:io.now(),reference};emit('waiting',{condition:'population_not_stable'});await io.pause(250);
  }
  if(!stable||captured.length<3||io.now()>=end)throw error('fixture_startup_timeout','startup_deadline');
  result.baseline=summarizeRows(captured,profile).map(p=>({...p,executableHash:hash(captured.find(c=>c.pid===p.pid).executable)}));
  result.baselineStabilityMs=io.now()-stable.at;result.profileKey=key;emit('stable',{references:result.startupStableReferences});
  enter('baseline');
  const leaderCommand=captured.find(p=>p.pid===leader).command.split(/\s+/);
  result.network.proxyArgumentsVerified=leaderCommand.includes(`--proxy-server=${proxy.url}`)
   &&leaderCommand.includes(`--proxy-bypass-list=<-loopback>;127.0.0.1:${port}`)&&leaderCommand.includes('--disable-quic');
  if(!result.network.proxyArgumentsVerified)throw error('network_boundary_unverified','proxy_arguments');
  try{saveCase(`cases/${spec.id}/baseline.json`,result.baseline);result.baselineReference=`cases/${spec.id}/baseline.json`;}
  catch{throw error('evidence_write_failed','baseline_write_failed');}assertRunning();
  const options={io,captured,profile,leader,record};
  if(!collectObservation(options).observation.verdict.passed)throw error('fixture_baseline_unverified','strict_baseline_verdict');
  emit('verified');enter('shutdown');
  if(spec.method==='SIGTERM'){
   if(!verifySignalTarget(captured.find(p=>p.pid===leader),{captured,profile,leader,runnerPid:process.pid,forbiddenPids,main,io}))throw error('fixture_disappeared_before_shutdown','leader_absent');
   recordEvent({kind:'fixture_shutdown_signal',pid:leader,signal:'SIGTERM',caseId:spec.id});
   if(!verifySignalTarget(captured.find(p=>p.pid===leader),{captured,profile,leader,runnerPid:process.pid,forbiddenPids,main,io}))throw error('fixture_disappeared_before_shutdown','leader_absent');
   io.signal(leader,'SIGTERM');
  }else{
   recordEvent({kind:'fixture_protocol_close',pid:leader,caseId:spec.id});
   void session.send('Browser.close').then(()=>{if(!trialFinished)result.protocolClose='resolved';},()=>{if(!trialFinished)result.protocolClose='disconnected_or_rejected';});
  }
  result.shutdownStartedMono=io.now();emit('requested',{method:spec.method});enter('observe');
  const observed=await observeDiagnosticShutdown({baseline:result.baseline,startedMono:result.shutdownStartedMono,firstDelay:spec.delay,
   io,checkSource,control,collect:()=>collectObservation({...options,phase:'shutdown'}).observation,
   onObservation:({analysis})=>{result.signatureObserved||=analysis.signaturePids.length>0;}});
  result.shutdownFinishedMono=observed.finishedMono;result.completed=true;emit('exit_observed');
 }catch(cause){failed(cause);for(const secondary of cause.secondaryFailures??[])failed(secondary);}
 finally{
  const cleanupEnter=name=>{try{lifecycle.enter(name);}catch(cause){failed(error('evidence_write_failed','lifecycle_write_failed'));}};
  if(leader){
   cleanupEnter('dispose');
   result.cleanupCaptured=summarizeRows(captured,profile).map(p=>({...p,executableHash:hash(captured.find(c=>c.pid===p.pid).executable)}));
   try{emit('targets',{captured:result.cleanupCaptured});}catch(cause){failed(cause);}
   try{result.cleanup=await disposeFixture({driver,session,captured,profile,leader,runnerPid:process.pid,forbiddenPids,main,io,
    record:event=>recordEvent({...event,caseId:spec.id})});emit('verified');}
   catch(cause){result.cleanup={verified:false,category:cause instanceof DiagnosisError?cause.category:'fixture_cleanup_failed'};failed(cause,'fixture_disposal_failed');}
   cleanupEnter('child_exit');
   try{
    const exitDeadline=io.now()+1000;while(!childExitObserved&&io.now()<exitDeadline)await io.pause(10);
    result.childExitObserved=childExitObserved;
    if(!childExitObserved)throw error('child_exit_timeout','child_exit_unobserved');emit('verified');
   }catch(cause){failed(cause);}
  }
  if(proxy){
   cleanupEnter('proxy_close');result.network.blockedRequests=proxy.events.length;
   try{await deps.bounded(()=>proxy.close(),1000,'proxy_close_timeout');result.network.proxyClosed=true;emit('verified');}
   catch(cause){result.cleanup.verified=false;failed(cause,'proxy_close_failed');}
   try{saveCase(`cases/${spec.id}/proxy.json`,proxy.events);}catch{failed(error('evidence_write_failed','proxy_evidence_write_failed'));}
  }
  try{assertRunning();}catch(cause){failed(cause);}
  if(!result.cleanup.verified||!result.childExitObserved||result.failure)result.completed=false;
  cleanupEnter('report');
  trialFinished=true;
  try{assertRunning();emit('terminal',{completed:result.completed});assertRunning();result.resultReference=`cases/${spec.id}/result.json`;saveCase(result.resultReference,result);assertRunning();}
  catch(cause){delete result.resultReference;failed(cause instanceof DiagnosisError?cause:error('evidence_write_failed','result_write_failed'));
   try{result.resultReference=`cases/${spec.id}/failure-result.json`;deps.emergency(resolve(root,result.resultReference),result);}
   catch{delete result.resultReference;result.secondaryFailures.push({category:'evidence_write_failed',stage:'report',condition:'emergency_write_failed',
    ...(lifecycle.lastReference?{reference:lifecycle.lastReference}:{})});}
  }
 }
 return result;
}
export async function runDiagnosisMatrix({runTrial,recordResult,checkSource,control}){
 const results=[];
 for(const spec of diagnosisCases){
  checkSource();if(control.stopping)break;
  const result=await runTrial(spec);results.push(result);recordResult(result);
  if(!result.completed||!result.cleanup?.verified)break;
 }
 return {results,status:classifyDiagnosis(results)};
}
export function finalizeDiagnosticReport(report,audit){
 report.audit=audit;report.auditFailures=audit.auditFailures??[];
 const status=classifyDiagnosis(report.results??[]);
 report.passed=report.matrixComplete===true&&status!=='blocked'&&audit.matrixComplete===true&&audit.passed===true&&audit.status===status
  &&audit.independentChecksPassed===true&&audit.completeCases===12&&audit.attemptedCases===12&&audit.fixtureProcessesGone===true
  &&report.auditFailures.length===0&&audit.signatureCases===report.results.filter(r=>r.signatureObserved).length;
 if(report.lifecycleEvidenceVersion!==undefined)report.passed&&=report.lifecycleEvidenceVersion===2&&audit.lifecycleEvidenceVersion===2
  &&report.results.every(r=>r.lifecycleEvidenceVersion===2&&!r.failure&&!r.secondaryFailures?.length);
 report.status=report.passed?status:'blocked';
 if(!report.passed){
  report.diagnosisFailure??=report.results?.find(r=>r.failure)?.failure??audit.diagnosisFailure
   ??report.auditFailures[0]??{category:'incomplete_diagnostic_matrix'};
  report.primaryFailure??=report.diagnosisFailure;
 }
 return report;
}
