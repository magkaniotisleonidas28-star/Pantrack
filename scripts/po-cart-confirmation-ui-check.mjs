// Served supplier-confirmation check. Start pnpm dev:cart-browser-worker first.
// Fictional local D1 only: a real local browser worker prepares the practice cart, then the
// manager records what the fictional supplier confirmed. Over the cap, the owner reviews it: notes are
// saved, and approval asks for the password, which practice sign-in cannot confirm, so nothing is
// approved here; approval itself is proved by tests/po-cart-over-cap-approval.mjs. No checkout, supplier or payment.
import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {randomUUID} from 'node:crypto';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {fixtureProvisioner,browserCandidate,launchBrowserWorker} from './po-cart-worker/manager-supervisor.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
const actor='local_seedy',quote=v=>`'${String(v).replaceAll("'","''")}'`;// The practice sign-in identity, which owns the company it creates.
const shot=async(page,name)=>{if(process.env.OVERCAP_SCREENSHOTS)await page.screenshot({path:`${process.env.OVERCAP_SCREENSHOTS}/${name}.png`,fullPage:true});};
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
      for(const stale of ['Inspect practice cart','An attempted addition prevents automatic resume','until verified abandonment'])assert.equal(await panel.getByText(stale,{exact:false}).count(),0,'No stale preparation guidance after confirmation: '+stale);
      // A second save for this order is refused; the record cannot be replaced.
      const job=(await current()).job,again=await context.request.post(f.origin+'/api/po-cart-confirmations',{headers:{origin:f.origin,'content-type':'application/json'},
        data:{action:'record',companyId:f.companyId,jobId:job.id,expectedJobRevision:job.revision,operationId:randomUUID(),supplierReference:reference+'-2',expectedDelivery:'2026-11-02',
          lines:saved.authorizedLines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''}});
      assert.equal(again.status(),409);
      if(over){
        // The owner reviews it: a note keeps it held; approval asks for the password, and an unconfirmed password approves nothing.
        const review=panel.locator('[data-over-cap-review]');await review.getByRole('heading',{name:'Owner review'}).waitFor();
        assert.match(await review.innerText(),/over the approved \$[\d,.]+ cap\. Approving counts the full/);
        await review.getByRole('button',{name:'Leave it held with this note'}).click();await review.getByRole('alert').filter({hasText:'Say what should happen with this order.'}).waitFor();
        await review.getByLabel('Note (required to leave it held)').fill('Ask the supplier to drop the fee');
        await review.getByRole('button',{name:'Leave it held with this note'}).click();
        await panel.locator('.over-cap-notes').getByText('Ask the supplier to drop the fee',{exact:false}).waitFor();
        await review.getByRole('button',{name:/^Approve \$/}).click();const prompt=review.getByRole('form',{name:'Confirm your password'});await prompt.waitFor();
        await shot(page,'over-cap-prompt');
        await prompt.getByLabel('Current password').fill('not-a-practice-password');await prompt.getByRole('button',{name:'Confirm and approve'}).click();
        await review.getByRole('alert').filter({hasText:'Password confirmation failed'}).waitFor();
        const held=await confirmation();assert.deepEqual([held.confirmation.approval,held.confirmation.notes.length,held.incoming.length],[null,1,0],'Nothing approved without the password');
        // A manager sees it waiting for the owner, with no review controls.
        await f.execute(`INSERT INTO memberships(user_id,company_id,role) VALUES('fictional-second-owner',${quote(f.companyId)},'owner');
UPDATE memberships SET role='manager' WHERE company_id=${quote(f.companyId)} AND user_id=${quote(actor)};`);
        await page.goto(f.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+f.companyId));
        await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).click();await page.getByRole('button',{name:/^Open PO-/}).first().click();
        await panel.getByText("Waiting for the owner's review.").waitFor();assert.equal(await panel.locator('[data-over-cap-review]').count(),0);
        await shot(page,'over-cap-manager');
      }
      await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No narrow horizontal overflow');
      assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory,'Non-stock confirmations leave stock unchanged');assert.deepEqual(errors,[]);
      console.log(`PASS supplier confirmation ${over?'over cap: held for owner review':'within cap: confirmed'}`);
    }finally{if(worker?.process.exitCode===null)worker.process.kill('SIGTERM');await context.close();
      for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});}
  }
}finally{await browser.close();}
console.log('PASS: served supplier confirmation after real local cart preparation: form, within-cap confirmation, over-cap hold, locked record, no cancel after confirmation and narrow layout.');
