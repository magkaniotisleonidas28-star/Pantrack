import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {fullGateRoot,consumedGateRoots,gatePolicy,gateSteps,requireGateSource,rejectGateArguments,createGateInvocation,runFullGate,validatePreparation,fileHash,inspectGateStep,gateAuditsPassed} from '../scripts/po-cart-worker/acceptance-gate.mjs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {finishOfflineFixture} from '../scripts/po-cart-worker/offline-case-cleanup.mjs';
const root=mkdtempSync(join(tmpdir(),'full-offline-gate-')),source={files:1,sha256:'frozen'},snapshot=()=>source;
try{
 assert.equal(gateAuditsPassed({passed:true}),false);
 assert.equal(fullGateRoot,'.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021');assert.equal(gateSteps.length,21);
 // The consumed 2026-10-14 root stays retained; the paid-allowance policy binding is unchanged.
 assert.deepEqual(consumedGateRoots,['.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014']);
 assert.equal(gatePolicy,'metadata-repair-real-matrix-v1');
 for(const consumed of [consumedGateRoots[0],resolve(consumedGateRoots[0]),consumedGateRoots[0]+'/'])assert.throws(()=>createGateInvocation(consumed,source),/Consumed gate root/);
 for(const args of [['--resume'],['--root','x'],['--case','0'],['--acceptance']])assert.throws(()=>rejectGateArguments(args));
 assert.throws(()=>requireGateSource({...source,sha256:'changed'},snapshot));
 const task=createGateInvocation(root+'/exclusive',source);assert.throws(()=>createGateInvocation(root+'/exclusive',source));
 assert.throws(()=>task.consume('reliability',[]));task.consume(...gateSteps[0]);assert.equal(readPrivate(root+'/exclusive/task.json').steps.length,1);task.release();
 assert.throws(()=>createGateInvocation(root+'/exclusive',source));
 const log=root+'/pipeline.log';writeFileSync(log,'local evidence');
 const pipeline={source,passed:true,results:['typecheck','test','db:check','build','db:migrate:local','test:local'].map(id=>({id,passed:true,exitCode:0,sourceBefore:source.sha256,sourceAfter:source.sha256,log:{path:log,sha256:fileHash(log)}}))};
 assert.deepEqual(validatePreparation(pipeline,snapshot),source);
 for(const bad of [{...pipeline,passed:false},{...pipeline,results:pipeline.results.slice(1)},{...pipeline,source:{files:2,sha256:'frozen'}}])assert.throws(()=>validatePreparation(bad,snapshot));
 writeFileSync(log,'changed');assert.throws(()=>validatePreparation(pipeline,snapshot));
 const r={source,passed:true,realProviderRequests:0,results:Array.from({length:16},(_,i)=>({passed:true,credentialsRevoked:true,cleanup:true,cleanupVerified:true,networkCoverageComplete:true,externalRequests:0,checkoutSubmissions:0,additions:i<4?3:0,requests:i<4?10:4,completedRequests:i<4?10:4,restartNoEffects:i>=4}))};
 const evidence=root+'/report.json';writePrivate(evidence,r);const output='Private metadata evidence: '+evidence;
 inspectGateStep('metadata',output,source,[]);
 for(const bad of [{...r,results:r.results.slice(1)},{...r,results:r.results.map((v,i)=>i?v:{...v,credentialsRevoked:false})},{...r,results:r.results.map((v,i)=>i?v:{...v,completedRequests:9})}]){writePrivate(evidence,bad);assert.throws(()=>inspectGateStep('metadata',output,source,[]));}writePrivate(evidence,r);
 for(const [kind,options] of [['unexpected',{exitCode:1}],['evidence',{exitCode:0,output:'missing'}],['interrupted',{interrupt:true}],['source',{change:true}],['cleanup',{cleanup:false}]]){
  let invoked=0,finalized=0,current=source;const control={stopping:false};
  const report=await runFullGate({root:root+'/'+kind,source,snapshot:()=>current,control,runStep:async()=>{
   invoked++;assert.equal(readPrivate(root+'/'+kind+'/task.json').steps.length,1);
   if(options.change)current={...source,sha256:'changed'};if(options.interrupt)control.stopping=true;
   return {exitCode:options.exitCode??1,output:options.output??output};
  },finalize:async()=>{finalized++;return {passed:options.cleanup!==false};}});
  assert.equal(report.passed,false);assert.equal(invoked,1);assert.equal(finalized,1);assert.equal(report.results.length,1);
  assert.equal(Object.hasOwn(report.results[0],'output'),false);assert.throws(()=>createGateInvocation(root+'/'+kind,source));
 }
 // Expected injected failures require all four safety assertions to have passed.
 inspectGateStep('faults-off','PASS injected a\nPASS injected b\nPASS injected c\nPASS injected d',source,[]);
 assert.throws(()=>inspectGateStep('faults-off','PASS injected a',source,[]));
 // Simulate partial issuance before any private credential file can be written.
 const issued=[{credentialId:'partial',secret:'fictional'}];let revoked=false,saved=false;
 const server=createServer((req,res)=>{res.writeHead(revoked?401:200);res.end('{}');});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const dir=root+'/partial';writePrivate(dir+'/fixture.json',{});
 try{
  const f={issuedCredentials:issued,revoke:()=>{revoked=true;},sql:{exec:sql=>{const path=sql.match(/VACUUM INTO '(.*)'/)[1];writeFileSync(path,'synthetic saved state');saved=true;}}};
  const cleanup=await finishOfflineFixture({f,dir,origin:'http://127.0.0.1:'+server.address().port});
  assert.equal(cleanup.credentialsRevoked,true);assert.equal(cleanup.cleanupVerified,true);assert.equal(saved,true);assert.equal(server.listening,true);
  f.revoke=()=>{throw Error('private revocation failure');};const failed=await finishOfflineFixture({f,dir:root+'/partial-failed',origin:'http://127.0.0.1:'+server.address().port});assert.equal(failed.cleanupVerified,false);
 }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 console.log('PASS: fixed 21-step invocation, exclusive durable consumption/order, pipeline/source/evidence binding, argument rejection, first unexpected failure/interruption, expected faults, partial issuance/HTTP 401/state retention and cleanup failure; no browsers or provider requests.');
}finally{rmSync(root,{recursive:true,force:true});}
