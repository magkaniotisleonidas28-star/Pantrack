import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {launchBrowserWorker,launchHumanBrowser} from './po-cart-worker/manager-supervisor.mjs';
import {readPrivate} from './po-cart-worker/private-files.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
const browser=await chromium.launch({headless:true}),evidence='.sites-runtime/po-cart-workers/reconciliation-acceptance-'+randomUUID();mkdirSync(evidence,{recursive:true,mode:0o700});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await sleep(150);}throw Error('Timed out: '+label);}
const cases=[['rows','accept'],['compact','accept'],['rows','abandon'],['compact','cancel_abandon'],['rows','partial'],['compact','source_abandon']];
try{for(const [index,[layout,kind]] of cases.entries()){
 if(process.argv.includes('--cases')&&!process.argv[process.argv.indexOf('--cases')+1].split(',').includes(String(index)))continue;
 const f=await seedLocalBrowserJob({layout,scenario:kind==='partial'?'lost_response':'normal'}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const view=()=>f.request(`/api/po-cart-jobs?view=manager&companyId=${f.companyId}&orderId=${f.orderId}`),intents=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 let human,proxy,results=0,dropped=false,closeDropped=false,lastFence;
 async function openUI(){await page.setViewportSize({width:1440,height:1000});await page.goto(f.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+f.companyId));await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();await page.getByRole('button',{name:/^Open PO-/}).first().click();await page.locator('[data-durable-cart]').waitFor();}
 async function action(name){const panel=page.locator('[data-durable-cart]');await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes('/api/po-cart-jobs?view=manager')),panel.getByRole('button',{name:'Refresh preparation status'}).click()]);await page.waitForTimeout(150);await panel.getByRole('button',{name,exact:true}).click();}
 try{
  proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks),body=raw.length?JSON.parse(raw):null;
   if(body?.action==='recordResult'&&kind==='accept'){results++;if(results===3){lastFence=body.fence;res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:'Injected interruption before final result commit.'}));return;}}
   const response=await fetch(f.origin+req.url,{method:req.method,headers:{authorization:req.headers.authorization,...(raw.length?{'content-type':'application/json'}:{})},...(raw.length?{body:raw}:{}),redirect:'manual'});
   const data=await response.text();if(body?.action==='beginAttempt'&&kind.includes('abandon')&&!dropped){dropped=true;res.destroy();return;}
   if(body?.action==='complete'&&index===0&&!closeDropped){closeDropped=true;res.destroy();return;}
   res.writeHead(response.status,{'content-type':'application/json'});res.end(data);
  }catch{res.writeHead(503);res.end('{}');}});await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));
  const worker=launchBrowserWorker({...f,origin:'http://127.0.0.1:'+proxy.address().port});await worker.done;
  let v=await view();
  if(v.job.state==='preparing'){const c=readPrivate(f.credentialFiles[0]),r=await fetch(f.origin+'/api/internal/po-cart-worker',{method:'POST',headers:{authorization:'Bearer '+c.secret,'content-type':'application/json'},body:JSON.stringify({action:'hold',jobId:f.jobId,fence:lastFence,operationId:randomUUID(),reason:'uncertain_write'})});assert.equal(r.status,200);v=await view();}
  assert.equal(v.job.state,'review_needed');const entries=JSON.stringify(f.readSession().entries),attempted=v.job.attempted,reserved=v.authorization.reservation.totalMinor;
  if(kind==='cancel_abandon')await f.request('/api/po-cart-jobs?view=manager',{action:'cancel',companyId:f.companyId,jobId:f.jobId,expectedRevision:v.job.revision,operationId:randomUUID(),reason:'Abandon fictional preparation.'});
  if(kind==='source_abandon')await f.execute(`UPDATE po_cart_authorizations SET revision=revision+1,status='invalidated' WHERE company_id='${f.companyId}' AND id='${v.authorization.id}';`);
  await openUI();await action('Inspect practice cart');human=launchHumanBrowser({...f,origin:'http://127.0.0.1:'+proxy.address().port},{headless:true});await until(async()=>(await view()).job.session.state==='open','inspection opened');await action('Close practice browser');assert.equal(await human.done,0);human=null;
  v=await until(async()=>{const v=await view();return v.job.session.state==='closed'&&v.job.reconciliation?.evidence?v:null;},'closed inspection evidence');
  await action('Refresh preparation status');const panel=page.locator('[data-durable-cart]');
  if(kind==='partial'){assert.equal(v.job.eligibility.accept,false);assert.equal(v.job.eligibility.abandon,false);assert.equal(await panel.getByRole('button',{name:'Accept verified cart'}).count(),0);assert.equal(v.authorization.reservation.state,'reserved');}
  else{
   const label=kind==='accept'?'Accept verified cart':'Close abandoned preparation';assert.equal(await panel.getByRole('button',{name:label,exact:true}).isDisabled(),true);
   await panel.getByLabel('Review note').fill('Inspected the fictional cart and verified this decision.');
   if(index===0){await page.screenshot({path:evidence+'/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:evidence+'/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
   let lost=false;await page.route('**/api/po-cart-jobs*',async route=>{if(route.request().method()!=='POST')return route.continue();const body=route.request().postDataJSON();if(!['acceptVerifiedCart','abandonVerifiedCart'].includes(body.action))return route.continue();intents.push(body);if(!lost){lost=true;await route.fetch();return route.abort('failed');}return route.continue();});
   await panel.getByRole('button',{name:label,exact:true}).click();await panel.getByRole('button',{name:'Retry saved request'}).waitFor();await openUI();await panel.getByRole('button',{name:'Retry saved request'}).click();await panel.getByRole('button',{name:'Retry saved request'}).waitFor({state:'hidden'});
   assert.deepEqual(intents[0],intents[1]);if(index===0)assert.equal(closeDropped,true);v=await view();assert.equal(v.job.state,kind==='accept'?'ready':'canceled');assert.equal(v.authorization.reservation.state,kind==='accept'?'reserved':'released');assert.equal(v.job.attempted,attempted);assert.equal(v.authorization.reservation.totalMinor,reserved);
   if(kind!=='accept')assert.equal(v.authorization.incomingLines,0);else assert.equal(v.job.verification.at(-1).reason,'manager_reconciled');
  }
  assert.equal(JSON.stringify(f.readSession().entries),entries);assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory);assert.deepEqual(errors,[]);
  console.log(`PASS served reconciliation ${index}: ${layout} ${kind}; immutable cart/stock, explicit decision and retained/released exposure.`);
 }finally{if(human){human.process.kill('SIGTERM');await human.done;}if(proxy)await new Promise(ok=>proxy.close(ok));await context.close();for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});}
}}finally{await browser.close();}
