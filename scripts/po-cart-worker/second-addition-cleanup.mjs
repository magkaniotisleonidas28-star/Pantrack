import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';

const hash=s=>createHash('sha256').update(s).digest('hex');
export function parseProcessSnapshot(output){
 const lines=output.split('\n').filter(line=>line.trim());
 if(!lines.length)throw Error('Process snapshot unavailable.');
 return lines.map(line=>{
  const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
  if(!m)throw Error('Process snapshot unavailable.');
  return {pid:Number(m[1]),parent:Number(m[2]),group:Number(m[3]),zombie:m[4].startsWith('Z'),identity:hash(m[5]+'\0'+m[6]),command:m[6]};
 });
}
export const processControls={
 snapshot:()=>parseProcessSnapshot(execFileSync('ps',['-axo','pid=,ppid=,pgid=,stat=,lstart=,command='],{encoding:'utf8'})),
 signal:(pid,signal)=>process.kill(pid,signal),now:()=>Date.now(),pause:()=>new Promise(ok=>setTimeout(ok,50))
};
const exactProfile=(p,path)=>p.command.split(/\s+/).includes('--user-data-dir='+path);
async function waitGone(owned,io){
 const end=io.now()+5000;
 for(;;){
  const current=io.snapshot().find(p=>p.pid===owned.pid);
  if(!current)return true;
  if(current.identity!==owned.identity)throw Error('Process identity changed.');
  if(io.now()>=end)return false;
  await io.pause();
 }
}
async function terminate(owned,io,verify){
 const signal=kind=>{
  const current=io.snapshot().find(p=>p.pid===owned.pid);
  if(!current)return;
  if(current.identity!==owned.identity||!verify(current))throw Error('Process ownership cannot be verified.');
  io.signal(owned.pid,kind);
 };
 signal('SIGTERM');
 if(!await waitGone(owned,io)){signal('SIGKILL');if(!await waitGone(owned,io))throw Error('Process exit unverified.');}
}
// Only the exact canonical profile and direct child identity authorize a signal.
// Stale profile locks are evidence and are deliberately left on disk.
export async function cleanupTaskBrowser(profilePath,{workerPid=process.pid,io=processControls,canonical=realpathSync}={}){
 const path=resolve(profilePath);
 let actual;try{actual=canonical(path);}catch(e){if(e.code==='ENOENT')return {verified:true,forced:false};throw e;}
 if(actual!==path)throw Error('Canonical profile mismatch.');
 const matches=io.snapshot().filter(p=>exactProfile(p,path));
 if(matches.length===0)return {verified:true,forced:false};
 if(matches.length!==1||matches[0].parent!==workerPid||matches[0].command.split(/\s+/).some(s=>s.startsWith('--type=')))throw Error('Task browser ownership cannot be verified.');
 const owned=matches[0];let forced=false;
 const wrapped={...io,signal:(pid,kind)=>{if(kind==='SIGKILL')forced=true;io.signal(pid,kind);}};
 await terminate(owned,wrapped,p=>canonical(path)===path&&p.parent===workerPid&&exactProfile(p,path));
 if(io.snapshot().some(p=>exactProfile(p,path)))throw Error('Task browser remains.');
 return {verified:true,forced};
}

