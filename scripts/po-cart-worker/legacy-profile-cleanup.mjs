import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,readlinkSync,realpathSync,openSync,closeSync,writeFileSync,fsyncSync,unlinkSync,renameSync,linkSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {processControls} from './second-addition-cleanup.mjs';
import {historicalProfileRoot,historicalProfilesPreflight} from './profile-preservation-preflight.mjs';
import {LegacyVerificationError,legacyFailure} from './legacy-profile-verification.mjs';
import {captureMaintenanceObservation,parseMaintenanceIdentity} from './maintenance-shutdown-observation.mjs';

export const maintenanceRoot='.sites-runtime/po-cart-workers/legacy-profile-cleanup-task-20261015';
export const historicalEvidence='.sites-runtime/po-cart-workers/profile-preflight-source-task-20261015/observed-preflight.json';
export const historicalEvidenceHash='196d88a3cfc163b6742d9a20e2a414deafcf5d7330d30b6ec9f732cbf775571e';
export const browserTargets=[
 {pid:30060,profile:'0cb6c7898d4728682938e074a2c701500df57841d4620b99c5d740057f28d754'},
 {pid:30082,profile:'22776886a411811a4c53a017119217ada012618186faf680812903ed38e254f0'},
 {pid:30474,profile:'803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571'},
];
export const staleTarget={pid:4303,profile:'e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf'};
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(message,context={})=>{
 const category=/Guard ownership/.test(message)?'guard_ownership_changed'
  :/Guard release/.test(message)?'guard_release_failed'
  :/identity changed|ownership changed/.test(message)?'identity_changed'
  :/Unexpected legacy process/.test(message)?'unexpected_membership'
  :/observation unavailable/.test(message)?'process_observation_unavailable'
  :/signal failed/.test(message)?'signal_failed'
  :/exit unverified/.test(message)?'exit_timeout'
  :/interrupted/.test(message)?'interrupted'
  :/archive|Archived lock/.test(message)?'lock_archive_failed'
  :/audit|preflight/.test(message)?'audit_failed':'ownership_unverified';
 throw new LegacyVerificationError(category,context,message);
};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const exact=(p,root,key)=>new RegExp('(?:^|\\s)--user-data-dir(?:=|\\s+)'+escape(join(root,key))+'(?=\\s|$)').test(p.command);
const statRecord=s=>({dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,mode:s.mode});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const chromeBase=resolve(process.env.HOME??'','Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents');
const allowedExecutables=[join(chromeBase,'MacOS/Google Chrome for Testing'),
 ...['',' (Renderer)'].map(s=>join(chromeBase,'Frameworks/Google Chrome for Testing Framework.framework/Versions/149.0.7827.55/Helpers/Google Chrome for Testing Helper'+s+'.app/Contents/MacOS/Google Chrome for Testing Helper'+s))];

