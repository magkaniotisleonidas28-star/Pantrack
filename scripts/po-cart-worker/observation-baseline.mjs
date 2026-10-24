import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,readlinkSync,lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join,resolve,basename,dirname} from 'node:path';
import {sourceSnapshot,requireGateSource,fileHash} from './acceptance-gate.mjs';
import {readPrivate,writePrivate} from './private-files.mjs';
import {historicalProfileRoot,historicalProfilesPreflight} from './profile-preservation-preflight.mjs';
import {parseProcessSnapshot} from './second-addition-cleanup.mjs';

// Observation-only C4 baseline. It reads processes, locks and profiles and
// writes only evidence inside its fixed private root. It has no signal, guard,
// consumption-record or archive path; the historical instance is already gone.
export const baselineRoot='.sites-runtime/po-cart-workers/observation-baseline-task-20261021';
export const baselinePolicy='fixed-observation-baseline-20261021';
export const activeProfile='803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571';
export const forbiddenPids=Object.freeze([4303]);
export const singletonLinkHash='1ca5152cf75d66e36c07e75dc337956996e3ad0a4975d923f8f41043019c10f2';
export const baselineReferences=Object.freeze({
 historicalEvidence:Object.freeze({path:'.sites-runtime/po-cart-workers/profile-preflight-source-task-20261015/observed-preflight.json',
  sha256:'196d88a3cfc163b6742d9a20e2a414deafcf5d7330d30b6ec9f732cbf775571e'}),
 lockEvidence:Object.freeze({path:'.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/worker-locks-before.json',
  sha256:'84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701'})});
export class BaselineError extends Error{
 constructor(category,context={}){super(category);this.category=category;this.context=context;}
}
const refuse=(category,context={})=>{throw new BaselineError(category,context);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>createHash('sha256').update(value).digest('hex');
const lockFields=['ino','dev','mode','mtimeNs','sha256'];

export function rejectBaselineArguments(args){
 if(args.length)throw Error('Observation baseline accepts no arguments, filters, overrides or resume.');
}
export function loadBaselineEvidence(references=baselineReferences){
 const {historicalEvidence:history,lockEvidence:locks}=references;
 const historyBytes=readFileSync(history.path),lockBytes=readFileSync(locks.path);
 if(hash(historyBytes)!==history.sha256||hash(lockBytes)!==locks.sha256)refuse('historical_evidence_changed');
 const pids=JSON.parse(historyBytes).processes.map(p=>p.pid).sort((a,b)=>a-b);
 // Quote retained integer nanoseconds before JSON parsing loses precision.
 let count=0;
 const records=JSON.parse(lockBytes.toString().replace(/("mtimeNs"\s*:\s*)(\d+)/g,(_,key,value)=>{count++;return key+'"'+value+'"';}));
 if(pids.length!==27||new Set(pids).size!==27||!Array.isArray(records)||records.length!==46||count!==46)refuse('historical_evidence_changed');
 return {historicalPids:pids,locks:records.map(r=>({name:basename(r.path),...Object.fromEntries(lockFields.map(k=>[k,String(r[k])]))})),singletonLinkHash};
}
export function exactLock(path){
 const before=lstatSync(path,{bigint:true});
 if(!before.isFile())refuse('worker_lock_changed');
 const sha256=fileHash(path),after=lstatSync(path,{bigint:true});
 if(!['ino','dev','mode','size','mtimeNs'].every(k=>before[k]===after[k]))refuse('worker_lock_changed');
 return {name:basename(path),ino:String(after.ino),dev:String(after.dev),mode:String(after.mode),mtimeNs:String(after.mtimeNs),sha256};
}
export function validateBaselinePreparation(pipeline,{root=baselineRoot,snapshot=sourceSnapshot}={}){
 let source;try{source=requireGateSource(pipeline?.source,snapshot);}catch{refuse('preparation_failed');}
 if(pipeline.passed!==true||pipeline.results?.length!==3)refuse('preparation_failed');
 for(const [index,id] of ['typecheck','test','build'].entries()){
  const entry=pipeline.results[index],path=join(root,'verification',id+'.log');
  let stat;try{stat=lstatSync(path);}catch{refuse('preparation_failed');}
  if(entry?.id!==id||entry.passed!==true||entry.exitCode!==0||entry.sourceBefore!==source.sha256||entry.sourceAfter!==source.sha256
   ||entry.log?.path!==path||!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||realpathSync(path)!==resolve(path)
   ||entry.log.sha256!==fileHash(path))refuse('preparation_failed');
 }
 return source;
}
function rootIdentity(root){
 let stat;try{stat=lstatSync(root);}catch{refuse('ownership_unverified');}
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||realpathSync(root)!==resolve(root))refuse('ownership_unverified');
 return {dev:stat.dev,ino:stat.ino,mode:stat.mode};
}
export function writeExclusive(path,value){
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
}
export const baselineIO={readProcesses:()=>execFileSync('ps',['-axo','pid=,ppid=,pgid=,stat=,lstart=,command='],{encoding:'utf8'})};

