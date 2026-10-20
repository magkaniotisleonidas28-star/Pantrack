import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync,lstatSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import * as original from '../scripts/po-cart-shutdown-observation-matrix-check.mjs';
import * as validation from '../scripts/po-cart-browser-lifecycle-validation-check.mjs';
import {sourceSnapshot} from '../scripts/po-cart-worker/acceptance-gate.mjs';
import {diagnosisRoot,diagnosisPolicy,diagnosisCases,historicalObservation,historicalObservationHash,hash,DiagnosisError,classifyDiagnosis} from '../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-browser-lifecycle-validation on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const repo=process.cwd(),sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-shutdown-matrix-')));
const bindings=[{module:original,root:original.matrixRoot,policy:original.matrixPolicy,entry:resolve('scripts/po-cart-shutdown-observation-matrix-check.mjs'),adapter:resolve('scripts/po-cart-worker/shutdown-observation-matrix-audit.py')},
 {module:validation,root:validation.validationRoot,policy:validation.validationPolicy,entry:resolve('scripts/po-cart-browser-lifecycle-validation-check.mjs'),adapter:resolve('scripts/po-cart-worker/browser-lifecycle-validation-audit.py')}];
let matrixRoot,matrixPolicy;
const source={files:1,sha256:hash('offline source')};
function setup(name){
 const cwd=join(sandbox,matrixPolicy+'-'+name);mkdirSync(cwd,{mode:0o700});process.chdir(cwd);mkdirSync(matrixRoot,{recursive:true,mode:0o700});
 writePrivate(matrixRoot+'/pipeline.json',{});writePrivate(matrixRoot+'/historical-processes-before.json',{processes:[{pid:30474}]});
 return cwd;
}
try{
 assert.notEqual(original.matrixRoot,validation.validationRoot);assert.notEqual(original.matrixPolicy,validation.validationPolicy);
 for(const binding of bindings){
 ({root:matrixRoot,policy:matrixPolicy}=binding);
 const {createMatrixAttempt,consumeMatrix,runFreshMatrix}=binding.module,{entry,adapter}=binding;
 process.chdir(repo);
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
 rmSync(matrixRoot,{recursive:true});const target=join(sandbox,matrixPolicy+'-symlink-target');mkdirSync(target,{mode:0o700});symlinkSync(target,matrixRoot);
 assert.throws(()=>createMatrixAttempt(),e=>e.category==='private_matrix_root_required');

 for(const mode of ['complete','partial','interrupted','source','thrown','audit','false_success','preparation','simulated','partial_audit','downgraded']){
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
    if(['audit','partial_audit'].includes(mode))throw new DiagnosisError('independent_audit_failed');
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
    const result={...spec,lifecycleEvidenceVersion:mode==='downgraded'?1:2,evidenceOrigin:mode==='simulated'?'simulated':'collected',completed:!['partial','partial_audit'].includes(mode),cleanup:{verified:true},signatureObserved:false,observations:[`cases/${spec.id}/observation-0002.json`]};
    if(['partial','partial_audit'].includes(mode))result.failure={category:'observed_start_time_mismatch',pid:1001};
    return result;
   }
  };
  const report=await runFreshMatrix({operations});
  const simulatedAccepted=mode==='simulated'&&binding.module===original;
  assert.equal(report.passed,mode==='complete'||simulatedAccepted);assert.equal(finalAudits,mode==='preparation'?0:1);
  assert.equal(trials,['complete','audit','false_success'].includes(mode)||simulatedAccepted?12:mode==='preparation'?0:1);
  assert.equal(existsSync(matrixRoot+'/diagnosis.json'),mode!=='preparation');
  assert.equal(readPrivate(matrixRoot+'/report.json').passed,report.passed);
  assert.equal(process.listenerCount('SIGTERM'),0);assert.equal(process.listenerCount('SIGINT'),0);
  assert.throws(()=>createMatrixAttempt(),e=>e.category==='invocation_consumed');
  if(['partial','partial_audit'].includes(mode))assert.deepEqual(report.primaryFailure,{category:'observed_start_time_mismatch',pid:1001,caseId:'SIGTERM-0-1',reference:'cases/SIGTERM-0-1/observation-0002.json'});
  if(mode==='source')assert.equal(report.primaryFailure.category,'source_changed');
  if(mode==='thrown')assert.equal(report.primaryFailure.category,'evidence_write_failed');
  if(mode==='interrupted')assert.equal(report.primaryFailure.category,'interrupted');
  if(['audit','partial_audit'].includes(mode))assert.equal(report.auditFailures[0].reference,'independent-audit.log');
  if(mode==='simulated'&&!simulatedAccepted||mode==='downgraded')assert.equal(report.primaryFailure.category,'lifecycle_evidence_missing');
 }
 // Adapter binding uses the same fixed relative root in an isolated cwd. No
 // browser or actual preservation/process check is replaced in the real CLI.
 const bindingCwd=setup('binding');
 writePrivate(matrixRoot+'/report.json',{policy:matrixPolicy,matrix:diagnosisCases,source,
  historicalReference:{path:historicalObservation,sha256:historicalObservationHash},lifecycleEvidenceVersion:2,results:[]});consumeMatrix(source);
 const python=spawnSync('python3',['-c',`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('adapter',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
assert str(a.ROOT)==${JSON.stringify(matrixRoot)} and a.audit.ROOT==a.ROOT
if hasattr(a,'preparation'):a.preparation=lambda:${JSON.stringify(source)}
assert a.binding()['passed'] is True
original_report=a.audit.read('report.json');original_invocation=a.audit.read('diagnosis.json')
def rejected():
 try:a.binding();raise RuntimeError('forged binding passed')
 except AssertionError:pass
for field in ['policy','source','cases']:
 value=dict(original_invocation);value[field]='forged';(a.ROOT/'diagnosis.json').write_text(json.dumps(value));rejected()
 (a.ROOT/'diagnosis.json').write_text(json.dumps(original_invocation))
if hasattr(a,'collected'):
 for result in [{'id':'SIGTERM-0-1','lifecycleEvidenceVersion':2,'evidenceOrigin':'simulated'},{'lifecycleEvidenceVersion':1,'evidenceOrigin':'collected'}]:
  report=dict(original_report);report['results']=[result];(a.ROOT/'report.json').write_text(json.dumps(report));rejected()
 (a.ROOT/'report.json').write_text(json.dumps(original_report))
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
 process.chdir(repo);
 }
 // Independently recompute source and validate preparation/log binding in a
 // disposable Git repository, without replacing the preparation function.
 matrixRoot=validation.validationRoot;matrixPolicy=validation.validationPolicy;
 const preparationCwd=setup('independent-preparation');
 assert.equal(spawnSync('git',['init','-q'],{cwd:preparationCwd}).status,0);
 writeFileSync('fixture.mjs','// offline source fixture\n');
 const frozen=sourceSnapshot();writePrivate(matrixRoot+'/source-frozen.json',frozen);
 const results=['typecheck','test','build'].map(id=>{
  const path=matrixRoot+'/'+id+'.log';writeFileSync(path,'offline preparation fixture\n',{mode:0o600});
  return {id,passed:true,exitCode:0,sourceBefore:frozen.sha256,sourceAfter:frozen.sha256,log:{path,sha256:hash(readFileSync(path))}};
 });
 writePrivate(matrixRoot+'/pipeline.json',{passed:true,source:frozen,results});
 const preparationCheck=spawnSync('python3',['-c',`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('validation',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
source=a.preparation();assert source==json.loads(sys.argv[2])
original=a.audit.read('pipeline.json')
for mode in ['source','step','log','passed']:
 value=json.loads(json.dumps(original))
 if mode=='source':value['source']['sha256']='forged'
 if mode=='step':value['results'][0]['sourceAfter']='forged'
 if mode=='log':value['results'][0]['log']['sha256']='forged'
 if mode=='passed':value['passed']=False
 (a.ROOT/'pipeline.json').write_text(json.dumps(value))
 try:a.preparation();raise RuntimeError('false preparation passed: '+mode)
 except AssertionError:pass
 (a.ROOT/'pipeline.json').write_text(json.dumps(original))
Path=__import__('pathlib').Path;Path('fixture.mjs').write_text('// changed source')
try:a.preparation();raise RuntimeError('changed source passed')
except AssertionError:pass
`,bindings[1].adapter,JSON.stringify(frozen)],{cwd:preparationCwd,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(preparationCheck.status,0,preparationCheck.stderr);
 console.log('PASS both fixed lifecycle bindings: fixed roots/policies, exclusive concurrent refusal, durable consumption, private-root checks, distinct preparation evidence, partial/interrupted/source/write/audit failures, precise primary references, false-success refusal and independent adapter binding; no browsers or process signals.');
}finally{process.chdir(repo);rmSync(sandbox,{recursive:true,force:true});}
