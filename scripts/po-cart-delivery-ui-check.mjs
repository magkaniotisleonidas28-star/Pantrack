// Served delivery receiving check. Start pnpm dev:cart-browser-worker first.
// Fictional local D1 only: a real local browser worker prepares the practice cart, the manager
// records the supplier confirmation, then staff count blind and the manager reviews.
// No checkout, supplier or payment.
import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {randomUUID} from 'node:crypto';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {fixtureProvisioner,browserCandidate,launchBrowserWorker} from './po-cart-worker/manager-supervisor.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
const actor='local_seedy',quote=v=>`'${String(v).replaceAll("'","''")}'`;// The practice sign-in identity, which owns the company it creates.
const provision=await fixtureProvisioner(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});
const f=await seedLocalBrowserJob({enqueueJob:false});let worker;
const signIn=async page=>page.goto(f.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+f.companyId));
async function openOrder(page){
  await signIn(page);await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();
  await page.getByRole('button',{name:/^Open PO-/}).first().click();const panel=page.locator('[data-durable-cart]');await panel.waitFor();return panel;
}
const fill=async(scope,values)=>{for(const [label,value] of Object.entries(values))await scope.getByLabel(label,{exact:true}).fill(value);};
try{
  const context=await confineManagerContext(await browser.newContext({viewport:{width:1440,height:1000}})),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const api=async(path,body)=>{const r=body?await context.request.post(f.origin+path,{headers:{origin:f.origin,'content-type':'application/json'},data:body}):await context.request.get(f.origin+path);
    return {status:r.status(),data:await r.json()};};
  // Prepare the practice cart with the real local worker, then record the confirmation within the cap.
  let panel=await openOrder(page);
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Authorize preparation',exact:true}).click();
  await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).click();await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).waitFor({state:'hidden'});
  const candidate=await browserCandidate(f);provision(candidate,f.fixtureFile);worker=launchBrowserWorker(f,0);await worker.done;
  const job=(await api(`/api/po-cart-jobs?view=manager&companyId=${f.companyId}&orderId=${f.orderId}`)).data.job,view=(await api(`/api/po-cart-confirmations?companyId=${f.companyId}&jobId=${job.id}`)).data;
  const recorded=await api('/api/po-cart-confirmations',{action:'record',companyId:f.companyId,jobId:job.id,expectedJobRevision:job.revision,operationId:randomUUID(),supplierReference:'SUP-'+randomUUID().slice(0,8),
    expectedDelivery:'2026-11-02',lines:view.authorizedLines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''});
  assert.equal(recorded.data.receipt.state,'confirmed');
  panel=await openOrder(page);
  const deliveries=panel.locator('[data-supplier-deliveries]');await deliveries.getByText('Waiting for a delivery to be counted.').waitFor();
  assert.ok(await deliveries.getByRole('form',{name:/^Count a delivery/}).isVisible(),'A manager can count too');
  // Staff: a Deliveries section with a blind count (no prices or expected amounts).
  await f.execute(`INSERT INTO memberships(user_id,company_id,role) VALUES('fictional-second-owner',${quote(f.companyId)},'owner');
UPDATE memberships SET role='employee' WHERE company_id=${quote(f.companyId)} AND user_id=${quote(actor)};`);
  await signIn(page);await page.getByRole('button',{name:'Deliveries',exact:true}).click();
  const staff=page.locator('[data-staff-deliveries]');await staff.getByRole('heading',{name:'Deliveries'}).waitFor();
  const count=staff.locator('[data-delivery-count]');await count.waitFor();
  const staffText=await staff.innerText();assert.doesNotMatch(staffText,/\$|Ordered|Confirmed|Still expected/,'Staff see no prices or expected amounts');
  assert.deepEqual(await count.locator('thead th').allInnerTexts(),['Item','Packs received','Damaged']);
  await fill(count,{'Packs received of House coffee beans':'1','Packs received of Barista oat milk':'1','Packs received of 12 oz paper cups':'4','Damaged packs of 12 oz paper cups':'1'});
  await count.getByRole('button',{name:'Save count'}).click();await staff.getByText('Count saved. A manager will review it.').waitFor();
  await staff.getByText('The last count for this order is waiting for a manager.').waitFor();
  assert.equal((await api(`/api/po-cart-deliveries?companyId=${f.companyId}&view=manager&jobId=${job.id}`)).status,403,'Staff cannot read the comparison');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No narrow overflow for staff');
  await page.setViewportSize({width:1440,height:1000});
  // Manager: review the count, send it back with a reason, count again and approve with a shortfall and an extra pack.
  await f.execute(`UPDATE memberships SET role='owner' WHERE company_id=${quote(f.companyId)} AND user_id=${quote(actor)};
DELETE FROM memberships WHERE company_id=${quote(f.companyId)} AND user_id='fictional-second-owner';`);
  panel=await openOrder(page);const review=panel.locator('[data-delivery-review]');await review.waitFor();
  assert.equal(await review.getByLabel('Accept packs of 12 oz paper cups').inputValue(),'3','Defaults accept the good packs up to what is expected');
  await review.getByRole('button',{name:'Ask for a recount'}).click();await review.getByRole('alert').filter({hasText:'Say what should be recounted'}).waitFor();
  await review.getByLabel('Note (required to ask for a recount)').fill('Recount the cups');await review.getByRole('button',{name:'Ask for a recount'}).click();
  const again=panel.locator('[data-supplier-deliveries] [data-delivery-count]');await again.waitFor();
  await fill(again,{'Packs received of House coffee beans':'1','Packs received of Barista oat milk':'1','Packs received of 12 oz paper cups':'4'});
  await again.getByRole('button',{name:'Save count'}).click();await review.waitFor();
  await review.getByLabel("The rest of Barista oat milk won't arrive").check();await review.getByLabel('Extra packs of 12 oz paper cups').fill('1');
  await review.getByRole('button',{name:'Approve delivery'}).click();
  await panel.getByText('Everything on this order is received or marked as not arriving.').waitFor();
  const progress=await panel.locator('[data-supplier-deliveries] table').first().locator('tbody tr').allInnerTexts();
  assert.deepEqual(progress.map(r=>r.split('\t').slice(1)),[['1','1','0','0'],['2','1','1','0'],['3','3 + 1 extra','0','0']]);
  const history=await panel.locator('.delivery-history li').allInnerTexts();
  assert.equal(history.length,3);assert.match(history[0],/Sent back for recount.*Recount the cups/);assert.match(history[2],/Approved.*decided by/);
  assert.equal((await api('/api/po-cart-deliveries',{action:'count',companyId:f.companyId,confirmationId:recorded.data.receipt.confirmationId,operationId:randomUUID(),
    deliveredAt:new Date().toISOString(),lines:[{lineId:view.authorizedLines[0].lineId,receivedPacks:'1',damagedPacks:'0'}],note:''})).status,409,'A received order takes no more counts');
  assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory,'Non-stock deliveries leave stock unchanged');
  await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No narrow overflow for the manager');
  assert.deepEqual(errors,[]);await context.close();
}finally{if(worker?.process.exitCode===null)worker.process.kill('SIGTERM');
  for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});await browser.close();}
console.log('PASS: served delivery receiving after real local cart preparation: staff blind count without prices, manager recount with a reason, manager count and approval with a shortfall and an extra pack, history, no further counts and narrow layout.');
