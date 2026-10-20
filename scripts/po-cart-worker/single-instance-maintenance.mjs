import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,existsSync,mkdirSync,fsyncSync} from 'node:fs';
import {join,resolve,relative,dirname,sep} from 'node:path';
import {sourceSnapshot,requireGateSource,fileHash} from './acceptance-gate.mjs';
import {readPrivate,writePrivate} from './private-files.mjs';
import {historicalProfileRoot,historicalProfilesPreflight} from './profile-preservation-preflight.mjs';
import {LegacyVerificationError,createLegacyAttempt,legacyFailure} from './legacy-profile-verification.mjs';
import {browserTargets,staleTarget,historicalEvidence,historicalEvidenceHash,loadHistoricalTargets,validateLegacyTargets,
 legacyIO,verifyPopulation,requireStalePidAbsent,verifyProfileDirectories,verifyProfileOwnership,lockRecord,
 acquireLegacyGuards,verifyLegacyGuards,releaseLegacyGuards,consumeMaintenance,closeLegacyBrowsers,archiveStaleLock,
 auditLegacyCleanup} from './legacy-profile-cleanup.mjs';

export const singleRoot='.sites-runtime/po-cart-workers/single-instance-maintenance-task-20261016';
export const singlePolicy='fixed-single-instance-maintenance-20261016';
export const singleTargets=Object.freeze([Object.freeze({...browserTargets[2]})]);
export const singleMemberPids=Object.freeze([30474,30480,30481,30482,30484,30487,30488,30493,30528]);
export const singleLockEvidence='.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/worker-locks-before.json';
export const singleLockEvidenceHash='84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701';
export const singleReferences=Object.freeze({
 historicalEvidence:Object.freeze({path:historicalEvidence,sha256:historicalEvidenceHash}),
 lockEvidence:Object.freeze({path:singleLockEvidence,sha256:singleLockEvidenceHash})});
