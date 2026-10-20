import {spawn} from 'node:child_process';
import {openSync,closeSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {validatePreparation,requireGateSource} from './po-cart-worker/acceptance-gate.mjs';
import {writePrivate,readPrivate} from './po-cart-worker/private-files.mjs';
import {historicalEvidence,historicalEvidenceHash,legacySnapshot,acquireLegacyGuards,releaseLegacyGuards,
 consumeMaintenance,closeLegacyBrowsers,archiveStaleLock,auditLegacyCleanup,verifyLegacyGuards,
 verifyProfileDirectories,verifyProfileOwnership} from './po-cart-worker/legacy-profile-cleanup.mjs';
import {remainingRoot as root,remainingPolicy,remainingTargets,loadRemainingEvidence,validateRemainingTargets,
 revalidateRemaining,lockEvidence,lockEvidenceHash} from './po-cart-worker/remaining-profile-cleanup.mjs';
import {createLegacyAttempt,LegacyVerificationError} from './po-cart-worker/legacy-profile-verification.mjs';

if(process.argv.length!==2)throw Error('Single-use remaining maintenance accepts no arguments, overrides or resume.');
if(existsSync(root+'/task.json')||existsSync(root+'/report.json'))throw Error('Maintenance already attempted; no resume or retry.');
if(realpathSync(root)!==resolve(root)||(lstatSync(root).mode&0o077))throw Error('Fixed private maintenance root required.');
const attempt=createLegacyAttempt(root,{policy:remainingPolicy,
 historicalEvidence:{path:historicalEvidence,sha256:historicalEvidenceHash},lockEvidence:{path:lockEvidence,sha256:lockEvidenceHash}});
const report=attempt.state,control={stopping:false};
let guards=[],plan,source;
const checkSource=()=>{
 if(control.stopping)throw new LegacyVerificationError('interrupted');
 try{requireGateSource(source);}catch{throw new LegacyVerificationError('source_changed',{phase:'source_check'});}
 verifyLegacyGuards(guards);
 if(plan){verifyProfileDirectories(plan);verifyProfileOwnership(plan);}
};
const recordObservation=value=>attempt.observation(value),record=value=>attempt.event(value);
const snapshot=()=>legacySnapshot({captured:plan.captured,record:recordObservation,forbiddenPids:[4303]});
const interrupted=()=>{control.stopping=true;};
process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
const python=(code,name)=>new Promise((ok,no)=>{
 const fd=openSync(root+'/'+name+'.log','wx',0o600);
 const child=spawn('python3',code?['-c',code]:['scripts/po-cart-worker/remaining-profile-audit.py'],
  {stdio:['ignore',fd,fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});closeSync(fd);
 child.once('error',no);child.once('exit',status=>status===0?ok():no(new LegacyVerificationError('audit_failed')));
});
const importAudit="import importlib.util; s=importlib.util.spec_from_file_location('audit','scripts/po-cart-worker/remaining-profile-audit.py'); a=importlib.util.module_from_spec(s); s.loader.exec_module(a); ";
const auditOptions={archive:root+'/archived-worker.lock',recordObservation};
try{
 attempt.stage('preparation');source=validatePreparation(readPrivate(root+'/pipeline.json'));report.source=source;
 attempt.stage('target_validation');checkSource();const evidence=loadRemainingEvidence();
 plan=validateRemainingTargets(evidence,legacySnapshot({captured:evidence.processes,record:recordObservation,forbiddenPids:[4303]}));
 writePrivate(root+'/targets-before.json',plan);
 attempt.stage('preservation_snapshot');await python(importAudit+"a.save('preservation-before-cleanup.json', a.audit_preservation()); a.audit_worker_locks(before=True)",'preservation-before-cleanup');checkSource();
 attempt.stage('profile_snapshot');await python(importAudit+"a.save('profiles-before.json', a.fingerprint())",'profiles-before');checkSource();
 attempt.stage('exclusive_guards');guards=acquireLegacyGuards(undefined,remainingTargets);
 revalidateRemaining(plan,snapshot());checkSource();
 consumeMaintenance(root,source,remainingPolicy);report.status='running';attempt.save();
 attempt.stage('browser_shutdown');await closeLegacyBrowsers(plan,{control,checkSource,record,recordObservation});checkSource();
 attempt.stage('lock_archive');report.archive=archiveStaleLock(plan,auditOptions);record({kind:'worker_lock_archived',sha256:report.archive.sha256});
 attempt.stage('guard_release');releaseLegacyGuards(guards);guards=[];checkSource();
 attempt.stage('final_audit');report.cleanup=auditLegacyCleanup(plan,auditOptions);attempt.save();
 await python(null,'independent-audit');checkSource();report.independent=readPrivate(root+'/verification-summary.json');
 if(!report.independent.passed)throw new LegacyVerificationError('audit_failed');
 report.cleanup=auditLegacyCleanup(plan,auditOptions);report.status='complete';report.passed=true;
}catch(error){
 const category={preparation:'preparation_failed',target_validation:'target_validation_failed',preservation_snapshot:'audit_failed',
  profile_snapshot:'audit_failed',exclusive_guards:'ownership_unverified',browser_shutdown:'ownership_unverified',
  lock_archive:'lock_archive_failed',guard_release:'guard_release_failed',final_audit:'audit_failed'}[report.stage];
 attempt.fail(error,{category});
}finally{
 try{if(guards.length)releaseLegacyGuards(guards);}catch(error){report.guardReleaseFailed=true;attempt.fail(error,{phase:'guard_release',category:'guard_release_failed'});}
 try{attempt.finish();}catch{process.exitCode=1;}
 process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);
}
console.log(`${report.passed?'PASS':'BLOCKED'} remaining maintenance: ${report.status}. Private evidence: ${root}/report.json`);
if(!report.passed)process.exitCode=1;