// Capture immediately after our detached spawn. Exit must be observed after
// escalation too; free-port checks are performed by the runner after this call.
export function capturePreview(child,io=processControls){
 const p=io.snapshot().find(p=>p.pid===child.pid);
 if(!p||p.parent!==process.pid||p.group!==child.pid||p.zombie)throw Error('Preview ownership unavailable.');return p;
}
export function observePreviewExit(child){
 return new Promise(ok=>{
  child.once('error',()=>ok({kind:'spawn_error'}));
  child.once('exit',()=>ok({kind:'exit'}));
 });
}
export async function cleanupPreview(child,done,owned,io=processControls){
 const result={childExited:false,groupEmpty:false,termSent:false,killSent:false,failures:[]};
 const fail=category=>{if(!result.failures.includes(category))result.failures.push(category);};
 let completion='pending',exitDeadline;
 Promise.resolve(done).then(value=>{completion=value?.kind==='exit'?'exit':value?.kind==='spawn_error'?'spawn_error':'observation_failed';},()=>{completion='observation_failed';});
 const observe=async()=>{
  try{exitDeadline=io.now()+5000;
   while(completion==='pending'&&io.now()<exitDeadline)await io.pause();
  }catch{fail('observation_failed');}
  result.childExited=completion==='exit';
 };
 const signal=kind=>{
  try{
   // Only a live, unchanged detached leader authorizes a group signal. A zombie
   // waits for the child exit event; its changed command is not a new owner.
   if(!owned||owned.pid!==child.pid||owned.parent!==process.pid||owned.group!==owned.pid){fail('ownership_unverified');return false;}
   const p=io.snapshot().find(p=>p.pid===owned.pid);
   if(!p||p.zombie)return false;
   if(p.identity!==owned.identity||p.parent!==owned.parent||p.group!==owned.group){fail('ownership_unverified');return false;}
  }catch{fail('observation_failed');return false;}
  try{io.signal(-owned.pid,kind);result[kind==='SIGTERM'?'termSent':'killSent']=true;return true;}
  catch(e){if(e?.code!=='ESRCH')fail('signal_failed');return false;}
 };
 await Promise.resolve();
 if(completion==='pending'){
  const termSent=signal('SIGTERM');await observe();
  if(completion==='pending'&&termSent){signal('SIGKILL');await observe();}
 }
 result.childExited=completion==='exit';
 if(completion==='pending')fail('exit_timeout');
 else if(completion!=='exit')fail(completion);
 // Check even after signal/ownership failures. Never adopt an orphaned group.
 try{
  if(!owned||owned.pid!==child.pid||owned.parent!==process.pid||owned.group!==owned.pid)fail('ownership_unverified');
  else{
   const end=exitDeadline??io.now()+5000;
   for(;;){result.groupEmpty=!io.snapshot().some(p=>p.group===owned.group);if(result.groupEmpty||io.now()>=end)break;await io.pause();}
   if(!result.groupEmpty)fail('group_remaining');
  }
 }catch{fail('observation_failed');}
 return {...result,verified:result.childExited&&result.groupEmpty&&result.failures.length===0};
}
export async function verifyPreviewPorts(ports=[5181,5182]){
 const result={portsFree:true,failures:[]};
 for(const port of ports){
  const category=await new Promise(ok=>{
   const probe=createServer();probe.once('error',e=>ok(e.code==='EADDRINUSE'?'port_occupied':'observation_failed'));
   probe.listen(port,'127.0.0.1',()=>probe.close(e=>ok(e?'observation_failed':null)));
  });
  if(category){result.portsFree=false;if(!result.failures.includes(category))result.failures.push(category);}
 }
 return result;
}
export function recordPreviewCleanup(report,preview,ports){
 const categories=new Set(['ownership_unverified','signal_failed','exit_timeout','group_remaining','port_occupied','observation_failed','spawn_error']);
 const failures=[...new Set([...preview.failures,...ports.failures].map(c=>categories.has(c)?c:'observation_failed'))];
 const cleanup={childExited:preview.childExited===true,groupEmpty:preview.groupEmpty===true,
  termSent:preview.termSent===true,killSent:preview.killSent===true,portsFree:ports.portsFree===true,failures};
 cleanup.verified=preview.verified===true&&cleanup.childExited&&cleanup.groupEmpty&&cleanup.portsFree&&failures.length===0;
 return {...report,investigationStatus:report.investigationStatus??report.status,
  status:cleanup.verified?report.status:'cleanup_failed',previewCleanup:cleanup,
  processesStopped:cleanup.childExited&&cleanup.groupEmpty,previewCleanupVerified:cleanup.verified};
}

// Credential revocation is independent of browser/worker cleanup success.
export async function finishCase({closeWorker,closeBrowser,revoke}){
 const result={workerClosed:false,browserClosed:false,credentialsRevoked:false,cleanupError:false};
 for(const [key,action] of [['browserClosed',closeBrowser],['workerClosed',closeWorker],['credentialsRevoked',revoke]]){
  try{result[key]=await action()===true;if(!result[key])result.cleanupError=true;}catch{result.cleanupError=true;}
 }
 result.cleanupVerified=result.workerClosed&&result.browserClosed&&result.credentialsRevoked&&!result.cleanupError;
 return result;
}
