import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restartDetached,withCleanup} from '../scripts/po-cart-worker/launcher-check-lifecycle.mjs';

const origin='http://127.0.0.1:5181',tick=()=>new Promise(ok=>setTimeout(ok,0));
// Models the observed dev client: a page left on the server polls while it is down
// and reloads once it answers, aborting any navigation started at that moment.
function devServer(){
 const log=[];let up=true,polling=false,navigation;
 const page={url:origin+'/?company=fictional',goto:async url=>{
  log.push('goto '+url);
  if(url==='about:blank'){page.url=url;polling=false;return;}
  const current={aborted:false};navigation=current;await tick();await tick();
  if(current.aborted)throw Error('page.goto: net::ERR_ABORTED at '+url);
  page.url=url;
 }};
 return {page,log,stop:async()=>{log.push('stop');up=false;if(page.url.startsWith(origin))polling=true;},start:async()=>{
  log.push('start');up=true;
  if(polling)setTimeout(()=>{log.push('reload');if(navigation)navigation.aborted=true;},0);
  return 'restarted';
 },isUp:()=>up};
}
{
 const s=devServer();await s.stop();await s.start();
 await assert.rejects(s.page.goto(origin+'/signin-with-chatgpt'),/ERR_ABORTED/,'Control: a page left on the server aborts the post-restart navigation');
}
{
 const s=devServer();
 assert.equal(await restartDetached(s),'restarted');assert.equal(s.isUp(),true);
 await s.page.goto(origin+'/signin-with-chatgpt');await tick();
 assert.equal(s.page.url,origin+'/signin-with-chatgpt');
 assert.deepEqual(s.log,['goto about:blank','stop','start','goto '+origin+'/signin-with-chatgpt']);
}
{
 const log=[],page={goto:async url=>{log.push(url);}};
 await assert.rejects(restartDetached({page,stop:async()=>{log.push('stop');throw Error('stop failed');},start:async()=>{log.push('start');}}),/stop failed/);
 assert.deepEqual(log,['about:blank','stop'],'A failed stop never starts another launcher');
}
{
 let cleanups=0;const cleanup=async()=>{cleanups++;},checkFailure=Error('check failed'),cleanupFailure=Error('cleanup failed');
 assert.equal(await withCleanup(async()=>'passed',cleanup),'passed');
 await assert.rejects(withCleanup(async()=>{throw checkFailure;},cleanup),e=>e===checkFailure);
 await assert.rejects(withCleanup(async()=>'passed',async()=>{cleanups++;throw cleanupFailure;}),e=>e===cleanupFailure);
 await assert.rejects(withCleanup(async()=>{throw checkFailure;},async()=>{cleanups++;throw cleanupFailure;}),e=>e instanceof AggregateError&&e.errors[0]===checkFailure&&e.errors[1]===cleanupFailure);
 assert.equal(cleanups,4);
}
const check=readFileSync('scripts/po-cart-manager-launcher-check.mjs','utf8'),preview=readFileSync('scripts/po-cart-manager-preview.mjs','utf8');
assert.match(check,/launcher=await restartDetached\(\{page,stop:/);assert.match(check,/^await withCleanup\(async\(\)=>\{$/m);
assert.doesNotMatch(check,/^try\{$/m);assert.doesNotMatch(check,/await launcher\.stop\(\);launcher=null;\n/);
assert.match(preview,/Local application cleanup was not verified \('\+\(cleanup\.failures\.join/);
console.log('PASS: launcher check leaves the dev-server page before its graceful restart, a failed stop never restarts, cleanup always runs and never replaces the original failure, and unverified app cleanup reports fixed categories.');
