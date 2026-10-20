import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readPrivate} from './po-cart-worker/private-files.mjs';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {fixtureProvisioner,browserCandidate,launchBrowserWorker} from './po-cart-worker/manager-supervisor.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
import {mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
const provision=await fixtureProvisioner(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});
const evidence='.sites-runtime/po-cart-workers/manager-acceptance-'+randomUUID();mkdirSync(evidence,{recursive:true,mode:0o700});
try{
 for(const [index,[layout,scenario]] of [['rows','normal'],['compact','normal'],['rows','malicious'],['compact','malicious'],['rows','login_expired'],['compact','lost_response'],['rows','cancel'],['compact','cancel_active']].entries()){
  if(process.argv.includes('--cases')&&!process.argv[process.argv.indexOf('--cases')+1].split(',').includes(String(index)))continue;
  const f=await seedLocalBrowserJob({enqueueJob:false}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await (await confineManagerContext(context)).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function open(){
   await page.goto(f.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+f.companyId));
   await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();
   await page.getByRole('button',{name:/^Open PO-/}).first().click();await page.locator('[data-durable-cart]').waitFor();
  }
  async function current(){return (await context.request.get(f.origin+`/api/po-cart-jobs?view=manager&companyId=${f.companyId}&orderId=${f.orderId}`)).json();}
  let worker,proxy,releaseBegin,releaseFinal;
  try{
   await open();const panel=page.locator('[data-durable-cart]');
   assert.equal(await panel.getByRole('button',{name:'Authorize preparation',exact:true}).isDisabled(),true);
   assert.equal((await current()).authorization,null);
   const intents=[];let lostAuthorization=false,lostEnqueue=false;
   if(index===0)await page.route('**/api/po-cart-*',async route=>{
    const request=route.request();if(request.method()!=='POST')return route.continue();
    const body=request.postDataJSON();intents.push(body);
    if((body.action==='authorize'&&!lostAuthorization)||(body.action==='enqueue'&&!lostEnqueue)){
     await route.fetch();if(body.action==='authorize')lostAuthorization=true;else lostEnqueue=true;return route.abort('failed');
    }return route.continue();
   });
   await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Authorize preparation',exact:true}).click();
   if(index===0){await panel.getByRole('button',{name:'Retry saved request'}).waitFor();await open();await panel.getByRole('button',{name:'Retry saved request'}).click();}
   await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).waitFor();
   const authorized=await current();assert.equal(authorized.authorization.reservation.state,'reserved');
   await panel.getByLabel('Practice storefront layout').selectOption(layout);await panel.getByLabel('Practice scenario').selectOption(scenario.startsWith('cancel')?'normal':scenario);
   let competitor;
   if(index===1){competitor=await context.newPage();await competitor.goto(page.url());await competitor.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();await competitor.getByRole('button',{name:/^Open PO-/}).first().click();await competitor.getByRole('button',{name:'Prepare fictional cart',exact:true}).waitFor();}
   await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).click();
   if(competitor){await competitor.getByRole('button',{name:'Prepare fictional cart',exact:true}).click();await competitor.locator('[data-durable-cart] .cart-preview-status').waitFor();await competitor.close();}
   if(index===0){await panel.getByRole('button',{name:'Retry saved request'}).waitFor();await open();await panel.getByRole('button',{name:'Retry saved request'}).click();}
   let view;for(let n=0;n<50;n++){view=await current();if(view.job)break;await page.waitForTimeout(100);}assert.equal(view.job.state,'queued');
   await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).waitFor({state:'hidden'});
   if(scenario==='cancel'){
    let lost=false;const cancels=[];await page.route('**/api/po-cart-jobs*',async route=>{const r=route.request();if(r.method()!=='POST')return route.continue();const body=r.postDataJSON();cancels.push(body);if(!lost){lost=true;await route.fetch();return route.abort('failed');}return route.continue();});
    await panel.getByRole('button',{name:'Cancel preparation',exact:true}).click();await panel.getByRole('button',{name:'Retry saved request'}).waitFor();await open();await panel.getByRole('button',{name:'Retry saved request'}).click();
    await panel.getByText('Preparation canceled',{exact:true}).waitFor();assert.deepEqual(cancels[0],cancels[1]);
    view=await current();assert.equal(view.authorization.reservation.state,'released');assert.equal(await browserCandidate(f),null);
   }else if(scenario==='cancel_active'){
    const candidate=await browserCandidate(f);provision(candidate,f.fixtureFile);
    let began;const begun=new Promise(ok=>{began=ok;}),gate=new Promise(ok=>{releaseBegin=ok;});
    proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();
      const r=await fetch(f.origin+req.url,{method:req.method,headers:{authorization:req.headers.authorization,...(raw?{'content-type':'application/json'}:{})},...(raw?{body:raw}:{}),redirect:'error'}),body=await r.text();
      if(raw&&JSON.parse(raw).action==='beginAttempt'&&r.ok){began();await gate;}res.writeHead(r.status,Object.fromEntries(r.headers));res.end(body);
    }catch{res.destroy();}});await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));
    worker=[launchBrowserWorker({...f,origin:'http://127.0.0.1:'+proxy.address().port})];
    await Promise.race([begun,new Promise((_,fail)=>setTimeout(()=>fail(Error('Worker never began an attempt')),15000))]);
    await panel.getByRole('button',{name:'Refresh preparation status'}).click();await panel.getByText('Preparing cart',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Cancel preparation',exact:true}).click();await panel.getByText('Preparation canceled',{exact:true}).waitFor();
    releaseBegin();await worker[0].done;view=await current();assert.equal(view.job.state,'canceled');assert.equal(view.authorization.reservation.state,'reserved');
    assert.equal(readPrivate(f.root+'/manager-journal-0.json').calls.length,0);assert.equal(readPrivate(f.storefrontFile).fixtures[view.job.id].entries.length,1);
   }else{
    const candidate=await browserCandidate(f);provision(candidate,f.fixtureFile);
    let workerManifest=f,finalStarted;
    if(index===1){
     let started;finalStarted=new Promise(ok=>{started=ok;});const gate=new Promise(ok=>{releaseFinal=ok;});
     proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();
       if(raw&&JSON.parse(raw).action==='finalizeCart'){started();await gate;}
       const r=await fetch(f.origin+req.url,{method:req.method,headers:{authorization:req.headers.authorization,...(raw?{'content-type':'application/json'}:{})},...(raw?{body:raw}:{}),redirect:'error'});
       res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
     }catch{res.destroy();}});await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));workerManifest={...f,origin:'http://127.0.0.1:'+proxy.address().port};
    }
    // Two independent HTTP consumers compete for the same account and exact lines.
    const workers=[launchBrowserWorker(workerManifest,0),launchBrowserWorker(workerManifest,1)];worker=workers;
    if(finalStarted){let timer;try{await Promise.race([finalStarted,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('Worker never finalized')),15000);})]);}finally{clearTimeout(timer);}
     await panel.getByRole('button',{name:'Refresh preparation status'}).click();await panel.getByText('Preparing cart',{exact:true}).waitFor();
     assert.equal((await current()).job.lines.every(l=>l.verified),true);assert.equal(await panel.getByText('Cart verified',{exact:true}).count(),0);releaseFinal();}
    await Promise.all(workers.map(w=>w.done));await panel.getByRole('button',{name:'Refresh preparation status'}).click();
    view=await current();const ready=['normal','malicious'].includes(scenario);assert.equal(view.job.state,ready?'ready':'review_needed');
    await panel.getByText(ready?'Cart verified':'Review needed',{exact:true}).waitFor();
    assert.equal(view.job.verification.some(e=>e.kind==='final'&&e.verified),ready);
    const calls=[0,1].flatMap(i=>readPrivate(f.root+`/manager-journal-${i}.json`).calls);assert.equal(calls.length,ready?3:scenario==='lost_response'?1:0);
    const session=readPrivate(f.storefrontFile).fixtures[view.job.id];assert.equal(session.entries.length,ready?4:scenario==='lost_response'?2:1);
    assert.equal(session.entries[0].sku,'EXISTING');assert.deepEqual(view.authorization.reservation,authorized.authorization.reservation);
    const beforeReload=view.job.id;await open();assert.equal((await current()).job.id,beforeReload);
    if(index===0){assert.equal(lostAuthorization,true);assert.equal(lostEnqueue,true);for(const action of ['authorize','enqueue']){const same=intents.filter(i=>i.action===action);assert.deepEqual(same[0],same[1]);}}
    if(index===1){
     await panel.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/desktop.png'});
     await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/mobile.png'});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No mobile horizontal overflow');
    }
    if(index===0){
     const {order}=await f.request(`/api/purchase-orders?companyId=${f.companyId}&orderId=${f.orderId}`);
     await f.request('/api/purchase-orders',{action:'edit',companyId:f.companyId,orderId:f.orderId,expectedRevision:order.revision,operationId:crypto.randomUUID(),reason:'Verify manager source invalidation',source:'manual',supplier:order.snapshot.supplier,capMinor:order.snapshot.capMinor,notes:'Changed after verified cart',lines:order.snapshot.lines.map(l=>({kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,estimatedUnitMinor:l.estimatedUnitMinor}))});
     await panel.getByRole('button',{name:'Refresh preparation status'}).click();await panel.getByText('Review needed',{exact:true}).waitFor();assert.equal((await current()).job.valid,false);
    }
   }
   assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory);assert.deepEqual(errors,[]);
   console.log(`PASS manager UI ${layout}/${scenario}: ${view.job.state}, reload, reservations and stock`);
  }finally{releaseBegin?.();releaseFinal?.();if(worker)for(const w of worker)if(w.process.exitCode===null)w.process.kill('SIGTERM');if(proxy){proxy.closeAllConnections();await new Promise(ok=>proxy.close(ok));}await context.close();for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});}
 }
}finally{await browser.close();}
console.log('PASS: served-D1 manager UI, separate competing browser processes, final verification, holds, lost-response replay, reload and private responsive evidence.');