const refuse=(category='target_validation_failed',context={})=>{throw new LegacyVerificationError(category,context);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>createHash('sha256').update(value).digest('hex');
const present=path=>{try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

export function rejectSingleArguments(args){
 if(args.length)throw Error('Single-use instance maintenance accepts no arguments, filters, overrides or resume.');
}
export function loadSingleEvidence(){
 const evidence=loadHistoricalTargets(),bytes=readFileSync(singleLockEvidence);
 if(hash(bytes)!==singleLockEvidenceHash)refuse();
 // Quote retained integer nanoseconds before JSON parsing loses precision.
 let count=0;
 const locks=JSON.parse(bytes.toString().replace(/("mtimeNs"\s*:\s*)(\d+)/g,(_,key,value)=>{count++;return key+'"'+value+'"';}));
 if(!Array.isArray(locks)||count!==locks.length||locks.length!==46)refuse();
 const oldLock=locks.find(p=>p.path.endsWith('/'+staleTarget.profile+'.lock'));
 const processes=evidence.processes.filter(p=>p.profile===singleTargets[0].profile);
 if(!oldLock||!same(processes.map(p=>p.pid).sort((a,b)=>a-b),singleMemberPids))refuse();
 return {...evidence,processes,oldLock};
}
export function exactWorkerLock(path){
 const before=lstatSync(path,{bigint:true}),record=lockRecord(path),stat=lstatSync(path,{bigint:true});
 if(Number(stat.ino)!==record.ino||Number(stat.dev)!==record.dev||Number(stat.mode)!==record.mode
  ||Number(stat.size)!==record.size||!['ino','dev','mode','size','mtimeNs'].every(key=>before[key]===stat[key]))refuse('lock_archive_failed');
 return {...record,mtimeNs:String(stat.mtimeNs)};
}
export function validateSingleTargets(evidence,rows,{root=historicalProfileRoot,io=legacyIO}={}){
 if(!same(evidence.processes?.map(p=>p.pid).sort((a,b)=>a-b),singleMemberPids))refuse();
 const plan=validateLegacyTargets(evidence,rows,{root,io,targets:singleTargets,pid4303Absent:true});
 const exact=exactWorkerLock(join(root,staleTarget.profile+'.lock')),old=evidence.oldLock;
 if(!old||!['ino','dev','mode','sha256','mtimeNs'].every(key=>exact[key]===old[key]))refuse();
 return {...plan,lockExact:exact};
}
export function revalidateSingle(plan,rows,{root=historicalProfileRoot,io=legacyIO}={}){
 requireStalePidAbsent(rows);
 if(!same(plan.targets,singleTargets)||!same(plan.captured.map(p=>p.pid).sort((a,b)=>a-b),singleMemberPids)
  ||verifyPopulation(rows,plan.captured,root).length!==9)refuse();
 verifyProfileDirectories(plan,io);verifyProfileOwnership(plan,{beforeShutdown:true});
 if(!same(exactWorkerLock(join(root,staleTarget.profile+'.lock')),plan.lockExact))refuse();
}
export function validateSinglePreparation(pipeline,{root=singleRoot,snapshot=sourceSnapshot}={}){
 const source=requireGateSource(pipeline?.source,snapshot),ids=['typecheck','test','build'];
 if(pipeline.passed!==true||pipeline.results?.length!==3)refuse('preparation_failed');
 for(const [index,entry] of pipeline.results.entries()){
  const path=join(root,'verification',ids[index]+'.log');
  if(entry.id!==ids[index]||entry.passed!==true||entry.exitCode!==0||entry.sourceBefore!==source.sha256
   ||entry.sourceAfter!==source.sha256||entry.log?.path!==path||entry.log.sha256!==fileHash(path))refuse('preparation_failed');
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||realpathSync(path)!==resolve(path))refuse('preparation_failed');
 }
 return source;
}
function rootIdentity(root){
 const stat=lstatSync(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||realpathSync(root)!==resolve(root))refuse('ownership_unverified');
 return {dev:stat.dev,ino:stat.ino,mode:stat.mode};
}
export function runSingleAudit(mode,{root=singleRoot}={}){
 if(root!==singleRoot||!['before','guarded','finish'].includes(mode))refuse('audit_failed');
 const path=join(root,'audit-'+mode+'.log'),fd=openSync(path,'wx',0o600);
 return new Promise((ok,no)=>{
  let child;
  try{child=spawn('python3',['-I','-B','scripts/po-cart-worker/single-instance-maintenance-audit.py',mode],
   {stdio:['ignore',fd,fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}catch(error){closeSync(fd);no(error);return;}
  closeSync(fd);child.once('error',no);
  child.once('exit',status=>{
   try{
    const log=openSync(path,'r');try{fsyncSync(log);}finally{closeSync(log);}
    if(status!==0)throw new LegacyVerificationError('audit_failed');
    ok(readPrivate(join(root,mode==='finish'?'verification-summary.json':'audit-'+mode+'.json')));
   }catch(error){no(error);}
  });
 });
}

// Internal dependency injection is for offline lifecycle tests. The CLI fixes
// every production binding; importing this module performs no maintenance.
export async function runSingleMaintenance({root=singleRoot,profileRoot=historicalProfileRoot,io=legacyIO,
 control={stopping:false},snapshotSource=sourceSnapshot,loadEvidence=loadSingleEvidence,audit=runSingleAudit,
 preflight=historicalProfilesPreflight,evidenceOrigin='collected',write=writePrivate}={}){
 const ownedRoot=rootIdentity(root);
 const assertRoot=()=>{if(!same(rootIdentity(root),ownedRoot))refuse('ownership_unverified');};
 const ownedFiles=new Map();
 const safeWrite=(path,value)=>{
  assertRoot();const absolute=resolve(path),base=resolve(root);
  if(!absolute.startsWith(base+sep))refuse('evidence_write_failed');
  let parent=base;
  for(const part of relative(base,dirname(absolute)).split(sep).filter(Boolean)){
   parent=join(parent,part);try{lstatSync(parent);}catch(error){if(error.code!=='ENOENT')throw error;mkdirSync(parent,{mode:0o700});}
   rootIdentity(parent);
  }
  let current;try{current=lstatSync(absolute);}catch(error){if(error.code!=='ENOENT')throw error;}
  const owned=ownedFiles.get(absolute);
  if(current&&(!owned||!current.isFile()||current.isSymbolicLink()||(current.mode&0o077)
   ||current.ino!==owned.ino||current.dev!==owned.dev))refuse('evidence_write_failed');
  if(!current&&owned)refuse('evidence_write_failed');
  write(path,value);assertRoot();ownedFiles.set(absolute,lstatSync(absolute));
 };
 const attempt=createLegacyAttempt(root,{policy:singlePolicy,targets:singleTargets,...singleReferences,
  evidenceOrigin,lifecycleEvidenceVersion:2,rootIdentity:ownedRoot,auditFailures:[],operationComplete:false},{write:safeWrite});
 ownedFiles.set(resolve(root,'report.json'),lstatSync(join(root,'report.json')));
 const report=attempt.state,timeline=[],absentPids=new Set();
 let guards=[],plan,source;
 const check=()=>{
  assertRoot();if(control.stopping)refuse('interrupted');
  if(source){try{requireGateSource(source,snapshotSource);}catch{refuse('source_changed',{phase:'source_check'});}}
  verifyLegacyGuards(guards);
  if(plan){
   verifyProfileDirectories(plan,io);verifyProfileOwnership(plan);
   const stale=join(profileRoot,staleTarget.profile+'.lock'),archive=join(root,'archived-worker.lock');
   if(!report.shutdownComplete&&present(archive))refuse('lock_archive_failed');
   if(present(stale)){
    if(!same(exactWorkerLock(stale),plan.lockExact))refuse('lock_archive_failed');
   }else if((report.stage!=='lock_archive'&&!report.archive)||!same(exactWorkerLock(archive),plan.lockExact))refuse('lock_archive_failed');
  }
 };
 const recordObservation=value=>{
  assertRoot();const reference=attempt.observation(value);
  timeline.push({type:'observation',reference});safeWrite(join(root,'timeline.json'),timeline);
  if(value.event==='decision'&&value.phase==='shutdown'&&value.analysis.passed)for(const pid of value.analysis.absentPids)absentPids.add(pid);
  return reference;
 };
 const record=value=>{
  assertRoot();attempt.event(value);timeline.push({type:'event',event:value});safeWrite(join(root,'timeline.json'),timeline);
 };
 const trackedRead=(read,options)=>{check();const value=read({...options,absentPids:[...absentPids]});check();return value;};
 const trackedIO={...io,snapshot:options=>trackedRead(io.snapshot,options),
  ...(io.shutdownSnapshot?{shutdownSnapshot:options=>trackedRead(io.shutdownSnapshot,options)}:{})};
 const snapshot=captured=>trackedIO.snapshot({captured,root:profileRoot,record:recordObservation,forbiddenPids:[4303]});
 const fail=(error,context={})=>attempt.fail(error,context);
 const finalCheck=async(category,operation)=>{
  try{return await operation();}catch(error){
   report.auditFailures.push({category,failure:legacyFailure(error,{phase:'final_audit',category:'audit_failed'})});
   // Keep an earlier operational failure first, even if evidence writing fails.
   fail(error,{phase:'final_audit',category:'audit_failed'});return null;
  }
 };
 try{
  safeWrite(join(root,'timeline.json'),timeline);
  attempt.stage('preparation');check();source=validateSinglePreparation(readPrivate(join(root,'pipeline.json')),{root,snapshot:snapshotSource});
  report.source=source;attempt.save();check();
  attempt.stage('target_validation');const evidence=loadEvidence();
  plan=validateSingleTargets(evidence,snapshot(evidence.processes),{root:profileRoot,io});check();
  safeWrite(join(root,'targets-before.json'),plan);
  attempt.stage('preservation_snapshot');const before=await audit('before',{root,plan,source});
  if(before?.passed!==true)refuse('audit_failed');check();
  attempt.stage('exclusive_guards');guards=acquireLegacyGuards(profileRoot,singleTargets);check();
  safeWrite(join(root,'guard-records.json'),guards.map(({path,token,...metadata})=>({path,...metadata,
   mtimeNs:String(lstatSync(path,{bigint:true}).mtimeNs),sha256:hash(token)})));
  const guarded=await audit('guarded',{root,plan,source});if(guarded?.passed!==true)refuse('audit_failed');check();
  revalidateSingle(plan,snapshot(plan.captured),{root:profileRoot,io});check();
  consumeMaintenance(root,source,singlePolicy);report.status='running';attempt.save();
  attempt.stage('browser_shutdown');await closeLegacyBrowsers(plan,{root:profileRoot,io:trackedIO,control,checkSource:check,record,recordObservation});check();
  report.shutdownComplete=true;attempt.stage('lock_archive');check();
  report.archive=archiveStaleLock(plan,{root:profileRoot,archive:join(root,'archived-worker.lock'),io:trackedIO,recordObservation});
  record({kind:'worker_lock_archived',sha256:report.archive.sha256});check();
  attempt.stage('guard_release');const ownedGuards=guards;guards=[];releaseLegacyGuards(ownedGuards);check();
  report.operationComplete=true;attempt.save();
 }catch(error){fail(error,{category:report.stage==='preparation'?'preparation_failed':'verification_failed'});}
 finally{
  if(guards.length){
   try{assertRoot();releaseLegacyGuards(guards);guards=[];}catch(error){report.guardReleaseFailed=true;fail(error,{phase:'guard_release',category:'guard_release_failed'});}
  }
  await finalCheck('local_cleanup_audit_failed',()=>{
   check();if(!plan)refuse('audit_failed');
   const value=auditLegacyCleanup(plan,{root:profileRoot,archive:join(root,'archived-worker.lock'),snapshot:trackedIO.snapshot,preflight,recordObservation});
   check();report.cleanup=value;return value;
  });
  await finalCheck('report_persistence_failed',()=>{assertRoot();attempt.save();});
  const independent=await finalCheck('independent_audit_failed',()=>{assertRoot();return audit('finish',{root,plan,source});});
  if(independent)report.independent=independent;
  if(independent?.passed!==true&&!report.auditFailures.some(f=>f.category==='independent_audit_failed')){
   await finalCheck('independent_audit_failed',()=>refuse('audit_failed'));
  }
  await finalCheck('final_source_or_ownership_failed',check);
  report.passed=report.operationComplete===true&&!report.failure&&!report.auditFailures.length&&independent?.passed===true;
  if(report.passed)report.status='complete';
  try{assertRoot();attempt.finish();}catch{report.passed=false;}
 }
 return report;
}
