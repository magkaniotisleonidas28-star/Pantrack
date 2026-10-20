import {lstatSync,readdirSync,readFileSync,readlinkSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {processControls} from './second-addition-cleanup.mjs';

export const historicalProfileRoot=resolve('.sites-runtime/po-cart-workers/browser-profiles');
const keyPattern=/^[a-f0-9]{64}$/;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const unavailable=()=>({version:1,passed:false,status:'observation_unavailable',profiles:0,processes:[],liveLocks:[],staleLocks:0});
const safeProcess=p=>Number.isSafeInteger(p.pid)&&p.pid>0&&Number.isSafeInteger(p.parent)&&p.parent>=0
 &&Number.isSafeInteger(p.group)&&p.group>0&&typeof p.command==='string'&&/^[a-f0-9]{64}$/.test(p.identity);

// No command, lock target, raw error or arbitrary path enters the report.
// Zombie/helper/orphan processes still block: absence of a browser leader is
// not proof that its profile has stopped changing.
export function inspectHistoricalProfiles({root,profiles,locks,processes}){
 try{
  if(!Array.isArray(profiles)||profiles.length>10000||profiles.some(p=>!keyPattern.test(p))||new Set(profiles).size!==profiles.length
   ||!Array.isArray(processes)||!processes.length||processes.length>20000||processes.some(p=>!safeProcess(p))
   ||!Array.isArray(locks)||locks.some(l=>!profiles.includes(l.profile)||!['worker','singleton'].includes(l.kind)||!Number.isSafeInteger(l.pid)||l.pid<1))throw Error();
  const result={version:1,passed:true,status:'idle',profiles:profiles.length,processes:[],liveLocks:[],staleLocks:0};
  const reference=new RegExp('(?:^|\\s)--user-data-dir(?:=|\\s+)');
  const scoped=new RegExp(escape(root)+'(?:[/\\\\\\s]|$)');
  for(const p of processes){
   if(!reference.test(p.command))continue;
   const profile=profiles.find(key=>new RegExp('(?:^|\\s)--user-data-dir(?:=|\\s+)'+escape(join(root,key))+'(?=\\s|$)').test(p.command));
   if(profile||scoped.test(p.command))result.processes.push({pid:p.pid,parent:p.parent,group:p.group,identity:p.identity,
    profile:profile??null,kind:profile?'profile_process':'unknown_profile_reference'});
  }
  for(const lock of locks){
   const p=processes.find(p=>p.pid===lock.pid);
   if(p)result.liveLocks.push({...lock,identity:p.identity});else result.staleLocks++;
  }
  if(result.processes.length||result.liveLocks.length){result.passed=false;result.status='historical_profiles_active';}
  return result;
 }catch{return unavailable();}
}

function profileFiles(root){
 const profiles=[],locks=[];
 let initial;
 try{initial=lstatSync(root);}catch(e){if(e.code==='ENOENT')return {profiles,locks};throw e;}
 if(initial.isSymbolicLink()||!initial.isDirectory()||realpathSync(root)!==root)throw Error();
 const entries=readdirSync(root,{withFileTypes:true});
 for(const entry of entries){
  if(entry.name==='.DS_Store'&&entry.isFile())continue;
  const worker=entry.name.match(/^([a-f0-9]{64})\.lock$/);
  if(worker){
   const path=join(root,entry.name),stat=lstatSync(path);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64)throw Error();
   const value=readFileSync(path,'utf8');if(!/^\d+$/.test(value))throw Error();
   locks.push({profile:worker[1],kind:'worker',pid:Number(value)});continue;
  }
  // A reclamation guard or unknown entry means ownership is unresolved.
  if(!keyPattern.test(entry.name)||!entry.isDirectory())throw Error();
  const path=join(root,entry.name);if(realpathSync(path)!==path)throw Error();profiles.push(entry.name);
  try{
   const lock=join(path,'SingletonLock');if(!lstatSync(lock).isSymbolicLink())throw Error();
   const target=readlinkSync(lock),match=target.match(/-(\d+)$/);if(!match)throw Error();
   locks.push({profile:entry.name,kind:'singleton',pid:Number(match[1])});
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 // Worker locks may precede profile-directory creation.
 for(const lock of locks)if(!profiles.includes(lock.profile))profiles.push(lock.profile);
 const final=lstatSync(root);if(final.dev!==initial.dev||final.ino!==initial.ino||realpathSync(root)!==root)throw Error();
 return {profiles,locks};
}

export function historicalProfilesPreflight({root=historicalProfileRoot,snapshot=processControls.snapshot,readProfiles=profileFiles,now=()=>new Date().toISOString()}={}){
 let startedAt;
 try{
  startedAt=now();root=resolve(root);
  // Observe both sides of the filesystem read. A process seen in either
  // snapshot blocks, even if it exits while its profile/lock is inspected.
  const before=snapshot(),files=readProfiles(root),after=snapshot();
  const first=inspectHistoricalProfiles({root,...files,processes:before});
  const second=inspectHistoricalProfiles({root,...files,processes:after});
  const merged={...second,startedAt,finishedAt:now()};
  if(first.status==='observation_unavailable'||second.status==='observation_unavailable')return {...unavailable(),startedAt,finishedAt:merged.finishedAt};
  merged.processes=[...new Map([...first.processes,...second.processes].map(p=>[p.pid+':'+p.identity+':'+p.profile,p])).values()];
  merged.liveLocks=[...new Map([...first.liveLocks,...second.liveLocks].map(l=>[l.profile+':'+l.kind+':'+l.pid+':'+l.identity,l])).values()];
  merged.passed=first.passed&&second.passed;merged.status=merged.passed?'idle':'historical_profiles_active';return merged;
 }catch{return {...unavailable(),startedAt,finishedAt:now()};}
}

export function requireHistoricalProfilesIdle(check=historicalProfilesPreflight){
 let result;try{result=check();}catch{}
 if(result?.passed!==true||result.status!=='idle')throw Error('Historical profile preservation preflight blocked. Run node scripts/po-cart-profile-preflight.mjs for private evidence; no invocation was consumed.');
 return result;
}
