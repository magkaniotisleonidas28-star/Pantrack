import {confineManagerContext,registerGateChild} from './po-cart-worker/full-gate-runtime.mjs';
import {restartDetached,stopThenRevoke,withCleanup} from './po-cart-worker/launcher-check-lifecycle.mjs';
import {capturePreview,cleanupPreview,observePreviewExit} from './po-cart-worker/second-addition-cleanup.mjs';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {chromium} from 'playwright-core';
import {readPrivate} from './po-cart-worker/private-files.mjs';
const root='.sites-runtime/po-cart-workers/manager-launcher-'+randomUUID();
async function start(){
 const p=spawn(process.execPath,['scripts/po-cart-manager-preview.mjs'],{stdio:['ignore','pipe','pipe'],env:{...process.env,PANTRACK_CART_MANAGER_ROOT:root}});let output='';
 const exited=new Promise(ok=>p.once('exit',code=>ok(code)));
 const ready=new Promise((ok,fail)=>{p.once('error',fail);p.stdout.on('data',b=>{output+=b;if(output.includes('Durable cart demo:'))ok();});p.stderr.on('data',b=>output+=b);p.once('exit',()=>fail(Error('Local launcher exited before ready.')));});
 let timer;try{await Promise.race([ready,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('Local launcher did not become ready.')),60000);})]);}catch(e){p.kill('SIGTERM');throw e;}finally{clearTimeout(timer);}
 return {p,output:()=>output,stop:async()=>{p.kill('SIGTERM');let timeout;try{
  const code=await Promise.race([exited,new Promise((_,fail)=>{timeout=setTimeout(()=>fail(Error('Local launcher failed to stop.')),15000);})]);
  // Only the launcher's fixed status lines; they carry no credential or token.
  assert.equal(code,0,['Local launcher stopped with exit code '+code+'.',...output.split('\n').filter(line=>/^Local (?:manager demo stopped|application cleanup was not verified)/.test(line))].join(' '));
 }finally{clearTimeout(timeout);}}};
}
// The launcher's app alone, without its supervisor, so revocation cannot stop it.
async function startApp(){
 for(const port of [5181,5182])await new Promise((ok,fail)=>{const probe=createServer();probe.once('error',()=>fail(Error('Local demo ports are already occupied.')));probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
 const app=spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs'],{detached:true,stdio:'ignore',env:process.env});
 const done=observePreviewExit(app),identity=capturePreview(app);registerGateChild(app);let exited=false;done.then(()=>{exited=true;});
 const stop=async()=>{const cleanup=await cleanupPreview(app,done,identity);assert.ok(cleanup.verified,'Local application cleanup was not verified ('+(cleanup.failures.join(', ')||'unconfirmed')+').');};
 for(let i=0;i<120&&!exited;i++){
  try{const r=await fetch('http://127.0.0.1:5181/signin-with-chatgpt?return_to=/',{redirect:'manual',signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.headers.get('set-cookie'))return {stop};}catch{}
  await new Promise(ok=>setTimeout(ok,500));
 }
 return withCleanup(async()=>{throw Error('Local application startup failed.');},stop);
}
let launcher,browser;
await withCleanup(async()=>{
 launcher=await start();const manifest=readPrivate(root+'/manifest.json'),credential=readPrivate(manifest.credentialFiles[0]);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});const context=await confineManagerContext(await browser.newContext()),page=await context.newPage();
 async function open(){await page.goto(manifest.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+manifest.companyId));await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();await page.getByRole('button',{name:/^Open PO-/}).first().click();await page.locator('[data-durable-cart]').waitFor();}
 async function view(){return page.evaluate(async m=>(await fetch(`/api/po-cart-jobs?view=manager&companyId=${m.companyId}&orderId=${m.orderId}`)).json(),manifest);}
 await open();let status=await view();const panel=page.locator('[data-durable-cart]');
 if(!status.authorization){await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Authorize preparation',exact:true}).click();await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).waitFor();status=await view();}
 if(!status.job){await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).click();}
 await panel.getByText('Cart verified',{exact:true}).waitFor({timeout:45000});status=await view();
 const session=readPrivate('.sites-runtime/po-cart-workers/local-storefront.json').fixtures[status.job.id],journal=readPrivate(root+'/manager-journal-0.json');assert.equal(journal.calls.filter(c=>c.jobId===status.job.id).length,3);assert.equal(session.entries.length,4);
 await panel.getByRole('button',{name:'Inspect practice cart',exact:true}).click();
 await panel.getByText('Practice browser is open',{exact:true}).waitFor({timeout:45000});
 await panel.getByRole('button',{name:'Close practice browser',exact:true}).click();
 await panel.getByText('Practice browser closed.',{exact:true}).waitFor({timeout:15000});
 assert.equal((await view()).job.session.state,'closed');assert.equal((await view()).job.state,'ready');
 assert.equal(readPrivate(root+'/human-journal.json').pending,null);

 launcher=await restartDetached({page,stop:async()=>{await launcher.stop();launcher=null;},start});const next=readPrivate(root+'/manifest.json'),rotated=readPrivate(next.credentialFiles[0]);assert.equal(next.companyId,manifest.companyId);assert.equal(next.orderId,manifest.orderId);assert.equal(rotated.workerId,credential.workerId);assert.notEqual(rotated.credentialId,credential.credentialId);
 await open();assert.equal((await view()).job.id,status.job.id);assert.deepEqual(readPrivate('.sites-runtime/po-cart-workers/local-storefront.json').fixtures[status.job.id],session);assert.deepEqual(readPrivate(root+'/manager-journal-0.json').calls,journal.calls);
 for(const secret of [session.token,credential.secret,rotated.secret])assert.ok(!launcher.output().includes(secret));
 console.log('PASS: one-command manager demo runs separate automation and visible inspection browser workers; graceful shutdown/restart preserves company, order, exact cart, token, journal and worker identity without another addition.');
},async()=>{
 await browser?.close();
 const manifest=existsSync(root+'/manifest.json')?readPrivate(root+'/manifest.json'):null;
 await stopThenRevoke({stop:launcher&&(async()=>{await launcher.stop();launcher=null;}),files:manifest?.credentialFiles??[],startApp,revoke:async file=>{
  const result=spawnSync(process.execPath,['scripts/po-cart-worker-credential.mjs','revoke',file],{stdio:'pipe'});assert.equal(result.status,0,'Fixture credential revocation failed');
  const r=await fetch(manifest.origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+readPrivate(file).secret}});await r.body?.cancel();assert.equal(r.status,401);
 }});
});