// Separate executable/start-time evidence supplements the historical ps identity.
// Neither full commands nor executable paths are written into public reports.
export function legacySnapshot({captured=[],root=historicalProfileRoot,record,forbiddenPids=[],absentPids=[],phase='strict',
 identitySnapshot=()=>parseMaintenanceIdentity(execFileSync('ps',['-axo','pid=,ppid=,pgid=,stat=,lstart=,command='],{encoding:'utf8'})),
 readExecutables=()=>execFileSync('ps',['-axo','pid=,lstart=,comm='],{encoding:'utf8'}),canonical=realpathSync,evidenceOrigin='collected'}={}){
 return captureMaintenanceObservation({identitySnapshot,readExecutables,captured,root,record,forbiddenPids,absentPids,phase,canonical,evidenceOrigin});
}
export const legacyIO={...processControls,snapshot:legacySnapshot,shutdownSnapshot:options=>legacySnapshot({...options,phase:'shutdown'}),canonical:realpathSync,now:()=>performance.now()};
export function loadHistoricalTargets(){
 const bytes=readFileSync(historicalEvidence);if(hash(bytes)!==historicalEvidenceHash)fail('Historical target evidence changed.');
 const evidence=JSON.parse(bytes);if(evidence.processes.length!==27)fail('Historical membership unavailable.');
 return evidence;
}
export function lockRecord(path){
 const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>64)fail('Unsafe worker lock.');
 const bytes=readFileSync(path);if(bytes.toString()!=='4303')fail('Worker lock target changed.');
 const after=lstatSync(path);if(!same(statRecord(s),statRecord(after)))fail('Worker lock changed during observation.');
 return {...statRecord(s),sha256:hash(bytes),pid:4303};
}
// Internal policies may select exact historical targets. The original CLI still
// uses its fixed three-instance policy and its permanently consumed root.
function validatedTargets(targets){
 if(!Array.isArray(targets)||!targets.length||new Set(targets.map(t=>t.pid)).size!==targets.length
  ||targets.some(t=>!browserTargets.some(old=>old.pid===t.pid&&old.profile===t.profile)))fail('Invalid historical target set.');
 return targets.map(t=>({...t}));
}
export function validateLegacyTargets(evidence,rows,{root=historicalProfileRoot,io=legacyIO,targets=browserTargets,pid4303Absent=false}={}){
 targets=validatedTargets(targets);
 if(!Array.isArray(rows)||!rows.length||new Set(rows.map(p=>p.pid)).size!==rows.length)fail('Process observation unavailable.');
 if(io.canonical(root)!==root)fail('Noncanonical profile root.');
 for(const {profile} of [...targets,staleTarget]){
  if(io.canonical(join(root,profile))!==join(root,profile))fail('Noncanonical target profile.');
  if(existsSync(join(root,profile+'.lock.reclaim')))fail('Existing reclamation guard.');
 }
 const captured=evidence.processes.map(old=>{
  const target=targets.find(t=>t.profile===old.profile),p=rows.find(p=>p.pid===old.pid);
  if(!target||!p||p.identity!==old.identity||p.parent!==old.parent||p.group!==old.group||p.zombie||!exact(p,root,old.profile)
   ||!allowedExecutables.includes(p.executable)||io.canonical(p.executable)!==p.executable||!Number.isFinite(p.startedMs))fail('Historical Chrome ownership changed.',{pid:old.pid,expectedIdentity:old.identity,observedIdentity:p?.identity});
  if(old.pid===target.pid&&(p.parent!==1||p.group!==p.pid||/--type=/.test(p.command)))fail('Legacy browser leader changed.');
  if(old.pid!==target.pid&&(p.parent!==target.pid||p.group!==target.pid||!/(?:^|\s)--type=/.test(p.command)))fail('Legacy browser helper changed.');
  return {...old,executable:p.executable,startedMs:p.startedMs,startHash:p.startHash,commandHash:p.commandHash};
 });
 for(const target of targets)if(captured.filter(p=>p.profile===target.profile).length!==9||!captured.some(p=>p.pid===target.pid))fail('Historical target membership changed.');
 verifyPopulation(rows,captured,root);
 const owner=rows.find(p=>p.pid===4303),old=evidence.liveLocks.find(l=>l.profile===staleTarget.profile&&l.kind==='worker');
 const lock=lockRecord(join(root,staleTarget.profile+'.lock'));
 if(pid4303Absent){
  requireStalePidAbsent(rows);
  if(!old||old.pid!==4303||rows.some(p=>exact(p,root,staleTarget.profile)))fail('Stale lock ownership unverified.');
 }else if(!old||old.pid!==4303||!owner||owner.identity!==old.identity||owner.executable!=='/usr/libexec/applekeystored'
  ||!Number.isFinite(owner.startedMs)||owner.startedMs<=lock.mtimeMs||rows.some(p=>exact(p,root,staleTarget.profile)))fail('Stale lock PID reuse unverified.');
 const directories=[root,...[...targets,staleTarget].map(t=>join(root,t.profile))].map(path=>{
  const s=lstatSync(path);return {path,dev:s.dev,ino:s.ino,mode:s.mode};
 });
 const ownership=targets.map(t=>{
  const singleton=join(root,t.profile,'SingletonLock'),worker=join(root,t.profile+'.lock');
  const s=lstatSync(singleton),link=readlinkSync(singleton),w=lstatSync(worker),bytes=readFileSync(worker);
  if(!s.isSymbolicLink()||Number(link.match(/-(\d+)$/)?.[1])!==t.pid||!w.isFile()||w.isSymbolicLink()
   ||!/^\d+$/.test(bytes.toString())||rows.some(p=>p.pid===Number(bytes.toString())))fail('Ambiguous profile lock ownership.');
  return {singleton:{path:singleton,...statRecord(s),sha256:hash(link)},worker:{path:worker,...statRecord(w),sha256:hash(bytes)}};
 });
 try{lstatSync(join(root,staleTarget.profile,'SingletonLock'));fail('Unexpected stale profile singleton.');}catch(e){if(e.code!=='ENOENT')throw e;}
 return {captured,lock,directories,ownership,targets,pid4303Absent,
  untouched:pid4303Absent?{pid:4303,absent:true}:{pid:4303,identity:owner.identity,executable:owner.executable,startedMs:owner.startedMs}};
}
export function requireStalePidAbsent(rows){
 const p=rows.find(p=>p.pid===4303);
 if(p)throw new LegacyVerificationError('process_appeared',{pid:4303,observedIdentity:p.identity});
}

