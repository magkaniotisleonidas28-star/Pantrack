import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {parseProcessSnapshot} from './second-addition-cleanup.mjs';
import {LegacyVerificationError,legacyFailure,parseLegacyExecutables,reconcileLegacyObservation} from './legacy-profile-verification.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const reference=value=>typeof value==='string'&&/^observations\/\d{6}\.json$/.test(value);
export function parseMaintenanceIdentity(output){
 const rows=parseProcessSnapshot(output),lines=output.split('\n').filter(line=>line.trim());
 if(new Set(rows.map(p=>p.pid)).size!==rows.length)throw new LegacyVerificationError('process_observation_unavailable');
 return rows.map((p,i)=>{
  const m=lines[i].match(/^\s*\d+\s+\d+\s+\d+\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
  if(!m||!Number.isFinite(Date.parse(m[2])))throw new LegacyVerificationError('process_observation_unavailable');
  return {...p,state:m[1],start:m[2],startedMs:Date.parse(m[2]),startHash:hash(m[2]),commandHash:hash(p.command)};
 });
}
const validRows=rows=>Array.isArray(rows)&&rows.length>0&&rows.length<=20000&&new Set(rows.map(p=>p?.pid)).size===rows.length
 &&rows.every(p=>Number.isSafeInteger(p?.pid)&&p.pid>0&&Number.isSafeInteger(p.parent)&&p.parent>=0&&Number.isSafeInteger(p.group)&&p.group>0
  &&typeof p.command==='string'&&typeof p.start==='string'&&Number.isFinite(Date.parse(p.start))&&digest(p.identity)
  &&p.identity===hash(p.start+'\0'+p.command)&&typeof p.zombie==='boolean'&&typeof p.state==='string');
function sampleEvidence({before,details,after,captured,root,phase,complete,forbiddenPids,absentPids,canonical,evidenceOrigin}){
 const ids=new Set(captured.map(p=>p.pid)),groups=new Set(captured.map(p=>p.group)),all=[...before,...after];
 const scoped=new RegExp(escape(root)+'(?:[/\\\\\\s]|$)');
 for(const p of all)if(groups.has(p.group)||(/(?:^|\s)--user-data-dir(?:=|\s+)/.test(p.command)&&scoped.test(p.command)))ids.add(p.pid);
 let changed=true;while(changed){changed=false;for(const p of all)if(ids.has(p.parent)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
 for(const pid of forbiddenPids)ids.add(pid);
 const rows=list=>list.filter(p=>ids.has(p.pid)).map(p=>({pid:p.pid,parent:p.parent,group:p.group,identity:p.identity,
  startHash:hash(p.start),commandHash:hash(p.command),startedMs:Date.parse(p.start),state:p.state,zombie:p.zombie,
  profile:[...new Set(captured.map(p=>p.profile))].find(key=>digest(key)&&p.command.split(/\s+/).includes('--user-data-dir='+join(root,key)))??null}));
 return {version:2,event:'sample',phase,complete,evidenceOrigin,forbiddenPids,absentPids,
  baseline:captured.map(p=>({pid:p.pid,parent:p.parent,group:p.group,identity:p.identity,profile:p.profile,
   ...(Number.isFinite(p.startedMs)?{startedMs:p.startedMs}:{}),...(digest(p.startHash)?{startHash:p.startHash}:{}),
   ...(typeof p.executable==='string'?{executableHash:hash(p.executable)}:{})})),before:rows(before),after:rows(after),
  executables:details.filter(p=>ids.has(p.pid)).map(p=>{
   let canonicalHash;try{canonicalHash=hash(canonical(p.executable));}catch{}
   const identityRow=after.find(r=>r.pid===p.pid)??before.find(r=>r.pid===p.pid);
   return {pid:p.pid,startedMs:p.startedMs,startHash:hash(p.start),executableHash:hash(p.executable),canonicalHash,
    ...(identityRow?{identity:hash(p.start+'\0'+identityRow.command)}:{})};
  })};
}

// An observation verdict never grants signal authority. Strict reconciliation
// remains mandatory immediately before each individual signal.
export function analyzeMaintenanceSample(sample){
 const findings=[],fail=(category,p)=>({passed:false,findings,livePids:[],absentPids:[],failure:{category,phase:'reconciliation',
  ...(p?{pid:p.pid,...(digest(p.identity)?{observedIdentity:p.identity}:{})}:{})}});
 const unique=rows=>Array.isArray(rows)&&rows.every(p=>Number.isSafeInteger(p?.pid)&&p.pid>0)&&new Set(rows.map(p=>p.pid)).size===rows.length;
 if(sample?.version!==2||!['strict','shutdown'].includes(sample.phase)||!['simulated','collected'].includes(sample.evidenceOrigin)||sample.complete!==true
  ||!unique(sample.before)||!unique(sample.after)||!unique(sample.executables)||!unique(sample.baseline)
  ||!Array.isArray(sample.forbiddenPids)||!Array.isArray(sample.absentPids)
  ||(sample.phase==='shutdown'&&!sample.baseline.length))return fail('process_observation_unavailable');
 for(const p of sample.baseline)if(!digest(p.identity)||!digest(p.profile)||!Number.isSafeInteger(p.parent)||p.parent<0
  ||!Number.isSafeInteger(p.group)||p.group<1)return fail('process_observation_unavailable',p);
 for(const p of [...sample.before,...sample.after])if(![p.identity,p.startHash,p.commandHash].every(digest)||!Number.isFinite(p.startedMs)
  ||!Number.isSafeInteger(p.parent)||p.parent<0||!Number.isSafeInteger(p.group)||p.group<1||typeof p.zombie!=='boolean'||typeof p.state!=='string'
  ||p.zombie!==p.state.startsWith('Z'))return fail('process_observation_unavailable',p);
 for(const d of sample.executables)if(!digest(d.startHash)||!digest(d.executableHash)||!Number.isFinite(d.startedMs))return fail('executable_collection_failed',d);
 const known=new Map(sample.baseline.map(p=>[p.pid,p])),seen=[...sample.before,...sample.after,...sample.executables];
 const forbidden=seen.find(p=>sample.forbiddenPids.includes(p.pid)||sample.absentPids.includes(p.pid));if(forbidden)return fail('process_appeared',forbidden);
 const unknown=seen.find(p=>!known.has(p.pid));if(unknown)return fail('unexpected_membership',unknown);
 const live=[],absent=[];
 for(const old of sample.baseline){
  const a=sample.before.find(p=>p.pid===old.pid),b=sample.after.find(p=>p.pid===old.pid),d=sample.executables.find(p=>p.pid===old.pid);
  const denied=(category,p)=>{const result=fail(category,p??{pid:old.pid});result.failure.expectedIdentity=old.identity;return result;};
  if(!a&&(b||d))return denied('process_appeared',b??d);
  if(sample.phase==='shutdown'&&(!Number.isFinite(old.startedMs)||!digest(old.startHash)||!digest(old.executableHash)))return denied('process_observation_unavailable');
  for(const p of [a,b,d].filter(Boolean))if((Number.isFinite(old.startedMs)&&p.startedMs!==old.startedMs)||(digest(old.startHash)&&p.startHash!==old.startHash))return denied('executable_identity_changed',p);
  if([a,b].some(p=>p&&(p.group!==old.group||(p.parent!==old.parent&&p.parent!==1))))return denied('identity_changed',b??a);
  if(sample.phase==='strict'){
   if([a,b].some(p=>p&&(p.identity!==old.identity||p.zombie||p.profile!==old.profile)))return denied('identity_changed',b??a);
   if(b&&!d)return denied('executable_evidence_incomplete',b);
   if(d&&((digest(old.executableHash)&&d.executableHash!==old.executableHash)||d.canonicalHash!==d.executableHash
    ||((b??a)&&d.identity!==(b??a).identity)))return denied('executable_identity_changed',b??a??d);
  }else{
   const note=kind=>findings.push({pid:old.pid,kind});
   if([a,b].some(p=>p&&p.identity!==old.identity))note('command_identity_changed');
   if([a,b].some(p=>p&&p.profile!==old.profile))note('profile_reference_missing');
   if([a,b].some(p=>p&&(p.zombie||p.state.startsWith('Z'))))note('zombie');
   if(d&&d.executableHash!==old.executableHash)note('executable_text_changed');
   if(d&&!digest(d.canonicalHash))note('canonical_evidence_unavailable');
   else if(d&&d.canonicalHash!==d.executableHash)note('executable_noncanonical');
   if((a||b)&&!d){
    note('metadata_missing');
    if(b&&[a,b].filter(Boolean).every(p=>p.identity===old.identity&&!p.zombie&&p.profile===old.profile))return denied('executable_evidence_incomplete',b);
   }
  }
  if(b)live.push(old.pid);else absent.push(old.pid);
 }
 return {passed:true,findings,livePids:live,absentPids:absent,failure:null};
}

export function captureMaintenanceObservation({identitySnapshot,readExecutables,captured,root,record,canonical,
 phase='strict',forbiddenPids=[],absentPids=[],evidenceOrigin='collected'}){
 let before=[],details=[],after=[],stage='before_snapshot',collectionFailure;
 try{
  before=identitySnapshot();if(!validRows(before))throw new LegacyVerificationError('process_observation_unavailable',{phase:stage});
  stage='executable_snapshot';details=parseLegacyExecutables(readExecutables());
  stage='after_snapshot';after=identitySnapshot();if(!validRows(after))throw new LegacyVerificationError('process_observation_unavailable',{phase:stage});
 }catch(error){
  collectionFailure=error instanceof LegacyVerificationError?error:new LegacyVerificationError(stage==='executable_snapshot'?'executable_collection_failed':'process_collection_failed',{phase:stage,code:error?.code});
  collectionFailure.context={...collectionFailure.context,phase:collectionFailure.context.phase??stage};
 }
 const sample=sampleEvidence({before:validRows(before)?before:[],details,after:validRows(after)?after:[],captured,root,phase,
  complete:!collectionFailure,forbiddenPids,absentPids,canonical,evidenceOrigin});
 sample.collectionStage=stage;if(collectionFailure)sample.collectionFailure=legacyFailure(collectionFailure);
 let sampleReference;
 try{sampleReference=record(sample);if(!reference(sampleReference))throw Error();}
 catch{
  const failure=collectionFailure??new LegacyVerificationError('evidence_write_failed',{phase:stage});
  if(collectionFailure)failure.secondaryFailures=[{category:'evidence_write_failed',phase:stage}];throw failure;
 }
 let analysis,rows;
 try{
  if(collectionFailure)throw collectionFailure;
  // Preserve the existing strict policy as a separate, unchanged verifier.
  if(phase==='strict')rows=reconcileLegacyObservation({before,details,after,captured,root,forbiddenPids:[...forbiddenPids,...absentPids]});
  analysis=analyzeMaintenanceSample(sample);
  if(!analysis.passed)throw new LegacyVerificationError(analysis.failure.category,{...analysis.failure,reference:sampleReference});
 }catch(error){
  const failure=error instanceof LegacyVerificationError?error:new LegacyVerificationError('verification_failed',{phase:'reconciliation'});
  analysis??={passed:false,findings:[],livePids:[],absentPids:[],failure:legacyFailure(failure)};
  failure.context={...failure.context,reference:sampleReference};
  try{const decisionReference=record({version:2,event:'decision',phase,sampleReference,outcome:'blocked',analysis,failure:legacyFailure(failure)});
   if(!reference(decisionReference))throw Error();failure.context.reference=decisionReference;
  }catch{failure.secondaryFailures=[...(failure.secondaryFailures??[]),{category:'evidence_write_failed',phase:'reconciliation',reference:sampleReference}];}
  throw failure;
 }
 let decisionReference;
 try{decisionReference=record({version:2,event:'decision',phase,sampleReference,outcome:'verified',analysis});if(!reference(decisionReference))throw Error();}
 catch{throw new LegacyVerificationError('evidence_write_failed',{phase:'reconciliation',reference:sampleReference});}
 if(phase==='strict')return rows;
 return {live:after.filter(p=>analysis.livePids.includes(p.pid)).map(p=>({...p,profile:captured.find(old=>old.pid===p.pid).profile})),
  absentPids:analysis.absentPids,analysis,reference:decisionReference};
}
