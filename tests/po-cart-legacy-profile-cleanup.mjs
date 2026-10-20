import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,utimesSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {browserTargets,staleTarget,validateLegacyTargets,verifyPopulation,acquireLegacyGuards,releaseLegacyGuards,
 verifyLegacyGuards,consumeMaintenance,closeLegacyBrowsers,archiveStaleLock,auditLegacyCleanup,lockRecord} from '../scripts/po-cart-worker/legacy-profile-cleanup.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-legacy-profile-cleanup on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-legacy-maintenance-')));
const hash=s=>createHash('sha256').update(s).digest('hex');
const executable=resolve(process.env.HOME,'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
let index=0;
function fixture(){
 const root=join(sandbox,String(index++));mkdirSync(root);
 for(const t of [...browserTargets,staleTarget])mkdirSync(join(root,t.profile));
 for(const t of browserTargets){symlinkSync('legacy-host-'+t.pid,join(root,t.profile,'SingletonLock'));writeFileSync(join(root,t.profile+'.lock'),String(t.pid-3));}
 const path=join(root,staleTarget.profile+'.lock');writeFileSync(path,'4303');utimesSync(path,new Date(100000),new Date(100000));
 const rows=browserTargets.flatMap(t=>Array.from({length:9},(_,i)=>({pid:t.pid+i,parent:i?t.pid:1,group:t.pid,
  identity:hash(String(t.pid+i)),zombie:false,executable,startedMs:200000,
  command:executable+(i?' --type=renderer':'')+' --user-data-dir='+join(root,t.profile)})));
 rows.push({pid:4303,parent:1,group:4303,identity:hash('applekeystored'),command:'/usr/libexec/applekeystored',executable:'/usr/libexec/applekeystored',startedMs:200000});
 const evidence={processes:rows.slice(0,27).map(p=>({...p,profile:browserTargets.find(t=>t.pid===p.group).profile})),liveLocks:[{...staleTarget,kind:'worker',identity:hash('applekeystored')}]};
 let current=rows.map(p=>({...p})),time=0;const signals=[];
 const io={snapshot:()=>current.map(p=>({...p})),canonical:p=>p,now:()=>time,pause:async()=>{time+=1000;},signal:(pid,kind)=>{signals.push({pid,kind,time});}};
 const plan=validateLegacyTargets(evidence,io.snapshot(),{root,io});
 return {root,path,evidence,io,plan,signals,rows:()=>current,set:rows=>{current=rows;},remove:pid=>{current=current.filter(p=>p.pid!==pid);}};
}
try{
 const f=fixture();assert.equal(f.plan.captured.length,27);
 // Sibling and personal profiles, and unrelated PID 4303, cannot be adopted.
 for(const command of ['Chrome --user-data-dir='+f.root+'-sibling/'+browserTargets[0].profile,'Chrome --user-data-dir=/personal/profile']){
  assert.equal(verifyPopulation([...f.rows(),{...f.rows().at(-1),pid:90000,parent:1,group:90000,command}],f.plan.captured,f.root).length,27);
 }
 for(const mutate of [
  rows=>rows.filter(p=>p.pid!==30060),
  rows=>rows.map(p=>p.pid===30060?{...p,identity:hash('reused')}:p),
  rows=>rows.map(p=>p.pid===30060?{...p,command:p.command+'suffix'}:p),
  rows=>rows.map(p=>p.pid===30060?{...p,executable:'/personal/Chrome'}:p),
  rows=>rows.map(p=>p.pid===30060?{...p,parent:42}:p),
  rows=>rows.map(p=>p.pid===4303?{...p,startedMs:50000}:p),
  rows=>rows.map(p=>p.pid===4303?{...p,executable:'/other/service'}:p),
  rows=>[...rows,{...rows[0],pid:9999,parent:30060}],
  rows=>[...rows,{...rows[0],pid:9999,command:'Chrome --user-data-dir='+join(f.root,staleTarget.profile)}],
 ])assert.throws(()=>validateLegacyTargets(f.evidence,mutate(f.rows()),{root:f.root,io:f.io}));
 assert.throws(()=>validateLegacyTargets(f.evidence,[],{root:f.root,io:f.io}));
 const guard=join(f.root,browserTargets[0].profile+'.lock.reclaim');writeFileSync(guard,'other owner');
 assert.throws(()=>acquireLegacyGuards(f.root));assert.equal(readFileSync(guard,'utf8'),'other owner');rmSync(guard);
 const guards=acquireLegacyGuards(f.root);verifyLegacyGuards(guards);assert.equal(guards.length,4);
 releaseLegacyGuards(guards);assert.ok(guards.every(g=>!existsSync(g.path)));
 // Acquisition failure after an earlier success releases only our earlier guard.
 const third=join(f.root,browserTargets[2].profile+'.lock.reclaim');writeFileSync(third,'retained');
 assert.throws(()=>acquireLegacyGuards(f.root));assert.equal(readFileSync(third,'utf8'),'retained');
 assert.equal(existsSync(guard),false);rmSync(third);
 const stolen=acquireLegacyGuards(f.root);renameSync(stolen[0].path,stolen[0].path+'.old');writeFileSync(stolen[0].path,stolen[0].token);
 assert.throws(()=>verifyLegacyGuards(stolen));assert.throws(()=>releaseLegacyGuards(stolen));assert.equal(readFileSync(stolen[0].path,'utf8'),stolen[0].token);
 assert.ok(stolen.slice(1).every(g=>!existsSync(g.path)));

 // Graceful leader exit must also account for every captured helper, in order.
 const graceful=fixture();graceful.io.signal=(pid,kind)=>{
  graceful.signals.push({pid,kind});graceful.set(graceful.rows().filter(p=>p.group!==pid));
 };
 const events=[];await closeLegacyBrowsers(graceful.plan,{io:graceful.io,root:graceful.root,record:e=>events.push(e)});
 assert.deepEqual(graceful.signals,browserTargets.map(t=>({pid:t.pid,kind:'SIGTERM'})));
 assert.equal(events.filter(e=>e.kind==='browser_closed').length,3);assert.equal(graceful.rows()[0].pid,4303);

 const forced=fixture();forced.io.signal=(pid,kind)=>{forced.signals.push({pid,kind,time:forced.io.now()});if(kind==='SIGKILL')forced.remove(pid);};
 await closeLegacyBrowsers(forced.plan,{io:forced.io,root:forced.root});
 assert.equal(forced.signals.filter(s=>s.kind==='SIGTERM').length,3);assert.equal(forced.signals.filter(s=>s.kind==='SIGKILL').length,27);
 assert.ok(forced.signals.every(s=>s.pid>0&&s.pid!==4303));
 assert.equal(forced.signals.find(s=>s.kind==='SIGKILL').time,5000);

 const stuck=fixture();await assert.rejects(closeLegacyBrowsers(stuck.plan,{io:stuck.io,root:stuck.root}),/exit unverified/);
 assert.equal(stuck.io.now(),10000);assert.ok(stuck.signals.every(s=>s.pid<30082));
 for(const change of ['descendant','reused','executable','interrupted','unavailable','source']){
  const c=fixture(),control={stopping:false};let badSource=false;
  c.io.pause=async()=>{
   if(change==='descendant')c.set([...c.rows(),{...c.rows()[0],pid:99000,parent:30060}]);
   if(change==='reused')c.set(c.rows().map(p=>p.pid===30060?{...p,identity:hash('new')}:p));
   if(change==='executable')c.set(c.rows().map(p=>p.pid===30060?{...p,executable:'/new/executable'}:p));
   if(change==='interrupted')control.stopping=true;
   if(change==='unavailable')c.io.snapshot=()=>{throw Error('unavailable');};
   if(change==='source')badSource=true;
  };
  await assert.rejects(closeLegacyBrowsers(c.plan,{io:c.io,root:c.root,control,checkSource:()=>{if(badSource)throw Error('source changed');}}));
  assert.deepEqual(c.signals.map(s=>[s.pid,s.kind]),[[30060,'SIGTERM']],change+' must stop without escalation or next browser');
 }
 // A new process appearing while signal intent is persisted is never signaled.
 const race=fixture();await assert.rejects(closeLegacyBrowsers(race.plan,{io:race.io,root:race.root,record:e=>{
  if(e.kind==='signal_intent')race.set([...race.rows(),{...race.rows()[0],pid:98000,parent:30060}]);
 }}));assert.equal(race.signals.length,0);

 const a=fixture(),archive=join(a.root,'archive');assert.throws(()=>archiveStaleLock(a.plan,{root:a.root,archive,io:a.io}),/shutdown incomplete/);
 a.set(a.rows().filter(p=>p.pid===4303));
 const original=readFileSync(a.path);archiveStaleLock(a.plan,{root:a.root,archive,io:a.io});
 assert.deepEqual(readFileSync(archive),original);assert.equal(existsSync(a.path),false);assert.deepEqual(lockRecord(archive),a.plan.lock);
 const auditOptions={root:a.root,archive,snapshot:a.io.snapshot,preflight:()=>({passed:true,status:'idle'})};
 assert.equal(auditLegacyCleanup(a.plan,auditOptions).passed,true);
 assert.throws(()=>auditLegacyCleanup(a.plan,{...auditOptions,snapshot:()=>[...a.rows(),{...a.plan.captured[0],command:'Chrome --user-data-dir='+join(a.root,browserTargets[0].profile)}]}));
 assert.throws(()=>auditLegacyCleanup(a.plan,{...auditOptions,snapshot:()=>a.rows().map(p=>({...p,identity:hash('new apple process')}))}));
 assert.throws(()=>auditLegacyCleanup(a.plan,{...auditOptions,preflight:()=>({passed:false,status:'historical_profiles_active'})}));
 writeFileSync(archive,'different bytes');assert.throws(()=>auditLegacyCleanup(a.plan,auditOptions));
 for(const change of ['inode','mtime','bytes','pid','live_profile']){
  const c=fixture();c.set(c.rows().filter(p=>p.pid===4303));
  if(change==='inode'){renameSync(c.path,c.path+'.old');writeFileSync(c.path,'4303');}
  if(change==='mtime')utimesSync(c.path,new Date(101000),new Date(101000));
  if(change==='bytes')writeFileSync(c.path,'4304');
  if(change==='pid')c.set(c.rows().map(p=>({...p,identity:hash('reused again')})));
  if(change==='live_profile')c.set([...c.rows(),{...c.plan.captured[0],pid:97000,command:'Chrome --user-data-dir='+join(c.root,staleTarget.profile)}]);
  assert.throws(()=>archiveStaleLock(c.plan,{root:c.root,archive:join(c.root,'archive'),io:c.io}),change);assert.equal(existsSync(c.path),true);
 }
 const consumeRoot=join(sandbox,'consume');mkdirSync(consumeRoot);consumeMaintenance(consumeRoot,{sha256:hash('source')});
 assert.throws(()=>consumeMaintenance(consumeRoot,{sha256:hash('source')}));
 for(const args of [['--help'],['--resume'],['--root',sandbox],['30060']]){
  const child=spawnSync(process.execPath,['scripts/po-cart-legacy-profile-cleanup.mjs',...args],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/accepts no arguments, overrides or resume/);
 }
 // Exercise the independent Python auditor against forged success reports.
 // It must inspect processes/locks itself; it cannot trust a runner boolean.
 const py=spawnSync('python3',['-c',`import importlib.util, pathlib, tempfile, json
s=importlib.util.spec_from_file_location('audit','scripts/po-cart-worker/legacy-profile-audit.py'); a=importlib.util.module_from_spec(s); s.loader.exec_module(a)
with tempfile.TemporaryDirectory() as d:
 a.ROOT=pathlib.Path(d); a.PROFILES=a.ROOT/'profiles'; a.PROFILES.mkdir()
 (a.ROOT/'report.json').write_text(json.dumps({'passed':True}))
 (a.ROOT/'targets-before.json').write_text(json.dumps({'captured':[{'pid':30060}],'untouched':{'identity':'wrong'}}))
 a.subprocess.check_output=lambda args:b'30060 1 30060 S Sun Oct 11 01:01:18 2026 Chrome\\n4303 1 4303 S Wed Oct 14 02:05:13 2026 /usr/libexec/applekeystored\\n'
 try:a.independent_process_audit(); raise RuntimeError('forged audit passed')
 except AssertionError as e:assert str(e)=='Target PID remains/reused'
 first=a.fingerprint(); (a.PROFILES/'cache').write_bytes(b'changed'); second=a.fingerprint(); assert first['sha256']!=second['sha256']
`],{encoding:'utf8'});
 assert.equal(py.status,0,py.stderr);
 console.log('PASS legacy maintenance: fixed target boundaries, identity/executable/PID reuse, new descendants, sequential graceful exit, bounded escalation, interruption/source/observation refusal, exclusive owned guards, byte/metadata-preserving lock archive, independent final audits and one-time argument-free CLI; no real process signals.');
}finally{rmSync(sandbox,{recursive:true,force:true});}
