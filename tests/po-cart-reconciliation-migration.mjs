import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {unstable_splitSqlQuery} from 'wrangler';
import {entries,LocalD1} from './helpers/supplier-simulation.mjs';
import {cartCore,configure,supplier,command} from './helpers/po-cart-authorizations.mjs';
import {D1PoCartJobs,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';
for(const populated of [false,true]){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 try{
  for(const e of entries.filter(e=>e.idx<33))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
  let jobs,ready,j;
  if(populated){
   sql.exec("INSERT INTO companies VALUES('a','Populated human browser upgrade','2026-10-10');INSERT INTO memberships VALUES('manager','a','manager');INSERT INTO inventory VALUES('a','retained','{\"onHand\":42}',1)");configure(sql);
   const db=new LocalD1(sql),options={identity:async()=>'manager',clock:{now:()=>new Date('2026-10-10T12:00:00.000Z')}},drafts=new cartCore.D1PurchaseOrderDrafts(db,options),auth=new cartCore.D1PoCartAuthorizations(db,options);jobs=new D1PoCartJobs(db,options);const worker=new D1PoCartJobs(db,{...options,workerId:'retained-worker'});
   let po=await drafts.create({action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Retained record',lines:[{kind:'non_stock',sku:'OLD',description:'Old item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
   po=await drafts.review({...command(po),action:'review',acknowledgeWarnings:true});const permission=await auth.authorize(command(po)),q=await jobs.enqueue(enqueue(permission.current.authorization));j=q.current.job;
   const claimed=await worker.claim(operation(j)),begun=await worker.beginAttempt({...fenced(j,claimed.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId});ready=await worker.recordResult({...fenced(j,claimed.receipt.fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]});
   sql.exec("INSERT INTO po_cart_worker_identities VALUES('retained-worker','a','cart-demo-supplier','DEMO-CART',1,'active','2026-10-10','fake')");
   sql.prepare("INSERT INTO po_cart_worker_credentials VALUES('retained-credential','retained-worker',?,1,'active','2099-01-01','2026-10-10',NULL)").run(createHash('sha256').update('a'.repeat(43)).digest('hex'));
   sql.exec("INSERT INTO companies VALUES('b','Retained browser job','2026-10-10');INSERT INTO memberships VALUES('manager','b','manager')");configure(sql,'b');
   let browserPo=await drafts.create({action:'create',companyId:'b',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Retained browser evidence',lines:[{kind:'non_stock',sku:'BROWSER',description:'Browser item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
   browserPo=await drafts.review({...command(browserPo),action:'review',acknowledgeWarnings:true});const browserPermission=await auth.authorize(command(browserPo)),browserQueued=await jobs.enqueue({...enqueue(browserPermission.current.authorization),browser:{layout:'compact',scenario:'normal'}}),bj=browserQueued.current.job;
   const bw=new D1PoCartJobs(db,{...options,workerAccess:{id:'retained-browser',companyId:'b',supplierId:supplier.id,accountId:supplier.accountId,consumerKind:'local_browser',assertCurrent:async()=>{},guard:()=>({sql:'1',args:[]})}});
   const bc=await bw.claim(operation(bj)),bf=bc.receipt.fence;await bw.recordBaseline({...fenced(bj,bf),cart:[]});const ba=await bw.beginAttempt({...fenced(bj,bf),lineId:bj.inputs.preflight.lines[0].lineId});await bw.recordResult({...fenced(bj,bf),attemptId:ba.receipt.attemptId,outcome:'verified',observation:bj.inputs.preflight.lines[0]});
   await bw.finalizeCart({...fenced(bj,bf),cart:bj.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))});
   assert.equal(sql.prepare('SELECT count(*) n FROM po_cart_browser_evidence').get().n,2);
   sql.prepare("UPDATE po_cart_owners SET fence=fence+1 WHERE company_id='b'").run();
   sql.prepare("INSERT INTO po_cart_browser_sessions VALUES('b','retained-session',?,?,?,'inspect','manager',1,'requested',?,NULL,NULL,'2026-10-10T12:30:00.000Z','2026-10-10T12:00:00.000Z','2026-10-10T12:00:00.000Z',NULL,'manager_requested')").run(bj.id,supplier.id,supplier.accountId,bc.receipt.fence+1);
   sql.prepare("INSERT INTO po_cart_browser_operations VALUES('b','retained-session-op','retained-session','retained-fingerprint','{}',1)").run();
   sql.exec("UPDATE po_cart_browser_sessions SET revision=revision+1,state='opening',worker_id='retained-browser',fence=fence+1,lease_until='2026-10-10T12:01:00.000Z' WHERE id='retained-session';UPDATE po_cart_browser_sessions SET revision=revision+1,state='open' WHERE id='retained-session';UPDATE po_cart_browser_sessions SET revision=revision+1,state='closing',reason='manager_closed' WHERE id='retained-session'");
   sql.prepare("INSERT INTO po_cart_browser_observations VALUES('b','retained-session','close',?,1,'verified','2026-10-10T12:00:00.000Z')").run(JSON.stringify(bj.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))));
   sql.exec("UPDATE po_cart_browser_sessions SET revision=revision+1,state='closed',closed_at='2026-10-10T12:00:00.000Z' WHERE id='retained-session'");



  }
  const tables=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),snapshot=()=>JSON.stringify(tables.map(t=>[t,sql.prepare(`SELECT * FROM "${t}"`).all()])),before=snapshot();assert.equal(tables.length,103);
  const m=entries.find(e=>e.idx===33);assert.equal(m.tag,'0033_po_cart_reconciliation');for(const statement of unstable_splitSqlQuery(readFileSync(`drizzle/${m.tag}.sql`,'utf8'))){assert.ok((statement.match(/CREATE TRIGGER/g)??[]).length<=1,'Each trigger must be a separate Wrangler statement');sql.exec(statement);}
  assert.equal(snapshot(),before);assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,105);
  if(populated)assert.deepEqual(await jobs.get({companyId:'a',jobId:j.id}),ready.current);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{sql.close();}
}
console.log('PASS: Wrangler-split 0033 fresh/populated upgrades preserve all 103 tables, fake job readiness, credentials, attempts and receipts.');
