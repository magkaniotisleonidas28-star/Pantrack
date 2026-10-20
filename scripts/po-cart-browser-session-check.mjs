import {gateActive} from './po-cart-worker/full-gate-runtime.mjs';
if(gateActive())await import('./po-cart-worker/offline-boundary.mjs');
import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {launchBrowserWorker,launchHumanBrowser} from './po-cart-worker/manager-supervisor.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
import {readPrivate,writePrivate,profileLock} from './po-cart-worker/private-files.mjs';
import {captureOwnedBrowser,stopOwnedBrowser} from './po-cart-worker/owned-browser-process.mjs';
await build({entryPoints:['scripts/po-cart-worker/human-browser.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/po-cart-workers/modules/human-acceptance.mjs',logLevel:'silent'});
const {HumanBrowserWorker}=await import('../.sites-runtime/po-cart-workers/modules/human-acceptance.mjs');
const ui=await chromium.launch({headless:true}),evidence='.sites-runtime/po-cart-workers/human-acceptance-'+randomUUID();mkdirSync(evidence,{recursive:true,mode:0o700});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(fn,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timed out: '+label);}
try{for(const [index,[layout,scenario,check]] of [['rows','login_expired','sign_in'],['compact','login_expired','baseline'],['rows','malicious','mismatch'],['compact','normal','native_close'],['rows','lost_response','uncertain'],['compact','normal','expiry'],['rows','normal','cancel'],['compact','normal','revoke'],['rows','normal','process'],['compact','normal','crash']].entries()){
 if(process.argv.includes('--cases')&&!process.argv[process.argv.indexOf('--cases')+1].split(',').includes(String(index)))continue;
 const f=await seedLocalBrowserJob({layout,scenario}),context=await ui.newContext({viewport:{width:1440,height:1000}}),page=await (await confineManagerContext(context)).newPage();
 let human,run,proxy;const failures=[];page.on('pageerror',e=>failures.push(e.message));
 const view=()=>f.request(`/api/po-cart-jobs?view=manager&companyId=${f.companyId}&orderId=${f.orderId}`);
 async function openUI(){await page.setViewportSize({width:1440,height:1000});await page.goto(f.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+f.companyId));await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();await page.getByRole('button',{name:/^Open PO-/}).first().click();await page.locator('[data-durable-cart]').waitFor();}
 const postWorker=async(action,extra={})=>{const c=readPrivate(f.credentialFiles[0]);const r=await fetch(f.origin+'/api/internal/po-cart-worker',{method:'POST',headers:{authorization:'Bearer '+c.secret,'content-type':'application/json'},body:JSON.stringify({action,jobId:f.jobId,operationId:randomUUID(),...extra})});assert.equal(r.status,200);return r.json();};
 try{
  if(check==='baseline'){const c=await postWorker('claim'),cart=f.readSession().entries;await postWorker('recordBaseline',{fence:c.receipt.fence,cart});await postWorker('hold',{fence:c.receipt.fence,reason:'sign_in_required'});}
  else{const worker=launchBrowserWorker(f);await worker.done;}
  await openUI();const panel=page.locator('[data-durable-cart]');let v=await view();assert.equal(v.job.state,scenario==='login_expired'||scenario==='lost_response'?'review_needed':'ready');
  const lost=new Set(),managerIntents=[];
  if(index===0)await page.route('**/api/po-cart-jobs*',async route=>{if(route.request().method()!=='POST')return route.continue();const body=route.request().postDataJSON();managerIntents.push(body);if(!lost.has(body.action)){lost.add(body.action);await route.fetch();return route.abort('failed');}return route.continue();});
  async function action(name){await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes('/api/po-cart-jobs?view=manager')),panel.getByRole('button',{name:'Refresh preparation status'}).click()]);await page.waitForTimeout(100);await panel.getByRole('button',{name,exact:true}).click();if(index===0){await panel.getByRole('button',{name:'Retry saved request'}).waitFor();await openUI();await panel.getByRole('button',{name:'Retry saved request'}).click();}}
  await action(scenario==='login_expired'?'Open practice sign-in':'Inspect practice cart');
  v=await view();assert.equal(v.job.session.state,'requested');assert.equal(v.job.eligibility.resume,false);
  if(['process','crash'].includes(check)){
   const child=launchHumanBrowser(f,{headless:true});let ownedChrome,ownedBrowser;
   try{
    await until(async()=>(await view()).job.session.state==='open','separate human process');
    const scope=readPrivate(f.fixtureFile).jobs[f.jobId].scope,key=createHash('sha256').update(JSON.stringify(['http://127.0.0.1:5182',scope.companyId,scope.supplierId,scope.accountId])).digest('hex');
    const profile=resolve('.sites-runtime/po-cart-workers/browser-profiles',key);
    ownedBrowser=captureOwnedBrowser(child.process.pid,profile);ownedChrome=ownedBrowser.pid;
    if(check==='crash'){
     assert.ok(ownedChrome,'owned practice browser identified');child.process.kill('SIGKILL');await child.done;
     process.kill(ownedChrome,0);
     assert.throws(()=>profileLock(profile),/still open/,'Live orphan blocks profile reuse before cleanup');
     const recovery=launchHumanBrowser(f,{headless:true});assert.equal(await recovery.done,0);process.kill(ownedChrome,0);
     assert.equal((await view()).job.session.state,'failed');assert.equal((await view()).job.state,'review_needed');
     // An orphan remains private and unresolved until the human closes it; recovery never adopts it.
     assert.equal(readPrivate(f.root+'/human-journal.json').human.phase,'open');
     const held=await view();await f.request('/api/po-cart-jobs?view=manager',{action:'requestBrowser',companyId:f.companyId,jobId:f.jobId,expectedRevision:held.job.revision,operationId:randomUUID(),purpose:'inspect'});
     const blocked=launchHumanBrowser(f,{headless:true});await blocked.done;process.kill(ownedChrome,0);
     assert.equal((await view()).job.session.reason,'profile_busy');assert.equal((await view()).job.session.state,'failed');

    }else{await action('Close practice browser');assert.equal(await child.done,0);assert.equal((await view()).job.session.state,'closed');assert.equal((await view()).job.state,'ready');}
    assert.equal(f.readSession().entries.length,4);assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory);
    console.log(`PASS supervised ${layout}/${check}: separate process ownership, no repeated browser launch or cart additions`);
   }finally{if(child.process.exitCode===null&&child.process.signalCode===null){child.process.kill('SIGTERM');await child.done;}if(ownedBrowser)await stopOwnedBrowser(ownedBrowser);}
   continue;
  }
  let humanOrigin=f.origin;const workerDrops=new Set();
  if(index===0){proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):null;
   const r=await fetch(f.origin+req.url,{method:req.method,redirect:'error',headers:{authorization:req.headers.authorization,...(raw?{'content-type':'application/json'}:{})},...(raw?{body:raw}:{})}),text=await r.text();
   if(r.ok&&body&&['claim','opened','heartbeat','complete'].includes(body.action)&&!workerDrops.has(body.action)){workerDrops.add(body.action);res.destroy();return;}
   res.writeHead(r.status,Object.fromEntries(r.headers));res.end(text);
  }catch{res.destroy();}});await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));humanOrigin='http://127.0.0.1:'+proxy.address().port;}
  human=new HumanBrowserWorker({credentialFile:f.credentialFiles[0],journalFile:f.root+'/human-acceptance.json',fixtureFile:f.fixtureFile,origin:humanOrigin,headless:true});
  run=human.tick().catch(e=>e);
  await until(async()=>human.activeSession&&(await view()).job.session.state==='open','human open');
  const practice=human.activeSession.page;
  // Both independent network boundaries block additions and checkout, including direct DOM-created requests.
  for(const path of ['/add','/checkout'])assert.equal(await practice.evaluate(async({origin,path})=>{try{return (await fetch(origin+path,{method:'POST',body:'sku=DEMO-COFFEE&packs=1'})).status;}catch{return 0;}},{origin:'http://127.0.0.1:5182',path}),0);
  if(scenario==='login_expired'){
   await practice.getByRole('button',{name:/Sign in to practice account/i}).click(); // Test imitates the manager's click, never a worker login operation.
   if(index===0){await panel.getByRole('button',{name:'Refresh preparation status'}).click();await panel.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/desktop.png'});await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await until(()=>workerDrops.has('heartbeat'),'20-second human heartbeat',25000);}
   await action('Close practice browser');await until(async()=>!(await view()).job.session.active,'browser closed');await run;assert.equal(human.activeSession,undefined);assert.equal((await view()).job.session.state,'closed');
   await panel.getByRole('button',{name:'Refresh preparation status'}).click();await panel.getByRole('button',{name:'Resume preparation',exact:true}).waitFor();await action('Resume preparation');
   const next=launchBrowserWorker(f,1);await next.done;v=await view();assert.equal(v.job.state,'ready');assert.equal(v.job.lines.every(l=>l.verified),true);assert.equal(f.readSession().entries.length,4);
   if(check==='baseline'){assert.equal(v.job.verification.filter(e=>e.kind==='baseline').length,1);assert.equal(readPrivate(f.root+'/manager-journal-1.json').calls.length,3);}
   if(index===0){for(const action of ['requestBrowser','closeBrowser','resume']){const same=managerIntents.filter(i=>i.action===action);assert.ok(same.length>=2);assert.deepEqual(same[0],same[1]);}assert.deepEqual([...workerDrops].sort(),['claim','complete','heartbeat','opened']);}
  }else{
   assert.equal(await practice.evaluate(async origin=>{try{return(await fetch(origin+'/login',{method:'POST'})).status;}catch{return 0;}},'http://127.0.0.1:5182'),0);
   if(check==='mismatch'){const store=readPrivate(f.storefrontFile);store.fixtures[f.jobId].entries[1].unitMinor='1';writePrivate(f.storefrontFile,store);await action('Close practice browser');}
   else if(check==='native_close')await human.activeSession.browser.close();
   else if(check==='expiry')await f.execute(`UPDATE po_cart_browser_sessions SET revision=revision+1,lease_until='2020-01-01T00:00:00.000Z' WHERE company_id='${f.companyId}' AND job_id='${f.jobId}';`);
   else if(check==='cancel'){await panel.getByRole('button',{name:'Cancel preparation',exact:true}).click();}
   else if(check==='revoke')await fixtureCredential({execute:f.execute,file:f.credentialFiles[0],action:'revoke'});
   else await action('Close practice browser');
   await run;assert.equal(human.activeSession,undefined);v=await view();assert.equal(v.job.eligibility.resume,false);assert.equal(v.job.state,check==='cancel'?'canceled':'review_needed');
   if(check==='revoke'){
    // A revoked credential cannot publish closure. The immutable ready evidence remains, but manager readiness must be withheld while the session is unresolved.
    assert.equal(v.job.session.active,true);assert.equal(v.job.session.state,'closing');
   }else if(check!=='uncertain')assert.equal(v.job.verification.find(e=>e.kind==='final').verified,true);
  }
  assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory);assert.deepEqual(v.authorization.reservation,f.reservation);assert.deepEqual(failures,[]);
  console.log(`PASS supervised ${layout}/${check}: ${v.job.state}, private browser closed, stock and commitments preserved`);
 }finally{human?.requestStop();if(run)await run;human?.close();if(proxy){proxy.closeAllConnections();await new Promise(ok=>proxy.close(ok));}await context.close();for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});}
}
}finally{await ui.close();}
console.log('PASS served-D1 supervised browser acceptance.');
