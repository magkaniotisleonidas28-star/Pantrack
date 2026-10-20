import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,utimesSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {browserTargets,staleTarget,verifyPopulation,acquireLegacyGuards,releaseLegacyGuards,verifyLegacyGuards,
 closeLegacyBrowsers,archiveStaleLock,auditLegacyCleanup,lockRecord,consumeMaintenance} from '../scripts/po-cart-worker/legacy-profile-cleanup.mjs';
import {remainingTargets,remainingPolicy,validateRemainingTargets,revalidateRemaining} from '../scripts/po-cart-worker/remaining-profile-cleanup.mjs';
import {reconcileLegacyObservation,createLegacyAttempt,LegacyVerificationError} from '../scripts/po-cart-worker/legacy-profile-verification.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-remaining-profile-cleanup on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-remaining-maintenance-')));
const hash=s=>createHash('sha256').update(s).digest('hex');
const executable=resolve(process.env.HOME??'','Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const unrelated={pid:99999,parent:1,group:99999,identity:hash('unrelated'),command:'/unrelated',executable:'/unrelated',startedMs:200000};
const reused4303={...unrelated,pid:4303,group:4303};
let index=0;
function fixture(){
 const root=join(sandbox,String(index++));mkdirSync(root);
 for(const t of [...browserTargets,staleTarget])mkdirSync(join(root,t.profile));
 for(const t of remainingTargets){symlinkSync('legacy-host-'+t.pid,join(root,t.profile,'SingletonLock'));writeFileSync(join(root,t.profile+'.lock'),String(t.pid-3));}
 const path=join(root,staleTarget.profile+'.lock');writeFileSync(path,'4303');utimesSync(path,new Date(100000),new Date(100000));
 const rows=remainingTargets.flatMap(t=>Array.from({length:9},(_,i)=>({pid:t.pid+i,parent:i?t.pid:1,group:t.pid,
  identity:hash(String(t.pid+i)),zombie:false,executable,startedMs:200000,
  command:executable+(i?' --type=renderer':'')+' --user-data-dir='+join(root,t.profile)})));
 const lock=lockRecord(path);
 const evidence={processes:rows.map(p=>({...p,profile:remainingTargets.find(t=>t.pid===p.group).profile})),
  liveLocks:[{...staleTarget,kind:'worker'}],oldLock:{...lock,mtimeNs:lock.mtimeMs*1e6}};
 let current=[...rows,unrelated],time=0;const signals=[];
 const io={snapshot:()=>current.map(p=>({...p})),canonical:p=>p,now:()=>time,pause:async()=>{time+=1000;},signal:(pid,kind)=>{signals.push({pid,kind,time});}};
 const plan=validateRemainingTargets(evidence,io.snapshot(),{root,io});
 return {root,path,evidence,io,plan,signals,rows:()=>current,set:r=>{current=r;},remove:pid=>{current=current.filter(p=>p.pid!==pid);}};
}
const refused=(fn,category)=>assert.throws(fn,e=>e.category===category);
try{
 assert.deepEqual(remainingTargets.map(t=>t.pid),[30082,30474]);
 const f=fixture();assert.equal(f.plan.captured.length,18);assert.equal(f.plan.pid4303Absent,true);
 // The already-closed first instance cannot be required, adopted, or signaled.
 assert.ok(!f.plan.captured.some(p=>p.pid===30060));
 const excluded={...f.rows()[0],pid:30060,parent:1,group:30060,command:'Chrome --user-data-dir='+join(f.root,browserTargets[0].profile)};
 assert.throws(()=>validateRemainingTargets(f.evidence,[...f.rows(),excluded],{root:f.root,io:f.io}));
 for(const mutate of [
  rows=>rows.filter(p=>p.pid!==30082),
  rows=>rows.map(p=>p.pid===30082?{...p,identity:hash('reused')}:p),
  rows=>rows.map(p=>p.pid===30082?{...p,executable:'/personal/Chrome'}:p),
  rows=>rows.map(p=>p.pid===30082?{...p,command:p.command+'suffix'}:p),
  rows=>[...rows,{...rows[0],pid:98000,parent:30082}],rows=>[...rows,reused4303],
 ])assert.throws(()=>validateRemainingTargets(f.evidence,mutate(f.rows()),{root:f.root,io:f.io}));
 assert.throws(()=>validateRemainingTargets({...f.evidence,oldLock:{...f.evidence.oldLock,ino:42}},f.rows(),{root:f.root,io:f.io}));
 assert.throws(()=>validateRemainingTargets({...f.evidence,processes:f.evidence.processes.slice(1)},f.rows(),{root:f.root,io:f.io}));
 assert.throws(()=>verifyPopulation([],f.plan.captured,f.root));
 const guard=join(f.root,remainingTargets[1].profile+'.lock.reclaim');writeFileSync(guard,'other owner');
 assert.throws(()=>acquireLegacyGuards(f.root,remainingTargets));assert.equal(readFileSync(guard,'utf8'),'other owner');
 assert.equal(existsSync(join(f.root,remainingTargets[0].profile+'.lock.reclaim')),false);rmSync(guard);
 const guards=acquireLegacyGuards(f.root,remainingTargets);assert.equal(guards.length,3);
 revalidateRemaining(f.plan,f.rows(),{root:f.root,io:f.io});verifyLegacyGuards(guards);releaseLegacyGuards(guards);
 const stolen=acquireLegacyGuards(f.root,remainingTargets);renameSync(stolen[0].path,stolen[0].path+'.old');writeFileSync(stolen[0].path,stolen[0].token);
 assert.throws(()=>verifyLegacyGuards(stolen));assert.throws(()=>releaseLegacyGuards(stolen));assert.ok(existsSync(stolen[0].path));
 assert.ok(stolen.slice(1).every(g=>!existsSync(g.path)));

 const graceful=fixture(),events=[];graceful.io.signal=(pid,kind)=>{
  graceful.signals.push({pid,kind});graceful.set(graceful.rows().filter(p=>p.group!==pid));
 };
 await closeLegacyBrowsers(graceful.plan,{io:graceful.io,root:graceful.root,record:e=>events.push(e)});
 assert.deepEqual(graceful.signals,remainingTargets.map(t=>({pid:t.pid,kind:'SIGTERM'})));
 assert.equal(events.filter(e=>e.kind==='browser_closed').length,2);
 const forced=fixture();forced.io.signal=(pid,kind)=>{forced.signals.push({pid,kind,time:forced.io.now()});if(kind==='SIGKILL')forced.remove(pid);};
 await closeLegacyBrowsers(forced.plan,{io:forced.io,root:forced.root});
 assert.equal(forced.signals.filter(s=>s.kind==='SIGTERM').length,2);assert.equal(forced.signals.filter(s=>s.kind==='SIGKILL').length,18);
 assert.ok(forced.signals.every(s=>s.pid>0&&s.pid!==4303&&s.pid!==30060));
 assert.equal(forced.signals.find(s=>s.kind==='SIGKILL').time,5000);
 const stuck=fixture();await assert.rejects(closeLegacyBrowsers(stuck.plan,{io:stuck.io,root:stuck.root}),e=>e.category==='exit_timeout');
 assert.equal(stuck.io.now(),10000);assert.ok(stuck.signals.every(s=>s.pid<30474));
 for(const change of ['descendant','reused','executable','interrupted','unavailable','source','pid4303']){
  const c=fixture(),control={stopping:false};let badSource=false;
  c.io.pause=async()=>{
   if(change==='descendant')c.set([...c.rows(),{...c.rows()[0],pid:98000,parent:30082}]);
   if(change==='reused')c.set(c.rows().map(p=>p.pid===30082?{...p,identity:hash('new')}:p));
   if(change==='executable')c.set(c.rows().map(p=>p.pid===30082?{...p,executable:'/new/executable'}:p));
   if(change==='interrupted')control.stopping=true;
   if(change==='unavailable')c.io.snapshot=()=>[];
   if(change==='source')badSource=true;
   if(change==='pid4303')c.set([...c.rows(),reused4303]);
  };
  await assert.rejects(closeLegacyBrowsers(c.plan,{io:c.io,root:c.root,control,checkSource:()=>{if(badSource)throw new LegacyVerificationError('source_changed');}}));
  assert.deepEqual(c.signals.map(s=>[s.pid,s.kind]),[[30082,'SIGTERM']],change);
 }
 const race=fixture();await assert.rejects(closeLegacyBrowsers(race.plan,{io:race.io,root:race.root,record:e=>{
  if(e.kind==='signal_intent')race.set([...race.rows(),reused4303]);
 }}),e=>e.category==='process_appeared'&&e.context.pid===4303);assert.equal(race.signals.length,0);
 // A transient PID 4303 seen only before, after, or in metadata always blocks.
 for(const phase of ['before','details','after']){
  const inputs={before:f.rows(),after:f.rows(),details:[],captured:f.plan.captured,root:f.root,forbiddenPids:[4303]};
  inputs[phase]=[...inputs[phase],reused4303];refused(()=>reconcileLegacyObservation(inputs),'process_appeared');
 }
 refused(()=>reconcileLegacyObservation({before:f.rows(),after:f.rows(),details:[],captured:f.plan.captured,root:f.root}),'executable_evidence_incomplete');
 const descendant={...f.rows()[0],pid:97000,parent:30082};
 refused(()=>reconcileLegacyObservation({before:[...f.rows(),descendant],after:[unrelated],details:[],captured:f.plan.captured,root:f.root}),'unexpected_membership');

 const a=fixture(),archive=join(a.root,'archive');assert.throws(()=>archiveStaleLock(a.plan,{root:a.root,archive,io:a.io}));
 a.set([unrelated]);const original=readFileSync(a.path);archiveStaleLock(a.plan,{root:a.root,archive,io:a.io});
 assert.deepEqual(readFileSync(archive),original);assert.deepEqual(lockRecord(archive),a.plan.lock);
 const opts={root:a.root,archive,snapshot:a.io.snapshot,preflight:()=>({passed:true,status:'idle'})};
 assert.equal(auditLegacyCleanup(a.plan,opts).passed,true);
 assert.throws(()=>auditLegacyCleanup(a.plan,{...opts,snapshot:()=>[unrelated,reused4303]}));
 assert.throws(()=>auditLegacyCleanup(a.plan,{...opts,preflight:()=>({passed:false,status:'historical_profiles_active'})}));
 for(const change of ['inode','mtime','bytes','pid','live_profile','destination','second_observation','post_archive','lock_race','archive_race']){
  const c=fixture(),out=join(c.root,'archive');c.set([unrelated]);
  if(change==='inode'){renameSync(c.path,c.path+'.old');writeFileSync(c.path,'4303');}
  if(change==='mtime')utimesSync(c.path,new Date(101000),new Date(101000));
  if(change==='bytes')writeFileSync(c.path,'4304');
  if(change==='pid')c.set([unrelated,reused4303]);
  if(change==='live_profile')c.set([unrelated,{...c.plan.captured[0],pid:97000,command:'Chrome --user-data-dir='+join(c.root,staleTarget.profile)}]);
  if(change==='destination')writeFileSync(out,'another archive');
  if(['second_observation','post_archive'].includes(change)){let n=0;c.io.snapshot=()=>++n===(change==='second_observation'?2:3)?[unrelated,reused4303]:[unrelated];}
  if(['lock_race','archive_race'].includes(change)){let n=0;c.io.snapshot=()=>{if(++n===2){if(change==='lock_race')writeFileSync(c.path,'4304');else writeFileSync(out,'racing archive');}return [unrelated];};}
  assert.throws(()=>archiveStaleLock(c.plan,{root:c.root,archive:out,io:c.io}),change);
  assert.equal(existsSync(c.path),true);
  if(change==='post_archive')assert.deepEqual(lockRecord(out),c.plan.lock);
  if(change==='destination')assert.equal(readFileSync(out,'utf8'),'another archive');
 }

 const attemptRoot=join(sandbox,'attempt');mkdirSync(attemptRoot);const attempt=createLegacyAttempt(attemptRoot,{policy:remainingPolicy});
 attempt.stage('browser_shutdown');const ref=attempt.observation({outcome:'blocked'});
 attempt.fail(new LegacyVerificationError('process_appeared',{pid:4303,reference:ref}));attempt.fail(new LegacyVerificationError('guard_release_failed'));attempt.finish();
 assert.equal(attempt.state.failure.reference,'observations/000001.json');assert.equal(attempt.state.failure.pid,4303);
 assert.equal(attempt.state.failure.category,'process_appeared');assert.equal(attempt.state.failures[1].category,'guard_release_failed');
 refused(()=>createLegacyAttempt(attemptRoot,{}),'invocation_consumed');
 const consumed=join(sandbox,'consumed');mkdirSync(consumed);consumeMaintenance(consumed,{sha256:hash('source')},remainingPolicy);
 refused(()=>createLegacyAttempt(consumed,{}),'invocation_consumed');assert.equal(existsSync(join(consumed,'report.json')),false);
 const concurrent=join(sandbox,'concurrent');mkdirSync(concurrent);
 const code=`import {createLegacyAttempt} from ${JSON.stringify(resolve('scripts/po-cart-worker/legacy-profile-verification.mjs'))};try{createLegacyAttempt(process.argv[1],{policy:${JSON.stringify(remainingPolicy)}}).finish();}catch{process.exitCode=2;}`;
 const launch=()=>new Promise(ok=>{const child=spawn(process.execPath,['--input-type=module','-e',code,concurrent],{stdio:'ignore'});child.on('exit',ok);});
 assert.deepEqual((await Promise.all([launch(),launch()])).sort(),[0,2]);
 for(const args of [['--help'],['--resume'],['--root',sandbox],['30060']]){
  const child=spawnSync(process.execPath,['scripts/po-cart-remaining-profile-cleanup.mjs',...args],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/accepts no arguments, overrides or resume/);
 }
 const py=spawnSync('python3',['-c',`import importlib.util,pathlib,tempfile,json,os
s=importlib.util.spec_from_file_location('audit','scripts/po-cart-worker/remaining-profile-audit.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
with tempfile.TemporaryDirectory() as d:
 a.ROOT=pathlib.Path(d);a.PROFILES=a.ROOT/'profiles';a.PROFILES.mkdir()
 a.HISTORY=a.ROOT/'history.json';a.LOCK_HISTORY=a.ROOT/'locks.json'
 expected=[dict(pid=pid+i,identity='test',profile=key,parent=pid if i else 1,group=pid) for pid,key in zip([30082,30474],sorted(a.TARGETS)) for i in range(9)]
 a.HISTORY.write_text(json.dumps({'processes':expected}));a.HISTORY_HASH=a.filehash(a.HISTORY)
 a.LOCK_HISTORY.write_text('[]');a.LOCK_HISTORY_HASH=a.filehash(a.LOCK_HISTORY)
 (a.ROOT/'report.json').write_text(json.dumps({'passed':True}))
 (a.ROOT/'targets-before.json').write_text(json.dumps({'captured':[],'pid4303Absent':True}))
 try:a.independent_process_audit();raise RuntimeError('forged report passed')
 except AssertionError as e:assert str(e)=='Audit target boundary changed'
 (a.ROOT/'targets-before.json').write_text(json.dumps({'captured':expected,'pid4303Absent':True}))
 archive=a.ROOT/'archived-worker.lock';archive.write_bytes(b'4303');st=archive.stat()
 a.LOCK_HISTORY.write_text(json.dumps([dict(path=str(a.PROFILES/a.STALE),ino=st.st_ino,dev=st.st_dev,mtimeNs=st.st_mtime_ns,mode=st.st_mode,sha256=a.filehash(archive))]));a.LOCK_HISTORY_HASH=a.filehash(a.LOCK_HISTORY)
 for key in a.TARGETS|{a.STALE.removesuffix('.lock')}:(a.PROFILES/key).mkdir()
 for pid,reason in [(4303,'PID 4303 reappeared'),(30082,'Target PID remains/reused')]:
  observations=iter([{99999:dict(parent=1,group=99999,command='/unrelated')},{pid:dict(parent=1,group=pid,command='/unrelated')}])
  a.process_rows=lambda:next(observations)
  try:a.independent_process_audit();raise RuntimeError('false process success passed')
  except AssertionError as e:assert str(e)==reason
 before={a.STALE:{'sha256':'old'},next(iter(a.TARGETS))+'/cache':{'sha256':'old'},'other/cache':{'sha256':'old'}}
 after={next(iter(a.TARGETS))+'/cache':{'sha256':'new'},'other/cache':{'sha256':'old'}}
 assert len(a.audit_profile_changes(before,after))==2
 after['other/cache']={'sha256':'new'}
 try:a.audit_profile_changes(before,after);raise RuntimeError('unrelated drift passed')
 except AssertionError as e:assert str(e)=='Unrelated profile changed'
 # Exercise finalization refusal without filesystem/business fixtures. A false
 # runner report cannot bypass instability, non-idle checks or preservation.
 for failure in ['unstable','idle','preservation']:
  saved={};a.save=lambda name,value:saved.update({name:value})
  a.independent_process_audit=lambda:{'passed':True};a.audit_worker_locks=lambda:{'passed':True}
  def preservation():
   assert failure!='preservation','preservation refused'
   return {'passed':True}
  a.audit_preservation=preservation
  def idle(name):assert failure!='idle','idle refused'
  a.idle_check=idle;a.time.sleep=lambda seconds:None
  captures=iter([{'startedAt':0,'finishedAt':1,'entries':{'cache':1},'sha256':'a'},{'startedAt':6,'finishedAt':7,'entries':{'cache':2},'sha256':'b'}])
  a.fingerprint=lambda:next(captures)
  try:a.finish();raise RuntimeError('false baseline passed')
  except AssertionError:pass
  assert 'fresh-baseline.json' not in saved
`],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(py.status,0,py.stderr);
 console.log('PASS remaining maintenance: exact two-instance boundary, excluded first instance, PID reuse/transient descendants/incomplete evidence, bounded sequential signals, interruption and PID-4303 reappearance, owned guards, archival races, exclusive invocation and named primary failures, independent false-success/drift/idle/baseline refusal; simulated processes only.');
}finally{rmSync(sandbox,{recursive:true,force:true});}
