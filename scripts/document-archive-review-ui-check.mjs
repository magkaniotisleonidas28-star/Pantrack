// Run the isolated purchase-order preview in this worktree first. Fictional loopback only.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';
import {localFixtureCookie} from './po-cart-worker/local-browser-fixture.mjs';
const origin='http://127.0.0.1:5179',root=resolve('.sites-runtime/archive-review-browser/run-'+crypto.randomUUID());mkdirSync(root,{recursive:true});
const companyId=crypto.randomUUID(),actor='local_seedy',cookie=await localFixtureCookie(origin),headers={cookie,origin,'content-type':'application/json','X-Pantrack-Archive-Viewer':actor};
const api=async(path,body,status=200)=>{const response=await fetch(origin+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers,redirect:'error'});assert.equal(response.status,status,await response.clone().text());return response.json();};
await api('/api/companies',{action:'create',id:companyId,name:'Saved-document review practice café'});
const {order}=await api('/api/purchase-orders',{action:'create',companyId,operationId:crypto.randomUUID(),source:'manual',capMinor:'10000',notes:'Review-only practice',
  supplier:{id:'fictional',name:'Fictional Café Supply',email:'orders@example.invalid',accountId:'fixture',locationId:'fixture',deliveryAddress:'Fictional street'},
  lines:[{kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:'125'}]});
