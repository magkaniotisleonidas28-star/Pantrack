import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,symlinkSync,existsSync,lstatSync,renameSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {singleRoot,singlePolicy,singleTargets,singleMemberPids,singleReferences,loadSingleEvidence,
 exactWorkerLock,validateSingleTargets,revalidateSingle,validateSinglePreparation,runSingleMaintenance} from '../scripts/po-cart-worker/single-instance-maintenance.mjs';
import {legacySnapshot,browserTargets,staleTarget} from '../scripts/po-cart-worker/legacy-profile-cleanup.mjs';
import {LegacyVerificationError} from '../scripts/po-cart-worker/legacy-profile-verification.mjs';
import {parseMaintenanceIdentity} from '../scripts/po-cart-worker/maintenance-shutdown-observation.mjs';
import {writePrivate} from '../scripts/po-cart-worker/private-files.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-single-instance-maintenance on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const hash=value=>createHash('sha256').update(value).digest('hex');
const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-single-maintenance-')));
const main=resolve(process.env.HOME??'','Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const source={files:1,sha256:hash('simulated frozen source')},start='Thu Oct 15 01:00:00 2026';
const auditPath=resolve('scripts/po-cart-worker/single-instance-maintenance-audit.py');
let count=0;
function fixture(mode='graceful'){
 const base=join(sandbox,String(++count));mkdirSync(base,{mode:0o700});
 const root=join(base,'proof'),profiles=join(base,'profiles');mkdirSync(root,{mode:0o700});mkdirSync(profiles);
 for(const t of [singleTargets[0],staleTarget])mkdirSync(join(profiles,t.profile));
 symlinkSync('fixture-'+30474,join(profiles,singleTargets[0].profile,'SingletonLock'));
 writeFileSync(join(profiles,singleTargets[0].profile+'.lock'),'30471',{mode:0o600});
 const stale=join(profiles,staleTarget.profile+'.lock');writeFileSync(stale,'4303',{mode:0o600});
 const baseline=singleMemberPids.map((pid,i)=>({pid,parent:i?30474:1,group:30474,state:'S',start,
  command:main+(i?' --type=renderer':'')+' --user-data-dir='+join(profiles,singleTargets[0].profile),executable:main}));
 const unrelated={pid:99999,parent:1,group:99999,state:'S',start,command:'TOKEN_MUST_NOT_LOG',executable:'/private/TOKEN_MUST_NOT_LOG'};
 let active=baseline.map(p=>({...p}));
 const world={time:0,phase:'strict',shutdown:false,shutdownReads:0,gone:false,signals:[],audits:[],sourceChanged:false};
 const control={stopping:false};
 const removeSingleton=()=>{const path=join(profiles,singleTargets[0].profile,'SingletonLock');if(existsSync(path)||lstatMaybe(path))rmSync(path);};
 const gone=()=>{active=[];world.gone=true;removeSingleton();};
 const identity=()=>{
  let rows=active.map(p=>({...p}));
  if(world.shutdown&&world.phase==='shutdown'){
   world.shutdownReads++;
   if(mode==='transition'){
    rows=rows.map(p=>p.pid===30480?{...p,command:'(Chrome Helper)'}:p);
    if(world.shutdownReads%2===0)rows=rows.filter(p=>p.pid!==30480);
   }
   if(mode==='changed_start')rows[1].start='Fri Oct 16 01:00:00 2026';
   if(mode==='new_member')rows.push({...rows[0],pid:90000,parent:30474});
   if(mode==='unavailable')throw Error('TOKEN_MUST_NOT_LOG');
  }
  if(world.shutdown&&mode==='reappearance'&&world.gone)rows.push({...baseline[1]});
  return parseMaintenanceIdentity([...rows,unrelated].map(p=>`${p.pid} ${p.parent} ${p.group} ${p.state} ${p.start} ${p.command}`).join('\n'));
 };
 const metadata=()=>{
  let rows=active;
  if(world.shutdown&&world.phase==='shutdown'&&mode==='transition')rows=rows.filter(p=>p.pid!==30480);
  return [...rows,unrelated].map(p=>`${p.pid} ${p.start} ${p.executable}`).join('\n');
 };
 const capture=options=>legacySnapshot({...options,identitySnapshot:identity,readExecutables:metadata,canonical:p=>p,evidenceOrigin:'simulated'});
 const io={canonical:p=>p,now:()=>world.time,
  snapshot:options=>{world.phase='strict';return capture(options);},
  shutdownSnapshot:options=>{world.phase='shutdown';return capture({...options,phase:'shutdown'});},
  pause:async()=>{world.time+=1000;if(['transition','reappearance'].includes(mode))gone();},
  signal:(pid,signal)=>{
   world.signals.push({pid,signal,time:world.time});
   if(mode==='signal_failed')throw Object.assign(Error('TOKEN_MUST_NOT_LOG'),{code:'EPERM'});
   if(signal==='SIGTERM'){world.shutdown=true;if(!['transition','escalation','stuck','changed_start','new_member','unavailable','reappearance'].includes(mode))gone();}
   if(signal==='SIGKILL'&&mode!=='stuck'){active=active.filter(p=>p.pid!==pid);if(!active.length){world.gone=true;removeSingleton();}}
  }};
 const old=exactWorkerLock(stale);
 const initial=parseMaintenanceIdentity(baseline.map(p=>`${p.pid} ${p.parent} ${p.group} ${p.state} ${p.start} ${p.command}`).join('\n'));
 const evidence={processes:initial.map(p=>({...p,profile:singleTargets[0].profile,kind:'profile_process'})),
  liveLocks:[{...staleTarget,kind:'worker'}],oldLock:old};
 mkdirSync(join(root,'verification'),{mode:0o700});
 const pipeline={source,passed:true,results:['typecheck','test','build'].map(id=>{
  const path=join(root,'verification',id+'.log');writeFileSync(path,'simulated preparation log',{mode:0o600});
  return {id,passed:true,exitCode:0,sourceBefore:source.sha256,sourceAfter:source.sha256,log:{path,sha256:hash(readFileSync(path))}};
 })};
 writePrivate(root+'/pipeline.json',pipeline);writePrivate(root+'/source-frozen.json',source);
 const write=(path,value)=>{
  if(value.stage==='lock_archive'&&mode==='archive_destination'&&!existsSync(root+'/archived-worker.lock'))writeFileSync(root+'/archived-worker.lock','foreign archive',{mode:0o600});
  if(value.events?.at(-1)?.kind==='signal_intent'){
   if(mode==='interrupt_on_intent')control.stopping=true;
   if(mode==='source_on_intent')world.sourceChanged=true;
   if(mode==='exit_on_intent')gone();
   if(mode==='forbidden_on_intent'&&!active.some(p=>p.pid===4303))active.push({...unrelated,pid:4303,group:4303});
   if(mode==='stale_changed_on_intent')writeFileSync(stale,'4304');
   if(mode==='archive_on_intent'&&!existsSync(root+'/archived-worker.lock'))writeFileSync(root+'/archived-worker.lock','foreign archive',{mode:0o600});
  }
  if(mode==='event_write'&&value.events?.at(-1)?.kind==='signal_intent')throw Error('TOKEN_MUST_NOT_LOG');
  writePrivate(path,value);
 };
 const audit=async phase=>{
  world.audits.push(phase);
  if(phase==='before'&&mode==='preaudit_failed')throw new LegacyVerificationError('audit_failed');
  if(phase==='guarded'&&mode==='guard_stolen'){
   const p=join(profiles,singleTargets[0].profile+'.lock.reclaim');renameSync(p,p+'.old');writeFileSync(p,'foreign guard',{mode:0o600});
  }
  if(phase==='guarded'&&mode==='guarded_failed')return {passed:false};
  if(phase==='finish'&&mode==='final_audit_failed')throw new LegacyVerificationError('audit_failed');
  return {passed:true,evidenceOrigin:'simulated'};
 };
 const options={root,profileRoot:profiles,io,control,snapshotSource:()=>world.sourceChanged?{...source,sha256:hash('changed')}:source,
  loadEvidence:()=>evidence,audit,preflight:()=>({passed:world.gone,status:world.gone?'idle':'historical_profiles_active'}),evidenceOrigin:'simulated',write};
 return {root,profiles,stale,baseline,initial,evidence,pipeline,world,options,io};
}
function lstatMaybe(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function python(code,args=[]){
 const result=spawnSync('python3',['-c',"import importlib.util,json,pathlib,sys\ns=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)\n"+code,auditPath,...args],
  {encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stderr);return result.stdout;
}
function files(root){
 return Object.fromEntries(readdirSync(root,{withFileTypes:true}).flatMap(p=>p.isDirectory()?Object.entries(files(join(root,p.name))).map(([k,v])=>[p.name+'/'+k,v]):p.isFile()?[[p.name,hash(readFileSync(join(root,p.name)))]]:[]));
}
try{
 assert.deepEqual(singleMemberPids,[30474,30480,30481,30482,30484,30487,30488,30493,30528]);
 assert.deepEqual(singleTargets,[browserTargets[2]]);
 assert.equal(singleRoot,'.sites-runtime/po-cart-workers/single-instance-maintenance-task-20261016');
 assert.equal(singlePolicy,'fixed-single-instance-maintenance-20261016');
 const admission=fixture(),observations=[];
 const rows=admission.io.snapshot({captured:admission.evidence.processes,root:admission.profiles,forbiddenPids:[4303],record:value=>{observations.push(value);return 'observations/'+String(observations.length).padStart(6,'0')+'.json';}});
 const plan=validateSingleTargets(admission.evidence,rows,{root:admission.profiles,io:admission.io});
 revalidateSingle(plan,rows,{root:admission.profiles,io:admission.io});
 for(const change of [
  {...admission.evidence,processes:admission.evidence.processes.slice(1)},
  {...admission.evidence,oldLock:{...admission.evidence.oldLock,mtimeNs:String(BigInt(admission.evidence.oldLock.mtimeNs)+1n)}},
  {...admission.evidence,oldLock:{...admission.evidence.oldLock,ino:1}},
 ])assert.throws(()=>validateSingleTargets(change,rows,{root:admission.profiles,io:admission.io}));
 assert.throws(()=>validateSingleTargets(admission.evidence,[...rows,{...rows[0],pid:4303}],{root:admission.profiles,io:admission.io}));
 assert.throws(()=>validateSingleTargets(admission.evidence,rows.map(p=>p.pid===30480?{...p,identity:hash('changed')}:p),{root:admission.profiles,io:admission.io}));
 assert.deepEqual(validateSinglePreparation(admission.pipeline,{root:admission.root,snapshot:()=>source}),source);
 for(const change of [
  {...admission.pipeline,passed:false},
  {...admission.pipeline,results:admission.pipeline.results.slice(1)},
  {...admission.pipeline,results:admission.pipeline.results.map((p,i)=>i? p:{...p,log:{...p.log,path:'/arbitrary/log'}})},
 ])assert.throws(()=>validateSinglePreparation(change,{root:admission.root,snapshot:()=>source}));

 const complete=[];
 for(const mode of ['graceful','transition','escalation','exit_on_intent','stuck','changed_start','new_member','unavailable','reappearance',
  'signal_failed','event_write','interrupt_on_intent','source_on_intent','forbidden_on_intent','stale_changed_on_intent','archive_on_intent',
  'preaudit_failed','guarded_failed','guard_stolen','archive_destination','final_audit_failed']){
  const f=fixture(mode),report=await runSingleMaintenance(f.options);
  const passed=['graceful','transition','escalation','exit_on_intent'].includes(mode);
  assert.equal(report.passed,passed,mode);assert.equal(f.world.audits.at(-1),'finish',mode);
  assert.equal(existsSync(f.root+'/task.json'),!['preaudit_failed','guarded_failed','guard_stolen'].includes(mode),mode);
  if(['event_write','interrupt_on_intent','source_on_intent','forbidden_on_intent','stale_changed_on_intent','archive_on_intent',
   'exit_on_intent','preaudit_failed','guarded_failed','guard_stolen'].includes(mode))assert.equal(f.world.signals.length,0,mode);
  assert.ok(f.world.signals.every(p=>singleMemberPids.includes(p.pid)&&p.pid!==4303));
  if(mode==='escalation'){assert.equal(f.world.signals.length,10);assert.equal(f.world.signals[1].time,5000);}
  if(mode==='stuck')assert.equal(f.world.time,10000);
  if(passed){
   assert.equal(existsSync(f.stale),false);assert.equal(readFileSync(f.root+'/archived-worker.lock','utf8'),'4303');
   assert.equal(report.operationComplete,true);complete.push(f);
  }else assert.ok(report.failure,mode);
  if(mode==='archive_destination')assert.equal(readFileSync(f.root+'/archived-worker.lock','utf8'),'foreign archive');
  if(mode==='guard_stolen')assert.equal(readFileSync(join(f.profiles,singleTargets[0].profile+'.lock.reclaim'),'utf8'),'foreign guard');
  assert.equal(existsSync(f.root+'/fresh-baseline.json'),false);
  const content=JSON.stringify(report);assert.ok(!content.includes('TOKEN_MUST_NOT_LOG'));assert.ok(!content.includes(main));
 }
 const proof=complete.find(f=>f.world.shutdownReads>0);
 python("for root in sys.argv[2:]:\n a.maintenance.audit_maintenance(root)\n try:a.maintenance.audit_maintenance(root,require_collected=True);raise RuntimeError('simulated proof accepted')\n except AssertionError:pass\n",complete.map(f=>f.root));
 python(`
import copy,os,shutil,tempfile
root=pathlib.Path(sys.argv[2]);a.ROOT=root
plan=a.read('targets-before.json');report=a.read('report.json');a.PROFILES=pathlib.Path(plan['directories'][0]['path'])
# Hermetic historical files are explicitly synthetic; the real-collected gate
# remains required by the fixed CLI and rejects this proof.
history={'processes':plan['captured']+[dict(pid=leader+i,parent=leader if i else 1,group=leader,identity='f'*64,profile=str(leader)) for leader in [30060,30082] for i in range(9)]}
a.HISTORY=root/'test-history.json';a.HISTORY.write_text(json.dumps(history));a.HISTORY_HASH=a.filehash(a.HISTORY)
a.LOCK_HISTORY=root/'test-lock-history.json'
for i in range(44):
 key=a.digest(('inactive-'+str(i)).encode());(a.PROFILES/key).mkdir()
 path=a.PROFILES/(key+'.lock');path.write_bytes(str(600000+i).encode());path.chmod(0o600)
entries=[]
for path in a.PROFILES.iterdir():
 if path.name.endswith('.lock'):entries.append(dict(path=str(path),**a.lock_fields(path)))
entries.append(dict(path=str(a.PROFILES/a.STALE),**a.lock_fields(root/'archived-worker.lock')))
a.LOCK_HISTORY.write_text(json.dumps(entries));a.LOCK_HISTORY_HASH=a.filehash(a.LOCK_HISTORY)
a.save('worker-locks-before.json',entries)
a.frozen_source=lambda:report['source']
assert a.binding(require_collected=False)['collected'] is False
assert a.signal_boundary(a.read('timeline.json'),plan)['closureEvents']==1
timeline=a.read('timeline.json')
intent=next(p for p in timeline if p['type']=='event' and p['event']['kind']=='signal_intent')
for change in ['repeat','group_signal','after_close']:
 bad=copy.deepcopy(timeline)
 if change=='repeat':bad.insert(bad.index(intent)+1,copy.deepcopy(intent))
 if change=='group_signal':bad.append({'type':'event','event':{'kind':'signal_group_sent','pid':30474,'signal':'SIGKILL'}})
 if change=='after_close':bad.append(copy.deepcopy(intent))
 try:a.signal_boundary(bad,plan);raise RuntimeError('invalid fixed signal boundary accepted: '+change)
 except AssertionError:pass
try:a.binding();raise RuntimeError('synthetic proof accepted as collected')
except AssertionError:pass
assert a.worker_locks()['preservedOtherWorkerLocks']==45
for key,value in [('policy','wrong'),('targets',[]),('source',{'files':1,'sha256':'0'*64}),('lifecycleEvidenceVersion',1),('historicalEvidence',{})]:
 bad=dict(report);bad[key]=value;(root/'report.json').write_text(json.dumps(bad))
 try:a.binding(require_collected=False);raise RuntimeError('forged binding accepted: '+key)
 except AssertionError:pass
 (root/'report.json').write_text(json.dumps(report))
bad=copy.deepcopy(plan);bad['captured'][1]['identity']='0'*64;(root/'targets-before.json').write_text(json.dumps(bad))
try:a.binding(require_collected=False);raise RuntimeError('captured identity changed')
except AssertionError:pass
(root/'targets-before.json').write_text(json.dumps(plan))
bad=copy.deepcopy(entries);next(p for p in bad if pathlib.Path(p['path']).name!=a.STALE)['mtimeNs']+=1
(root/'worker-locks-before.json').write_text(json.dumps(bad))
try:a.worker_locks();raise RuntimeError('one-nanosecond mismatch accepted')
except AssertionError:pass
(root/'worker-locks-before.json').write_text(json.dumps(entries))
guard=a.PROFILES/(a.PROFILE+'.lock.reclaim');guard.write_text('foreign')
try:a.worker_locks();raise RuntimeError('unexpected guard accepted')
except AssertionError:pass
guard.unlink()
normal={99999:dict(parent=1,group=99999,command='/unrelated')}
for index in range(3):
 for pid in [4303,30474,30060]:
  observations=[dict(normal) for _ in range(3)];observations[index][pid]=dict(parent=1,group=pid,command='/unrelated')
  sequence=iter(observations);a.process_rows=lambda metadata=False:next(sequence)
  try:a.independent_processes();raise RuntimeError('transient forbidden/historical PID accepted')
  except AssertionError:pass
sequence=iter([dict(normal) for _ in range(3)]);a.process_rows=lambda metadata=False:next(sequence)
assert a.independent_processes()['completeAbsence'] is True
first=a.fingerprint();before=copy.deepcopy(first);before['entries'][a.STALE]={'sha256':'original-lock'}
a.save('profiles-before.json',before);a.save('profiles-before-preparation.json',before)
for mode in ['valid','short_interval','unstable','wrong_hash']:
 with tempfile.TemporaryDirectory() as d:
  a.ROOT=pathlib.Path(d).resolve();shutil.copytree(root,a.ROOT,dirs_exist_ok=True)
  owner=json.loads((a.ROOT/'report.json').read_text());current=a.ROOT.stat();owner['rootIdentity']={'dev':current.st_dev,'ino':current.st_ino,'mode':current.st_mode};(a.ROOT/'report.json').write_text(json.dumps(owner))
  calls=[];a.idle_check=lambda name:calls.append(name)
  second=copy.deepcopy(first);second.update(startedAt=first['finishedAt']+(4 if mode=='short_interval' else 5),finishedAt=first['finishedAt']+6)
  if mode=='unstable':second['entries']['changed']={}
  if mode=='wrong_hash':second['sha256']='0'*64
  sequence=iter([first,second]);a.fingerprint=lambda:next(sequence);a.time.sleep=lambda seconds:calls.append(seconds)
  if mode=='valid':
   assert a.stability()['separationSeconds']>=5
   assert calls==['idle-before-stability.json','idle-between-stability.json',5,'idle-after-stability.json']
  else:
   try:a.stability();raise RuntimeError('false stability accepted: '+mode)
   except AssertionError:pass
  assert not (a.ROOT/'fresh-baseline.json').exists()
`,[proof.root]);

 const repeat=complete[0],before=files(repeat.root);
 await assert.rejects(runSingleMaintenance(repeat.options),error=>error.category==='invocation_consumed');assert.deepEqual(files(repeat.root),before);
 const concurrent=fixture();
 const raced=await Promise.allSettled([runSingleMaintenance(concurrent.options),runSingleMaintenance(concurrent.options)]);
 assert.equal(raced.filter(p=>p.status==='fulfilled'&&p.value.passed).length,1);
 assert.equal(raced.filter(p=>p.status==='rejected'&&p.reason.category==='invocation_consumed').length,1);
 assert.deepEqual(concurrent.world.audits,['before','guarded','finish']);
 for(const kind of ['existing_observation','existing_timeline','symlink_observations']){
  const f=fixture();let path;
  if(kind==='existing_timeline')path=f.root+'/timeline.json';
  else if(kind==='existing_observation'){
   mkdirSync(f.root+'/observations',{mode:0o700});path=f.root+'/observations/000001.json';
  }else{
   const outside=join(sandbox,'outside-'+count);mkdirSync(outside,{mode:0o700});
   symlinkSync(outside,f.root+'/observations');path=outside+'/000001.json';
  }
  writeFileSync(path,'retained evidence',{mode:0o600});const original=hash(readFileSync(path));
  const result=await runSingleMaintenance(f.options);
  assert.equal(result.passed,false);assert.equal(f.world.signals.length,0);assert.equal(existsSync(f.root+'/task.json'),false);
  assert.equal(hash(readFileSync(path)),original);assert.equal(f.world.audits.at(-1),'finish');
 }
 const foreignArchive=fixture();writeFileSync(foreignArchive.root+'/archived-worker.lock','foreign archive',{mode:0o600});
 const archiveRefusal=await runSingleMaintenance(foreignArchive.options);
 assert.equal(archiveRefusal.passed,false);assert.equal(foreignArchive.world.signals.length,0);assert.equal(existsSync(foreignArchive.root+'/task.json'),false);
 assert.equal(readFileSync(foreignArchive.root+'/archived-worker.lock','utf8'),'foreign archive');

 const cli=resolve('scripts/po-cart-single-instance-maintenance.mjs');
 for(const args of [['--help'],['--resume'],['--root',sandbox],['30474'],['--filter','SIGTERM']]){
  const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/accepts no arguments/);
 }
 const cold=join(sandbox,'cold');mkdirSync(cold);
 assert.notEqual(spawnSync(process.execPath,[cli],{cwd:cold,encoding:'utf8'}).status,0);
 assert.equal(existsSync(join(cold,singleRoot)),false);
 const invalidAudit=spawnSync('python3',[auditPath,'--root',sandbox],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.notEqual(invalidAudit.status,0);assert.match(invalidAudit.stderr,/Only fixed before\/guarded\/finish/);
 for(const flags of [['-O'],['-OO'],[]]){
  const optimizedAudit=spawnSync('python3',[...flags,auditPath,'finish'],{cwd:cold,encoding:'utf8',
   env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONOPTIMIZE:'1'}});
  assert.notEqual(optimizedAudit.status,0);assert.match(optimizedAudit.stderr,/Optimized fixed audit execution is not accepted/);
  assert.equal(existsSync(join(cold,singleRoot)),false);
 }

 const blocked=fixture('preaudit_failed');await runSingleMaintenance(blocked.options);
 python(`
root=pathlib.Path(sys.argv[2]);a.ROOT=root
plan=a.read('targets-before.json');a.PROFILES=pathlib.Path(plan['directories'][0]['path'])
history={'processes':plan['captured']+[dict(pid=leader+i,parent=leader if i else 1,group=leader,identity='f'*64,profile=str(leader)) for leader in [30060,30082] for i in range(9)]}
a.HISTORY=root/'test-history.json';a.HISTORY.write_text(json.dumps(history));a.HISTORY_HASH=a.filehash(a.HISTORY)
for i in range(44):
 key=a.digest(('inactive-'+str(i)).encode());(a.PROFILES/key).mkdir()
 path=a.PROFILES/(key+'.lock');path.write_bytes(str(600000+i).encode());path.chmod(0o600)
entries=[dict(path=str(path),**a.lock_fields(path)) for path in a.PROFILES.iterdir() if path.name.endswith('.lock')]
a.LOCK_HISTORY=root/'test-lock-history.json';a.LOCK_HISTORY.write_text(json.dumps(entries));a.LOCK_HISTORY_HASH=a.filehash(a.LOCK_HISTORY)
a.save('worker-locks-before.json',entries)
assert a.worker_locks(before=True)['archivedLocks']==0
guards=[]
for key in [a.PROFILE,a.STALE.removesuffix('.lock')]:
 path=a.PROFILES/(key+'.lock.reclaim');path.write_bytes(b'unit-owned-guard');path.chmod(0o600)
 record=dict(path=str(path),**a.lock_fields(path));record['mtimeNs']=str(record['mtimeNs']);guards.append(record)
a.save('guard-records.json',guards)
assert a.worker_locks(before=True,guarded=True)['guards']==2
guard_path=pathlib.Path(guards[0]['path']);guard_path.rename(str(guard_path)+'.old');guard_path.write_bytes(b'foreign');guard_path.chmod(0o600)
try:a.worker_locks(before=True,guarded=True);raise RuntimeError('replaced guard accepted')
except AssertionError:pass
now={p['pid']:dict(p,state='S') for p in plan['captured']};now[99999]=dict(parent=1,group=99999,command='/unrelated')
metadata={p['pid']:dict(p) for p in plan['captured']}
sequence=iter([now,metadata,now]);a.process_rows=lambda metadata=False:next(sequence)
assert a.independent_processes(before=True)['completeAbsence'] is False
bad={pid:dict(value) for pid,value in now.items()};bad[30480]['identity']='0'*64
sequence=iter([bad,metadata,now]);a.process_rows=lambda metadata=False:next(sequence)
try:a.independent_processes(before=True);raise RuntimeError('fresh ownership mismatch accepted')
except AssertionError:pass
`,[blocked.root]);
 python(`
root=pathlib.Path(sys.argv[2]);a.ROOT=root
report=a.read('report.json')
assert report['evidenceOrigin']=='simulated'
try:a.binding();raise RuntimeError('synthetic report passed real binding')
except (AssertionError,FileNotFoundError):pass
# All final groups execute even when binding and process verification refuse.
called=[]
def reject(name):
 def run():called.append(name);raise AssertionError(name)
 return run
for name in ['binding','lifecycle','independent_processes','worker_locks','preservation','stability','preparation']:
 setattr(a,name,reject(name))
value=a.finish()
assert value['passed'] is False and not (root/'fresh-baseline.json').exists()
assert value['primaryFailure']==report['failure']
assert called==['binding','lifecycle','independent_processes','worker_locks','preservation','stability','independent_processes','worker_locks','preservation','preparation']
assert len(value['auditFailures'])>=10
`,[blocked.root]);
 python(`
import tempfile,shutil
original=pathlib.Path(sys.argv[2]);report=json.loads((original/'report.json').read_text())
with tempfile.TemporaryDirectory() as d:
 a.ROOT=pathlib.Path(d).resolve();shutil.copytree(original,a.ROOT,dirs_exist_ok=True)
 current=a.ROOT.stat();report['rootIdentity']={'dev':current.st_dev,'ino':current.st_ino,'mode':current.st_mode};(a.ROOT/'report.json').write_text(json.dumps(report))
 calls=[]
 def passed(name,value):
  def run():calls.append(name);return value
  return run
 a.binding=passed('binding',{'source':report['source']})
 a.lifecycle=passed('lifecycle',{'passed':True})
 a.independent_processes=passed('processes',{'passed':True})
 a.worker_locks=passed('locks',{'passed':True})
 a.preservation=passed('preservation',{'passed':True})
 a.stability=passed('stability',{'profiles':{}})
 def changed_source():calls.append('source');raise AssertionError('source changed after hashing')
 a.preparation=changed_source
 result=a.finish()
 assert result['passed'] is False and result['operationComplete'] is True
 assert result['auditFailures']==[{'category':'final_source_failed'}]
 assert calls==['binding','lifecycle','processes','locks','preservation','stability','processes','locks','preservation','source']
 assert not (a.ROOT/'fresh-baseline.json').exists()
 # A failed atomic report update retains its original primary in the exclusive
 # fallback; final auditing must not replace it with a later audit failure.
 report['failure']={'category':'signal_failed','phase':'browser_shutdown'};report['failures']=[report['failure']]
 (a.ROOT/'failure-report.json').write_text(json.dumps(report));(a.ROOT/'failure-report.json').chmod(0o600)
 assert a.failure_report()['failure']==report['failure']
`,[complete[1].root]);
 python(`
key=a.PROFILE;stale=a.STALE
before={key+'/cache':{'sha256':'a'},stale:{'sha256':'lock'},'inactive/cache':{'sha256':'b'}}
after={key+'/cache':{'sha256':'c'},'inactive/cache':{'sha256':'b'}}
assert len(a.profile_changes(before,after,archived=True))==2
after['inactive/cache']={'sha256':'changed'}
try:a.profile_changes(before,after,archived=True);raise RuntimeError('inactive drift accepted')
except AssertionError:pass
assert a.ROOT==pathlib.Path('${singleRoot}') and a.POLICY=='${singlePolicy}' and a.PIDS==${JSON.stringify(singleMemberPids)}
`);
 assert.equal(existsSync(singleRoot),false,'Source-only tests must not create the production execution root');
 console.log('PASS single-instance maintenance: exact original nine-member admission and nanosecond lock binding, private frozen preparation, 21 injected controller modes plus concurrency/reuse/evidence ownership, strict signals and bounded waits, owned guards/archive refusal, durable ordered evidence, primary failures and all final audits, argument refusal, independent lock/process/stability checks and simulated-evidence rejection. No real maintenance or baseline.');
}finally{rmSync(sandbox,{recursive:true,force:true});}
