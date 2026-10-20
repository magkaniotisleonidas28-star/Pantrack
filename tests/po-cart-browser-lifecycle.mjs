import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runDiagnosticTrial,diagnosisCases,DiagnosisError,hash,finalizeDiagnosticReport} from '../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs';
import {runFreshMatrix,matrixRoot} from '../scripts/po-cart-shutdown-observation-matrix-check.mjs';
import {lifecycleStages} from '../scripts/po-cart-worker/shutdown-lifecycle-evidence.mjs';
import {writePrivate} from '../scripts/po-cart-worker/private-files.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-browser-lifecycle on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const start='Thu Oct 15 01:00:00 2026',repo=process.cwd(),auditor=resolve('scripts/po-cart-worker/shutdown-observation-audit.py');
const pyEnv={...process.env,PYTHONDONTWRITEBYTECODE:'1'};

// Only resource dependencies are replaced. The actual trial, observation,
// strict signal verification and disposal run without browsers or OS signals.
export async function runLifecycleScenario(root,{mode='complete',spec=diagnosisCases[0],faultStage,faultEvent,faultKind='write',recordEvent=()=>{},saveHook=()=>{}}={}){
 mkdirSync(root,{recursive:true,mode:0o700});root=resolve(root);
 const main=resolve(root,'Fixture.app/Contents/MacOS/Chrome'),profile=resolve(root,'profiles',hash(spec.id)),child=new EventEmitter();child.pid=1000;
 const world={stage:'executable',time:0,spawned:false,gone:false,pagesReady:false,populations:0,shutdown:false,reads:0,connects:0,
  mode,signals:[],events:[],writes:[],sourceChanged:false,faultUsed:false},control={stopping:false};
 const endChild=()=>{world.gone=true;if(mode!=='child_exit_timeout')child.emit('exit',0);};
 const baseRows=()=>[1000,1001,1002].map(pid=>({pid,parent:pid===1000?process.pid:1000,group:1000,state:'S',start,
  command:pid===1000?main+' '+(world.spawnArgs??[]).join(' '):main+' --type=renderer --user-data-dir='+profile,executable:main}));
 const members=()=>{
  if(!world.spawned||world.gone)return [];
  let rows=baseRows();
  if(world.stage==='startup'){
   if(mode==='leader_delayed'&&world.time<100)return [];
   if(mode==='leader_unowned')rows[0].parent=777;
   if(world.pagesReady){
    if(mode==='insufficient_members')rows=rows.slice(0,2);
    if(mode==='zombie_member')rows[1].state='Z';
    if(mode==='profile_argument_missing')rows[1].command='private unrelated TOKEN_DO_NOT_LOG';
    if(mode==='population_changes'&&world.populations===1)rows.push({...rows[2],pid:1003});
    if(mode==='population_never_stable')rows.push({...rows[2],pid:2000+world.populations});
   }
  }
  if(world.stage==='dispose'&&mode==='pid_reuse')rows[0].command='reused TOKEN_DO_NOT_LOG';
  if(world.stage==='observe'&&world.shutdown){
   if(['shutdown_timeout','escalation','pid_reuse'].includes(mode))return rows;
   if(mode==='start_mismatch')rows[1].start='Fri Oct 16 01:00:00 2026';
   else if(mode==='topology_mismatch')rows[1].group=777;
   else if(mode==='unexpected_member')rows.push({...rows[2],pid:7777});
   else if(mode==='signature'&&world.reads<=2){rows[1].command='(Chrome Renderer)';if(world.reads===2)rows.splice(1,1);}
   else{endChild();return [];}
  }
  return rows;
 };
 const idle={pid:99999,parent:1,group:99999,state:'S',start,command:'private unrelated TOKEN_DO_NOT_LOG',executable:'/private/DO_NOT_LOG'};
 const raw=rows=>rows.map(p=>`${p.pid} ${p.parent} ${p.group} ${p.state} ${p.start} ${p.command}`).join('\n');
 const io={now:()=>world.time,pause:async ms=>{world.time+=ms;},identityOutput:()=>{
  if(world.stage==='observe')world.reads++;
  if((mode==='malformed_identity'&&world.pagesReady&&world.stage==='startup')||(mode==='incomplete_observation'&&world.stage==='observe'))return 'malformed TOKEN_DO_NOT_LOG';
  return raw([...members(),idle]);
 },executableOutput:()=>{
  let rows=members();
  if(world.stage==='startup'&&world.pagesReady){
   if(mode==='malformed_metadata')return 'malformed TOKEN_DO_NOT_LOG';
   if(mode==='metadata_missing')rows=rows.filter(p=>p.pid!==1001);
   if(mode==='identity_metadata_mismatch')rows=rows.map(p=>p.pid===1001?{...p,start:'Fri Oct 16 01:00:00 2026'}:p);
   if(mode==='executable_not_allowed')rows=rows.map(p=>p.pid===1001?{...p,executable:'/private/TOKEN_DO_NOT_LOG'}:p);
  }
  if(world.stage==='observe'&&mode==='signature'&&world.reads===1)rows=rows.filter(p=>p.pid!==1001);
  return [...rows,idle].map(p=>`${p.pid} ${p.start} ${p.executable}`).join('\n');
 },signal:(pid,signal)=>{
  assert.ok(pid>0&&[1000,1001,1002].includes(pid));assert.ok(![4303,30474].includes(pid));world.signals.push({pid,signal});
  if(world.stage==='shutdown'){world.shutdown=true;return;}
  if(mode==='escalation'&&(signal==='SIGTERM'||pid!==1000))return;
  endChild();
 }};
 const page={goto:async()=>{world.pageCalls=(world.pageCalls??0)+1;if(mode==='pages_failed')throw Error('TOKEN_DO_NOT_LOG');if(mode==='pages_timeout')return new Promise(ok=>{world.releasePage=ok;});}};
 const session={send:async()=>{if(world.stage==='shutdown'){world.shutdown=true;if(mode==='protocol_late')return new Promise(ok=>{world.releaseClose=ok;});return;}endChild();}};
 const driver={contexts:()=>[{route:async()=>{},pages:()=>[page],newPage:async()=>page}],newBrowserCDPSession:async()=>session,
  isConnected:()=>!world.gone&&!['escalation','pid_reuse'].includes(mode),close:async()=>{}};
 const dependencies={executable:()=>{if(mode==='executable_lookup_failed')throw new DiagnosisError('fixture_executable_unavailable');return main;},
  proxy:async()=>{if(mode==='proxy_setup_failed')throw Error('TOKEN_DO_NOT_LOG');return {url:'http://127.0.0.1:1234',events:[],close:async()=>{
   if(mode==='proxy_close_failed')throw Error('TOKEN_DO_NOT_LOG');if(mode==='proxy_close_timeout')return new Promise(()=>{});
  }};},port:async()=>{if(mode==='port_setup_failed')throw Error('TOKEN_DO_NOT_LOG');return 2345;},
  spawn:(main,args)=>{
   if(mode==='spawn_throws')throw Error('TOKEN_DO_NOT_LOG');
   world.spawned=true;world.spawnArgs=mode==='network_boundary_unverified'?args.filter(a=>!a.startsWith('--proxy-server=')):args;
   if(mode==='spawn_failed'){child.pid=undefined;queueMicrotask(()=>child.emit('error',Error('TOKEN_DO_NOT_LOG')));}
   if(mode==='forbidden_pid')child.pid=4303;
   if(mode==='child_early_exit')queueMicrotask(endChild);
   return child;
  },connect:async()=>{world.connects++;if(mode==='cdp_unavailable'||(mode==='cdp_delayed'&&world.connects<3))throw Error('TOKEN_DO_NOT_LOG');return driver;},
  canonical:path=>{if(mode==='executable_resolution_failed')throw Error('TOKEN_DO_NOT_LOG');return mode==='executable_not_canonical'?path+'-link':path;},
  bounded:async(operation,ms,category)=>{
   if((mode==='pages_timeout'&&category==='fixture_startup_timeout')||(mode==='proxy_close_timeout'&&category==='proxy_close_timeout')){
    void operation().catch(()=>{});
    if(mode==='pages_timeout')for(let i=0;i<10&&!world.releasePage;i++)await Promise.resolve();
    world.time+=ms;throw new DiagnosisError(category);
   }
   return operation();
  }};
 if(mode==='stdio_open_failed')dependencies.open=()=>{throw Error('TOKEN_DO_NOT_LOG');};
 if(mode==='stdio_close_failed')dependencies.close=fd=>{closeSync(fd);throw Error('TOKEN_DO_NOT_LOG');};
 if(mode==='emergency_write_failed')dependencies.emergency=()=>{throw Error('TOKEN_DO_NOT_LOG');};
 const saveCase=(ref,value)=>{
  if(ref.includes('/lifecycle-')){
   world.stage=value.stage;
   if(value.event==='pages_ready')world.pagesReady=true;
   if(value.event==='population_decision')world.populations++;
   if(!world.faultUsed&&value.stage===faultStage&&value.event===(faultEvent??'enter')){
    world.faultUsed=true;
    if(faultKind==='interrupt')control.stopping=true;
    if(faultKind==='source')world.sourceChanged=true;
    if(faultKind==='write')throw Error('TOKEN_DO_NOT_LOG');
   }
  }
  if(mode==='observation_write_failed'&&ref.includes('/observation-'))throw Error('TOKEN_DO_NOT_LOG');
  if(mode==='baseline_write_failed'&&ref.endsWith('/baseline.json'))throw Error('TOKEN_DO_NOT_LOG');
  if(mode==='proxy_evidence_write_failed'&&ref.endsWith('/proxy.json'))throw Error('TOKEN_DO_NOT_LOG');
  if(['result_write_failed','emergency_write_failed'].includes(mode)&&ref.endsWith('/result.json'))throw Error('TOKEN_DO_NOT_LOG');
  saveHook(ref,value);const path=resolve(root,ref);mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});
  writeFileSync(path,JSON.stringify(value)+'\n',{mode:0o600});world.writes.push(ref);
 };
 const result=await runDiagnosticTrial(spec,{root,forbiddenPids:[4303,30474],checkSource:()=>{if(world.sourceChanged)throw Error('TOKEN_DO_NOT_LOG');},
  recordEvent:event=>{world.events.push(event);recordEvent(event);},saveCase,io,control,dependencies});
 world.lateChildError=()=>child.emit('error',Error('TOKEN_DO_NOT_LOG'));
 for(const ref of world.writes)assert.ok(!readFileSync(resolve(root,ref),'utf8').includes('TOKEN_DO_NOT_LOG'),ref);
 return {result,world,root};
}

