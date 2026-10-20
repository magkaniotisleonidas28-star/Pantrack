import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {get,request} from 'node:http';
import {createLegacyAttempt} from '../scripts/po-cart-worker/legacy-profile-verification.mjs';
import {diagnosisCases,parseDiagnosticIdentity,collectObservation,classifyDiagnosis,consumeDiagnosis,runDiagnosisMatrix,
 verifySignalTarget,disposeFixture,denyProxy,hash,validateDiagnosisPreparation,analyzeDiagnosticObservation,
 observeDiagnosticShutdown,finalizeDiagnosticReport} from '../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-shutdown-observation on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-shutdown-diagnosis-')));
const profile='/fixture/profiles/'+hash('fixture'),main='/fixture/Contents/MacOS/Chrome',start='Thu Oct 15 01:00:00 2026';
const row=(pid,parent,command,change={})=>({pid,parent,group:1000,state:'S',start,command,...change});
const baseline=[row(1000,42,main+' --user-data-dir='+profile),row(1001,1000,main+' --type=renderer --user-data-dir='+profile)];
const idle=row(99999,1,'private unrelated token=DO_NOT_LOG',{group:99999});
const raw=rows=>rows.map(p=>`${p.pid} ${p.parent} ${p.group} ${p.state} ${p.start} ${p.command}`).join('\n');
const details=rows=>rows.map(p=>`${p.pid} ${p.start} ${p.executable??main}`).join('\n');
const captured=parseDiagnosticIdentity(raw(baseline)).map(p=>({...p,profile:hash('fixture'),startedMs:Date.parse(start),executable:main}));
const observation=(before,metadata,after,phase='shutdown')=>{
 let calls=0;const evidence=[];
 const io={now:()=>calls,identityOutput:()=>raw(calls++?after:before),executableOutput:()=>details(metadata)};
 const result=collectObservation({io,captured,profile,leader:1000,phase,record:o=>{evidence.push(o);return 'observation.json';}});
 return {...result,evidence};
};
try{
 assert.equal(diagnosisCases.length,12);
 assert.deepEqual(diagnosisCases.map(c=>c.id),['SIGTERM-0-1','SIGTERM-0-2','SIGTERM-10-1','SIGTERM-10-2','SIGTERM-50-1','SIGTERM-50-2',
  'protocol-0-1','protocol-0-2','protocol-10-1','protocol-10-2','protocol-50-1','protocol-50-2']);
 const short=row(1001,1000,'(Chrome Renderer)');
 const changed=observation([baseline[0],short,idle],[baseline[0],idle],[baseline[0],idle]);
 assert.equal(changed.observation.verdict.category,'identity_changed');assert.deepEqual(changed.observation.signaturePids,[1001]);
 assert.equal(changed.observation.before[1].exactProfile,false);assert.equal(changed.observation.details.some(p=>p.pid===1001),false);
 assert.ok(!JSON.stringify(changed.evidence).includes('DO_NOT_LOG'));assert.ok(!JSON.stringify(changed.evidence).includes(main));
 assert.ok(!JSON.stringify(changed.evidence).includes(profile));
 const exited=observation([...baseline,idle],[baseline[0],idle],[baseline[0],idle]);
 assert.equal(exited.observation.verdict.passed,true);assert.deepEqual(exited.observation.signaturePids,[]);
 const incomplete=observation([...baseline,idle],[baseline[0],idle],[...baseline,idle]);
 assert.equal(incomplete.observation.verdict.category,'executable_evidence_incomplete');
 const zombie=observation([baseline[0],{...baseline[1],state:'Z'},idle],[baseline[0],idle],[baseline[0],idle]);
 assert.equal(zombie.observation.verdict.category,'identity_changed');assert.equal(zombie.observation.signaturePids.length,0);
 assert.throws(()=>observation([baseline[0],{...baseline[1],parent:777},idle],[...baseline,idle],[...baseline,idle]),e=>e.category==='observed_topology_changed');
 assert.throws(()=>observation([baseline[0],{...baseline[1],start:'Fri Oct 16 01:00:00 2026'},idle],[...baseline,idle],[...baseline,idle]),e=>e.category==='observed_start_time_mismatch');
 const executable=observation([...baseline,idle],[baseline[0],{...baseline[1],executable:'/changed/Chrome'},idle],[...baseline,idle]);
 assert.ok(executable.observation.analysis.findings.some(f=>f.kind==='executable_text_changed'));
 assert.equal(executable.observation.analysis.allAbsentAfter,false);
 assert.throws(()=>observation([...baseline,idle],[baseline[0],{...baseline[1],executable:'/changed/Chrome'},idle],[...baseline,idle],'baseline'),e=>e.category==='fixture_baseline_unverified');
 assert.throws(()=>observation([...baseline,row(1002,1000,'new child'),idle],[...baseline,idle],[...baseline,idle]),e=>e.category==='unexpected_fixture_membership');
 for(const phase of ['before','details','after']){
  let count=0;const evidence=[];
  assert.throws(()=>collectObservation({captured,profile,leader:1000,record:o=>evidence.push(o),io:{now:()=>0,
   identityOutput:()=>{if(phase===(count++?'after':'before'))throw Error('token=DO_NOT_LOG');return raw([...baseline,idle]);},
   executableOutput:()=>phase==='details'?'malformed private':details([...baseline,idle])}}),e=>e.category==='incomplete_collection');
  assert.equal(evidence[0].complete,false);assert.ok(!JSON.stringify(evidence).includes('DO_NOT_LOG'));
 }
 assert.throws(()=>collectObservation({captured,profile,leader:1000,io:{now:()=>0,identityOutput:()=>raw([...baseline,idle]),executableOutput:()=>details([...baseline,idle])},
  record:()=>{throw Error('disk full');}}));

 // Replay actual field-level evidence, not a guessed shutdown command string.
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/po-cart-shutdown-transition.json',import.meta.url),'utf8'));
 const recorded=structuredClone(fixture.observation),realBaseline=fixture.baseline;
 const analyze=(obs=recorded,phase='shutdown')=>analyzeDiagnosticObservation(obs,realBaseline,{phase});
 const diagnosis=analyze();assert.equal(diagnosis.blockingFailure,null);assert.equal(diagnosis.allAbsentAfter,false);
 assert.deepEqual(diagnosis.signaturePids,[61598]);assert.equal(recorded.verdict.pid,61492);
 assert.ok(diagnosis.findings.some(f=>f.pid===61492&&f.kind==='zombie'));
 assert.ok(diagnosis.findings.some(f=>f.pid===61492&&f.kind==='executable_text_changed'));
 assert.equal(analyzeDiagnosticObservation(recorded,realBaseline).blockingFailure.category,'fixture_baseline_unverified');
 assert.throws(()=>analyzeDiagnosticObservation(recorded,realBaseline,{phase:'signal'}),e=>e.category==='invalid_observation_phase');
 const absent={version:1,complete:true,before:[],details:[],after:[],verdict:{passed:true}};
 const stable={version:1,complete:true,before:structuredClone(realBaseline),after:structuredClone(realBaseline),
  details:realBaseline.map(p=>({pid:p.pid,startHash:p.startHash,startedMs:p.startedMs,executableHash:p.executableHash})),verdict:{passed:true}};
 const analysisInputs=[{obs:recorded,phase:'shutdown'},{obs:recorded,phase:'baseline'},{obs:absent,phase:'shutdown'},{obs:stable,phase:'baseline'}];
 for(const change of [
  obs=>{obs.verdict.pid=61628;},
  obs=>{obs.before.reverse();obs.after.reverse();obs.details.reverse();},
 ]){const obs=structuredClone(recorded);change(obs);assert.deepEqual(analyze(obs).signaturePids,[61598]);analysisInputs.push({obs,phase:'shutdown'});}
 for(const [mutate,category] of [
  [obs=>{obs.before[0].startHash=hash('different start');},'observed_start_time_mismatch'],
  [obs=>{obs.details[0].startedMs++;},'observed_start_time_mismatch'],
  [obs=>{obs.after[0].group++;},'observed_topology_changed'],
  [obs=>{obs.before[0].parent=123;},'observed_topology_changed'],
  [obs=>{obs.before.push({...obs.before[0],pid:77777});},'unexpected_fixture_membership'],
  [obs=>{obs.complete=false;},'incomplete_collection'],
  [obs=>{obs.after=null;},'incomplete_collection'],
  [obs=>{obs.before.push(obs.before[0]);},'incomplete_collection'],
  [obs=>{obs.before[0].pid={};},'incomplete_collection'],
 ]){
  const obs=structuredClone(recorded);mutate(obs);assert.equal(analyze(obs).blockingFailure.category,category);
  analysisInputs.push({obs,phase:'shutdown'});
 }
 const adopted=structuredClone(recorded);adopted.before[1].parent=1;assert.equal(analyze(adopted).blockingFailure,null);analysisInputs.push({obs:adopted,phase:'shutdown'});
 const unavailable=structuredClone(stable);unavailable.details=[];
 assert.equal(analyze(unavailable).blockingFailure,null);assert.equal(analyze(unavailable).allAbsentAfter,false);
 assert.equal(analyze(unavailable,'baseline').blockingFailure.category,'fixture_baseline_unverified');
 analysisInputs.push({obs:unavailable,phase:'shutdown'},{obs:unavailable,phase:'baseline'});
 let clock=0,reads=0,signals=0;const sequence=[recorded,absent],states=[];
 const replay=await observeDiagnosticShutdown({baseline:realBaseline,startedMono:0,
  collect:()=>{clock+=1;return sequence[reads++];},io:{now:()=>clock,pause:async ms=>{clock+=ms;},signal:()=>signals++},
  onObservation:({analysis})=>states.push(analysis.allAbsentAfter)});
 assert.deepEqual(states,[false,true]);assert.equal(replay.exitObserved,true);assert.equal(replay.signatureObserved,true);assert.equal(signals,0);
 assert.equal(reads,2);assert.deepEqual(recorded,fixture.observation,'Replay never rewrites the recorded verdict or fields');
 for(const condition of ['persistent','missing_metadata','incomplete','start','membership','interrupted','source','write','late']){
  let time=0,count=0;const ctl={stopping:false};
  const collect=()=>{
   count++;const obs=structuredClone(condition==='persistent'?recorded:condition==='missing_metadata'?unavailable:absent);
   if(condition==='incomplete')obs.complete=false;
   if(condition==='start'){obs.before=structuredClone(recorded.before);obs.before[0].startHash=hash('new birth');}
   if(condition==='membership')obs.before=[{...recorded.before[0],pid:88888}];
   if(condition==='interrupted')ctl.stopping=true;
   if(condition==='late')time=5001;
   return obs;
  };
  const expected={persistent:'fixture_shutdown_timeout',missing_metadata:'fixture_shutdown_timeout',incomplete:'incomplete_collection',start:'observed_start_time_mismatch',membership:'unexpected_fixture_membership',interrupted:'interrupted',source:'source_changed',write:undefined,late:'fixture_shutdown_timeout'}[condition];
  await assert.rejects(observeDiagnosticShutdown({baseline:realBaseline,startedMono:0,control:ctl,collect,
   io:{now:()=>time,pause:async ms=>{time+=ms;},signal:()=>assert.fail('observer signaled')},
   checkSource:()=>{if(condition==='source'&&count)throw Error('changed source');},
   onObservation:()=>{if(condition==='write')throw Error('evidence write failed');}}),expected?e=>e.category===expected:undefined);
  if(['persistent','missing_metadata'].includes(condition))assert.equal(time,5000);
 }
 const batch=join(sandbox,'analysis-inputs.json');writeFileSync(batch,JSON.stringify(analysisInputs.map(p=>({...p,baseline:realBaseline}))));
 const pythonAnalysis=spawnSync('python3',['-c',`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('a','scripts/po-cart-worker/shutdown-observation-audit.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
print(json.dumps([a.analyze_observation(v['obs'],v['baseline'],v['phase']) for v in json.load(open(sys.argv[1]))]))
`,batch],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(pythonAnalysis.status,0,pythonAnalysis.stderr);
 assert.deepEqual(JSON.parse(pythonAnalysis.stdout),analysisInputs.map(p=>analyze(p.obs,p.phase)),'Independent Python/JS analysis agrees on recorded transitions and unsafe cases');

 const complete=()=>diagnosisCases.map(c=>({...c,completed:true,cleanup:{verified:true},signatureObserved:false}));
 assert.equal(classifyDiagnosis(complete()),'not reproduced within this matrix');
 const once=complete();once[0].signatureObserved=true;assert.equal(classifyDiagnosis(once),'observed once');
 once[1].signatureObserved=true;assert.equal(classifyDiagnosis(once),'reproduced');
 assert.equal(classifyDiagnosis(once.slice(1)),'blocked');once[2].cleanup.verified=false;assert.equal(classifyDiagnosis(once),'blocked');
 const primary={category:'observed_start_time_mismatch',pid:61492};
 const blockedReport={matrixComplete:false,results:[{...diagnosisCases[0],completed:false,failure:primary}],diagnosisFailure:primary};
 finalizeDiagnosticReport(blockedReport,{passed:false,matrixComplete:false,auditFailures:[{category:'business_preservation_audit_failed'}]});
 assert.deepEqual(blockedReport.primaryFailure,primary);assert.equal(blockedReport.status,'blocked');assert.equal(blockedReport.auditFailures.length,1);
 const falseReport={matrixComplete:true,results:complete()};finalizeDiagnosticReport(falseReport,{passed:true,matrixComplete:false,status:'reproduced'});assert.equal(falseReport.passed,false);
 const goodAudit={passed:true,matrixComplete:true,status:'not reproduced within this matrix',independentChecksPassed:true,completeCases:12,attemptedCases:12,fixtureProcessesGone:true,auditFailures:[],signatureCases:0};
 assert.equal(finalizeDiagnosticReport({matrixComplete:true,results:complete()},goodAudit).passed,true);
 for(const override of [{completeCases:1},{attemptedCases:1},{independentChecksPassed:false},{fixtureProcessesGone:false},{auditFailures:[{category:'case_evidence_audit_failed'}]},{signatureCases:2}]){
  assert.equal(finalizeDiagnosticReport({matrixComplete:true,results:complete()},{...goodAudit,...override}).passed,false);
 }
 const order=[];const matrix=await runDiagnosisMatrix({control:{stopping:false},checkSource:()=>{},recordResult:()=>{},runTrial:async c=>{order.push(c.id);return {...c,completed:order.length<3,cleanup:{verified:true}};}});
 assert.equal(matrix.status,'blocked');assert.equal(order.length,3);
 const control={stopping:false},interrupted=[];
 await runDiagnosisMatrix({control,checkSource:()=>{},recordResult:()=>{},runTrial:async c=>{interrupted.push(c.id);control.stopping=true;return {...c,completed:true,cleanup:{verified:true}};}});
 assert.equal(interrupted.length,1);
 let launched=false;await assert.rejects(runDiagnosisMatrix({control:{stopping:false},checkSource:()=>{throw Error('source');},recordResult:()=>{},runTrial:async()=>{launched=true;}}));assert.equal(launched,false);

 function disposal(){
  let now=0,current=[...baseline,idle];const signals=[];
  const io={now:()=>now,pause:async ms=>{now+=ms;},identityOutput:()=>raw(current),executableOutput:()=>details(current),
   signal:(pid,signal)=>{signals.push({pid,signal});if(signal==='SIGKILL')current=current.filter(p=>p.pid!==pid);}};
  const options={captured,profile,leader:1000,runnerPid:42,forbiddenPids:[4303,30474],main,io};
  return {io,options,signals,getTime:()=>now,set:rows=>{current=rows;}};
 }
 const d=disposal();assert.equal(verifySignalTarget(captured[0],d.options),true);
 assert.throws(()=>verifySignalTarget({...captured[0],pid:4303},d.options),e=>e.category==='forbidden_signal_target');
 d.set([baseline[0],{...baseline[1],command:'other program'},idle]);assert.throws(()=>verifySignalTarget(captured[1],d.options),e=>e.category==='signal_ownership_unverified');
 const escalation=disposal();assert.equal((await disposeFixture(escalation.options)).verified,true);
 assert.deepEqual(escalation.signals,[{pid:1000,signal:'SIGTERM'},{pid:1001,signal:'SIGKILL'},{pid:1000,signal:'SIGKILL'}]);
 assert.equal(escalation.getTime(),10000);
 const timeout=disposal();timeout.io.signal=()=>{};await assert.rejects(disposeFixture(timeout.options),e=>e.category==='fixture_cleanup_unverified');assert.equal(timeout.getTime(),15000);
 const intentRace=disposal();await assert.rejects(disposeFixture({...intentRace.options,record:()=>intentRace.set([{...baseline[0],command:'reused'},baseline[1],idle])}),e=>e.category==='signal_ownership_unverified');assert.equal(intentRace.signals.length,0);
 const handle=disposal();const driver={isConnected:()=>true,newBrowserCDPSession:async()=>({send:async()=>handle.set([idle])}),close:async()=>{}};
 assert.equal((await disposeFixture({...handle.options,driver})).verified,true);assert.equal(handle.signals.length,0);

 const root=join(sandbox,'invocation');mkdirSync(root);consumeDiagnosis(root,{sha256:hash('source')});assert.throws(()=>consumeDiagnosis(root,{}));assert.equal(existsSync(join(root,'task.json')),false);
 const raceRoot=join(sandbox,'race');mkdirSync(raceRoot);
 const code=`import {createLegacyAttempt} from ${JSON.stringify(resolve('scripts/po-cart-worker/legacy-profile-verification.mjs'))};try{createLegacyAttempt(process.argv[1],{}).finish();}catch{process.exitCode=2;}`;
 const launch=()=>new Promise(ok=>{const p=spawn(process.execPath,['--input-type=module','-e',code,raceRoot],{stdio:'ignore'});p.on('exit',ok);});
 assert.deepEqual((await Promise.all([launch(),launch()])).sort(),[0,2]);assert.throws(()=>createLegacyAttempt(raceRoot,{}));
 const failureRoot=join(sandbox,'write-failure');mkdirSync(failureRoot);let signaled=false;
 const a=createLegacyAttempt(failureRoot,{}, {write:()=>{throw Error('token=DO_NOT_LOG');}});
 try{a.stage('browser_shutdown');signaled=true;}catch{}assert.equal(signaled,false);
 const log=join(sandbox,'prepare.log');writeFileSync(log,'passed');
 const source={files:1,sha256:hash('source')},pipeline={source,passed:true,results:['typecheck','test','build'].map(id=>({id,passed:true,exitCode:0,sourceBefore:source.sha256,sourceAfter:source.sha256,log:{path:log,sha256:hash('passed')}}))};
 assert.deepEqual(validateDiagnosisPreparation(pipeline,()=>source),source);
 assert.throws(()=>validateDiagnosisPreparation({...pipeline,results:pipeline.results.slice(1)},()=>source));
 writeFileSync(log,'changed');assert.throws(()=>validateDiagnosisPreparation(pipeline,()=>source));
 for(const args of [['--help'],['--resume'],['--root',sandbox],['30474']]){
  const child=spawnSync(process.execPath,['scripts/po-cart-shutdown-observation-check.mjs',...args],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/accepts no arguments, overrides or resume/);
 }
 const proxy=await denyProxy();
 try{
  const status=await new Promise((ok,no)=>{get(proxy.url+'/',r=>{r.resume();r.on('end',()=>ok(r.statusCode));}).on('error',no);});assert.equal(status,403);
  const connect=await new Promise((ok,no)=>{const req=request(proxy.url,{method:'CONNECT',path:'example.invalid:443'});req.on('connect',(res,socket)=>{socket.destroy();ok(res.statusCode);});req.on('error',no);req.end();});assert.equal(connect,403);
  assert.deepEqual(proxy.events.map(e=>e.kind),['http','connect']);assert.ok(!JSON.stringify(proxy.events).includes('example.invalid'));
 }finally{await proxy.close();}
 const py=spawnSync('python3',['-c',`import importlib.util,tempfile,pathlib,json
s=importlib.util.spec_from_file_location('audit','scripts/po-cart-worker/shutdown-observation-audit.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
with tempfile.TemporaryDirectory() as d:
 a.ROOT=pathlib.Path(d);expected=dict(id='SIGTERM-0-1',method='SIGTERM',delay=0,repetition=1)
 result=dict(**expected,completed=True,childExitObserved=True,cleanup={'verified':True},network={'proxyClosed':True,'proxyArgumentsVerified':True},baselineStabilityMs=250,baseline=[{'pid':1,'identity':'old'},{'pid':2,'identity':'old'},{'pid':3,'identity':'old'}],leader=1,observations=[],signatureObserved=True)
 try:a.audit_case(result,expected);raise RuntimeError('forged signature passed')
 except AssertionError as e:assert str(e)=='Incomplete observation series'
 a.subprocess.check_output=lambda args:b'1000 1 1000 S Thu Oct 15 01:00:00 2026 Chrome\\n'
 try:a.fixture_processes_gone([{'leader':1000}]);raise RuntimeError('false exit passed')
 except AssertionError as e:assert str(e)=='Fixture PID remains or was reused'
`],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(py.status,0,py.stderr);
 const auditProof=spawnSync('python3',['-c',`import importlib.util,tempfile,pathlib,json,copy,contextlib,io
s=importlib.util.spec_from_file_location('audit','scripts/po-cart-worker/shutdown-observation-audit.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
fixture=json.load(open('tests/fixtures/po-cart-shutdown-transition.json'));baseline=fixture['baseline']
def write(name,value):
 p=a.ROOT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value))
def obs(value,phase,start,end):
 result=copy.deepcopy(value);result['startedMono']=start;result['finishedMono']=end
 result['analysis']=a.analyze_observation(result,baseline,phase);result['signaturePids']=result['analysis']['signaturePids'];return result
stable=dict(version=1,complete=True,before=baseline,after=baseline,details=[{k:p[k] for k in ['pid','startHash','startedMs','executableHash']} for p in baseline],verdict={'passed':True})
absent=dict(version=1,complete=True,before=[],after=[],details=[],verdict={'passed':True})
matrix=[dict(id=f'{method}-{delay}-{repeat}',method=method,delay=delay,repetition=repeat) for method in ['SIGTERM','protocol'] for delay in [0,10,50] for repeat in [1,2]]
actual_audit_case=a.audit_case;actual_signals=a.audit_signals
for mode in ['partial','partial_audit_failure','complete','forged_findings','forged_signature','forged_classification','forbidden_signal']:
 with tempfile.TemporaryDirectory() as d:
  a.ROOT=pathlib.Path(d);results=[];events=[]
  for expected in matrix[:1 if mode.startswith('partial') else 12]:
   refs=[f"cases/{expected['id']}/observation-{i:04}.json" for i in [1,2,3]]
   write(refs[0],obs(stable,'baseline',0,1));write(refs[1],obs(fixture['observation'],'shutdown',10,20));write(refs[2],obs(absent,'shutdown',30,31))
   write(f"cases/{expected['id']}/baseline.json",baseline)
   if mode=='forged_findings' and not results:
    value=json.load(open(a.ROOT/refs[1]));value['analysis']['findings']=[];write(refs[1],value)
   if mode=='forged_signature' and not results:
    value=json.load(open(a.ROOT/refs[1]));value['signaturePids']=[];write(refs[1],value)
   result=dict(**expected,completed=not mode.startswith('partial'),leader=61492,runnerPid=61444,baseline=baseline,baselineStabilityMs=391,
    childExitObserved=True,cleanup={'verified':True},network={'proxyClosed':True,'proxyArgumentsVerified':True},
    observations=refs,signatureObserved=True,shutdownStartedMono=2,shutdownFinishedMono=31)
   if mode.startswith('partial'):result['failure']={'category':'observed_start_time_mismatch','pid':61492}
   results.append(result);events.extend([{'kind':'fixture_spawned','pid':61492,'caseId':expected['id']},
    {'kind':'fixture_shutdown_signal' if expected['method']=='SIGTERM' else 'fixture_protocol_close','pid':61492,'caseId':expected['id'],**({'signal':'SIGTERM'} if expected['method']=='SIGTERM' else {})}])
  if mode=='forbidden_signal':events.append({'kind':'fixture_cleanup_signal','pid':4303,'signal':'SIGKILL','caseId':matrix[0]['id']})
  report={'results':results,'events':events,'status':'blocked' if mode.startswith('partial') else 'reproduced'}
  if mode.startswith('partial'):report['diagnosisFailure']=results[0]['failure']
  if mode=='forged_classification':report['status']='not reproduced within this matrix'
  write('report.json',report);write('historical-processes-before.json',{'processes':[{'pid':30474}]})
  a.fixture_processes_gone=lambda results:None;a.historical_check=lambda:{'passed':True};a.audit_profile_drift=lambda:0
  def preservation():
   if mode=='partial_audit_failure':raise AssertionError('private preservation failure')
   return {'passed':True,'databaseDelta':[]}
  a.preservation=preservation;a.audit_case=actual_audit_case;a.audit_signals=actual_signals
  with contextlib.redirect_stdout(io.StringIO()):summary=a.finish()
  assert json.load(open(a.ROOT/'verification-summary.json'))==summary
  if mode.startswith('partial'):
   assert summary['passed'] is False and summary['matrixComplete'] is False and summary['signatureCases']==0
   assert summary['diagnosisFailure']==report['diagnosisFailure']
   assert summary['independentChecksPassed']==(mode=='partial')
   if mode=='partial_audit_failure':assert any(f['category']=='business_preservation_audit_failed' for f in summary['auditFailures'])
  elif mode=='complete':assert summary['passed'] is True and summary['signatureCases']==12
  else:
   assert summary['passed'] is False and summary['auditFailures']
`],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(auditProof.status,0,auditProof.stderr);
 console.log('PASS shutdown observation repair: retained real transition replay through zombie/metadata changes to confirmed absence, unchanged strict signal checks, independent JS/Python findings, start/topology/membership refusal, bounded timeout/interruption/source/write failures, case counting and structured partial audits with primary failure preservation and false-success rejection; no browsers or real browser signals.');
}finally{rmSync(sandbox,{recursive:true,force:true});}
