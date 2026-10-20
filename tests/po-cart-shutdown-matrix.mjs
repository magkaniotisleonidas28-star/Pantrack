import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync,lstatSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {matrixRoot,matrixPolicy,createMatrixAttempt,consumeMatrix,runFreshMatrix} from '../scripts/po-cart-shutdown-observation-matrix-check.mjs';
import {diagnosisRoot,diagnosisPolicy,diagnosisCases,historicalObservation,historicalObservationHash,hash,DiagnosisError,classifyDiagnosis} from '../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-shutdown-matrix on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const repo=process.cwd(),sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-shutdown-matrix-')));
const entry=resolve('scripts/po-cart-shutdown-observation-matrix-check.mjs'),adapter=resolve('scripts/po-cart-worker/shutdown-observation-matrix-audit.py');
const source={files:1,sha256:hash('offline source')};
function setup(name){
 const cwd=join(sandbox,name);mkdirSync(cwd,{mode:0o700});process.chdir(cwd);mkdirSync(matrixRoot,{recursive:true,mode:0o700});
 writePrivate(matrixRoot+'/pipeline.json',{});writePrivate(matrixRoot+'/historical-processes-before.json',{processes:[{pid:30474}]});
 return cwd;
}
try{
 assert.notEqual(matrixRoot,diagnosisRoot);assert.notEqual(matrixPolicy,diagnosisPolicy);
 for(const args of [['--help'],['--resume'],['--root',sandbox],['30474']]){
  const result=spawnSync(process.execPath,[entry,...args],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/arguments_forbidden/);
 }
 assert.equal(process.listenerCount('SIGTERM'),0);
 setup('consumption');consumeMatrix(source);
 const bytes=readFileSync(matrixRoot+'/diagnosis.json'),stat=lstatSync(matrixRoot+'/diagnosis.json');
 assert.equal(stat.mode&0o777,0o600);assert.equal(readPrivate(matrixRoot+'/diagnosis.json').policy,matrixPolicy);
 assert.deepEqual(readPrivate(matrixRoot+'/diagnosis.json').cases,diagnosisCases);
 assert.throws(()=>consumeMatrix(source));assert.deepEqual(readFileSync(matrixRoot+'/diagnosis.json'),bytes);
 assert.throws(()=>createMatrixAttempt(),e=>e.category==='invocation_consumed');

 const raceCwd=setup('race');
 const code=`import {createMatrixAttempt} from ${JSON.stringify(entry)};try{createMatrixAttempt().finish();}catch{process.exitCode=2;}`;
 const launch=()=>new Promise(ok=>{const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:raceCwd,stdio:'ignore'});child.on('exit',ok);});
 assert.deepEqual((await Promise.all([launch(),launch()])).sort(),[0,2]);
 const reportBytes=readFileSync(matrixRoot+'/report.json');
 assert.throws(()=>createMatrixAttempt(),e=>e.category==='invocation_consumed');
 assert.deepEqual(readFileSync(matrixRoot+'/report.json'),reportBytes);assert.equal(existsSync(matrixRoot+'/diagnosis.json'),false);

 setup('private-root');rmSync(matrixRoot,{recursive:true});mkdirSync(matrixRoot,{mode:0o755});
 assert.throws(()=>createMatrixAttempt(),e=>e.category==='private_matrix_root_required');
 rmSync(matrixRoot,{recursive:true});const target=join(sandbox,'symlink-target');mkdirSync(target,{mode:0o700});symlinkSync(target,matrixRoot);
 assert.throws(()=>createMatrixAttempt(),e=>e.category==='private_matrix_root_required');

 for(const mode of ['complete','partial','interrupted','source','thrown','audit','false_success','preparation']){
  setup(mode);let trials=0,finalAudits=0,sourceChanged=false;
  // Preparation files cannot collide with the exclusive invocation audit files.
  writePrivate(matrixRoot+'/preservation-before-preparation.json',{passed:true});
  const operations={
   validatePreparation:()=>{if(mode==='preparation')throw new DiagnosisError('preparation_failed');return source;},
   verifyHistoricalReference:()=>{},
   checkSource:()=>{if(sourceChanged)throw Error('source changed');},
   audit:async operation=>{
    if(operation==='before'){
     assert.equal(existsSync(matrixRoot+'/diagnosis.json'),false);
     writeFileSync(matrixRoot+'/preservation-before-diagnosis.json','{}',{flag:'wx',mode:0o600});return;
    }
    finalAudits++;assert.equal(readPrivate(matrixRoot+'/diagnosis.json').policy,matrixPolicy);
    if(mode==='audit')throw new DiagnosisError('independent_audit_failed');
    const report=readPrivate(matrixRoot+'/report.json'),complete=report.results.length===12;
    writePrivate(matrixRoot+'/verification-summary.json',{passed:complete,matrixComplete:complete,lifecycleEvidenceVersion:2,status:classifyDiagnosis(report.results),
     independentChecksPassed:true,fixtureProcessesGone:true,attemptedCases:report.results.length,completeCases:report.results.filter(r=>r.completed).length,
     signatureCases:0,auditFailures:[],...(mode==='false_success'?{matrixComplete:false}:{})});
   },
   runTrial:async(spec,options)=>{
    trials++;assert.equal(options.root,matrixRoot);assert.deepEqual(options.forbiddenPids,[4303,30474]);
    if(mode==='thrown')throw new DiagnosisError('evidence_write_failed');
    if(mode==='interrupted')process.emit('SIGTERM');
    if(mode==='source')sourceChanged=true;
    const result={...spec,lifecycleEvidenceVersion:2,completed:mode!=='partial',cleanup:{verified:true},signatureObserved:false,observations:[`cases/${spec.id}/observation-0002.json`]};
    if(mode==='partial')result.failure={category:'observed_start_time_mismatch',pid:1001};
    return result;
   }
  };
  const report=await runFreshMatrix({operations});
  assert.equal(report.passed,mode==='complete');assert.equal(finalAudits,mode==='preparation'?0:1);
  assert.equal(trials,['complete','audit','false_success'].includes(mode)?12:mode==='preparation'?0:1);
  assert.equal(existsSync(matrixRoot+'/diagnosis.json'),mode!=='preparation');
  assert.equal(readPrivate(matrixRoot+'/report.json').passed,report.passed);
  assert.equal(process.listenerCount('SIGTERM'),0);assert.equal(process.listenerCount('SIGINT'),0);
  assert.throws(()=>createMatrixAttempt(),e=>e.category==='invocation_consumed');
  if(mode==='partial')assert.deepEqual(report.primaryFailure,{category:'observed_start_time_mismatch',pid:1001,caseId:'SIGTERM-0-1',reference:'cases/SIGTERM-0-1/observation-0002.json'});
  if(mode==='source')assert.equal(report.primaryFailure.category,'source_changed');
  if(mode==='thrown')assert.equal(report.primaryFailure.category,'evidence_write_failed');
  if(mode==='interrupted')assert.equal(report.primaryFailure.category,'interrupted');
  if(mode==='audit')assert.equal(report.auditFailures[0].reference,'independent-audit.log');
 }
 // Adapter binding uses the same fixed relative root in an isolated cwd. No
 // browser or actual preservation/process check is replaced in the real CLI.
 const bindingCwd=setup('binding');
 writePrivate(matrixRoot+'/report.json',{policy:matrixPolicy,matrix:diagnosisCases,source,
  historicalReference:{path:historicalObservation,sha256:historicalObservationHash}});consumeMatrix(source);
 const python=spawnSync('python3',['-c',`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('adapter',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
assert str(a.ROOT)==${JSON.stringify(matrixRoot)} and a.audit.ROOT==a.ROOT
assert a.binding()['passed'] is True
p=a.ROOT/'diagnosis.json';v=json.loads(p.read_text());v['policy']='forged';p.write_text(json.dumps(v))
try:a.binding();raise RuntimeError('forged policy passed')
except AssertionError:pass
# Binding failure must not skip the shared auditor. Its classification check
# independently rejects success and retains an explicit binding failure file.
def finish():
 try:a.audit.require_classification('reproduced','reproduced');raise RuntimeError('false success')
 except AssertionError:pass
 return {'passed':False}
a.audit.finish=finish
assert a.finish()['passed'] is False
assert json.loads((a.ROOT/'matrix-binding-audit.json').read_text())['category']=='matrix_binding_audit_failed'
`,adapter],{cwd:bindingCwd,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(python.status,0,python.stderr);
 for(const args of [[],['before','--root',sandbox],['resume']]){
  const rejected=spawnSync('python3',[adapter,...args],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Only the fixed/);
 }
 console.log('PASS fresh shutdown matrix wrapper: fixed roots/policies, exclusive concurrent refusal, durable consumption, private-root checks, distinct preparation evidence, partial/interrupted/source/write/audit failures, precise primary references, false-success refusal and independent adapter binding; no browsers or process signals.');
}finally{process.chdir(repo);rmSync(sandbox,{recursive:true,force:true});}
