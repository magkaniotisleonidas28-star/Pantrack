// Start scripts/purchase-order-preview.mjs in this worktree. Fictional loopback only.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {localFixtureCookie} from './po-cart-worker/local-browser-fixture.mjs';
const origin='http://127.0.0.1:5179',root=resolve('.sites-runtime/archive-browser/run-'+crypto.randomUUID());mkdirSync(root,{recursive:true});
const cookie=await localFixtureCookie(origin),companyId=crypto.randomUUID(),actor='local_seedy',headers={cookie,origin,'content-type':'application/json','X-Pantrack-Archive-Viewer':actor};
const api=async(path,body)=>{const response=await fetch(origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers,redirect:'error'});assert.equal(response.status,200,await response.clone().text());return response.json();};
await api('/api/companies',{action:'create',id:companyId,name:'Permanent copies practice café'});
const input=()=>({action:'create',companyId,operationId:crypto.randomUUID(),source:'manual',capMinor:'10000',notes:'Permanent fictional copy',
  supplier:{id:'fictional',name:'Fictional Café Supply',email:'orders@example.invalid',accountId:'fixture',locationId:'fixture',deliveryAddress:'Fictional street'},
  lines:[{kind:'non_stock',sku:'=BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:'125'}]});
const {order}=await api('/api/purchase-orders',input()),list=async(kind='draft')=>api('/api/purchase-order-documents?'+new URLSearchParams({companyId,view:'list',kind,...(kind==='draft'?{orderId:order.snapshot.id}:{})}));
const d1Root=resolve('.sites-runtime/po-review-state/v3/d1'),matches=[];
for(const name of readdirSync(d1Root,{recursive:true}).filter(n=>n.endsWith('.sqlite')&&!n.endsWith('metadata.sqlite'))){const path=join(d1Root,name),db=new DatabaseSync(path,{readOnly:true});
  try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='companies'").get()&&db.prepare('SELECT 1 FROM companies WHERE id=?').get(companyId))matches.push(path);}finally{db.close();}}
assert.equal(matches.length,1,'Select only the unique fictional preview database');const db=new DatabaseSync(matches[0]);
const latest=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.at(-1),tables=Object.keys(JSON.parse(readFileSync(`drizzle/meta/${String(latest.idx).padStart(4,'0')}_snapshot.json`,'utf8')).tables).filter(n=>!n.startsWith('document_archive_')).sort();
const business=()=>JSON.stringify(tables.map(n=>[n,db.prepare(`SELECT * FROM "${n}"`).all()])),before=business();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()}),files=[];let roleChanged=false;
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const page=await context.newPage(),errors=[],downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d));page.setDefaultTimeout(60000);
  const open=async()=>{await page.goto(origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+companyId));await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).first().click();await page.getByRole('button',{name:'Open '+order.snapshot.number,exact:true}).click();};
  await open();const panel=page.getByRole('region',{name:'Saved copies',exact:true});await panel.getByText('No saved copies yet.').waitFor();
  const save=async(format)=>{const previous=(await list()).artifacts.length;await panel.getByRole('button',{name:`Save ${format} copy`,exact:true}).click();await panel.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="Saved copies"] [role="status"]')?.textContent?.includes('Loading'));
    assert.equal((await list()).artifacts.length,previous+1);};
  const download=async(format,label,oldest=false)=>{const pending=page.waitForEvent('download'),buttons=panel.getByRole('button',{name:new RegExp('^Download saved '+format)});await (oldest?buttons.last():buttons.first()).click();const file=await pending,path=join(root,label+'.'+(format==='PDF'?'pdf':'xlsx'));await file.saveAs(path);
    const bytes=readFileSync(path),id=file.suggestedFilename().match(/^pantrack-saved-([a-f0-9-]+)\./)?.[1];assert.ok(id);const found=[...(await list()).artifacts,...(await list('history')).artifacts].find(a=>a.id===id);assert.ok(found);assert.equal(createHash('sha256').update(bytes).digest('hex'),found.sha256);files.push({path,id,format,sha256:found.sha256});return bytes;};
  await save('PDF');const originalPdf=await download('PDF','draft-original');await save('Excel');await download('Excel','draft-excel');
  // Lose the browser response after the actual server has committed; reload and replay.
  let lostOperation;const count=(await list()).artifacts.length;
  await page.route('**/api/purchase-order-documents',async route=>{if(route.request().method()!=='POST')return route.continue();lostOperation=route.request().postDataJSON().operationId;await route.fetch();await route.abort('failed');});
  await panel.getByRole('button',{name:'Save Excel copy',exact:true}).click();await panel.getByRole('alert').filter({hasText:'The save could not be confirmed.'}).waitFor();assert.equal((await list()).artifacts.length,count+1);await page.unroute('**/api/purchase-order-documents');
  await open();await panel.getByRole('button',{name:'Retry this save'}).waitFor();let replayOperation;
  await page.route('**/api/purchase-order-documents',route=>{replayOperation=route.request().postDataJSON().operationId;return route.continue();});await panel.getByRole('button',{name:'Retry this save'}).click();await panel.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();await page.unroute('**/api/purchase-order-documents');
  assert.equal(replayOperation,lostOperation);assert.equal((await list()).artifacts.length,count+1);
  let release,entered,finished;const releaseResponse=new Promise(r=>release=r),requestEntered=new Promise(r=>entered=r),requestFinished=new Promise(r=>finished=r),beforeStop=(await list()).artifacts.length;
  await page.route('**/api/purchase-order-documents',async route=>{try{const response=await route.fetch();entered();await releaseResponse;await route.fulfill({response});}catch{/* Browser stopped waiting; the server result remains durable. */}finally{finished();}});
  await panel.getByRole('button',{name:'Save PDF copy',exact:true}).click();await requestEntered;await panel.getByRole('button',{name:'Stop waiting'}).click();await panel.getByText('Stopped waiting. The save may still complete. Retry this save to check its result.').waitFor();release();await requestFinished;await page.unroute('**/api/purchase-order-documents');
  await panel.getByRole('button',{name:'Retry this save'}).click();await panel.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();assert.equal((await list()).artifacts.length,beforeStop+1);
  assert.equal(business(),before,'Archive app operations preserve every business table');
  // Keep a fictional second owner; the real last-owner constraint must remain enforced.
  db.prepare("INSERT INTO memberships(user_id,company_id,role) VALUES('archive-fixture-owner',?,'owner')").run(companyId);
  // Revocation during a download's final handoff must prevent the browser file.
  const priorDownloads=downloads.length;let routeFailure=null;await page.route('**/api/purchase-order-documents?**',async route=>{try{
    if(new URL(route.request().url()).searchParams.get('view')==='metadata'){db.prepare("UPDATE memberships SET role='employee' WHERE company_id=? AND user_id=?").run(companyId,actor);roleChanged=true;}await route.continue();
  }catch(error){routeFailure=error;await route.abort('failed');}});
  await panel.getByRole('button',{name:/^Download saved PDF/}).first().click();await panel.getByRole('alert').filter({hasText:'Your session or company access changed.'}).waitFor();assert.equal(routeFailure,null);assert.equal(downloads.length,priorDownloads);
  assert.equal((await fetch(origin+'/api/purchase-order-documents?'+new URLSearchParams({companyId,view:'list',kind:'history'}),{headers})).status,403);
  db.prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?").run(companyId,actor);roleChanged=false;await page.unroute('**/api/purchase-order-documents?**');
  const edited=(await api('/api/purchase-orders',{...input(),action:'edit',orderId:order.snapshot.id,expectedRevision:order.revision,reason:'Later correction',notes:'Later changed details'})).order;
  await api('/api/purchase-orders',{action:'cancel',companyId,operationId:crypto.randomUUID(),orderId:order.snapshot.id,expectedRevision:edited.revision,reason:'Preserve permanent copy'});
  await open();assert.equal(await panel.getByRole('button',{name:'Save PDF copy',exact:true}).isDisabled(),true);const originalAgain=await download('PDF','draft-after-cancel',true);assert.equal(files.at(-1).id,files[0].id);assert.equal(createHash('sha256').update(originalAgain).digest('hex'),createHash('sha256').update(originalPdf).digest('hex'));
  await page.getByRole('button',{name:'All drafts',exact:true}).click();await page.getByLabel('Product or item',{exact:true}).fill('Delivery bags');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await panel.getByRole('button',{name:'Save PDF copy',exact:true}).click();await panel.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();await download('PDF','history-pdf');
  await panel.getByRole('button',{name:'Save Excel copy',exact:true}).click();await panel.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();await download('Excel','history-excel');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(root,'saved-copies-390.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(root,'saved-copies-desktop.png'),fullPage:true});await panel.getByRole('button',{name:'Refresh saved copies'}).focus();assert.equal(await panel.getByRole('button',{name:'Refresh saved copies'}).evaluate(e=>e===document.activeElement),true);
  assert.equal((await fetch(origin+'/api/purchase-order-documents?companyId='+companyId+'&view=list&kind=history')).status,401);assert.deepEqual(errors,[]);
  writeFileSync(join(root,'result.json'),JSON.stringify({companyId,orderId:order.snapshot.id,lostOperation,replayOperation,files,pageErrors:errors,passed:true},null,2)+'\n');await context.close();
}finally{if(roleChanged)db.prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?").run(companyId,actor);db.close();await browser.close();}
console.log('PASS: signed-in Worker D1/R2 save/list/download, PDF/Excel draft/history files, persistent lost-response replay without duplicates, role revocation at handoff, unchanged business rows, exact old bytes after edit/cancel, desktop/mobile/keyboard and anonymous refusal. Evidence: '+root);
