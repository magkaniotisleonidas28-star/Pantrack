import {spawn} from 'node:child_process';
import {openSync,closeSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {validatePreparation,requireGateSource} from './po-cart-worker/acceptance-gate.mjs';
import {writePrivate,readPrivate} from './po-cart-worker/private-files.mjs';
import {maintenanceRoot,historicalEvidence,historicalEvidenceHash,loadHistoricalTargets,legacySnapshot,
 validateLegacyTargets,acquireLegacyGuards,releaseLegacyGuards,consumeMaintenance,closeLegacyBrowsers,
 archiveStaleLock,auditLegacyCleanup,verifyLegacyGuards,verifyPopulation,lockRecord,staleTarget,
 verifyProfileDirectories,verifyProfileOwnership} from './po-cart-worker/legacy-profile-cleanup.mjs';
import {createLegacyAttempt,LegacyVerificationError} from './po-cart-worker/legacy-profile-verification.mjs';

if(process.argv.length!==2)throw Error('Single-use legacy maintenance accepts no arguments, overrides or resume.');
if(existsSync(maintenanceRoot+'/task.json')||existsSync(maintenanceRoot+'/report.json'))throw Error('Maintenance already attempted; no resume or retry.');
if(realpathSync(maintenanceRoot)!==resolve(maintenanceRoot)||(lstatSync(maintenanceRoot).mode&0o077))throw Error('Fixed private maintenance root required.');
const attempt=createLegacyAttempt(maintenanceRoot,{historicalEvidence:{path:historicalEvidence,sha256:historicalEvidenceHash}});
const report=attempt.state,control={stopping:false};
let guards=[],capturedPlan,source;
const checkSource=()=>{
 if(control.stopping)throw new LegacyVerificationError('interrupted');
 try{requireGateSource(source);}catch{throw new LegacyVerificationError('source_changed',{phase:'source_check'});}
 verifyLegacyGuards(guards);
 if(capturedPlan){verifyProfileDirectories(capturedPlan);verifyProfileOwnership(capturedPlan);}
};
const save=()=>attempt.save();
const recordObservation=value=>attempt.observation(value);
const interrupted=()=>{control.stopping=true;};
process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
const python=(code,name)=>new Promise((ok,no)=>{
 const path=maintenanceRoot+'/'+name+'.log',fd=openSync(path,'wx',0o600);
 const child=spawn('python3',code?['-c',code]:['scripts/po-cart-worker/legacy-profile-audit.py'],{stdio:['ignore',fd,fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});closeSync(fd);
 child.once('error',no);child.once('exit',status=>status===0?ok():no(Error('Independent evidence check failed.')));
});
const importAudit="import importlib.util; s=importlib.util.spec_from_file_location('audit','scripts/po-cart-worker/legacy-profile-audit.py'); a=importlib.util.module_from_spec(s); s.loader.exec_module(a); ";
try{
 // The exclusive report prevents competing launches; task.json is consumed
 // only after successful preparation, validation and preservation snapshots.
 attempt.stage('preparation');source=validatePreparation(readPrivate(maintenanceRoot+'/pipeline.json'));report.source=source;
 attempt.stage('target_validation');checkSource();const evidence=loadHistoricalTargets();
 const initial=validateLegacyTargets(evidence,legacySnapshot({captured:evidence.processes,record:recordObservation}));capturedPlan=initial;writePrivate(maintenanceRoot+'/targets-before.json',initial);
 attempt.stage('preservation_snapshot');await python(importAudit+"a.save('preservation-before-cleanup.json', a.audit_preservation())",'preservation-before-cleanup');checkSource();
 attempt.stage('profile_snapshot');await python(importAudit+"a.save('profiles-before.json', a.fingerprint())",'profiles-before');checkSource();
 attempt.stage('exclusive_guards');guards=acquireLegacyGuards();
 // Guards are now task-owned. Revalidation must not treat our own guards as a
 // competing owner; recheck population and lock evidence against the exact plan.
 const rows=legacySnapshot({captured:initial.captured,record:recordObservation});verifyPopulation(rows,initial.captured);
 if(rows.filter(p=>initial.captured.some(c=>c.pid===p.pid)).length!==initial.captured.length
  ||JSON.stringify(lockRecord(resolve('.sites-runtime/po-cart-workers/browser-profiles',staleTarget.profile+'.lock')))!==JSON.stringify(initial.lock)
  ||rows.find(p=>p.pid===4303)?.identity!==initial.untouched.identity)throw new LegacyVerificationError('target_validation_failed');
 checkSource();verifyProfileOwnership(initial,{beforeShutdown:true});consumeMaintenance(maintenanceRoot,source);report.status='running';save();
 const record=event=>attempt.event(event);
 attempt.stage('browser_shutdown');await closeLegacyBrowsers(initial,{control,checkSource,record,recordObservation});checkSource();
 attempt.stage('lock_archive');report.archive=archiveStaleLock(initial,{recordObservation});record({kind:'worker_lock_archived',sha256:report.archive.sha256});
 attempt.stage('guard_release');releaseLegacyGuards(guards);guards=[];checkSource();
 attempt.stage('final_audit');report.cleanup=auditLegacyCleanup(initial,{recordObservation});save();
 await python(null,'independent-audit');checkSource();
 report.independent=readPrivate(maintenanceRoot+'/verification-summary.json');
 if(!report.independent.passed)throw new LegacyVerificationError('audit_failed');
 // The independent auditor hashes profiles twice; confirm idle again afterward.
 report.cleanup=auditLegacyCleanup(initial,{recordObservation});report.status='complete';report.passed=true;
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
console.log(`${report.passed?'PASS':'BLOCKED'} legacy maintenance: ${report.status}. Private evidence: ${maintenanceRoot}/report.json`);
if(!report.passed)process.exitCode=1;
