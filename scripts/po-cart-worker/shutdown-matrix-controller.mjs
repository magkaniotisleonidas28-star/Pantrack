import {spawn} from 'node:child_process';
import {openSync,closeSync,existsSync,realpathSync,lstatSync,writeFileSync,fsyncSync} from 'node:fs';
import {resolve} from 'node:path';
import {requireGateSource,fileHash} from './acceptance-gate.mjs';
import {readPrivate,writePrivate} from './private-files.mjs';
import {createLegacyAttempt,LegacyVerificationError} from './legacy-profile-verification.mjs';
import {diagnosisCases,historicalObservation,historicalObservationHash,validateDiagnosisPreparation,
 runDiagnosticTrial,runDiagnosisMatrix,finalizeDiagnosticReport,DiagnosisError} from './shutdown-observation-diagnosis.mjs';

// Internal bindings only. Public entrypoints expose no binding overrides.
export function createShutdownMatrixController({root,policy,auditAdapter,requireCollected=false}){
function createMatrixAttempt(args=[]){
 if(args.length)throw new DiagnosisError('arguments_forbidden');
 if(existsSync(root+'/report.json')||existsSync(root+'/diagnosis.json'))throw new DiagnosisError('invocation_consumed');
 if(realpathSync(root)!==resolve(root)||!lstatSync(root).isDirectory()||(lstatSync(root).mode&0o077))
  throw new DiagnosisError('private_matrix_root_required');
 return createLegacyAttempt(root,{policy,lifecycleEvidenceVersion:2,matrix:diagnosisCases,results:[],
  historicalReference:{path:historicalObservation,sha256:historicalObservationHash}});
}

function consumeMatrix(source){
 const fd=openSync(root+'/diagnosis.json','wx',0o600);
 try{writeFileSync(fd,JSON.stringify({policy,source,cases:diagnosisCases,startedAt:new Date().toISOString()})+'\n');fsyncSync(fd);}
 finally{closeSync(fd);}
 const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}

function independentAudit(operation){
 return new Promise((ok,no)=>{
  const fd=openSync(root+'/'+(operation==='before'?'before-matrix':'independent-audit')+'.log','wx',0o600);
  let child;
  try{child=spawn('python3',[auditAdapter,operation],
   {stdio:['ignore',fd,fd],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}finally{closeSync(fd);}
  child.once('error',()=>no(new DiagnosisError('independent_audit_failed')));
  child.once('exit',status=>status===0?ok():no(new DiagnosisError('independent_audit_failed')));
 });
}

// Dependencies are injected only by offline tests. The CLI never accepts a root,
// policy, case filter, alternate source, resume option or environment override.
async function runFreshMatrix({args=[],operations={}}={}){
 const attempt=createMatrixAttempt(args),report=attempt.state,control={stopping:false};
 const interrupted=()=>{control.stopping=true;};process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
 let source,consumed=false,snapshotValidated=false;
 const checkSource=()=>{
  try{(operations.checkSource??requireGateSource)(source);}catch{throw new DiagnosisError('source_changed');}
 };
 const audit=operations.audit??independentAudit;
 const failure=error=>({category:error instanceof DiagnosisError?error.category:'matrix_operation_failed',
  ...(Number.isSafeInteger(error?.pid)?{pid:error.pid}:{})});
 const block=error=>{
  report.diagnosisFailure??=failure(error);report.primaryFailure??=report.diagnosisFailure;
  report.status='blocked';report.passed=false;
  attempt.fail(new LegacyVerificationError(control.stopping?'interrupted':'audit_failed'));
 };
 try{
  attempt.stage('preparation');
  source=(operations.validatePreparation??validateDiagnosisPreparation)(readPrivate(root+'/pipeline.json'));report.source=source;
  (operations.verifyHistoricalReference??(()=>{
   if(fileHash(historicalObservation)!==historicalObservationHash)throw new DiagnosisError('historical_reference_changed');
  }))();
  attempt.stage('preservation_snapshot');await audit('before');snapshotValidated=true;checkSource();
  if(control.stopping)throw new DiagnosisError('interrupted');
  const before=readPrivate(root+'/historical-processes-before.json'),forbiddenPids=[4303,...before.processes.map(p=>p.pid)];
  consumeMatrix(source);consumed=true;report.status='running';attempt.save();attempt.stage('browser_shutdown');
  const result=await runDiagnosisMatrix({control,checkSource,
   runTrial:spec=>(operations.runTrial??runDiagnosticTrial)(spec,{root,forbiddenPids,checkSource,control,
    recordEvent:event=>attempt.event(event),saveCase:(reference,value)=>writePrivate(root+'/'+reference,value)}),
   recordResult:value=>{report.results.push(value);attempt.save();
    if(value.lifecycleEvidenceVersion!==2)throw new DiagnosisError('lifecycle_evidence_missing');
    if(requireCollected&&value.evidenceOrigin!=='collected')throw new DiagnosisError('lifecycle_evidence_missing');
    console.log(`CASE ${report.results.length}/12 ${value.id}: ${value.completed?'complete':'blocked'}; signature=${value.signatureObserved}`);}});
  report.status=result.status;report.matrixComplete=result.results.length===12&&result.results.every(r=>r.completed);
  if(result.status==='blocked'){
   const last=report.results.at(-1);
   report.diagnosisFailure={...(last?.failure??{category:control.stopping?'interrupted':'fixture_cleanup_unverified'}),
    ...(last?{caseId:last.id,reference:last.failure?.reference??last.observations?.at(-1)??last.resultReference??`cases/${last.id}/result.json`}:{})};
   report.primaryFailure??=report.diagnosisFailure;
  }
 }catch(error){block(error);}
 finally{
  // A partial case or exception never skips the independent preservation audit.
  if(consumed||snapshotValidated){
   try{
    attempt.save();attempt.stage('final_audit');await audit('finish');
    const summary=readPrivate(root+'/verification-summary.json');
    finalizeDiagnosticReport(report,summary);
   }catch(error){
    report.auditFailures=[...(report.auditFailures??[]),{...failure(error),reference:'independent-audit.log'}];block(error);
   }
  }
  if(source){try{checkSource();}catch(error){block(error);}}
  if(control.stopping)block(new DiagnosisError('interrupted'));
  try{attempt.finish();}finally{process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);}
 }
 console.log(`${report.passed?'PASS':'BLOCKED'} shutdown matrix: ${report.status}. Private evidence: ${root}/report.json`);
 return report;
}

 return {createMatrixAttempt,consumeMatrix,runFreshMatrix};
}
