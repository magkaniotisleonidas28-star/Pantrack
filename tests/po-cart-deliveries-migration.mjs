import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';
import {entries,LocalD1} from './helpers/supplier-simulation.mjs';
import {cartCore,configure,supplier,command} from './helpers/po-cart-authorizations.mjs';
import {D1PoCartJobs,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-po-cart-confirmations.ts';export * from './src/lib/d1-po-cart-deliveries.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-deliveries-migration-tests.mjs'});
const {D1PoCartConfirmations,D1PoCartDeliveries}=await import('../.sites-runtime/po-cart-deliveries-migration-tests.mjs');
const m=entries.find(e=>e.tag==='0040_po_cart_deliveries');assert.ok(m,'Missing delivery migration');
const statements=unstable_splitSqlQuery(readFileSync(`drizzle/${m.tag}.sql`,'utf8'));
for(const s of statements){
  assert.ok((s.match(/CREATE TRIGGER/g)??[]).length<=1,'Each trigger must be a separate Wrangler statement');
  if(/CREATE TRIGGER/.test(s))assert.match(s.trim(),/END;?$/,'Wrangler kept each trigger body whole');
}
for(const populated of [false,true]){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  try{
    for(const e of entries.filter(e=>e.idx<m.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
    let now='2026-10-10T12:00:00.000Z';
    const db=new LocalD1(sql),options={identity:async()=>'manager',clock:{now:()=>new Date(now)}};
    let job,confirmationId;
    if(populated){
      sql.exec("INSERT INTO companies VALUES('a','Populated confirmation upgrade','2026-10-10');INSERT INTO memberships VALUES('manager','a','manager')");configure(sql);
      const drafts=new cartCore.D1PurchaseOrderDrafts(db,options),auth=new cartCore.D1PoCartAuthorizations(db,options),jobs=new D1PoCartJobs(db,options),worker=new D1PoCartJobs(db,{...options,workerId:'w'});
      let po=await drafts.create({action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Retained record',
        lines:[{kind:'non_stock',sku:'OLD',description:'Old item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
      po=await drafts.review({...command(po),action:'review',acknowledgeWarnings:true});
      job=(await jobs.enqueue(enqueue((await auth.authorize(command(po))).current.authorization))).current.job;
      const fence=(await worker.claim(operation(job))).receipt.fence,line=job.inputs.preflight.lines[0];
      const begun=await worker.beginAttempt({...fenced(job,fence),lineId:line.lineId});
      job=(await worker.recordResult({...fenced(job,fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current.job;
      assert.equal(job.state,'ready');now='2026-10-10T12:05:00.000Z';
      confirmationId=(await new D1PoCartConfirmations(db,options).record({action:'record',companyId:'a',jobId:job.id,expectedJobRevision:job.revision,operationId:randomUUID(),
        supplierReference:'SUP-UPGRADE',expectedDelivery:'2026-10-12',lines:job.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''})).receipt.confirmationId;
    }
    const tables=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
    const snapshot=()=>JSON.stringify(tables.map(t=>[t,sql.prepare(`SELECT * FROM "${t}"`).all()]));
    const before=snapshot();for(const s of statements)sql.exec(s);
    assert.equal(snapshot(),before,'Every existing table is unchanged');
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,tables.length+2);
    if(populated){
      // An order confirmed before the upgrade is counted and approved after it.
      now='2026-10-11T09:00:00.000Z';const deliveries=new D1PoCartDeliveries(db,options),line=job.inputs.preflight.lines[0];
      const counted=await deliveries.count({action:'count',companyId:'a',confirmationId,operationId:randomUUID(),deliveredAt:'2026-10-11T08:30:00.000Z',
        lines:[{lineId:line.lineId,receivedPacks:'1',damagedPacks:'0'}],note:''});
      const approved=await deliveries.approve({action:'approve',companyId:'a',deliveryId:counted.receipt.deliveryId,operationId:randomUUID(),
        lines:[{lineId:line.lineId,acceptPacks:'1',excessPacks:'0',releaseRest:false}],note:''});
      assert.equal(approved.receipt.state,'approved');
      assert.equal((await deliveries.manager({companyId:'a',view:'manager',jobId:job.id})).complete,true);
    }
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{sql.close();}
}
console.log('PASS: Wrangler-split 0040 fresh/populated upgrades keep every table, then an order confirmed before the upgrade is counted and approved after it.');
