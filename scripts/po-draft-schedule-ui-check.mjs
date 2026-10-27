// Served weekly draft schedules check. Start pnpm dev:cart-browser-worker first.
// Fictional local D1 only. The preview keeps live sales sync off, so every real weekly check here is
// held or skipped, never drafted; the drafting itself is proved by tests/po-draft-schedules.mjs.
// One earlier week is seeded as drafted (through the database guards) to show that result and the
// draft label. No cart, supplier, checkout or payment.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {confineManagerContext} from './po-cart-worker/full-gate-runtime.mjs';
import {localFixtureCookie} from './po-cart-worker/local-browser-fixture.mjs';
await build({entryPoints:['src/lib/po-draft-schedule-contract.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-draft-schedule-contract.mjs',logLevel:'warning'});
const {latestDue}=await import('../.sites-runtime/po-draft-schedule-contract.mjs');
const origin='http://127.0.0.1:5181',root='.sites-runtime/po-cart-workers/weekly-ui-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
const quote=v=>`'${String(v).replaceAll("'","''")}'`,iso=ms=>new Date(ms).toISOString();
function execute(sql){const file=root+'/fixture.sql';writeFileSync(file,sql,{mode:0o600});
  try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc',
    '--persist-to','.sites-runtime/cart-review-state','--file',file],{encoding:'utf8'});if(r.status!==0)throw Error('Local D1 fixture setup failed.');}finally{unlinkSync(file);}}
const shot=async(page,name)=>{if(process.env.WEEKLY_SCREENSHOTS)await page.screenshot({path:`${process.env.WEEKLY_SCREENSHOTS}/${name}.png`,fullPage:true});};
const cookie=await localFixtureCookie(origin),companyId=randomUUID(),actor='local_seedy',now=Date.now(),zone='America/New_York';
const api=async(path,body,headers={})=>{const r=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}:{headers:{cookie,...headers}});
  return {status:r.status,headers:r.headers,data:await r.json()};};
assert.equal((await api('/api/companies',{action:'create',id:companyId,name:'Weekly drafts practice café'})).status,200);
// A supplier with two delivery locations (two schedule groups), saved through the app.
const saved=await api('/api/purchasing-suppliers',{action:'save_profile',companyId,operationId:randomUUID(),reason:'Fictional practice supplier',supplierId:'practice-supply',expectedVersion:0,
  profile:{name:'Practice Café Supply',email:null,telephone:'',paymentTerms:'Illustrative',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'Fictional only',
    emailAcceptance:{status:'unknown',note:''},accounts:[{id:'north-account',reference:'A-100',status:'active'},{id:'south-account',reference:'A-200',status:'active'}],
    locations:[{id:'north',accountId:'north-account',reference:'North café',address:'1 Fictional Street',status:'active'},
      {id:'south',accountId:'south-account',reference:'South café',address:'2 Fictional Street',status:'active'}]}});
assert.equal(saved.status,200,JSON.stringify(saved.data));
// A manual draft to stand for an earlier scheduled week.
const draft=(await api('/api/purchase-orders',{action:'create',companyId,operationId:randomUUID(),source:'manual',capMinor:'5000',notes:'Fictional',
  supplier:{id:'practice-supply',name:'Practice Café Supply',email:'orders@example.invalid',accountId:'A-100',locationId:'North café',deliveryAddress:'1 Fictional Street'},
  lines:[{kind:'non_stock',sku:'CUPS',description:'Paper cups',unitLabel:'sleeve',packs:'2',estimatedUnitMinor:'650'}]})).data.order;
