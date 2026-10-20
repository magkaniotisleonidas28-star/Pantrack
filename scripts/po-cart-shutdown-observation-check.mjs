import {spawn} from 'node:child_process';
import {openSync,closeSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {requireGateSource,fileHash} from './po-cart-worker/acceptance-gate.mjs';
import {readPrivate,writePrivate} from './po-cart-worker/private-files.mjs';
import {createLegacyAttempt,LegacyVerificationError} from './po-cart-worker/legacy-profile-verification.mjs';
import {diagnosisRoot as root,diagnosisPolicy,diagnosisCases,historicalObservation,historicalObservationHash,
 validateDiagnosisPreparation,consumeDiagnosis,runDiagnosticTrial,runDiagnosisMatrix,finalizeDiagnosticReport,DiagnosisError} from './po-cart-worker/shutdown-observation-diagnosis.mjs';

if(process.argv.length!==2)throw Error('Shutdown diagnosis accepts no arguments, overrides or resume.');
if(existsSync(root+'/report.json')||existsSync(root+'/diagnosis.json'))throw Error('Diagnosis already attempted; no retry or resume.');
if(realpathSync(root)!==resolve(root)||(lstatSync(root).mode&0o077))throw Error('Fixed private diagnosis root required.');
const attempt=createLegacyAttempt(root,{policy:diagnosisPolicy,matrix:diagnosisCases,results:[],
 historicalReference:{path:historicalObservation,sha256:historicalObservationHash}});
const report=attempt.state,control={stopping:false};let source;
const interrupted=()=>{control.stopping=true;};process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
const checkSource=()=>requireGateSource(source);
const audit=(operation,name)=>new Promise((ok,no)=>{
 const fd=openSync(root+'/'+name+'.log','wx',0o600),code="import importlib.util; s=importlib.util.spec_from_file_location('a','scripts/po-cart-worker/shutdown-observation-audit.py'); a=importlib.util.module_from_spec(s); s.loader.exec_module(a); "+operation;
 const child=spawn('python3',['-c',code],{stdio:['ignore',fd,fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});closeSync(fd);
 child.once('error',no);child.once('exit',status=>status===0?ok():no(new DiagnosisError('independent_audit_failed')));
});
try{
 attempt.stage('preparation');source=validateDiagnosisPreparation(readPrivate(root+'/pipeline.json'));report.source=source;
 if(fileHash(historicalObservation)!==historicalObservationHash)throw new DiagnosisError('historical_reference_changed');
 attempt.stage('preservation_snapshot');await audit("a.before()",'before-diagnosis');checkSource();
 if(control.stopping)throw new DiagnosisError('interrupted');
 const before=readPrivate(root+'/historical-processes-before.json'),forbiddenPids=[4303,...before.processes.map(p=>p.pid)];
 consumeDiagnosis(root,source);report.status='running';attempt.save();attempt.stage('browser_shutdown');
 const result=await runDiagnosisMatrix({control,checkSource,
  runTrial:spec=>runDiagnosticTrial(spec,{root,forbiddenPids,checkSource,control,
   recordEvent:event=>attempt.event(event),saveCase:(reference,value)=>writePrivate(root+'/'+reference,value)}),
  recordResult:result=>{report.results.push(result);attempt.save();console.log(`CASE ${report.results.length}/12 ${result.id}: ${result.completed?'complete':'blocked'}; signature=${result.signatureObserved}`);}});
 report.status=result.status;report.matrixComplete=result.results.length===12&&result.results.every(r=>r.completed);
 if(result.status==='blocked')report.diagnosisFailure=report.results.at(-1)?.failure??{category:control.stopping?'interrupted':'fixture_cleanup_unverified'};
 if(report.diagnosisFailure)report.primaryFailure??=report.diagnosisFailure;
 attempt.save();attempt.stage('final_audit');await audit("a.finish()",'independent-audit');checkSource();
 if(control.stopping)throw new DiagnosisError('interrupted');
 finalizeDiagnosticReport(report,readPrivate(root+'/verification-summary.json'));
}catch(error){
 report.diagnosisFailure??={category:error instanceof DiagnosisError?error.category:'diagnosis_operation_failed'};
 report.primaryFailure??=report.diagnosisFailure;
 if(report.stage==='final_audit')report.auditFailures=[...(report.auditFailures??[]),{category:error instanceof DiagnosisError?error.category:'independent_audit_failed'}];
 attempt.fail(new LegacyVerificationError(control.stopping?'interrupted':'audit_failed'));
}finally{
 try{attempt.finish();}catch{process.exitCode=1;}
 process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);
}
console.log(`${report.passed?'PASS':'BLOCKED'} shutdown diagnosis: ${report.status}. Private evidence: ${root}/report.json`);
if(!report.passed)process.exitCode=1;
