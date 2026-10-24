import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,mkdirSync,symlinkSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {fullGateRoot,consumedGateRoots,gatePolicy,gateSteps,requireGateSource,rejectGateArguments,createGateInvocation,runFullGate,validatePreparation,fileHash,inspectGateStep,gateAuditsPassed,failureSummary} from '../scripts/po-cart-worker/acceptance-gate.mjs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {finishOfflineFixture} from '../scripts/po-cart-worker/offline-case-cleanup.mjs';
const root=mkdtempSync(join(tmpdir(),'full-offline-gate-')),source={files:1,sha256:'frozen'},snapshot=()=>source;
try{
 assert.equal(gateAuditsPassed({passed:true}),false);
 assert.equal(fullGateRoot,'.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261024');assert.equal(gateSteps.length,21);
 // Every consumed gate root stays retained; the paid-allowance policy binding is unchanged.
 assert.deepEqual(consumedGateRoots,['.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014','.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021','.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261022']);
 assert.equal(gatePolicy,'metadata-repair-real-matrix-v1');
 // A failed step's log gains fixed-shape facts only; message text and private values never pass.
 const secret='fictional-secret-'+'q'.repeat(24),failed=['AssertionError [ERR_ASSERTION]: token '+secret+' mismatch',
  '    at Object.stop (file:///Users/someone/Pantrack/scripts/po-cart-manager-launcher-check.mjs:14:86)',
  'page.goto: net::ERR_ABORTED at http://127.0.0.1:5181/?token='+secret,'locator.waitFor: Timeout 45000ms exceeded.',
  'Local application cleanup was not verified (group_remaining, '+secret+', exit_timeout).',
  '    at /private/scripts/'+secret+'.mjs:3:1','    at file:///tmp/'+secret+'/tests/missing-suite.mjs:9:2'].join('\n');
 assert.equal(failureSummary(1,failed),'FAILURE summary: exit=1 kinds=AssertionError codes=ERR_ASSERTION,net::ERR_ABORTED timeoutsMs=45000 at=scripts/po-cart-manager-launcher-check.mjs:14 cleanup=group_remaining,exit_timeout\n');
 assert.ok(!failureSummary(1,failed).includes(secret));assert.equal(failureSummary(0,failed),'');
 assert.equal(failureSummary(null,'no recognised facts '+secret),'FAILURE summary: exit=signal kinds= codes= timeoutsMs= at= cleanup=\n');
 const runner=readFileSync('scripts/po-cart-ai-gate.mjs','utf8');assert.match(runner,/writeFileSync\(path,safeLog\(output\)\+failureSummary\(exitCode,output\),\{flag:'wx',mode:0o600\}\)/);
 for(const old of consumedGateRoots)for(const consumed of [old,resolve(old),old+'/'])assert.throws(()=>createGateInvocation(consumed,source),/Consumed gate root/);
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
 // Regression (G2 step 15): a real SQLite state vacuums into a case directory
 // that does not exist yet, as the browser worker check's states/<case> does.
 const real=new DatabaseSync(':memory:');real.exec("CREATE TABLE kept(v);INSERT INTO kept VALUES ('state')");
 const missing=root+'/missing/states/1',none={issuedCredentials:[],revoke:()=>{},sql:real};
 const created=await finishOfflineFixture({f:none,dir:missing,origin:'http://127.0.0.1:1'});
 assert.deepEqual(created,{credentialsRevoked:true,browserClosed:true,stateSaved:true,cleanupVerified:true});
 // POSIX modes and unprivileged symlinks are unavailable on Windows.
 if(process.platform!=='win32'){assert.equal(statSync(missing).mode&0o777,0o700);assert.equal(statSync(missing+'/state.sqlite').mode&0o777,0o600);}
 const savedState=new DatabaseSync(missing+'/state.sqlite',{readOnly:true});assert.deepEqual(savedState.prepare('SELECT v FROM kept').all().map(r=>r.v),['state']);savedState.close();
 // A symlinked case directory is refused rather than followed.
 if(process.platform!=='win32'){
  mkdirSync(root+'/elsewhere');symlinkSync(root+'/elsewhere',root+'/linked');
  const linked=await finishOfflineFixture({f:none,dir:root+'/linked',origin:'http://127.0.0.1:1'});
  assert.equal(linked.stateSaved,false);assert.equal(linked.cleanupVerified,false);assert.equal(existsSync(root+'/elsewhere/state.sqlite'),false);
 }
 real.close();
 console.log('PASS: fixed 21-step invocation, exclusive durable consumption/order, pipeline/source/evidence binding, argument rejection, first unexpected failure/interruption, expected faults, partial issuance/HTTP 401/state retention and cleanup failure; no browsers or provider requests.');
}finally{rmSync(root,{recursive:true,force:true});}
