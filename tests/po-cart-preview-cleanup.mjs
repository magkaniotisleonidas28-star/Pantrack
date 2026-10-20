import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:net';
import {parseProcessSnapshot,capturePreview,observePreviewExit,cleanupPreview,verifyPreviewPorts,recordPreviewCleanup,finishCase} from '../scripts/po-cart-worker/second-addition-cleanup.mjs';

const owned={pid:101,parent:process.pid,group:101,zombie:false,identity:'captured',command:'owned preview'};
const unrelated={pid:303,parent:404,group:303,zombie:false,identity:'unrelated',command:'unrelated preview'};
const parsed=parseProcessSnapshot(' 101 202 101 Ss Wed Oct 14 01:44:01 2026 node task-preview\n 102 101 101 Z Wed Oct 14 01:44:02 2026 (node)\n');
assert.equal(parsed[0].group,101);assert.equal(parsed[0].parent,202);assert.equal(parsed[0].zombie,false);assert.equal(parsed[1].zombie,true);
assert.throws(()=>parseProcessSnapshot(''));assert.throws(()=>parseProcessSnapshot('invalid process output'));
function scenario({forced=false,exitAt=forced?7000:1000,removeAt=exitAt,zombieAt,changeAt,descendantUntil,snapshotError=false,signalError}={}){
 const child=new EventEmitter();Object.assign(child,{pid:owned.pid,exitCode:null,signalCode:null});
 const done=observePreviewExit(child),log=[];let time=0,list=[{...owned},{...unrelated}],exited=false,observations=0;
 if(descendantUntil)list.push({pid:102,parent:101,group:101,identity:'descendant',command:'owned descendant'});
 const io={now:()=>time,snapshot:()=>{
  log.push(['inspect',time]);if(snapshotError&&observations++===0)throw Error('private process details');return list;
 },signal:(pid,kind)=>{
  assert.equal(pid,-owned.pid,'Only the captured detached group receives signals');log.push([kind,time]);
  if(signalError===kind)throw Object.assign(Error('private signal details'),{code:'EPERM'});
 },pause:async()=>{
  time+=1000;
  if(zombieAt&&time>=zombieAt)list=list.map(p=>p.pid===101?{...p,zombie:true,command:'(node)',identity:'changed-zombie-command'}:p);
  if(changeAt&&time>=changeAt)list=list.map(p=>p.pid===101?{...p,identity:'different-process',group:909}:p);
  if(time>=removeAt)list=list.filter(p=>p.pid!==101);
  if(descendantUntil&&time>=descendantUntil)list=list.filter(p=>p.pid!==102);
  if(!exited&&time>=exitAt){exited=true;child.exitCode=0;log.push(['exit',time]);child.emit('exit',0,null);}
 }};
 return {child,done,io,log,current:()=>list};
}
for(const forced of [false,true]){
 const s=scenario({forced});const result=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(result.verified,true);assert.equal(result.childExited,true);assert.equal(result.groupEmpty,true);assert.equal(result.termSent,true);assert.equal(result.killSent,forced);
 assert.equal(s.log.filter(([event])=>event==='SIGKILL').length,forced?1:0);
 if(forced)assert.equal(s.log.find(([event])=>event==='SIGKILL')[1],5000);
 assert.equal(s.log.at(-1)[0],'inspect');assert.ok(s.log.findIndex(([event])=>event==='exit')<s.log.length-1,'Final group verification follows exit');
 assert.ok(s.current().some(p=>p.pid===303),'Unrelated processes stay untouched');
}
for(const options of [{zombieAt:1000,exitAt:3000},{zombieAt:1000,exitAt:7000},{removeAt:1000,exitAt:7000},{descendantUntil:3000}]){
 const s=scenario(options),r=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(r.verified,true);assert.equal(r.killSent,false,'Exiting/missing leaders never authorize escalation');assert.equal(s.log.at(-1)[0],'inspect');
}
{
 const s=scenario({changeAt:1000,exitAt:7000,removeAt:Infinity}),r=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(r.verified,false);assert.ok(r.failures.includes('ownership_unverified'));assert.equal(r.killSent,false);assert.equal(r.childExited,true);
 assert.ok(s.current().some(p=>p.pid===101&&p.identity==='different-process'),'Reused PID remains untouched');
}
{
 const s=scenario(),r=await cleanupPreview(s.child,s.done,{...owned,parent:-1},s.io);
 assert.equal(r.verified,false);assert.ok(r.failures.includes('ownership_unverified'));assert.equal(r.childExited,true);assert.ok(!s.log.some(([event])=>event.startsWith('SIG')));
}
for(const kind of ['SIGTERM','SIGKILL']){
 const s=scenario({forced:kind==='SIGKILL',signalError:kind}),r=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(r.verified,false);assert.ok(r.failures.includes('signal_failed'));assert.equal(r.childExited,true);assert.equal(r.groupEmpty,true,'Signal errors still finish bounded exit/group observation');
}
{
 const s=scenario({snapshotError:true}),r=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(r.verified,false);assert.ok(r.failures.includes('observation_failed'));assert.equal(r.childExited,true);assert.equal(r.groupEmpty,true);
}
{
 const s=scenario({forced:true,exitAt:Infinity,removeAt:Infinity}),r=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(r.verified,false);assert.deepEqual(r.failures,['exit_timeout','group_remaining']);assert.equal(s.log.at(-1)[1],10000);
}
{
 const s=scenario({descendantUntil:Infinity}),r=await cleanupPreview(s.child,s.done,owned,s.io);
 assert.equal(r.childExited,true);assert.equal(r.groupEmpty,false);assert.deepEqual(r.failures,['group_remaining']);assert.equal(r.killSent,false);
 assert.equal(s.log.filter(([event])=>event.startsWith('SIG')).length,1,'Orphaned descendants are observed, never adopted');
}
{
 const s=scenario();const done=Promise.reject(Error('private rejected observer'));
 const r=await cleanupPreview(s.child,done,owned,s.io);assert.ok(r.failures.includes('observation_failed'));assert.equal(r.verified,false);
}
{
 const s=scenario();s.child.emit('error',Error('private spawn details'));
 const r=await cleanupPreview(s.child,s.done,undefined,s.io);assert.ok(r.failures.includes('spawn_error'));assert.equal(r.verified,false);
}
{
 const s=scenario();await s.io.pause();
 const r=await cleanupPreview(s.child,s.done,owned,s.io);assert.equal(r.verified,true);assert.ok(!s.log.some(([event])=>event.startsWith('SIG')),'Already observed exit needs no signals');
}
assert.deepEqual(capturePreview({pid:101},{snapshot:()=>[owned]}),owned);
for(const record of [{...owned,parent:-1},{...owned,group:303},{...owned,zombie:true}])assert.throws(()=>capturePreview({pid:101},{snapshot:()=>[record]}));

