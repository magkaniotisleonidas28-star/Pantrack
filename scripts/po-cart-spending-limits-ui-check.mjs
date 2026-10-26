// Served owner spending-limits screen check. Start pnpm dev:cart-browser-worker first.
// Fictional local D1 only. Practice sign-in has no password, so loosening is shown to
// require confirmation and to save nothing when it cannot be confirmed.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import {localFixtureCookie} from './po-cart-worker/local-browser-fixture.mjs';
const origin='http://127.0.0.1:5181',root='.sites-runtime/po-cart-workers/spending-limits-ui-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
function execute(sql){const file=root+'/fixture.sql';writeFileSync(file,sql,{mode:0o600});
  try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc',
    '--persist-to','.sites-runtime/cart-review-state','--file',file],{encoding:'utf8'});if(r.status!==0)throw Error('Local D1 fixture setup failed.');}finally{unlinkSync(file);}}
const cookie=await localFixtureCookie(origin),companyId=randomUUID(),at=new Date().toISOString();
const api=async(path,body)=>{const r=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});return {status:r.status,data:await r.json()};};
assert.equal((await api('/api/companies',{action:'create',id:companyId,name:'Spending limits practice café'})).status,200);
const owner=(await api('/api/po-cart-spending-limits?companyId='+companyId)).data;assert.equal(owner.limits,null,'A new company has no limits');
const actor='local_seedy';// The practice sign-in identity, which owns the company it creates.
// Seed what practice sign-in cannot confirm: the first time zone and limits, as the owner.
execute(`INSERT INTO company_time_zones VALUES(${quote(companyId)},1,'America/New_York',${quote(actor)},${quote(at)},${quote(randomUUID())},'ui-fixture');
INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,per_day_minor,per_month_minor,actor,created_at,operation_id,fingerprint)
 VALUES(${quote(companyId)},1,20000,100000,30000,50000,${quote(actor)},${quote(at)},${quote(randomUUID())},'ui-fixture');`);
const current=async()=>(await api('/api/po-cart-spending-limits?companyId='+companyId)).data;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const context=await confineManagerContext(await browser.newContext({viewport})),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+companyId));
    if(viewport.width<700){await page.getByRole('button',{name:'Open workspace navigation'}).click();}
    await page.getByRole('button',{name:'Spending limits',exact:true}).first().click();
    const panel=page.locator('[data-spending-limits]');await panel.waitFor();
    await panel.getByRole('heading',{name:'Owner spending limits'}).waitFor();
    assert.ok(await panel.getByText("cannot limit spending at a supplier's own checkout",{exact:false}).isVisible());
    assert.equal(await panel.getByLabel('Per order').inputValue(),'200.00');assert.equal(await panel.getByLabel('Per day').inputValue(),'300.00');
    assert.equal(await panel.getByLabel('Per month (optional)').inputValue(),'500.00');assert.equal(await panel.getByLabel('In progress').inputValue(),'1000.00');
    assert.ok(await panel.getByText('$0.00 of $300.00').isVisible(),'Today\'s use against the daily limit');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`No horizontal scroll at ${viewport.width}px`);
    if(viewport.width<700){assert.deepEqual(errors,[]);await context.close();continue;}
    const version=(await current()).limits.version;
    // Client checks never send an invalid ordering.
    await panel.getByLabel('Per order').fill('400.00');await panel.getByRole('button',{name:'Save limits'}).click();
    await panel.getByRole('alert').filter({hasText:'Per order cannot be more than per day.'}).waitFor();assert.equal((await current()).limits.version,version);
    // Tightening saves without a password.
    await panel.getByRole('button',{name:'Reset unsaved fields'}).click();await panel.getByLabel('Per day').fill('250.00');
    await panel.getByRole('button',{name:'Save limits'}).click();await panel.getByRole('status').filter({hasText:'Spending limits saved.'}).waitFor();
    let saved=await current();assert.equal(saved.limits.version,version+1);assert.equal(saved.limits.perDayMinor,25000);
    await panel.getByText('Change history').click();await panel.getByRole('heading',{name:`Version ${version+1} · Set by owner`}).waitFor();
    // Loosening asks for the password; without a confirmation nothing is saved.
    await panel.getByLabel('Per day').fill('400.00');await panel.getByRole('button',{name:'Save limits'}).click();
    const prompt=panel.getByRole('form',{name:'Confirm your password'});await prompt.waitFor();
    assert.ok(await prompt.getByText('Confirm your password to raise, remove or first set spending limits.',{exact:false}).isVisible());
    assert.equal(await panel.getByRole('button',{name:'Save limits'}).isDisabled(),true,'Other changes wait for the confirmation');
    await prompt.getByLabel('Current password').fill('not-a-real-password');await prompt.getByRole('button',{name:'Confirm and save'}).click();
    await panel.getByRole('alert').filter({hasText:'Password confirmation failed'}).waitFor();
    assert.equal(await prompt.getByLabel('Current password').inputValue(),'','The password is cleared after an attempt');
    await prompt.getByRole('button',{name:'Cancel'}).click();await prompt.waitFor({state:'detached'});
    saved=await current();assert.equal(saved.limits.version,version+1);assert.equal(saved.limits.perDayMinor,25000);
    // A time-zone change always asks for the password.
    await panel.getByLabel('Time zone').fill('America/Chicago');await panel.getByRole('button',{name:'Save time zone'}).click();
    await panel.getByRole('form',{name:'Confirm your password'}).waitFor();await panel.getByRole('button',{name:'Cancel'}).click();
    assert.equal((await current()).timeZone.timeZone,'America/New_York');
    // Keyboard: the limit fields are reachable and labelled.
    await panel.getByLabel('Per order').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('label')?.textContent?.startsWith('Per day')),true);
    assert.deepEqual(errors,[]);await context.close();
  }
  // Managers and employees see no spending-limit screen, and the API refuses them.
  // A second fictional owner keeps the company owned while the practice user is demoted.
  execute(`INSERT INTO memberships(user_id,company_id,role) VALUES('fictional-second-owner',${quote(companyId)},'owner');`);
  for(const role of ['manager','employee']){
    execute(`UPDATE memberships SET role=${quote(role)} WHERE company_id=${quote(companyId)} AND user_id=${quote(actor)};`);
    const context=await confineManagerContext(await browser.newContext({viewport:{width:1440,height:1000}})),page=await context.newPage();
    await page.goto(origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+companyId));
    await page.getByRole('navigation',{name:'Workspace sections'}).first().waitFor();
    assert.equal(await page.getByRole('button',{name:'Spending limits',exact:true}).count(),0,`${role} sees no spending limits`);
    assert.equal((await api('/api/po-cart-spending-limits?companyId='+companyId)).status,403);await context.close();
  }
  execute(`UPDATE memberships SET role='owner' WHERE company_id=${quote(companyId)} AND user_id=${quote(actor)};
DELETE FROM memberships WHERE company_id=${quote(companyId)} AND user_id='fictional-second-owner';`);
  console.log('PASS: owner spending-limits screen at desktop and narrow widths shows limits, use and history, tightens without a password, asks for it before loosening or a time-zone change and saves nothing unconfirmed; managers and employees see no screen.');
}finally{await browser.close();}