// Seed what the preview cannot do in real time: the owner's time zone, a scheduler token, a schedule saved
// two weeks ago, and the previous week drafted. All rows pass the database guards.
const token=randomUUID(),created=iso(now-15*86_400_000),latest=latestDue(now,1,'09:00',zone),previous=latestDue(Date.parse(latest.dueAt)-1,1,'09:00',zone);
execute(`INSERT INTO company_time_zones VALUES(${quote(companyId)},1,${quote(zone)},${quote(actor)},${quote(created)},${quote(randomUUID())},'ui-fixture');
INSERT INTO automation_settings(company_id,data,scheduler_hash) VALUES(${quote(companyId)},'{}',${quote(createHash('sha256').update(token).digest('hex'))});
INSERT INTO po_draft_schedules VALUES(${quote(companyId)},'seeded',1,'active','practice-supply','north-account','north',1,'09:00',10,${quote(actor)},'Monday order',${quote(actor)},${quote(created)},${quote(randomUUID())},'ui-fixture');
INSERT INTO po_draft_occurrences(company_id,schedule_id,week_key,schedule_version,due_at,time_zone,state,attempts,holder,lease_until,created_at,updated_at)
 VALUES(${quote(companyId)},'seeded',${quote(previous.weekKey)},1,${quote(previous.dueAt)},${quote(zone)},'running',1,'ui-fixture',${quote(iso(Date.parse(previous.dueAt)+60_000))},${quote(previous.dueAt)},${quote(previous.dueAt)});
UPDATE po_draft_occurrences SET draft_input_json='{}',draft_actor=${quote(actor)} WHERE company_id=${quote(companyId)} AND schedule_id='seeded';
UPDATE po_draft_occurrences SET state='drafted',order_id=${quote(draft.snapshot.id)},lease_until=NULL,updated_at=${quote(previous.dueAt)} WHERE company_id=${quote(companyId)} AND schedule_id='seeded';`);
// The real weekly check, through its route: wrong tokens run nothing; the right one records this week once.
const tick=t=>fetch(`${origin}/api/po-draft-schedules/tick?companyId=${companyId}`,{method:'POST',headers:{authorization:'Bearer '+t}});
assert.equal((await tick('wrong')).status,401);
const ran=await (await tick(token)).json();
assert.deepEqual(ran.weeks.map(w=>[w.weekKey,w.state]),[[latest.weekKey,'skipped_waiting']],'The earlier draft still waits, so this week is skipped');
assert.deepEqual((await (await tick(token)).json()).weeks,[],'A repeated check adds nothing');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});
try{
  const context=await confineManagerContext(await browser.newContext({viewport:{width:1440,height:1000}})),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+companyId));
  await page.getByRole('button',{name:'Weekly drafts',exact:true}).first().click();
  const panel=page.locator('[data-weekly-schedules]');await panel.getByRole('heading',{name:'Weekly order drafts'}).waitFor();
  assert.ok(await panel.getByText(`Times use the café's time zone, ${zone}.`).isVisible());
  const seeded=panel.locator('[data-weekly-schedule]').filter({hasText:'North café'});
  assert.match(await seeded.innerText(),/Every Monday at 09:00 · margin 10% · drafts for local_seedy/);
  const weeks=await seeded.locator('tbody tr').allInnerTexts();
  assert.deepEqual(weeks.map(r=>r.split('\t')),[[latest.weekKey,'Skipped: a draft is waiting',`Draft ${draft.snapshot.number} from the week of ${previous.weekKey} is still waiting for review.`],
    [previous.weekKey,'Draft created',`${draft.snapshot.number}, waiting for review`]]);
  await shot(page,'weekly-list');
  // A new schedule for the other location, with a validation error first.
  await panel.getByRole('button',{name:'New schedule'}).click();const form=panel.locator('[data-weekly-form]');
  assert.deepEqual(await form.getByLabel('Supplier and delivery location').locator('option').allInnerTexts(),['Choose…','Practice Café Supply — A-200 · South café'],'Taken groups are not offered');
  await form.getByLabel('Supplier and delivery location').selectOption({label:'Practice Café Supply — A-200 · South café'});
  await form.getByLabel('Day').selectOption({label:'Wednesday'});await form.getByLabel('Time').fill('07:30');await form.getByLabel('Cap margin (%)').fill('150');
  await form.getByRole('button',{name:'Save schedule'}).click();await panel.getByRole('alert').filter({hasText:'Enter a cap margin from 0 to 100 percent.'}).waitFor();
  await form.getByLabel('Cap margin (%)').fill('15');await shot(page,'weekly-form');await form.getByRole('button',{name:'Save schedule'}).click();
  await panel.getByText('Schedule saved. The first draft comes at its next weekly time.').waitFor();
  const south=panel.locator('[data-weekly-schedule]').filter({hasText:'South café'});
  assert.match(await south.innerText(),/Every Wednesday at 07:30 · margin 15% · drafts for local_seedy[\s\S]*Next run: [\s\S]*No weeks yet\./);
  assert.equal(await panel.getByRole('button',{name:'New schedule'}).isDisabled(),true,'Every group has a schedule');
  // Edit keeps the supplier; pause and resume.
  await south.getByRole('button',{name:'Edit'}).click();
  assert.equal(await form.getByLabel('Supplier and delivery location').isDisabled(),true);await form.getByLabel('Time').fill('08:00');
  await form.getByRole('button',{name:'Save schedule'}).click();await panel.getByText('Schedule updated. It applies from now on.').waitFor();
  await south.getByText('Every Wednesday at 08:00').waitFor();
  await south.getByRole('button',{name:'Pause'}).click();await panel.getByText('Schedule paused.').waitFor();
  await south.getByText('Paused. Paused weeks are skipped, not caught up.').waitFor();assert.equal(await south.locator('.weekly-status').innerText(),'Paused');
  await south.getByRole('button',{name:'Resume'}).click();await panel.getByText('Schedule resumed from now on.').waitFor();
  assert.equal(await south.locator('.weekly-status').innerText(),'Active');
  const listed=(await api('/api/po-draft-schedules?companyId='+companyId)).data.schedules.find(s=>s.locationId==='south');
  assert.deepEqual([listed.version,listed.weekday,listed.localTime,listed.marginPercent,listed.status],[4,3,'08:00',15,'active']);
  await page.setViewportSize({width:390,height:844});await shot(page,'weekly-390');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No narrow overflow');
  assert.equal(await panel.locator('.weekly-weeks').evaluateAll(tables=>tables.some(t=>t.scrollWidth>t.clientWidth+1)),false,'Recent weeks fit a phone without sideways scrolling');
  await page.setViewportSize({width:1440,height:1000});
  // The draft from the scheduled week says so when opened.
  await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).first().click();
  await page.getByRole('button',{name:`Open ${draft.snapshot.number}`}).click();
  await page.locator('[data-weekly-draft]').getByText(`Created by the weekly schedule for the week of ${previous.weekKey}.`).waitFor();await shot(page,'weekly-draft');
  // Staff never see schedules.
  execute(`INSERT INTO memberships(user_id,company_id,role) VALUES('fictional-second-owner',${quote(companyId)},'owner');
UPDATE memberships SET role='employee' WHERE company_id=${quote(companyId)} AND user_id=${quote(actor)};`);
  assert.equal((await api('/api/po-draft-schedules?companyId='+companyId)).status,403,'Staff cannot read schedules');
  assert.deepEqual(errors,[]);await context.close();
}finally{await browser.close();}
console.log('PASS: served weekly drafts: the real weekly check through its token route (wrong token refused, one record per week, skipped while a draft waits), the schedule list with recent weeks and a seeded drafted week, new schedule with validation and taken groups hidden, edit keeping the supplier, pause and resume, narrow layout, the weekly label on the opened draft, and staff refused.');
