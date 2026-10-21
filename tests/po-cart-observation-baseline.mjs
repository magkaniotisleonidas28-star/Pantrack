import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,symlinkSync,existsSync,lstatSync,readdirSync,chmodSync,utimesSync,readlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {baselineRoot,baselinePolicy,activeProfile,forbiddenPids,singletonLinkHash,baselineReferences,BaselineError,
 rejectBaselineArguments,loadBaselineEvidence,validateBaselinePreparation,runObservationBaseline,writeExclusive} from '../scripts/po-cart-worker/observation-baseline.mjs';
import {writePrivate} from '../scripts/po-cart-worker/private-files.mjs';

// POSIX-only: models macOS profile locks with symlinks, file modes and a python3 auditor.
if(process.platform==='win32'){console.log('SKIP po-cart-observation-baseline on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const hash=value=>createHash('sha256').update(value).digest('hex');
const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-observation-baseline-')));
const controllerPath=resolve('scripts/po-cart-worker/observation-baseline.mjs');
const auditPath=resolve('scripts/po-cart-worker/observation-baseline-audit.py');
const start='Wed Oct 21 09:00:00 2026',link='fixture-host-30474',stale='e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf';
const historicalPids=[30060,30066,30067,30068,30070,30072,30073,30074,30082,30088,30089,30090,30092,30093,30095,30096,30097,30115,
 30474,30480,30481,30482,30484,30487,30488,30493,30528];
const signals=[],realKill=process.kill;
// Any signal attempt during a lifecycle is a failure; existence probes are not used here either.
process.kill=(pid,signal)=>{signals.push({pid,signal});throw Error('Observation baseline must not signal.');};
let count=0;

function tree(root){
 const out={};
 const walk=dir=>{for(const name of readdirSync(dir).sort()){const path=join(dir,name),stat=lstatSync(path,{bigint:true});
  out[path.slice(root.length)]=[stat.ino,stat.mode,stat.size,stat.mtimeNs].join(':')+(stat.isFile()?':'+hash(readFileSync(path)):stat.isSymbolicLink()?':'+readlinkSync(path):'');
  if(stat.isDirectory())walk(path);}};
 walk(root);return out;
}
function exactLock(path){
 const stat=lstatSync(path,{bigint:true});
 return {name:path.split('/').pop(),ino:String(stat.ino),dev:String(stat.dev),mode:String(stat.mode),mtimeNs:String(stat.mtimeNs),sha256:hash(readFileSync(path))};
}
function fixture(mode='pass'){
 const base=join(sandbox,String(++count));mkdirSync(base,{mode:0o700});
 const root=join(base,'root'),profiles=join(base,'profiles');mkdirSync(root,{mode:0o700});mkdirSync(profiles);
 for(const key of [activeProfile,stale,'a'.repeat(64)])mkdirSync(join(profiles,key));
 writeFileSync(join(profiles,activeProfile,'Preferences'),'{}');
 symlinkSync(link,join(profiles,activeProfile,'SingletonLock'));
 writeFileSync(join(profiles,activeProfile+'.lock'),'30471',{mode:0o600});
 writeFileSync(join(profiles,stale+'.lock'),'4303',{mode:0o600});
 writeFileSync(join(profiles,'a'.repeat(64)+'.lock'),'12',{mode:0o600});
 const locks=[activeProfile,stale,'a'.repeat(64)].map(k=>exactLock(join(profiles,k+'.lock')));
 const world={source:{files:1,sha256:hash('simulated frozen source')},reads:0,audits:0,auditReport:null,preflights:0};
 mkdirSync(join(root,'verification'),{mode:0o700});
 const results=['typecheck','test','build'].map(id=>{
  const path=join(root,'verification',id+'.log');writeFileSync(path,id+' passed\n',{mode:0o600});
  return {id,passed:true,exitCode:0,sourceBefore:world.source.sha256,sourceAfter:world.source.sha256,log:{path,sha256:hash(readFileSync(path))}};
 });
 writePrivate(join(root,'pipeline.json'),{source:world.source,passed:true,results});
 const control={stopping:false};
 const evidence={historicalPids,locks,singletonLinkHash:hash(link)};
 const unrelated=`99999 1 99999 S ${start} /usr/bin/tool --password=TOKEN_MUST_NOT_LOG`;
 const io={readProcesses:()=>{
  world.reads++;
  if(mode==='unavailable')throw Error('TOKEN_MUST_NOT_LOG unavailable');
  const rows=[`1 0 1 Ss ${start} /sbin/launchd`,unrelated];
  const late=world.reads===2;
  if(mode==='reappearance'&&late)rows.push(`30480 30474 30474 S ${start} /chrome --type=renderer --user-data-dir=${join(profiles,activeProfile)} TOKEN_MUST_NOT_LOG`);
  if(mode==='pid_reuse')rows.push(`30480 1 30480 S Wed Oct 21 10:00:00 2026 /usr/bin/unrelated TOKEN_MUST_NOT_LOG`);
  if(mode==='forbidden')rows.push(`4303 1 4303 S ${start} /usr/bin/unrelated`);
  if(mode==='profile_reference')rows.push(`70000 1 70000 S ${start} /chrome --user-data-dir=${join(profiles,'a'.repeat(64))}`);
  if(mode==='source_after_preparation')world.source={files:1,sha256:hash('changed')};
  return rows.join('\n')+'\n';
 }};
 const preflight=({root:scanned})=>{
  world.preflights++;assert.equal(scanned,profiles);
  if(mode==='interrupt')control.stopping=true;
  if(mode==='preflight_unavailable')throw Error('TOKEN_MUST_NOT_LOG');
  return mode==='live_lock'?{version:1,passed:false,status:'historical_profiles_active',profiles:3,processes:[],liveLocks:[{profile:stale,kind:'worker',pid:4303,identity:'f'.repeat(64)}],staleLocks:2}
   :{version:1,passed:true,status:'idle',profiles:3,processes:[],liveLocks:[],staleLocks:3};
 };
 const audit=async({root:audited})=>{
  world.audits++;assert.equal(audited,root);
  world.auditReport=JSON.parse(readFileSync(join(root,'report.json'),'utf8'));
  if(mode==='audit_throws')throw Error('TOKEN_MUST_NOT_LOG');
  return {passed:!['audit_failed','collection_and_audit'].includes(mode),auditFailures:[],baselinePublished:mode!=='audit_failed'};
 };
 const replace=(path,value)=>{if(mode==='final_report_write'&&value.stage==='finished')throw Error('disk full');writePrivate(path,value);};
 const exclusive=(path,value)=>{if(mode==='evidence_write'&&path.endsWith('worker-locks.json'))throw Error('disk full');writeExclusive(path,value);};
 const options={root,profileRoot:profiles,io,control,snapshotSource:()=>world.source,loadEvidence:()=>evidence,preflight,audit,
  evidenceOrigin:'simulated',writer:{exclusive,replace}};
 return {base,root,profiles,world,control,options};
}
async function run(mode,setup=()=>{}){
 const f=fixture(mode);setup(f);
 const before=tree(f.profiles);
 const report=await runObservationBaseline(f.options);
 assert.deepEqual(tree(f.profiles),before,mode+': profiles and locks must remain untouched');
 assert.equal(f.world.audits,1,mode+': independent audit must always be attempted once');
 assert.equal(f.world.auditReport.stage,'independent_audit');
 for(const name of readdirSync(f.root))if(name.endsWith('.json'))assert.doesNotMatch(readFileSync(join(f.root,name),'utf8'),/TOKEN_MUST_NOT_LOG|password/,mode+': '+name);
 assert.deepEqual(JSON.parse(readFileSync(join(f.root,'report.json'),'utf8')).failure,mode==='final_report_write'?null:report.failure);
 return {...f,report};
}
function python(code,...args){
 const result=spawnSync('python3',['-c',"import importlib.util,json,pathlib,sys,os\ns=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)\n"+code,auditPath,...args],
  {encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim().split('\n').pop());
}

try{
 assert.equal(baselineRoot,'.sites-runtime/po-cart-workers/observation-baseline-task-20261021');
 assert.equal(baselinePolicy,'fixed-observation-baseline-20261021');
 assert.deepEqual(forbiddenPids,[4303]);
 assert.throws(()=>rejectBaselineArguments(['--root','/tmp']),/accepts no arguments/);

 // Static boundary: no signal, guard, consumption-record or archive path is
 // importable or callable from the controller, CLI or auditor.
 const controller=readFileSync(controllerPath,'utf8'),cli=readFileSync('scripts/po-cart-observation-baseline.mjs','utf8'),auditor=readFileSync(auditPath,'utf8');
 for(const text of [controller,cli])assert.doesNotMatch(text,/process\.kill|\.signal\(|SIGKILL|acquireLegacyGuards|releaseLegacyGuards|consumeMaintenance|archiveStaleLock|closeLegacyBrowsers|legacy-profile-cleanup|single-instance-maintenance|unlinkSync|renameSync|rmSync|profileLock/);
 assert.doesNotMatch(auditor,/os\.kill|import signal|signal\.|os\.remove|os\.unlink|os\.rename|shutil|single-instance-maintenance-audit|maintenance-observation-audit|legacy-profile-cleanup/);

 // Evidence loading binds exact bytes and keeps integer-nanosecond lock mtimes.
 const evidenceDir=join(sandbox,'evidence');mkdirSync(evidenceDir);
 const historyPath=join(evidenceDir,'history.json'),lockPath=join(evidenceDir,'locks.json');
 writeFileSync(historyPath,JSON.stringify({processes:historicalPids.map(pid=>({pid}))}));
 writeFileSync(lockPath,'['+Array.from({length:46},(_,i)=>`{"path":"p/${i}.lock","ino":${i},"dev":1,"mode":33152,"mtimeNs":1791682967426471099,"sha256":"${'0'.repeat(64)}"}`).join(',')+']');
 const references={historicalEvidence:{path:historyPath,sha256:hash(readFileSync(historyPath))},lockEvidence:{path:lockPath,sha256:hash(readFileSync(lockPath))}};
 const loaded=loadBaselineEvidence(references);
 assert.equal(loaded.historicalPids.length,27);assert.equal(loaded.locks.length,46);
 assert.equal(loaded.locks[0].mtimeNs,'1791682967426471099');assert.equal(loaded.singletonLinkHash,singletonLinkHash);
 assert.throws(()=>loadBaselineEvidence({...references,lockEvidence:{path:lockPath,sha256:'0'.repeat(64)}}),e=>e.category==='historical_evidence_changed');
 writeFileSync(historyPath,JSON.stringify({processes:historicalPids.slice(1).map(pid=>({pid}))}));
 assert.throws(()=>loadBaselineEvidence({...references,historicalEvidence:{path:historyPath,sha256:hash(readFileSync(historyPath))}}),e=>e.category==='historical_evidence_changed');
 assert.deepEqual(baselineReferences.lockEvidence.sha256,'84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701');

 // Preparation binds the frozen source and each private log.
 const prep=fixture();
 assert.deepEqual(validateBaselinePreparation(JSON.parse(readFileSync(join(prep.root,'pipeline.json'),'utf8')),{root:prep.root,snapshot:()=>prep.world.source}),prep.world.source);
 assert.throws(()=>validateBaselinePreparation(JSON.parse(readFileSync(join(prep.root,'pipeline.json'),'utf8')),{root:prep.root,snapshot:()=>({files:2,sha256:'x'})}),e=>e.category==='preparation_failed');
 writeFileSync(join(prep.root,'verification','test.log'),'tampered\n');
 assert.throws(()=>validateBaselinePreparation(JSON.parse(readFileSync(join(prep.root,'pipeline.json'),'utf8')),{root:prep.root,snapshot:()=>prep.world.source}),e=>e.category==='preparation_failed');

 // A complete observation passes, persists every read and sends no signal.
 const pass=await run('pass');
 assert.equal(pass.report.passed,true);assert.equal(pass.report.status,'complete');
 assert.deepEqual(pass.report.collection,{passed:true,processReads:[2,2],historicalPidsAbsent:27,forbiddenPidsAbsent:1,preflight:'idle',profiles:3,
  workerLocks:3,singletonRetained:true,signalsSent:0});
 for(const name of ['processes-before.json','preflight.json','worker-locks.json','singleton.json','processes-after.json'])assert.ok(existsSync(join(pass.root,name)),name);
 assert.equal(lstatSync(join(pass.root,'worker-locks.json')).mode&0o777,0o600);
 assert.equal(pass.world.auditReport.collection.passed,true);assert.equal(pass.world.auditReport.failure,null);
 assert.deepEqual(pass.report.independent,{passed:true,auditFailures:[],baselinePublished:true});

 // The exclusive report is single-use: reuse and a concurrent loser change nothing.
 const reportBytes=readFileSync(join(pass.root,'report.json'));
 await assert.rejects(runObservationBaseline(pass.options),e=>e instanceof BaselineError&&e.category==='invocation_consumed');
 assert.deepEqual(readFileSync(join(pass.root,'report.json')),reportBytes);assert.equal(pass.world.audits,1);
 const race=fixture();
 const settled=await Promise.allSettled([runObservationBaseline(race.options),runObservationBaseline(race.options)]);
 assert.deepEqual(settled.map(s=>s.status).sort(),['fulfilled','rejected']);
 assert.equal(settled.find(s=>s.status==='rejected').reason.category,'invocation_consumed');
 assert.equal(JSON.parse(readFileSync(join(race.root,'report.json'),'utf8')).attemptId,settled.find(s=>s.status==='fulfilled').value.attemptId);
 assert.equal(race.world.audits,1);

 // Unsafe or missing roots are refused before any write.
 const missing=fixture();rmSync(missing.root,{recursive:true});
 await assert.rejects(runObservationBaseline(missing.options),e=>e.category==='ownership_unverified');assert.equal(existsSync(missing.root),false);
 const open=fixture();chmodSync(open.root,0o755);
 await assert.rejects(runObservationBaseline(open.options),e=>e.category==='ownership_unverified');assert.equal(existsSync(join(open.root,'report.json')),false);

 // Every blocking condition retains its first failure and the persisted read that caused it.
 const blocked=[
  ['reappearance','historical_process_present','processes-after.json'],
  ['pid_reuse','historical_process_present','processes-before.json'],
  ['forbidden','historical_process_present','processes-before.json'],
  ['profile_reference','historical_process_present','processes-before.json'],
  ['unavailable','observation_unavailable',null],
  ['preflight_unavailable','observation_unavailable',null],
  ['live_lock','profile_not_idle','preflight.json'],
  ['interrupt','interrupted',null],
  ['source_after_preparation','source_changed',null],
  ['evidence_write','evidence_write_failed','worker-locks.json'],
 ];
 for(const [mode,category,reference] of blocked){
  const result=await run(mode);
  assert.equal(result.report.passed,false,mode);assert.equal(result.report.status,'blocked',mode);
  assert.equal(result.report.failure.category,category,mode);
  if(reference&&mode!=='evidence_write'){assert.equal(result.report.failure.reference,reference,mode);assert.ok(existsSync(join(result.root,reference)),mode);}
  if(mode==='evidence_write'){assert.equal(result.report.failure.reference,reference);assert.equal(existsSync(join(result.root,reference)),false);}
  assert.equal(result.world.auditReport.failure.category,category,mode+': audit sees the saved primary failure');
  assert.deepEqual(result.report.failures.map(f=>f.category),[category],mode);
 }
 const reappeared=JSON.parse(readFileSync(join((await run('reappearance')).root,'processes-after.json'),'utf8'));
 assert.deepEqual(reappeared.scoped.map(p=>[p.pid,p.historicalPid,p.profileReference]),[[30480,true,true]]);
 const interrupted=await run('interrupt');assert.ok(existsSync(join(interrupted.root,'preflight.json')));assert.equal(existsSync(join(interrupted.root,'worker-locks.json')),false);

 // Lock, guard and singleton changes block without being repaired.
 const lockCases=[
  ['lock_bytes',f=>writeFileSync(join(f.profiles,stale+'.lock'),'4304'),'worker_lock_changed'],
  ['lock_mtime',f=>{const t=new Date('2026-10-10T00:00:00Z');utimesSync(join(f.profiles,stale+'.lock'),t,t);},'worker_lock_changed'],
  ['guard',f=>writeFileSync(join(f.profiles,activeProfile+'.lock.reclaim'),'',{mode:0o600}),'worker_lock_changed'],
  ['lock_removed',f=>rmSync(join(f.profiles,'a'.repeat(64)+'.lock')),'worker_lock_changed'],
  ['singleton_retarget',f=>{rmSync(join(f.profiles,activeProfile,'SingletonLock'));symlinkSync('fixture-host-30475',join(f.profiles,activeProfile,'SingletonLock'));},'singleton_changed'],
  ['singleton_missing',f=>rmSync(join(f.profiles,activeProfile,'SingletonLock')),'singleton_changed'],
 ];
 for(const [name,mutate,category] of lockCases){
  const result=await run(name,mutate);
  assert.equal(result.report.failure.category,category,name);assert.equal(result.report.passed,false,name);
 }

 // Audit failures block a clean collection; an earlier collection failure stays primary.
 const auditFailed=await run('audit_failed');
 assert.equal(auditFailed.report.passed,false);assert.equal(auditFailed.report.status,'blocked');
 assert.equal(auditFailed.report.failure.category,'audit_failed');assert.deepEqual(auditFailed.report.auditFailures,[{category:'independent_audit_failed'}]);
 const thrown=await run('audit_throws');assert.equal(thrown.report.passed,false);assert.equal(thrown.report.failure.category,'audit_failed');assert.equal(thrown.report.independent,null);
 const both=await run('collection_and_audit',f=>writeFileSync(join(f.profiles,stale+'.lock'),'4304'));
 assert.equal(both.report.failure.category,'worker_lock_changed');assert.deepEqual(both.report.failures.map(f=>f.category),['worker_lock_changed','audit_failed']);
 const finalWrite=await run('final_report_write');assert.equal(finalWrite.report.passed,false);assert.equal(finalWrite.report.status,'blocked');
 const prepFailed=await run('preparation',f=>writeFileSync(join(f.root,'verification','build.log'),'tampered\n'));
 assert.equal(prepFailed.report.failure.category,'preparation_failed');assert.equal(prepFailed.report.collection,null);
 assert.equal(existsSync(join(prepFailed.root,'processes-before.json')),false);
 assert.deepEqual(signals,[]);

 // The fixed CLI rejects arguments and cannot create its root in a cold directory.
 const cold=join(sandbox,'cold');mkdirSync(cold);
 const cliPath=resolve('scripts/po-cart-observation-baseline.mjs');
 const argued=spawnSync(process.execPath,[cliPath,'--root',cold],{cwd:cold,encoding:'utf8'});
 assert.notEqual(argued.status,0);assert.match(argued.stderr,/accepts no arguments/);
 const coldRun=spawnSync(process.execPath,[cliPath],{cwd:cold,encoding:'utf8'});
 assert.notEqual(coldRun.status,0);assert.match(coldRun.stderr,/ownership_unverified/);
 assert.deepEqual(readdirSync(cold),[]);

 // The independent auditor accepts only its fixed operation and refuses optimization.
 const invalidAudit=spawnSync('python3',[auditPath,'before'],{cwd:cold,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.notEqual(invalidAudit.status,0);assert.match(invalidAudit.stderr,/Only the fixed finish audit operation/);
 for(const flags of [['-O'],['-OO'],[]]){
  const optimized=spawnSync('python3',[...flags,auditPath,'finish'],{cwd:cold,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONOPTIMIZE:'1'}});
  assert.notEqual(optimized.status,0);assert.match(optimized.stderr,/Optimized fixed audit execution is not accepted/);
 }
 assert.deepEqual(readdirSync(cold),[]);

 // Independent audit groups against temporary resources; read-only primitives are injected.
 const auditCase=mode=>{
  const f=fixture(),identity=lstatSync(f.root);
  const report={version:1,policy:baselinePolicy,...baselineReferences,evidenceOrigin:mode==='simulated'?'simulated':'collected',
   rootIdentity:{dev:identity.dev,ino:identity.ino,mode:identity.mode},stage:'independent_audit',status:'running',source:f.world.source,
   collection:{passed:mode!=='collection_failed',signalsSent:0},failure:mode==='collection_failed'?{category:'worker_lock_changed'}:null,
   failures:mode==='collection_failed'?[{category:'worker_lock_changed'}]:[]};
  writePrivate(join(f.root,'report.json'),report);
  for(const name of ['processes-before.json','processes-after.json'])writePrivate(join(f.root,name),{rows:2,scoped:[]});
  writePrivate(join(f.root,'preflight.json'),{passed:true,status:'idle'});
  writePrivate(join(f.root,'singleton.json'),{linkHash:hash(link)});
  writePrivate(join(f.root,'worker-locks.json'),Array.from({length:3},(_,i)=>({name:i+'.lock'})));
  if(mode==='prior_baseline')writePrivate(join(f.root,'fresh-baseline.json'),{});
  const locks=[activeProfile,stale,'a'.repeat(64)].map(k=>{const p=join(f.profiles,k+'.lock'),s=lstatSync(p,{bigint:true});
   return {path:'x/'+k+'.lock',ino:Number(s.ino),dev:Number(s.dev),mode:Number(s.mode),mtimeNs:String(s.mtimeNs),sha256:hash(readFileSync(p))};});
  const lockFile=join(f.base,'locks.json');writeFileSync(lockFile,JSON.stringify(locks).replace(/"mtimeNs":"(\d+)"/g,'"mtimeNs":$1'));
  if(mode==='guard')writeFileSync(join(f.profiles,stale+'.lock.reclaim'),'',{mode:0o600});
  if(mode==='singleton'){rmSync(join(f.profiles,activeProfile,'SingletonLock'));symlinkSync('fixture-host-30475',join(f.profiles,activeProfile,'SingletonLock'));}
  return python(`
root=pathlib.Path(sys.argv[2]);profiles=pathlib.Path(sys.argv[3]);mode=sys.argv[5]
a.ROOT,a.PROFILES,a.LOCK_HISTORY,a.LOCK_COUNT=root,profiles,pathlib.Path(sys.argv[4]),3
a.historical_pids=lambda:${JSON.stringify(historicalPids)}
a.SINGLETON_HASH=a.digest(os.readlink(profiles/a.PROFILE/'SingletonLock').encode()) if mode!='singleton' else a.digest(b'${link}')
a.preparation=lambda:${JSON.stringify(f.world.source)}
a.preservation=lambda:dict(passed=True,historicalBusinessRows=0)
a.preflight=lambda:dict(passed=mode!='not_idle',status='idle' if mode!='not_idle' else 'historical_profiles_active')
rows={1:dict(parent=0,group=1,command='/sbin/launchd'),99999:dict(parent=1,group=99999,command='TOKEN_MUST_NOT_LOG')}
if mode=='reappearance':rows[30480]=dict(parent=1,group=30480,command='/usr/bin/unrelated')
if mode=='descendant':rows[71000]=dict(parent=1,group=30474,command='/usr/bin/orphan')
a.process_rows=lambda:rows
prior={a.PROFILE+'/Preferences':dict(sha256='old'),a.PROFILE+'/SingletonLock':dict(linkHash='kept'),'b'*64+'/History':dict(sha256='kept')}
current=dict(prior);current[a.PROFILE+'/Preferences']=dict(sha256='new')
if mode=='inactive':current['b'*64+'/History']=dict(sha256='changed')
if mode=='singleton_entry':current[a.PROFILE+'/SingletonLock']=dict(linkHash='changed')
a.prior_profiles=lambda:prior
calls=[]
def fingerprint():
    calls.append(1);first=len(calls)==1
    entries=dict(current) if first or mode!='unstable' else {**current,a.PROFILE+'/Cache':dict(sha256='late')}
    started=100.0 if first else (103.0 if mode=='short' else 106.0)
    return dict(startedAt=started,finishedAt=started+1,entries=entries,sha256=a.digest(json.dumps(entries,sort_keys=True).encode()))
a.fingerprint=fingerprint;a.time.sleep=lambda s:None
result=a.finish()
print(json.dumps(dict(passed=result['passed'],failures=[f['category'] for f in result['auditFailures']],published=result['baselinePublished'],
 baseline=(root/'fresh-baseline.json').exists() and mode!='prior_baseline',summary=(root/'verification-summary.json').exists())))
`,f.root,f.profiles,lockFile,mode);
 };
 const audited=auditCase('pass');
 assert.deepEqual(audited,{passed:true,failures:[],published:true,baseline:true,summary:true});
 const auditBlocked={
  collection_failed:['binding_failed'],simulated:['binding_failed'],prior_baseline:['binding_failed'],
  reappearance:['processes_failed','stability_failed','final_processes_failed'],descendant:['processes_failed','stability_failed','final_processes_failed'],
  guard:['worker_locks_failed','stability_failed','final_worker_locks_failed'],singleton:['singleton_failed','stability_failed','final_singleton_failed'],
  not_idle:['stability_failed'],inactive:['stability_failed'],singleton_entry:['stability_failed'],short:['stability_failed'],unstable:['stability_failed'],
 };
 for(const [mode,failures] of Object.entries(auditBlocked)){
  const result=auditCase(mode);
  assert.deepEqual(result,{passed:false,failures,published:false,baseline:false,summary:true},mode);
 }
 // The database inventory spans every local state directory, not only po-cart-workers.
 const dbCase=mode=>{
  const f=fixture(),identity=lstatSync(f.root),state=join(f.base,'state');
  for(const dir of ['po-cart-workers','cart-review-state/v3/d1'])mkdirSync(join(state,dir),{recursive:true});
  writeFileSync(join(state,'po-cart-workers','a.sqlite'),'');writeFileSync(join(state,'cart-review-state/v3/d1','b.sqlite'),'');
  writePrivate(join(f.root,'report.json'),{rootIdentity:{dev:identity.dev,ino:identity.ino,mode:identity.mode}});
  writePrivate(join(f.root,'database-before.json'),['po-cart-workers/a.sqlite','cart-review-state/v3/d1/b.sqlite'].map(p=>({path:join(state,p),tables:[]})));
  if(mode==='added')writeFileSync(join(state,'cart-review-state','c.sqlite'),'');
  if(mode==='removed')rmSync(join(state,'cart-review-state/v3/d1','b.sqlite'));
  return python(`
a.ROOT=pathlib.Path(sys.argv[2]);a.DATABASE_BASES=[pathlib.Path(sys.argv[3])]
a.legacy.audit_preservation=lambda:dict(passed=True,ordinaryFictionalSmokeRows=0,bookkeepingRowsChanged=0,databaseDelta=[])
try:a.preservation();print(json.dumps(dict(passed=True,paths=len(a.database_paths()))))
except AssertionError as error:print(json.dumps(dict(passed=False,error=str(error))))
`,f.root,state);
 };
 assert.deepEqual(dbCase('pass'),{passed:true,paths:2});
 for(const mode of ['added','removed'])assert.deepEqual(dbCase(mode),{passed:false,error:'Database files added/removed'},mode);
 // WAL-format backups copied without sidecars open read-only; live WAL frames stay visible.
 const walDir=join(sandbox,'wal');mkdirSync(walDir);
 assert.deepEqual(python(`
import sqlite3,shutil
d=pathlib.Path(sys.argv[2]);live=d/'live.sqlite';c=sqlite3.connect(live);c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA wal_autocheckpoint=0')
c.execute('CREATE TABLE t(v)');c.execute("INSERT INTO t VALUES ('kept')");c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
shutil.copyfile(live,d/'copy.sqlite');c.execute("INSERT INTO t VALUES ('wal-only')");c.commit()
try:sqlite3.connect('file:'+str(d/'copy.sqlite')+'?mode=ro',uri=True).execute('SELECT * FROM t').fetchall();plain='opened'
except sqlite3.OperationalError:plain='failed'
copy=[r[0] for r in a.legacy.open_readonly(d/'copy.sqlite').execute('SELECT v FROM t')]
current=[r[0] for r in a.legacy.open_readonly(live).execute('SELECT v FROM t ORDER BY rowid')]
print(json.dumps(dict(plain=plain,copy=copy,live=current,created=sorted(p.name for p in d.iterdir() if p.name.startswith('copy')))))
`,walDir),{plain:'failed',copy:['kept'],live:['kept','wal-only'],created:['copy.sqlite']});
 assert.match(readFileSync('scripts/po-cart-worker/legacy-profile-audit.py','utf8'),/connection = open_readonly\(entry\['path'\]\)/);
 const auditorSource=readFileSync(auditPath,'utf8');
 assert.match(auditorSource,/DATABASE_BASES = \[Path\('\.wrangler\/state'\), Path\('\.sites-runtime'\)\]/);
 console.log('Observation baseline controller, CLI and independent audit passed offline; no signal, guard, archive or real root was used.');
}finally{
 process.kill=realKill;
 rmSync(sandbox,{recursive:true,force:true});
}
