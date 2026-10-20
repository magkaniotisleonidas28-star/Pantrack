import {createHash,randomUUID} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,lstatSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {writePrivate} from './private-files.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const identityPattern=/^[a-f0-9]{64}$/;
const categories=new Set(['process_collection_failed','executable_collection_failed','process_observation_unavailable',
 'unexpected_membership','identity_changed','process_appeared','executable_evidence_incomplete','executable_identity_changed',
 'ownership_unverified','guard_ownership_changed','guard_release_failed','signal_failed','exit_timeout','interrupted',
 'source_changed','lock_archive_failed','audit_failed','verification_failed','invocation_consumed','evidence_write_failed',
 'preparation_failed','target_validation_failed']);
const phases=new Set(['before_snapshot','executable_snapshot','after_snapshot','reconciliation','target_validation',
 'preservation_snapshot','profile_snapshot','exclusive_guards','browser_shutdown','lock_archive','guard_release',
 'final_audit','preparation','source_check','report_creation','finished']);
const nativeCodes=new Set(['EACCES','EPERM','ENOENT','EEXIST','EIO','ENOSPC','EBADF','EINTR','ESRCH']);
export class LegacyVerificationError extends Error{
 constructor(category,context={},message=category){
  super(message);this.category=categories.has(category)?category:'verification_failed';
  this.context=context;
 }
}
export function legacyFailure(error,{phase='reconciliation',category='verification_failed',reference}={}){
 const context=error instanceof LegacyVerificationError?error.context:{};
 const result={category:error instanceof LegacyVerificationError?error.category:categories.has(category)?category:'verification_failed',
  phase:phases.has(context.phase)?context.phase:phases.has(phase)?phase:'reconciliation'};
 if(Number.isSafeInteger(context.pid)&&context.pid>0)result.pid=context.pid;
 for(const key of ['expectedIdentity','observedIdentity'])if(identityPattern.test(context[key]))result[key]=context[key];
 const ref=context.reference??reference;
 if(typeof ref==='string'&&/^observations\/\d{6}\.json$/.test(ref))result.reference=ref;
 const code=error?.code??context.code;if(nativeCodes.has(code))result.code=code;
 if(identityPattern.test(context.profile))result.profile=context.profile;
 return result;
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const validRows=rows=>Array.isArray(rows)&&rows.length>0&&rows.length<=20000&&new Set(rows.map(p=>p.pid)).size===rows.length
 &&rows.every(p=>Number.isSafeInteger(p.pid)&&p.pid>0&&Number.isSafeInteger(p.parent)&&p.parent>=0
  &&Number.isSafeInteger(p.group)&&p.group>0&&typeof p.command==='string'&&identityPattern.test(p.identity));
function relevantIds(before,after,captured,root){
 const ids=new Set(captured.map(p=>p.pid)),groups=new Set(captured.map(p=>p.group));
 const scoped=new RegExp(escape(root)+'(?:[/\\\\\\s]|$)');
 const rows=[...(before??[]),...(after??[])];let changed=true;
 for(const p of rows)if(groups.has(p.group)||(/(?:^|\s)--user-data-dir(?:=|\s+)/.test(p.command)&&scoped.test(p.command)))ids.add(p.pid);
 while(changed){changed=false;for(const p of rows)if(ids.has(p.parent)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
 ids.add(4303);return ids;
}
export function parseLegacyExecutables(output){
 const result=[];
 for(const line of output.split('\n').filter(s=>s.trim())){
  const m=line.match(/^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
  if(!m||!m[3]||!Number.isFinite(Date.parse(m[2])))throw new LegacyVerificationError('executable_collection_failed',{phase:'executable_snapshot'});
  result.push({pid:Number(m[1]),start:m[2],startedMs:Date.parse(m[2]),executable:m[3]});
 }
 if(!result.length||new Set(result.map(p=>p.pid)).size!==result.length)throw new LegacyVerificationError('executable_collection_failed',{phase:'executable_snapshot'});
 return result;
}

// Keep identity snapshots separate. A missing metadata row is never itself
// evidence of exit; only absence from the final complete identity snapshot is.
export function reconcileLegacyObservation({before,details,after,captured,root,forbiddenPids=[]}){
 if(!validRows(before)||!validRows(after)||!Array.isArray(details))throw new LegacyVerificationError('process_observation_unavailable');
 for(const pid of forbiddenPids)if([...before,...details,...after].some(p=>p.pid===pid))throw new LegacyVerificationError('process_appeared',{pid});
 const relevant=relevantIds(before,after,captured,root),expected=new Map(captured.map(p=>[p.pid,p])),first=new Map(before.map(p=>[p.pid,p]));
 const last=new Map(after.map(p=>[p.pid,p])),metadata=new Map(details.map(p=>[p.pid,p]));
 if(metadata.size!==details.length)throw new LegacyVerificationError('executable_collection_failed');
 for(const pid of relevant){
  const a=first.get(pid),b=last.get(pid),old=expected.get(pid),context={pid,expectedIdentity:old?.identity,observedIdentity:(b??a)?.identity};
  if(!a&&!b)continue;
  const scoped=p=>p&&/(?:^|\s)--user-data-dir(?:=|\s+)/.test(p.command)&&new RegExp(escape(root)+'(?:[/\\\\\\s]|$)').test(p.command);
  if(!old&&(pid!==4303||scoped(a)||scoped(b)))throw new LegacyVerificationError('unexpected_membership',context);
  // Validate both observations, including a changed process that exits before
  // the final read. Disappearance cannot erase identity or membership evidence.
  const mismatch=old&&[a,b].find(p=>p&&(p.identity!==old.identity||p.group!==old.group||p.zombie||(p.parent!==old.parent&&p.parent!==1)));
  if(mismatch||(a&&b&&a.identity!==b.identity))throw new LegacyVerificationError('identity_changed',{
   ...context,expectedIdentity:old?.identity??a.identity,observedIdentity:mismatch?.identity??b.identity});
  if(!a&&b)throw new LegacyVerificationError('process_appeared',context);
  const d=metadata.get(pid);
  if(!b){
   if(d&&(hash(d.start+'\0'+a.command)!==a.identity||(old?.executable!==undefined&&d.executable!==old.executable)))throw new LegacyVerificationError('executable_identity_changed',{
    ...context,expectedIdentity:old?.identity??a.identity,observedIdentity:hash(d.start+'\0'+a.command)});
   continue;
  }
  if(!d||typeof d.start!=='string'||!Number.isFinite(d.startedMs)||!d.executable)throw new LegacyVerificationError('executable_evidence_incomplete',context);
  const metadataIdentity=hash(d.start+'\0'+b.command);
  if(metadataIdentity!==b.identity||(old?.startedMs!==undefined&&d.startedMs!==old.startedMs)
   ||(old?.executable!==undefined&&d.executable!==old.executable))throw new LegacyVerificationError('executable_identity_changed',{
    ...context,expectedIdentity:old?.identity??b.identity,observedIdentity:metadataIdentity});
 }
 return after.map(p=>({...p,...(metadata.has(p.pid)?{executable:metadata.get(p.pid).executable,startedMs:metadata.get(p.pid).startedMs}:{})}));
}
function observationEvidence({before=[],details=[],after=[],captured,root}){
 const ids=relevantIds(before,after,captured,root),known=new Set(captured.map(p=>p.profile)),last=new Map(after.map(p=>[p.pid,p]));
 const profile=p=>[...known].find(key=>identityPattern.test(key)&&new RegExp('(?:^|\\s)--user-data-dir(?:=|\\s+)'+escape(join(root,key))+'(?=\\s|$)').test(p.command))??null;
 const rows=list=>list.filter(p=>ids.has(p.pid)).map(p=>({pid:p.pid,parent:p.parent,group:p.group,identity:p.identity,profile:profile(p),zombie:p.zombie===true}));
 return {version:1,before:rows(before),after:rows(after),executables:details.filter(d=>ids.has(d.pid)).map(d=>({pid:d.pid,startedMs:d.startedMs,
  executableHash:hash(d.executable),identity:hash(d.start+'\0'+(last.get(d.pid)??before.find(p=>p.pid===d.pid))?.command)})),
  exited:validRows(after)?before.filter(p=>ids.has(p.pid)&&!last.has(p.pid)).map(p=>({pid:p.pid,identity:p.identity})):[]};
}
export function captureLegacyObservation({identitySnapshot,readExecutables,captured,root,record=()=>{},forbiddenPids=[]}){
 let before=[],details=[],after=[],phase='before_snapshot',failure;
 try{
  before=identitySnapshot();if(!validRows(before))throw new LegacyVerificationError('process_observation_unavailable',{phase});
  phase='executable_snapshot';details=parseLegacyExecutables(readExecutables());
  phase='after_snapshot';after=identitySnapshot();if(!validRows(after))throw new LegacyVerificationError('process_observation_unavailable',{phase});
  phase='reconciliation';const rows=reconcileLegacyObservation({before,details,after,captured,root,forbiddenPids});
  try{record({...observationEvidence({before,details,after,captured,root}),outcome:'verified'});}catch{throw new LegacyVerificationError('evidence_write_failed',{phase});}
  return rows;
 }catch(error){
  failure=error instanceof LegacyVerificationError?error:new LegacyVerificationError(phase==='executable_snapshot'?'executable_collection_failed':'process_collection_failed',{phase,code:error?.code});
  try{
   const reference=record({...observationEvidence({before:validRows(before)?before:[],details,after:validRows(after)?after:[],captured,root}),outcome:'blocked',failure:legacyFailure(failure,{phase})});
   failure.context={...failure.context,phase:failure.context.phase??phase,reference};
  }catch{failure.secondaryFailures=[{category:'evidence_write_failed',phase}];}
  throw failure;
 }
}
function exclusiveJson(path,value){
 const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
}
function syncDirectory(root){const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}

// The exclusive report is an attempt marker, not the consumed task invocation.
// A losing launcher never owns this report and must never enter finalization.
export function createLegacyAttempt(root,initial,{write=writePrivate,now=()=>new Date().toISOString()}={}){
 if(existsSync(join(root,'task.json')))throw new LegacyVerificationError('invocation_consumed');
 const path=join(root,'report.json'),state={...initial,version:2,attemptId:randomUUID(),status:'validating',passed:false,events:[],failures:[],startedAt:now()};
 try{exclusiveJson(path,state);}catch(error){
  if(error.code==='EEXIST')throw new LegacyVerificationError('invocation_consumed',{phase:'report_creation'});
  throw new LegacyVerificationError('evidence_write_failed',{phase:'report_creation'});
 }
 syncDirectory(root);let owner=lstatSync(path),sequence=0,emergency=0;
 const append=failure=>{
  state.failures.push(failure);state.failure??=failure;state.status=failure.category==='interrupted'?'interrupted':'blocked';state.passed=false;
 };
 const persist=()=>{
  try{
   const current=lstatSync(path);if(!current.isFile()||current.isSymbolicLink()||current.ino!==owner.ino||current.dev!==owner.dev)throw new LegacyVerificationError('evidence_write_failed');
   write(path,state);owner=lstatSync(path);
  }catch(error){
   append(legacyFailure(error,{phase:state.stage,category:'evidence_write_failed'}));
   // Independent exclusive fallback retains the primary failure if an atomic
   // report update fails. Never overwrite another attempt's report or fallback.
   const fallback=++emergency===1?'failure-report.json':'failure-report-'+String(emergency).padStart(6,'0')+'.json';
   try{exclusiveJson(join(root,fallback),state);syncDirectory(root);}catch{}
   throw new LegacyVerificationError('evidence_write_failed',{phase:state.stage});
  }
 };
 return {state,
  stage(name){state.stage=name;persist();},
  event(event){state.events.push({...event,at:now()});persist();},
  observation(value){const reference='observations/'+String(++sequence).padStart(6,'0')+'.json';
   try{write(join(root,reference),value);}catch{throw new LegacyVerificationError('evidence_write_failed',{phase:state.stage});}
   state.lastObservation=reference;return reference;
  },
  fail(error,context={}){
   append(legacyFailure(error,{phase:state.stage,reference:state.lastObservation,...context}));
   for(const failure of error?.secondaryFailures??[])append(legacyFailure(new LegacyVerificationError(failure.category,failure)));
  },
  save:persist,
  finish(){state.finishedAt=now();persist();}
 };
}