export function verifyProfileOwnership(plan,{beforeShutdown=false}={}){
 for(const locks of plan.ownership){
  for(const [kind,before] of Object.entries(locks)){
   if(kind==='singleton'&&!beforeShutdown)continue; // Chrome removes its own singleton on exit.
   const s=lstatSync(before.path),sha256=hash(kind==='singleton'?readlinkSync(before.path):readFileSync(before.path));
   if((kind==='singleton'?!s.isSymbolicLink():!s.isFile()||s.isSymbolicLink())
    ||!same(statRecord(s),statRecord(before))||sha256!==before.sha256)fail('Profile lock ownership changed.');
  }
 }
}

export function verifyProfileDirectories(plan,io=legacyIO){
 for(const before of plan.directories){
  const s=lstatSync(before.path);
  if(!s.isDirectory()||s.isSymbolicLink()||io.canonical(before.path)!==before.path
   ||s.dev!==before.dev||s.ino!==before.ino||s.mode!==before.mode)fail('Profile directory identity changed.');
 }
}

// Reject unknown profile references, new descendants/group members and PID reuse
// globally, including while a different captured browser is being shut down.
export function verifyPopulation(rows,captured,root=historicalProfileRoot){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000||new Set(rows.map(p=>p.pid)).size!==rows.length
  ||rows.some(p=>!Number.isSafeInteger(p.pid)||p.pid<1||!Number.isSafeInteger(p.parent)||p.parent<0
   ||!Number.isSafeInteger(p.group)||p.group<1||typeof p.command!=='string'||!/^[a-f0-9]{64}$/.test(p.identity)))fail('Process observation unavailable.');
 const ids=new Set(captured.map(p=>p.pid)),groups=new Set(captured.map(p=>p.group));
 const descendants=new Set(ids);let changed=true;
 while(changed){changed=false;for(const p of rows)if(descendants.has(p.parent)&&!descendants.has(p.pid)){descendants.add(p.pid);changed=true;}}
 for(const p of rows){
  const old=captured.find(c=>c.pid===p.pid);
  const scoped=/(?:^|\s)--user-data-dir(?:=|\s+)/.test(p.command)&&new RegExp(escape(root)+'(?:[/\\\\\\s]|$)').test(p.command);
  if(!old&&(scoped||descendants.has(p.pid)||groups.has(p.group)))fail('Unexpected legacy process membership.',{pid:p.pid,observedIdentity:p.identity});
  if(old&&(p.identity!==old.identity||p.executable!==old.executable||p.startedMs!==old.startedMs||p.zombie||p.group!==old.group
   ||(p.parent!==old.parent&&p.parent!==1)||!exact(p,root,old.profile)))fail('Captured process identity changed.',{pid:p.pid,expectedIdentity:old.identity,observedIdentity:p.identity});
 }
 return rows.filter(p=>ids.has(p.pid)).map(p=>({...p,profile:captured.find(c=>c.pid===p.pid).profile}));
}
export function acquireLegacyGuards(root=historicalProfileRoot,targets=browserTargets){
 targets=validatedTargets(targets);
 const guards=[];
 try{
  for(const {profile} of [...targets,staleTarget]){
   const path=join(root,profile+'.lock.reclaim'),token=randomUUID(),fd=openSync(path,'wx',0o600);
   try{writeFileSync(fd,token);fsyncSync(fd);}finally{closeSync(fd);}
   guards.push({path,token,...statRecord(lstatSync(path))});
  }
  syncDirectory(root);return guards;
 }catch(error){
  const primary=error instanceof LegacyVerificationError?error:new LegacyVerificationError('ownership_unverified');
  try{releaseLegacyGuards(guards);}catch(releaseError){primary.secondaryFailures=[...(primary.secondaryFailures??[]),legacyFailure(releaseError,{phase:'guard_release',category:'guard_release_failed'})];}
  throw primary;
 }
}
function syncDirectory(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function releaseLegacyGuards(guards){
 const failures=[];
 for(const guard of guards){
  try{
   const s=lstatSync(guard.path);if(!s.isFile()||s.isSymbolicLink()||!same(statRecord(s),statRecord(guard))||readFileSync(guard.path,'utf8')!==guard.token)fail('Guard ownership changed.');
   unlinkSync(guard.path);syncDirectory(resolve(guard.path,'..'));
  }catch(error){failures.push(legacyFailure(error,{phase:'guard_release',category:'guard_release_failed'}));}
 }
 if(failures.length){const error=new LegacyVerificationError('guard_release_failed',{phase:'guard_release'},'Guard release unverified.');error.secondaryFailures=failures;throw error;}
}
export function verifyLegacyGuards(guards){
 for(const guard of guards){
  const s=lstatSync(guard.path);
  if(!s.isFile()||s.isSymbolicLink()||!same(statRecord(s),statRecord(guard))||readFileSync(guard.path,'utf8')!==guard.token)fail('Guard ownership changed.');
 }
}
export function consumeMaintenance(root,source,policy='fixed-legacy-profile-cleanup-20261015'){
 const fd=openSync(join(root,'task.json'),'wx',0o600);
 try{writeFileSync(fd,JSON.stringify({version:1,source,startedAt:new Date().toISOString(),policy})+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 syncDirectory(root);
}
export async function closeLegacyBrowsers(plan,{io=legacyIO,root=historicalProfileRoot,control={stopping:false},record=()=>{},recordObservation=()=>{},checkSource=()=>{}}={}){
 const absentPids=new Set();
 const observe=()=>{
  if(control.stopping)fail('Maintenance interrupted.');checkSource();verifyProfileDirectories(plan,io);verifyProfileOwnership(plan);
  const rows=io.snapshot({captured:plan.captured,root,record:recordObservation,forbiddenPids:plan.pid4303Absent?[4303]:[],absentPids:[...absentPids]});
  if(control.stopping)fail('Maintenance interrupted.');checkSource();verifyProfileDirectories(plan,io);verifyProfileOwnership(plan);
  if(plan.pid4303Absent)requireStalePidAbsent(rows);
  return verifyPopulation(rows,plan.captured,root);
 };
 const signal=(p,kind)=>{
  const current=observe().find(c=>c.pid===p.pid);if(!current)return;
  if(p.pid===4303||p.pid<=0)fail('Forbidden signal target.');
  record({kind:'signal_intent',pid:p.pid,identity:p.identity,signal:kind});
  // Persisting evidence can take time: recheck immediately before signaling.
  if(!observe().some(c=>c.pid===p.pid))return;
  try{io.signal(p.pid,kind);}catch(e){
   if(e.code==='ESRCH'){record({kind:'signal_not_sent',pid:p.pid,identity:p.identity,signal:kind,reason:'already_exited'});return;}
   fail('Process signal failed.',{pid:p.pid,expectedIdentity:p.identity,observedIdentity:current.identity,code:e.code});
  }
  record({kind:'signal_sent',pid:p.pid,identity:p.identity,signal:kind});
 };
 const observeShutdown=()=>{
  // Older injected snapshots retain their strict behavior. Production always
  // supplies the separate collector; tests of the new lifecycle use it too.
  if(!io.shutdownSnapshot)return observe();
  if(control.stopping)fail('Maintenance interrupted.');checkSource();verifyProfileDirectories(plan,io);verifyProfileOwnership(plan);
  const observation=io.shutdownSnapshot({captured:plan.captured,root,record:recordObservation,
   forbiddenPids:plan.pid4303Absent?[4303]:[],absentPids:[...absentPids]});
  if(control.stopping)fail('Maintenance interrupted.');checkSource();verifyProfileDirectories(plan,io);verifyProfileOwnership(plan);
  for(const pid of observation.absentPids)absentPids.add(pid);
  return observation.live;
 };
 const wait=async profile=>{
  const end=io.now()+5000;
  for(;;){const live=observeShutdown().filter(p=>p.profile===profile);if(!live.length)return true;if(io.now()>=end)return false;await io.pause();}
 };
 for(const target of plan.targets??browserTargets){
  observe();signal(plan.captured.find(p=>p.pid===target.pid),'SIGTERM');
  if(!await wait(target.profile)){
   for(const p of observe().filter(p=>p.profile===target.profile).reverse())signal(p,'SIGKILL');
   if(!await wait(target.profile))fail('Legacy browser exit unverified.',{pid:target.pid,expectedIdentity:plan.captured.find(p=>p.pid===target.pid).identity});
  }
  record({kind:'browser_closed',pid:target.pid,profile:target.profile});
 }
 if(observe().length)fail('Legacy processes remain.');
}
export function archiveStaleLock(plan,{root=historicalProfileRoot,archive=join(maintenanceRoot,'archived-worker.lock'),io=legacyIO,recordObservation=()=>{}}={}){
 verifyProfileDirectories(plan,io);
 const observe=()=>{
  const rows=io.snapshot({captured:plan.captured,root,record:recordObservation,forbiddenPids:plan.pid4303Absent?[4303]:[]});
  if(plan.pid4303Absent)requireStalePidAbsent(rows);
  if(verifyPopulation(rows,plan.captured,root).length)fail('Browser shutdown incomplete.');
  return rows;
 };
 const rows=observe();
 const p=rows.find(p=>p.pid===4303);
 if(!plan.pid4303Absent&&(!p||p.identity!==plan.untouched.identity||p.executable!==plan.untouched.executable||p.startedMs!==plan.untouched.startedMs
  ||p.startedMs<=plan.lock.mtimeMs||rows.some(p=>exact(p,root,staleTarget.profile))))fail('Stale lock owner changed.');
 const path=join(root,staleTarget.profile+'.lock');if(!same(lockRecord(path),plan.lock)||existsSync(archive))fail('Stale lock archive refused.');
 if(plan.pid4303Absent){observe();if(!same(lockRecord(path),plan.lock)||existsSync(archive))fail('Stale lock archive refused.');}
 if(plan.pid4303Absent){
  // Exclusive hard-link creation cannot overwrite a racing archive. Retain
  // both names on any subsequent refusal; never repair a partial archive.
  linkSync(path,archive);syncDirectory(resolve(archive,'..'));
  if(!same(lockRecord(archive),plan.lock)||!same(lockRecord(path),plan.lock))fail('Archived lock verification failed.');
  observe();if(!same(lockRecord(path),plan.lock))fail('Stale lock archive refused.');
  unlinkSync(path);
 }else renameSync(path,archive);
 syncDirectory(root);syncDirectory(resolve(archive,'..'));
 const archived=lockRecord(archive);if(!same(archived,plan.lock))fail('Archived lock verification failed.');
 if(plan.pid4303Absent)observe();
 return {path:archive,...archived};
}
export function auditLegacyCleanup(plan,{root=historicalProfileRoot,archive=join(maintenanceRoot,'archived-worker.lock'),snapshot=legacySnapshot,preflight=historicalProfilesPreflight,recordObservation=()=>{}}={}){
 verifyProfileDirectories(plan,{canonical:realpathSync});
 const rows=snapshot({captured:plan.captured,root,record:recordObservation,forbiddenPids:plan.pid4303Absent?[4303]:[]});if(verifyPopulation(rows,plan.captured,root).length)fail('Final process audit failed.');
 if(plan.pid4303Absent)requireStalePidAbsent(rows);
 const p=rows.find(p=>p.pid===4303);if(!plan.pid4303Absent&&(!p||p.identity!==plan.untouched.identity||p.executable!==plan.untouched.executable||p.startedMs!==plan.untouched.startedMs))fail('Untouched PID audit failed.');
 if(existsSync(join(root,staleTarget.profile+'.lock'))||!same(lockRecord(archive),plan.lock))fail('Final lock audit failed.');
 for(const {profile} of [...(plan.targets??browserTargets),staleTarget])if(existsSync(join(root,profile+'.lock.reclaim')))fail('Final guard audit failed.');
 const idle=preflight({root});if(!idle.passed||idle.status!=='idle')fail('Final idle preflight failed.');
 return {passed:true,targetProcessesGone:true,...(plan.pid4303Absent?{pid4303Absent:true}:{applekeystoredUntouched:true}),archiveVerified:true,guardsCleared:true,preflight:idle};
}