function python(code,args=[]){const p=spawnSync('python3',['-c',code,auditor,...args],{encoding:'utf8',env:pyEnv});assert.equal(p.status,0,p.stderr);return p.stdout;}
const loadAudit="import importlib.util,json,pathlib,sys\ns=importlib.util.spec_from_file_location('a',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)\n";

export async function runLifecycleSuite(sandbox){
 const proofs=[];let number=0;
 const run=async options=>{const item=await runLifecycleScenario(join(sandbox,String(++number)),options);proofs.push(item);return item;};
 for(const spec of diagnosisCases){const {result,world}=await run({spec});assert.equal(result.completed,true);assert.equal(result.lifecycleEvidenceVersion,2);
  assert.equal(result.childExitObserved,true);assert.equal(result.network.proxyClosed,true);assert.deepEqual(result.secondaryFailures,[]);
  assert.equal(world.signals.length,spec.method==='SIGTERM'?1:0);}
 for(const mode of ['signature','leader_delayed','cdp_delayed','population_changes']){const {result}=await run({mode});assert.equal(result.completed,true,mode);assert.equal(result.signatureObserved,mode==='signature');}
 const late=await run({mode:'protocol_late',spec:diagnosisCases.find(c=>c.method==='protocol')});assert.equal(late.result.completed,true);
 const frozen=JSON.stringify(late.result);late.world.releaseClose();late.world.lateChildError();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(JSON.stringify(late.result),frozen);
 for(const mode of ['insufficient_members','zombie_member','profile_argument_missing','metadata_missing','identity_metadata_mismatch','executable_not_allowed','executable_not_canonical','executable_resolution_failed']){
  const {result,world}=await run({mode});assert.equal(result.completed,false);assert.equal(result.failure.condition,mode);
  assert.equal(result.failure.stage,'startup');assert.ok(result.failure.reference.includes('/lifecycle-'));assert.equal(world.signals.length,0);assert.equal(result.cleanup.verified,true);}
 for(const mode of ['malformed_identity','malformed_metadata','executable_lookup_failed','proxy_setup_failed','port_setup_failed','spawn_failed','child_early_exit','cdp_unavailable',
  'pages_failed','pages_timeout','population_never_stable','shutdown_timeout','start_mismatch','topology_mismatch','unexpected_member','incomplete_observation',
  'child_exit_timeout','proxy_close_failed','proxy_close_timeout','observation_write_failed','result_write_failed','baseline_write_failed','proxy_evidence_write_failed','network_boundary_unverified',
  'stdio_open_failed','stdio_close_failed','spawn_throws']){
  const {result,world}=await run({mode});assert.equal(result.completed,false,mode);assert.ok(result.failure?.stage,mode);assert.ok(result.failure?.condition,mode);assert.ok(result.failure.reference,mode);assert.ok(result.resultReference,mode);
  if(mode==='pages_timeout'){
   const calls=world.pageCalls,writes=world.writes.length;assert.equal(calls,1);world.releasePage();for(let i=0;i<10;i++)await Promise.resolve();
   assert.equal(world.pageCalls,calls,'Timed-out initialization issues no further CDP commands');assert.equal(world.writes.length,writes);
  }
  if(mode==='result_write_failed')assert.ok(result.resultReference.endsWith('/failure-result.json'));}
 const escalation=await run({mode:'escalation'});assert.equal(escalation.result.failure.category,'fixture_shutdown_timeout');
 assert.deepEqual(escalation.world.signals,[{pid:1000,signal:'SIGTERM'},{pid:1000,signal:'SIGTERM'},{pid:1002,signal:'SIGKILL'},{pid:1001,signal:'SIGKILL'},{pid:1000,signal:'SIGKILL'}]);
 const reuse=await run({mode:'pid_reuse'});assert.equal(reuse.result.failure.category,'fixture_shutdown_timeout');assert.ok(reuse.result.secondaryFailures.some(f=>f.category==='signal_ownership_unverified'));assert.equal(reuse.world.signals.length,1);
 const forbidden=await run({mode:'forbidden_pid'});assert.equal(forbidden.result.failure.category,'fixture_spawn_failed');assert.equal(forbidden.world.signals.length,0);
 const unowned=await run({mode:'leader_unowned'});assert.equal(unowned.result.failure.category,'fixture_startup_timeout');assert.equal(unowned.world.signals.length,0);
 for(const stage of lifecycleStages)for(const faultKind of ['interrupt','source','write']){
  const {result,world}=await run({faultStage:stage,faultKind});assert.equal(world.faultUsed,true,stage);assert.equal(result.completed,false,stage+' '+faultKind);assert.ok(result.failure);
  if(faultKind==='interrupt')assert.equal(result.failure.category,'interrupted');if(faultKind==='source')assert.equal(result.failure.category,'source_changed');}
 const endEvents={executable:'ready',proxy:'ready',port:'ready',spawn:'ready',startup:'stable',baseline:'verified',shutdown:'requested',observe:'exit_observed',dispose:'verified',child_exit:'verified',proxy_close:'verified',report:'terminal'};
 for(const [faultStage,faultEvent] of Object.entries(endEvents))for(const faultKind of ['interrupt','source','write']){
  const {result,world}=await run({faultStage,faultEvent,faultKind});assert.equal(world.faultUsed,true,faultStage);assert.equal(result.completed,false,faultStage+' after '+faultKind);assert.ok(result.failure);}
 const primary=await run({mode:'zombie_member',faultStage:'report',faultKind:'write'});assert.equal(primary.result.failure.condition,'zombie_member');assert.ok(primary.result.secondaryFailures.some(f=>f.category==='evidence_write_failed'));
 const noEmergency=await run({mode:'emergency_write_failed'});assert.equal(noEmergency.result.failure.condition,'result_write_failed');assert.equal(noEmergency.result.resultReference,undefined);
 assert.ok(noEmergency.result.secondaryFailures.some(f=>f.condition==='emergency_write_failed'));
 const intact=proofs.filter(p=>p.result.lifecycle.length&&p.result.resultReference&&!p.result.secondaryFailures.some(f=>f.category==='evidence_write_failed')&&!p.result.failure?.condition.includes('lifecycle_write_failed'));
 const input=join(sandbox,'audit-input.json');writeFileSync(input,JSON.stringify(intact.map(({root,result,world})=>({root,result,events:world.events,mode:world.mode}))));
 python(loadAudit+"for v in json.load(open(sys.argv[2])):\n a.ROOT=pathlib.Path(v['root']);r=v['result'];a.audit_case(r,{k:r[k] for k in ['id','method','delay','repetition']})\n if r.get('leader')!=4303:\n  a.save('historical-processes-before.json',{'processes':[{'pid':30474}]});a.audit_signals({'results':[r],'events':v['events']})\n",[input]);
 const broken=join(sandbox,'broken-input.json');writeFileSync(broken,JSON.stringify(proofs.filter(p=>!intact.includes(p)).map(({root,result})=>({root,result}))));
 python(loadAudit+"for v in json.load(open(sys.argv[2])):\n a.ROOT=pathlib.Path(v['root']);r=v['result']\n try:a.audit_case(r,{k:r[k] for k in ['id','method','delay','repetition']});raise RuntimeError('lost evidence accepted')\n except (AssertionError,FileNotFoundError):pass\n",[broken]);
 return proofs;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const sandbox=mkdtempSync(join(tmpdir(),'pantrack-lifecycle-'));
 try{
  const proofs=await runLifecycleSuite(sandbox),input=join(sandbox,'forgeries.json');writeFileSync(input,JSON.stringify({root:proofs[0].root,result:proofs[0].result}));
  python(loadAudit+`import tempfile,shutil,copy
v=json.load(open(sys.argv[2]));expected={k:v['result'][k] for k in ['id','method','delay','repetition']}
for mode in ['decision','missing','reorder','stable','cleanup','primary','version','pages','cdp','requested']:
 with tempfile.TemporaryDirectory() as d:
  a.ROOT=pathlib.Path(d);shutil.copytree(v['root'],d,dirs_exist_ok=True);r=copy.deepcopy(v['result'])
  def event(kind):
   ref=next(ref for ref in r['lifecycle'] if json.load(open(a.ROOT/ref))['event']==kind);return ref,json.load(open(a.ROOT/ref))
  if mode=='decision':
   ref,e=event('population_decision');e['decision']={'kind':'rejected','condition':'metadata_missing'};(a.ROOT/ref).write_text(json.dumps(e))
  if mode=='missing':(a.ROOT/r['lifecycle'][1]).unlink()
  if mode=='reorder':r['lifecycle'][1:3]=reversed(r['lifecycle'][1:3])
  if mode=='stable':r['startupStableReferences']=r['startupStableReferences'][::-1]
  if mode=='cleanup':
   ref,e=event('verified');e['event']='omitted';(a.ROOT/ref).write_text(json.dumps(e))
  if mode=='primary':r['failure']={'category':'ignored','stage':'startup','condition':'forged','reference':r['lifecycle'][0]}
  if mode=='version':r['lifecycleEvidenceVersion']=99
  if mode in ['pages','cdp','requested']:
   ref,e=event({'pages':'pages_ready','cdp':'cdp_ready','requested':'requested'}[mode]);e['event']='omitted';(a.ROOT/ref).write_text(json.dumps(e))
  (a.ROOT/r['resultReference']).write_text(json.dumps(r))
  try:a.audit_case(r,expected);raise RuntimeError('false success: '+mode)
  except (AssertionError,FileNotFoundError):pass
`,[input]);
  for(const controllerMode of ['complete','partial','partial_audit_failure']){
   const partial=controllerMode!=='complete';
   const cwd=join(sandbox,'controller-'+controllerMode);mkdirSync(cwd);process.chdir(cwd);mkdirSync(matrixRoot,{recursive:true,mode:0o700});
   writePrivate(matrixRoot+'/pipeline.json',{});writePrivate(matrixRoot+'/historical-processes-before.json',{processes:[{pid:30474}]});let trials=0,finalAudits=0;
   const report=await runFreshMatrix({operations:{validatePreparation:()=>({files:1,sha256:hash('simulated')}),verifyHistoricalReference:()=>{},checkSource:()=>{},
    runTrial:async(spec,options)=>{trials++;return (await runLifecycleScenario(matrixRoot,{spec,mode:partial&&trials===8?'zombie_member':'complete',recordEvent:options.recordEvent})).result;},
    audit:async operation=>{if(operation==='before')return;finalAudits++;
     python(loadAudit+"a.ROOT=pathlib.Path(sys.argv[2])\na.fixture_processes_gone=lambda results:None\na.historical_check=lambda:{'passed':True}\na.preservation=lambda:{'passed':True,'databaseDelta':[]}\na.audit_profile_drift=lambda:0\n"+
      (controllerMode==='partial_audit_failure'?"def lost_preservation():raise AssertionError('simulated preservation failure')\na.preservation=lost_preservation\n":"")+"a.finish()\n",[resolve(matrixRoot)]);
    }}});
   assert.equal(trials,partial?8:12);assert.equal(finalAudits,1);assert.equal(report.passed,!partial);
   if(partial){assert.equal(report.primaryFailure.condition,'zombie_member');assert.ok(report.primaryFailure.reference.includes('/lifecycle-'));assert.equal(report.audit.independentChecksPassed,controllerMode!=='partial_audit_failure');
    if(controllerMode==='partial_audit_failure')assert.ok(report.auditFailures.some(f=>f.category==='business_preservation_audit_failed'));}
   if(!partial){
    python(loadAudit+`import tempfile,shutil
original=pathlib.Path(sys.argv[2])
for mode in ['case_downgrade','report_unknown','forbidden_signal']:
 with tempfile.TemporaryDirectory() as d:
  a.ROOT=pathlib.Path(d);shutil.copytree(original,d,dirs_exist_ok=True)
  for name in ['verification-summary.json','preservation.json']:(a.ROOT/name).unlink()
  report=a.read('report.json')
  if mode=='case_downgrade':report['results'][0].pop('lifecycleEvidenceVersion')
  if mode=='report_unknown':report['lifecycleEvidenceVersion']=True
  if mode=='forbidden_signal':report['events'].append({'kind':'fixture_cleanup_signal','caseId':report['results'][0]['id'],'pid':4303,'signal':'SIGKILL'})
  (a.ROOT/'report.json').write_text(json.dumps(report))
  a.fixture_processes_gone=lambda results:None;a.historical_check=lambda:{'passed':True};a.preservation=lambda:{'passed':True,'databaseDelta':[]};a.audit_profile_drift=lambda:0
  summary=a.finish();assert summary['passed'] is False and summary['auditFailures']
`,[resolve(matrixRoot)]);
   }
   const forged=structuredClone(report);finalizeDiagnosticReport(forged,{...report.audit,lifecycleEvidenceVersion:1});assert.equal(forged.passed,false);process.chdir(repo);
  }
  console.log(`PASS actual browser lifecycle: ${proofs.length} simulated trials, twelve policies, startup refusals/readiness/stability, shutdown transitions, bounded disposal, forbidden targets/PID reuse, interruption/source/write faults at every phase, primary preservation, durable fallback, independent Python analysis and forged-success refusal; complete/partial actual-controller integration. No browsers, OS signals or private runtime evidence.`);
 }finally{process.chdir(repo);rmSync(sandbox,{recursive:true,force:true});}
}