const server=createServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;
let occupied;
try{occupied=await verifyPreviewPorts([port]);assert.deepEqual(occupied,{portsFree:false,failures:['port_occupied']});}
finally{await new Promise(ok=>server.close(ok));}
assert.deepEqual(await verifyPreviewPorts([port]),{portsFree:true,failures:[]});
const original={status:'stopped',results:[{stage:'launch',error:'worker_failed'}]};
const closed={verified:true,childExited:true,groupEmpty:true,termSent:true,killSent:false,failures:[]};
const report=recordPreviewCleanup(original,closed,occupied);
assert.equal(report.status,'cleanup_failed');assert.equal(report.investigationStatus,'stopped');assert.deepEqual(report.results,original.results);
assert.equal(report.processesStopped,true);assert.equal(report.previewCleanupVerified,false);assert.equal(report.previewCleanup.portsFree,false);assert.equal(original.status,'stopped');
const privateText='private command and error';
const projected=recordPreviewCleanup(original,{...closed,command:privateText,failures:[privateText]},{portsFree:true,failures:[]});
assert.ok(!JSON.stringify(projected).includes(privateText));assert.deepEqual(projected.previewCleanup.failures,['observation_failed']);
let revoked=false;const cleanup=await finishCase({closeBrowser:async()=>{throw Error(privateText);},closeWorker:async()=>true,revoke:async()=>{revoked=true;return true;}});
assert.equal(revoked,true);assert.equal(cleanup.credentialsRevoked,true);assert.equal(cleanup.cleanupVerified,false);
console.log('PASS: authoritative preview exit, zombie/delayed events, bounded escalation, identity safety, descendants/ports, fixed private failure categories and independent revocation; mocked processes only.');
