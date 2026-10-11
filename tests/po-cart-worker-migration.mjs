import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {unstable_splitSqlQuery} from 'wrangler';
import {entries,LocalD1} from './helpers/supplier-simulation.mjs';
import {cartCore,configure,supplier,command,tables} from './helpers/po-cart-authorizations.mjs';
import {D1PoCartJobs,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
try{
  for(const e of entries.filter(e=>e.idx<30))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
  sql.exec("INSERT INTO companies VALUES('a','Populated worker fixture','2026-10-01'); INSERT INTO memberships VALUES('manager','a','manager'); INSERT INTO inventory VALUES('a','old','{\"onHand\":42}',1)");configure(sql);
  const db=new LocalD1(sql),options={identity:async()=>'manager',clock:{now:()=>new Date('2026-10-01T12:00:00.000Z')}};
  const drafts=new cartCore.D1PurchaseOrderDrafts(db,options),auth=new cartCore.D1PoCartAuthorizations(db,options),jobs=new D1PoCartJobs(db,options),worker=new D1PoCartJobs(db,{...options,workerId:'historical'});
  let po=await drafts.create({action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Historical private PO',
    lines:[{kind:'non_stock',sku:'OLD',description:'Practice item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
  po=await drafts.review({...command(po),action:'review',acknowledgeWarnings:true});const permission=await auth.authorize(command(po));
  const queued=await jobs.enqueue(enqueue(permission.current.authorization)),j=queued.current.job,claim=await worker.claim(operation(j));
  const begun=await worker.beginAttempt({...fenced(j,claim.receipt.fence),lineId:j.inputs.preflight.lines[0].lineId});
  const names=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),before=tables(sql,names);assert.equal(names.length,96);
  const migration=entries.find(e=>e.idx===30);assert.equal(migration.tag,'0030_po_cart_worker_transport');
  for(const statement of unstable_splitSqlQuery(readFileSync(`drizzle/${migration.tag}.sql`,'utf8')))sql.exec(statement);
  assert.equal(tables(sql,names),before);assert.deepEqual(await jobs.get({companyId:'a',jobId:j.id}),begun.current);
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'po_cart_worker_%'").get().n,11);
  sql.prepare("INSERT INTO po_cart_worker_identities VALUES('worker','a','supplier','account',1,'active','2026-10-01')").run();
  const hash='a'.repeat(64);
  sql.prepare("INSERT INTO po_cart_worker_credentials VALUES('credential','worker',?,1,'active','2026-10-02','2026-10-01',NULL)").run(hash);
  assert.equal(sql.prepare('SELECT kind FROM po_cart_worker_credential_events').get().kind,'issued');
  for(const query of ["UPDATE po_cart_worker_identities SET account_id='other',version=2", "DELETE FROM po_cart_worker_identities",
    "UPDATE po_cart_worker_credentials SET secret_hash='replacement'",'DELETE FROM po_cart_worker_credentials',
    "UPDATE po_cart_worker_credential_events SET kind='rotated'",'DELETE FROM po_cart_worker_credential_events'])assert.throws(()=>sql.exec(query));
  sql.exec("UPDATE po_cart_worker_credentials SET status='revoked',revoked_at='2026-10-01T01:00:00.000Z'");
  assert.deepEqual(sql.prepare('SELECT kind FROM po_cart_worker_credential_events ORDER BY id').all().map(r=>r.kind),['issued','revoked']);
  assert.throws(()=>sql.exec("UPDATE po_cart_worker_credentials SET status='active',revoked_at=NULL"));
  assert.equal(tables(sql,names),before);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{sql.close();}
console.log('PASS: Wrangler-split additive 0030 preserves 96 populated tables, attempts and replay; immutable scopes, hash-only credentials and append-only audit.');