const command=(format='pdf',revision=order.revision)=>({companyId,operationId:crypto.randomUUID(),format,source:{kind:'draft',orderId:order.snapshot.id,revision}});
const missing=(await api('/api/purchase-order-documents',command())).artifact,damaged=(await api('/api/purchase-order-documents',command('xlsx'))).artifact;
for(let i=0;i<22;i++)await api('/api/purchase-order-documents',command('pdf',999),409);
const d1Root=resolve('.sites-runtime/po-review-state/v3/d1'),matches=[];
for(const name of readdirSync(d1Root,{recursive:true}).filter(n=>n.endsWith('.sqlite')&&!n.endsWith('metadata.sqlite'))){const path=join(d1Root,name),candidate=new DatabaseSync(path,{readOnly:true});
  try{if(candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='companies'").get()&&candidate.prepare('SELECT 1 FROM companies WHERE id=?').get(companyId))matches.push(path);}finally{candidate.close();}}
assert.equal(matches.length,1);const db=new DatabaseSync(matches[0]);
// Retained observation fixtures exercise the real review projection/UI. The API suite
// separately proves detection with actually missing/corrupt native R2 objects.
const at=new Date().toISOString(),observe=(artifact,payload)=>db.prepare('INSERT INTO document_archive_observations VALUES(?,?,?,?,NULL,?,?)').run(companyId,artifact.id,crypto.randomUUID(),actor,JSON.stringify(payload),at);
for(let i=0;i<23;i++)observe(missing,{kind:'object',present:false,reportedSize:null,byteLength:null,sha256:null});
observe(damaged,{kind:'object',present:true,reportedSize:damaged.size,byteLength:damaged.size,sha256:'f'.repeat(64)});
db.prepare("INSERT INTO memberships(user_id,company_id,role) VALUES('review-fixture-owner',?,'owner')").run(companyId);
const latest=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.at(-1),tables=Object.keys(JSON.parse(readFileSync(`drizzle/meta/${String(latest.idx).padStart(4,'0')}_snapshot.json`,'utf8')).tables).sort();
const snapshot=()=>JSON.stringify(tables.map(name=>[name,db.prepare(`SELECT * FROM "${name}"`).all()])),before=snapshot();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??chromium.executablePath()});let changedRole=false;
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const page=await context.newPage(),errors=[],archiveRequests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname==='/api/purchase-order-documents')archiveRequests.push(request.method());});page.setDefaultTimeout(60000);
  await page.goto(origin+'/signin-with-chatgpt?return_to='+encodeURIComponent('/?company='+companyId));await page.getByRole('button',{name:'Purchase-order drafts',exact:true}).first().click();await page.getByRole('button',{name:'Open '+order.snapshot.number,exact:true}).click();
  const copies=page.getByRole('region',{name:'Saved copies',exact:true});await copies.getByRole('button',{name:'Review saves',exact:true}).click();
  const panel=page.getByRole('region',{name:'Saved-document review',exact:true});await panel.getByRole('button',{name:'Earlier saves',exact:true}).waitFor();
  const listIds=()=>panel.getByRole('button',{name:/^View save history/}).evaluateAll(nodes=>nodes.map(node=>node.textContent));
  const first=await listIds();assert.equal(first.length,20);await panel.getByRole('button',{name:'Earlier saves'}).click();await panel.getByRole('button',{name:'Later saves'}).waitFor();assert.equal(await panel.getByRole('button',{name:/^View save history/}).count(),4);
  const second=await listIds();assert.equal(new Set([...first,...second]).size,24);
  await panel.getByRole('button',{name:'View save history for PDF requested '+new Date(missing.requestedAt).toLocaleString()+', reference '+missing.id,exact:true}).click();
  const history=panel.getByRole('article',{name:'Save history'});await history.getByText('File not found',{exact:true}).waitFor();await panel.getByRole('button',{name:'Older checks'}).click();await panel.getByRole('button',{name:'Newer checks'}).waitFor();
  await panel.getByRole('button',{name:'Back to saves needing attention'}).click();await panel.getByText('File contents did not match',{exact:true}).waitFor();
  // Safe error and retry on a real signed-in screen.
  await page.route('**/api/purchase-order-documents?**',route=>new URL(route.request().url()).searchParams.get('view')==='review'?route.fulfill({status:503,json:{error:'PRIVATE_PROVIDER_DETAIL'}}):route.continue());
  await panel.getByRole('button',{name:'Refresh review'}).click();await panel.getByRole('alert').filter({hasText:'The review could not be read.'}).waitFor();assert.ok(!(await panel.innerText()).includes('PRIVATE_'));await page.unroute('**/api/purchase-order-documents?**');
  await panel.getByRole('button',{name:'Refresh review'}).click();await panel.getByRole('button',{name:'Earlier saves'}).waitFor();
  let entered,release,finished;const started=new Promise(r=>entered=r),released=new Promise(r=>release=r),ended=new Promise(r=>finished=r);
  await page.route('**/api/purchase-order-documents?**',async route=>{if(new URL(route.request().url()).searchParams.get('view')!=='review')return route.continue();try{const response=await route.fetch();entered();await released;await route.fulfill({response});}catch{/* Aborted read has no effect. */}finally{finished();}});
  await panel.getByRole('button',{name:'Refresh review'}).click();await started;await panel.getByRole('button',{name:'Stop loading review'}).click();release();await ended;await page.unroute('**/api/purchase-order-documents?**');await panel.getByText('Stopped loading. Refresh to see the latest recorded results.').waitFor();
  await panel.getByRole('button',{name:'Refresh review'}).click();await panel.getByRole('button',{name:'Earlier saves'}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(root,'review-390.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(root,'review-desktop.png'),fullPage:true});await panel.getByRole('button',{name:'Refresh review'}).focus();assert.equal(await panel.getByRole('button',{name:'Refresh review'}).evaluate(node=>node===document.activeElement),true);
  // A real role change before the API's read clears all displayed review data.
  await page.route('**/api/purchase-order-documents?**',async route=>{if(new URL(route.request().url()).searchParams.get('view')==='review-detail'){db.prepare("UPDATE memberships SET role='employee' WHERE company_id=? AND user_id=?").run(companyId,actor);changedRole=true;}await route.continue();});
  await panel.getByRole('button',{name:/^View save history/}).first().click();await panel.getByRole('alert').filter({hasText:'The review could not be read.'}).waitFor();assert.equal(await panel.getByRole('button',{name:/^View save history/}).count(),0);assert.equal(await panel.getByRole('article',{name:'Save history'}).count(),0);
  db.prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?").run(companyId,actor);changedRole=false;await page.unroute('**/api/purchase-order-documents?**');
  await panel.getByRole('button',{name:'Refresh review'}).click();await panel.getByRole('button',{name:'Earlier saves'}).waitFor();await copies.getByRole('button',{name:'Close save review'}).click();assert.equal(await panel.count(),0);
  await page.getByRole('button',{name:'All drafts',exact:true}).click();await copies.getByRole('button',{name:'Review saves',exact:true}).click();await panel.getByText('No saves need attention in this list.',{exact:true}).waitFor();
  await copies.getByRole('button',{name:'Close save review'}).click();
  assert.ok(archiveRequests.every(method=>method==='GET'));assert.equal(snapshot(),before,'All application and archive tables are unchanged by review');assert.deepEqual(errors,[]);
  writeFileSync(join(root,'result.json'),JSON.stringify({passed:true,companyId,orderId:order.snapshot.id,missingId:missing.id,damagedId:damaged.id,records:24,readOnly:true,historyEmpty:true,observationFixtures:true,pageErrors:errors},null,2)+'\n');await context.close();
}finally{if(changedRole)db.prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?").run(companyId,actor);db.close();await browser.close();}
console.log('PASS: signed-in read-only review, 24-record paging, held/missing/damaged evidence, event paging, safe error/retry, cancellation, real role refusal, all tables unchanged, mobile/desktop/keyboard. Evidence: '+root);
