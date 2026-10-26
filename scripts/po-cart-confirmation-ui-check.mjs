// Served supplier-confirmation check. Start pnpm dev:cart-browser-worker first.
// Fictional local D1 only: a real local browser worker prepares the practice cart, then the
// manager records what the fictional supplier confirmed. No checkout, supplier or payment.
import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {randomUUID} from 'node:crypto';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {fixtureProvisioner,browserCandidate,launchBrowserWorker} from './po-cart-worker/manager-supervisor.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
const provision=await fixtureProvisioner(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});
try{
  for(const over of [false,true]){
    const f=await seedLocalBrowserJob({enqueueJob:false}),context=await confineManagerContext(await browser.newContext({viewport:{width:1440,height:1000}}));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let worker;
    const confirmation=async()=>(await context.request.get(f.origin+`/api/po-cart-confirmations?companyId=${f.companyId}&jobId=${(await current()).job.id}`)).json();
    async function current(){return (await context.request.get(f.origin+`/api/po-cart-jobs?view=manager&companyId=${f.companyId}&orderId=${f.orderId}`)).json();}
    try{
      await page.goto(f.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+f.companyId));
      await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();
      await page.getByRole('button',{name:/^Open PO-/}).first().click();const panel=page.locator('[data-durable-cart]');await panel.waitFor();
      await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Authorize preparation',exact:true}).click();
      await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).click();
      await panel.getByRole('button',{name:'Prepare fictional cart',exact:true}).waitFor({state:'hidden'});
      const candidate=await browserCandidate(f);provision(candidate,f.fixtureFile);worker=launchBrowserWorker(f,0);await worker.done;
      await panel.getByRole('button',{name:'Refresh preparation status'}).click();await panel.getByText('Cart verified',{exact:true}).waitFor();
      const form=panel.locator('[data-supplier-confirmation]');await form.getByRole('heading',{name:'Record supplier confirmation'}).waitFor();
      assert.ok(await form.getByText('A checkout alone is not a confirmation.',{exact:false}).isVisible());
      const reference='SUP-'+randomUUID().slice(0,8);
      await form.getByLabel('Supplier order number').fill(reference);await form.getByLabel('Expected delivery').fill('2026-11-02');
      if(over){await form.getByRole('button',{name:'Add charge'}).click();await form.getByLabel('Amount (USD)').fill('500.00');
        await form.getByText('it will be held for the owner',{exact:false}).waitFor();}
      await form.getByRole('button',{name:'Save supplier confirmation'}).click();
      await panel.getByRole('heading',{name:'Supplier confirmation recorded'}).waitFor();
      await panel.getByText('Supplier confirmed',{exact:true}).waitFor();
      const saved=await confirmation();assert.equal(saved.confirmation.state,over?'needs_owner_review':'confirmed');
      assert.equal(saved.confirmation.supplierReference,reference);assert.equal(saved.incoming.length,0,'Practice catalog lines are non-stock');
      assert.ok(await panel.getByText(over?"waits for the owner's review; no stock was added":'Confirmed items were added to incoming stock once',{exact:false}).isVisible());
      assert.equal(await panel.getByRole('button',{name:'Cancel preparation',exact:true}).count(),0,'A confirmed purchase cannot be cancelled here');
      // A second save for this order is refused; the record cannot be replaced.
      const job=(await current()).job,again=await context.request.post(f.origin+'/api/po-cart-confirmations',{headers:{origin:f.origin,'content-type':'application/json'},
        data:{action:'record',companyId:f.companyId,jobId:job.id,expectedJobRevision:job.revision,operationId:randomUUID(),supplierReference:reference+'-2',expectedDelivery:'2026-11-02',
          lines:saved.authorizedLines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''}});
      assert.equal(again.status(),409);
      await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No narrow horizontal overflow');
      assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory,'Non-stock confirmations leave stock unchanged');assert.deepEqual(errors,[]);
      console.log(`PASS supplier confirmation ${over?'over cap: held for owner review':'within cap: confirmed'}`);
    }finally{if(worker?.process.exitCode===null)worker.process.kill('SIGTERM');await context.close();
      for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});}
  }
}finally{await browser.close();}
console.log('PASS: served supplier confirmation after real local cart preparation: form, within-cap confirmation, over-cap hold, locked record, no cancel after confirmation and narrow layout.');
