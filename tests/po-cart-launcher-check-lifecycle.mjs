import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restartDetached,stopThenRevoke,withCleanup} from '../scripts/po-cart-worker/launcher-check-lifecycle.mjs';

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
// Models the observed launcher: its supervisor polls with the first credential and,
// once that is revoked, exits 1 and stops its app. Revocation needs a running app.
function launcherModel(){
 const log=[],revoked=new Set();let app='launcher',code=null;
 const poll=()=>{if(app==='launcher'&&revoked.has('one')){log.push('poll refused');app=null;code=1;}};
 return {log,revoked,
  stop:async()=>{poll();log.push('stop');if(app==='launcher'){app=null;code=0;}if(code!==0)throw Error('Local launcher stopped with exit code '+code+'.');},
  startApp:async()=>{if(app)throw Error('Local demo ports are already occupied.');log.push('app start');app='alone';return {stop:async()=>{log.push('app stop');app=null;}};},
  revoke:async file=>{if(!app)throw Error('Credential revocation unverified.');revoked.add(file);log.push('revoke '+file);await tick();poll();}};
}
{
 const m=launcherModel();
 await assert.rejects((async()=>{for(const file of ['one','two'])await m.revoke(file);})(),/revocation unverified/,'Control: revoking first stops the launcher before the second file');
 await assert.rejects(m.stop(),/exit code 1/,'Control: the later graceful stop then reports exit 1');
}
{
 const m=launcherModel();
 await stopThenRevoke({stop:m.stop,files:['one','two'],startApp:m.startApp,revoke:m.revoke});
 assert.deepEqual(m.log,['stop','app start','revoke one','revoke two','app stop']);assert.deepEqual([...m.revoked],['one','two']);
}
{
 const log=[],failure=Error('stop failed');
 const deps={files:['one','two'],startApp:async()=>{log.push('app start');return {stop:async()=>{log.push('app stop');}};},revoke:async file=>{log.push('revoke '+file);}};
 await assert.rejects(stopThenRevoke({...deps,stop:async()=>{log.push('stop');throw failure;}}),e=>e===failure);
 assert.deepEqual(log,['stop','app start','revoke one','revoke two','app stop'],'A failed stop still revokes every file');log.length=0;
 await stopThenRevoke({...deps,stop:undefined});assert.deepEqual(log,['app start','revoke one','revoke two','app stop'],'No launcher still revokes');log.length=0;
 await stopThenRevoke({...deps,files:[],stop:async()=>{log.push('stop');}});assert.deepEqual(log,['stop'],'No credential files start no app');log.length=0;
 const one=Error('revoke one failed'),appFailure=Error('app cleanup failed');
 await assert.rejects(stopThenRevoke({...deps,stop:async()=>{},revoke:async file=>{log.push('revoke '+file);if(file==='one')throw one;}}),e=>e===one);
 assert.deepEqual(log,['app start','revoke one','revoke two','app stop'],'A failed revocation still attempts the rest and stops the app');log.length=0;
 await assert.rejects(stopThenRevoke({...deps,stop:async()=>{},revoke:async()=>{throw one;},startApp:async()=>({stop:async()=>{throw appFailure;}})}),
  e=>e instanceof AggregateError&&e.errors.length===3&&e.errors[0]===one&&e.errors[1]===one&&e.errors[2]===appFailure);
 const startFailure=Error('app start failed');
 await assert.rejects(stopThenRevoke({...deps,stop:async()=>{throw failure;},startApp:async()=>{log.push('app start');throw startFailure;}}),
  e=>e instanceof AggregateError&&e.errors[0]===failure&&e.errors[1]===startFailure);
 assert.deepEqual(log,['app start'],'A failed app start revokes nothing and reports both failures');
}
const check=readFileSync('scripts/po-cart-manager-launcher-check.mjs','utf8'),preview=readFileSync('scripts/po-cart-manager-preview.mjs','utf8');
assert.match(check,/launcher=await restartDetached\(\{page,stop:/);assert.match(check,/^await withCleanup\(async\(\)=>\{$/m);
assert.doesNotMatch(check,/^try\{$/m);assert.doesNotMatch(check,/await launcher\.stop\(\);launcher=null;\n/);
assert.match(preview,/Local application cleanup was not verified \('\+\(cleanup\.failures\.join/);
assert.match(check,/await stopThenRevoke\(\{stop:launcher&&\(async\(\)=>\{await launcher\.stop\(\);launcher=null;\}\),files:manifest\?\.credentialFiles\?\?\[\],startApp,revoke:/);
assert.doesNotMatch(check,/if\(launcher\)\{const r=await fetch/);assert.doesNotMatch(check,/finally\{await launcher\?\.stop\(\);\}/);
const app=check.slice(check.indexOf('async function startApp(){'),check.indexOf('let launcher,browser;'));
assert.ok(app.includes('for(const port of [5181,5182])')&&app.indexOf('probe.listen(port')>0&&app.indexOf('probe.listen(port')<app.indexOf("spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs']"),'The revocation app starts only on free ports');
assert.match(app,/registerGateChild\(app\)/);assert.match(app,/return withCleanup\(async\(\)=>\{throw Error\('Local application startup failed\.'\);\},stop\);/);
assert.match(check,/revoke:async file=>\{\r?\n.*assert\.equal\(result\.status,0,'Fixture credential revocation failed'\);\r?\n.*assert\.equal\(r\.status,401\);/);
console.log('PASS: launcher check leaves the dev-server page before its graceful restart, a failed stop never restarts, cleanup always runs and never replaces the original failure, unverified app cleanup reports fixed categories, and credentials are revoked only after the launcher stops, against the app alone.');
