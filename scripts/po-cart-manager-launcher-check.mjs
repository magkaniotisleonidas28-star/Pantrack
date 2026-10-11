import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {readPrivate} from './po-cart-worker/private-files.mjs';
const root='.sites-runtime/po-cart-workers/manager-demo';
async function start(){
 const p=spawn(process.execPath,['scripts/po-cart-manager-preview.mjs'],{stdio:['ignore','pipe','pipe']});let output='';
 const exited=new Promise(ok=>p.once('exit',code=>ok(code)));
 const ready=new Promise((ok,fail)=>{p.once('error',fail);p.stdout.on('data',b=>{output+=b;if(output.includes('Durable cart demo:'))ok();});p.stderr.on('data',b=>output+=b);p.once('exit',()=>fail(Error('Local launcher exited before ready.')));});
 let timer;try{await Promise.race([ready,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('Local launcher did not become ready.')),60000);})]);}catch(e){p.kill('SIGTERM');throw e;}finally{clearTimeout(timer);}
 return {p,output:()=>output,stop:async()=>{p.kill('SIGTERM');let timeout;try{assert.equal(await Promise.race([exited,new Promise((_,fail)=>{timeout=setTimeout(()=>fail(Error('Local launcher failed to stop.')),15000);})]),0);}finally{clearTimeout(timeout);}}};
}
let launcher,browser;
try{
 launcher=await start();const manifest=readPrivate(root+'/manifest.json'),credential=readPrivate(manifest.credentialFiles[0]);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});const page=await browser.newPage();
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

 await launcher.stop();launcher=null;
 launcher=await start();const next=readPrivate(root+'/manifest.json'),rotated=readPrivate(next.credentialFiles[0]);assert.equal(next.companyId,manifest.companyId);assert.equal(next.orderId,manifest.orderId);assert.equal(rotated.workerId,credential.workerId);assert.notEqual(rotated.credentialId,credential.credentialId);
 await open();assert.equal((await view()).job.id,status.job.id);assert.deepEqual(readPrivate('.sites-runtime/po-cart-workers/local-storefront.json').fixtures[status.job.id],session);assert.deepEqual(readPrivate(root+'/manager-journal-0.json').calls,journal.calls);
 for(const secret of [session.token,credential.secret,rotated.secret])assert.ok(!launcher.output().includes(secret));
 console.log('PASS: one-command manager demo runs separate automation and visible inspection browser workers; graceful shutdown/restart preserves company, order, exact cart, token, journal and worker identity without another addition.');
}finally{await browser?.close();await launcher?.stop();}