// Each read is persisted before it is evaluated. Commands are kept only as
// hashes, so an unrelated process's arguments never reach the evidence.
export function collectObservation(evidence,{profileRoot=historicalProfileRoot,io=baselineIO,preflight=historicalProfilesPreflight,record,check}){
 const scopedPids=new Set([...evidence.historicalPids,...forbiddenPids]),profiles=resolve(profileRoot);
 const processes=name=>{
  let raw,rows;
  try{raw=io.readProcesses();rows=parseProcessSnapshot(raw);}catch{refuse('observation_unavailable',{phase:name});}
  const scoped=rows.filter(p=>scopedPids.has(p.pid)||p.command.includes(profiles)).map(p=>({pid:p.pid,parent:p.parent,group:p.group,
   identity:p.identity,commandHash:hash(p.command),historicalPid:scopedPids.has(p.pid),profileReference:p.command.includes(profiles)}));
  record(name,{rows:rows.length,sha256:hash(raw),scoped});check();
  if(scoped.length)refuse('historical_process_present',{reference:name});
  return {rows:rows.length,scoped:0};
 };
 const before=processes('processes-before.json');
 let idle;try{idle=preflight({root:profileRoot});}catch{refuse('observation_unavailable',{phase:'preflight'});}
 record('preflight.json',idle);check();
 if(idle?.passed!==true||idle.status!=='idle')refuse('profile_not_idle',{reference:'preflight.json'});
 let locks;
 try{locks=readdirSync(profileRoot).filter(n=>n.endsWith('.lock')||n.endsWith('.lock.reclaim')).sort().map(n=>exactLock(join(profileRoot,n)));}
 catch(error){if(error instanceof BaselineError)throw error;refuse('observation_unavailable',{phase:'worker_locks'});}
 record('worker-locks.json',locks);check();
 const expected=[...evidence.locks].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(!same(locks,expected))refuse('worker_lock_changed',{reference:'worker-locks.json'});
 const path=join(profileRoot,activeProfile,'SingletonLock');
 let singleton;
 try{const stat=lstatSync(path,{bigint:true}),link=stat.isSymbolicLink()?readlinkSync(path):null;
  singleton={symlink:stat.isSymbolicLink(),linkHash:link===null?null:hash(link),originalOwner:link!==null&&/-30474$/.test(link),
   ino:String(stat.ino),dev:String(stat.dev)};}
 catch{singleton={symlink:false,linkHash:null,originalOwner:false};}
 record('singleton.json',singleton);check();
 if(!singleton.symlink||!singleton.originalOwner||singleton.linkHash!==evidence.singletonLinkHash)refuse('singleton_changed',{reference:'singleton.json'});
 const after=processes('processes-after.json');
 return {passed:true,processReads:[before.rows,after.rows],historicalPidsAbsent:evidence.historicalPids.length,forbiddenPidsAbsent:forbiddenPids.length,
  preflight:idle.status,profiles:idle.profiles,workerLocks:locks.length,singletonRetained:true,signalsSent:0};
}
export function runBaselineAudit({root=baselineRoot}={}){
 if(root!==baselineRoot)refuse('audit_failed');
 const fd=openSync(join(root,'audit-finish.log'),'wx',0o600);
 return new Promise((ok,no)=>{
  let child;
  try{child=spawn('python3',['-I','-B','scripts/po-cart-worker/observation-baseline-audit.py','finish'],
   {stdio:['ignore',fd,fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}catch(error){closeSync(fd);no(error);return;}
  closeSync(fd);child.once('error',no);
  child.once('exit',status=>{try{ok({...readPrivate(join(root,'verification-summary.json')),exitCode:status});}catch(error){no(error);}});
 });
}

// Internal dependency injection is for offline lifecycle tests. The CLI fixes
// every production binding; importing this module performs no observation.
export async function runObservationBaseline({root=baselineRoot,profileRoot=historicalProfileRoot,io=baselineIO,control={stopping:false},
 snapshotSource=sourceSnapshot,loadEvidence=loadBaselineEvidence,preflight=historicalProfilesPreflight,audit=runBaselineAudit,
 evidenceOrigin='collected',writer={exclusive:writeExclusive,replace:writePrivate}}={}){
 const ownedRoot=rootIdentity(root);
 const report={version:1,policy:baselinePolicy,...baselineReferences,evidenceOrigin,rootIdentity:ownedRoot,attemptId:randomUUID(),
  status:'running',stage:'invocation',source:null,collection:null,failure:null,failures:[],auditFailures:[],independent:null,passed:false};
 // The exclusive report is the single-use invocation record. A losing or
 // repeated launcher stops here without touching the winner's evidence.
 try{writer.exclusive(join(root,'report.json'),report);}
 catch(error){refuse(error?.code==='EEXIST'?'invocation_consumed':'evidence_write_failed',{reference:'report.json'});}
 const assertRoot=()=>{if(!same(rootIdentity(root),ownedRoot))refuse('ownership_unverified');};
 const save=()=>{assertRoot();writer.replace(join(root,'report.json'),report);};
 const record=(name,value)=>{assertRoot();try{writer.exclusive(join(root,name),value);}catch{refuse('evidence_write_failed',{reference:name});}};
 const fail=(error,phase)=>{
  const failure={category:error instanceof BaselineError?error.category:'verification_failed',phase,...(error?.context?.reference?{reference:error.context.reference}:{})};
  if(!report.failure)report.failure=failure;report.failures.push(failure);
 };
 let source=null;
 const check=()=>{
  assertRoot();if(control.stopping)refuse('interrupted');
  if(source){try{requireGateSource(source,snapshotSource);}catch{refuse('source_changed');}}
 };
 try{
  report.stage='preparation';save();
  source=validateBaselinePreparation(readPrivate(join(root,'pipeline.json')),{root,snapshot:snapshotSource});
  report.source=source;save();check();
  report.stage='collection';let evidence;
  try{evidence=loadEvidence();}catch(error){if(error instanceof BaselineError)throw error;refuse('historical_evidence_changed');}
  check();
  report.collection=collectObservation(evidence,{profileRoot,io,preflight,record,check});
  report.stage='final_collection_check';check();
 }catch(error){fail(error,report.stage);}
 // The independent audit runs last, after any partial failure, and reads this
 // saved report; it publishes a baseline only for a failure-free collection.
 try{report.stage='independent_audit';save();}catch(error){fail(error,'report_persistence');}
 let independent=null;
 try{independent=await audit({root});}catch{}
 if(independent?.passed!==true){
  report.auditFailures.push({category:'independent_audit_failed'});fail(new BaselineError('audit_failed'),'independent_audit');
 }
 report.independent=independent&&{passed:independent.passed===true,auditFailures:independent.auditFailures??null,
  baselinePublished:independent.baselinePublished===true};
 if(control.stopping&&!report.failures.some(f=>f.category==='interrupted'))fail(new BaselineError('interrupted'),'independent_audit');
 report.passed=!report.failure&&report.collection?.passed===true&&independent?.passed===true;
 report.status=report.passed?'complete':'blocked';report.stage='finished';
 try{save();}catch{report.passed=false;report.status='blocked';}
 return report;
}
