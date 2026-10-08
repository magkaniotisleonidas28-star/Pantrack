import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {fixture,LocalD1,entries} from './helpers/supplier-simulation.mjs';

await build({entryPoints:['src/lib/d1-purchase-order-drafts.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-drafts.mjs'});
const {D1PurchaseOrderDrafts}=await import('../.sites-runtime/po-drafts.mjs');
const f=await fixture();
const clock={now:()=>new Date('2026-10-01T12:00:00.000Z')};
let actor='manager';
const store=()=>new D1PurchaseOrderDrafts(f.db,{identity:async()=>actor,clock,salesPolicy:f.options.salesPolicy});
const supplier={id:'fake-supplier',name:'Fictional Café Supplier',email:'orders@example.invalid',accountId:'fake-account',locationId:'fake-location',deliveryAddress:'Fictional café, 123 Example Street'};
const line={kind:'non_stock',sku:'SERVICE',description:'Café cleaning, "weekly"\nservice',unitLabel:'visit',packs:'1',estimatedUnitMinor:null};
const input=(operationId,extra={})=>({action:'create',companyId:'a',operationId,source:'manual',supplier,capMinor:'10000',notes:'Review only',lines:[line],...extra});
const err=code=>e=>e.code===code;
const nonPoSnapshot=()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'purchase_order_%' ORDER BY name").all()
  .map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]));
const before=nonPoSnapshot();
const draft=await store().create(input('create-one'));
assert.equal(draft.status,'draft');assert.equal(draft.revision,1);
assert.equal(draft.snapshot.lines[0].stockQuantity,null);assert.equal(draft.snapshot.pricesComplete,false);
assert.equal(draft.snapshot.knownSubtotalMinor,'0');assert.equal(draft.snapshot.lines[0].estimatedLineMinor,null);
assert.ok(draft.snapshot.number.startsWith('PO-'));assert.ok(Object.isFrozen(draft.snapshot.supplier));
assert.deepEqual(await store().create(input('create-one')),draft);
assert.deepEqual(await store().get('a',draft.snapshot.id),draft);
assert.deepEqual((await store().list('a')).orders.map(o=>o.id),[draft.snapshot.id]);
assert.equal(nonPoSnapshot(),before,'Draft operations do not modify any preexisting table, even proposal history.');
await assert.rejects(store().create(input('create-one',{notes:'different'})),err('conflict'));
actor='owner';await assert.rejects(store().create(input('create-one')),err('conflict'));actor='manager';
for(const who of [null,'employee','b-manager']){
  actor=who;
  await assert.rejects(store().get('a',draft.snapshot.id),err('forbidden'));
  await assert.rejects(store().list('a'),err('forbidden'));
  await assert.rejects(store().choices('a'),err('forbidden'));
  await assert.rejects(store().create(input('forbidden')),err('forbidden'));
}actor='manager';
await assert.rejects(store().get('b',draft.snapshot.id),err('forbidden'));
actor='b-manager';await assert.rejects(store().get('b',draft.snapshot.id),err('missing'));actor='manager';
for(const extra of [{lines:[]},{lines:[{...line,packs:'0'}]},{lines:[{...line,packs:'1.5'}]},
  {lines:[{...line,packs:'01'}]},{lines:[line,line]},{capMinor:'0'},
  {capMinor:'1',lines:[{...line,estimatedUnitMinor:'2'}]},{currency:'EUR'},
  {lines:[{...line,kind:'non_stock',productId:'hidden-stock'}]},{supplier:{...supplier,email:'bad'}},
  {lines:[{...line,estimatedUnitMinor:'1.25'}]}]) {
  await assert.rejects(store().create(input('invalid',extra)),err('invalid_request'));
}
const stockSource=await f.source({productId:'stock'});
const stockLine={kind:'stock',productId:'stock',expectedConfigId:'config-stock',expectedConfigVersion:1,
  sku:'STOCK',description:'Stock item',packs:'3',estimatedUnitMinor:'100'};
const stock=await store().create(input('stock-create',{lines:[stockLine,line]}));
assert.equal(stock.snapshot.lines[0].stockQuantity.minor,'90');
assert.equal(stock.snapshot.lines[0].estimatedLineMinor,'300');
assert.equal(stock.snapshot.knownSubtotalMinor,'300');
assert.equal(stock.snapshot.lines[1].stockQuantity,null);
await assert.rejects(store().create(input('duplicate',{lines:[stockLine,{...stockLine,sku:'other'}]})),err('invalid_request'));
await assert.rejects(store().create(input('bad-config',{lines:[{...stockLine,expectedConfigVersion:2}]})),err('source_changed'));
await assert.rejects(store().create(input('foreign-product',{lines:[{...stockLine,productId:'foreign'}]})),err('source_changed'));
// Configuration versions are immutable; large exact fixture values are inserted at creation.
f.sql.prepare("INSERT INTO products(owner,id,data) VALUES('a','large','{}')").run();
f.sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
  VALUES('a','large','each',1,'curated','count','each','1','1','manager',?)`).run(clock.now().toISOString());
f.sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,effective_from,created_by,created_at)
  VALUES('a','large','large-config',1,'active','each',1,'case','9007199254740993',?,'manager',?)`).run(clock.now().toISOString(),clock.now().toISOString());
const largeLine={...stockLine,productId:'large',expectedConfigId:'large-config',sku:'LARGE',packs:'3'};
assert.equal((await store().create(input('large',{lines:[largeLine]}))).snapshot.lines[0].stockQuantity.minor,'27021597764222979');
await assert.rejects(store().create(input('overflow',{lines:[{...largeLine,packs:'999999999'}]})),err('invalid_request'));

const v2=await f.source({productId:'second',clover:true});
const refs=[stockSource,v2].map(h=>({id:h.proposalId,revision:h.revision}));
const proposalInput=input('proposals',{source:'proposals',lines:undefined,proposals:refs});delete proposalInput.lines;
const beforeProposal=nonPoSnapshot();
const proposal=await store().create(proposalInput);
for(const saved of proposal.snapshot.lines){
  const h=[stockSource,v2].find(h=>h.proposalId===saved.proposal.proposalId);
  assert.deepEqual(saved.proposal,h);
  assert.equal(saved.packs,h.packs);assert.deepEqual(saved.stockUnitsPerPack,h.stockUnitsPerPack);
}
assert.equal(nonPoSnapshot(),beforeProposal);
assert.match(proposal.snapshot.warnings.join(' '),/fictional/);
await assert.rejects(store().create({...proposalInput,operationId:'group',supplier:{...supplier,accountId:'other'}}),err('invalid_request'));
await assert.rejects(store().create({...proposalInput,operationId:'dupe-ref',proposals:[refs[0],refs[0]]}),err('source_changed'));
await assert.rejects(store().create({...proposalInput,operationId:'revision',proposals:[{...refs[0],revision:99}]}),err('source_changed'));
const raceTables=()=>JSON.stringify(['purchase_order_drafts','purchase_order_draft_lines','purchase_order_draft_operations','purchase_order_draft_events']
  .map(name=>f.sql.prepare(`SELECT * FROM ${name}`).all()));
const beforeRace=raceTables();
f.db.beforeBatch=()=>f.sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='stock'").run();
await assert.rejects(store().create({...proposalInput,operationId:'source-race'}),err('conflict'));
assert.equal(raceTables(),beforeRace,'No partial header, lines or audit survives source race.');
await assert.rejects(store().create({...proposalInput,operationId:'stale'}),err('conflict'));
const membershipBefore=raceTables();
f.db.beforeBatch=()=>f.sql.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();
await assert.rejects(store().create(input('revoked-at-commit')),err('forbidden'));
assert.equal(raceTables(),membershipBefore);
f.sql.prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'").run();

f.db.loseAcknowledgment=true;
const lost=await store().create(input('lost'));
assert.deepEqual(await store().create(input('lost')),lost);
const concurrent=await Promise.all([store().create(input('concurrent')),store().create(input('concurrent'))]);
assert.deepEqual(concurrent[0],concurrent[1]);
assert.equal(f.sql.prepare("SELECT count(*) AS n FROM purchase_order_draft_operations WHERE operation_id='concurrent'").get().n,1);
// Inject a failure after inserting a header and first line: the whole transaction rolls back.
f.sql.exec("CREATE TEMP TRIGGER po_injected_failure BEFORE INSERT ON purchase_order_draft_lines WHEN NEW.id='line-2' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
const beforeFailure=raceTables();
await assert.rejects(store().create(input('injected',{lines:[line,{...line,sku:'SERVICE-2'}]})),err('conflict'));
assert.equal(raceTables(),beforeFailure);f.sql.exec('DROP TRIGGER po_injected_failure');

const cancel={action:'cancel',companyId:'a',orderId:draft.snapshot.id,operationId:'cancel',expectedRevision:1,reason:'Replaced after review'};
const beforeCancel=nonPoSnapshot();
f.db.loseAcknowledgment=true;
const canceled=await store().cancel(cancel);
assert.equal(canceled.status,'canceled');assert.deepEqual(canceled.snapshot,draft.snapshot);
assert.equal(canceled.events.length,2);assert.deepEqual(await store().cancel(cancel),canceled);
assert.deepEqual(await store().get('a',draft.snapshot.id),canceled);
assert.equal(nonPoSnapshot(),beforeCancel);
await assert.rejects(store().cancel({...cancel,operationId:'cancel-again'}),err('conflict'));
for(const table of ['purchase_order_draft_lines','purchase_order_draft_operations','purchase_order_draft_events']){
  assert.throws(()=>f.sql.exec(`UPDATE ${table} SET company_id=company_id`),/immutable/);
  assert.throws(()=>f.sql.exec(`DELETE FROM ${table}`),/immutable/);
}
assert.throws(()=>f.sql.exec("UPDATE purchase_order_drafts SET status='sent'"),/immutable/);
assert.throws(()=>f.sql.exec('DELETE FROM purchase_order_drafts'),/cannot be deleted/);
assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal((await store().choices('a')).stocks.length,3);
await assert.rejects(store().list('a',-1),err('invalid_request'));

// Canceled/zero proposals, mixed locations and stale sales cannot become drafts.
const actorScope={companyId:'a',userId:'manager',role:'manager'};
const lifecycle=new (await import('./helpers/supplier-simulation.mjs')).core.D1ReplenishmentLifecycle(f.db,{clock,salesPolicy:f.options.salesPolicy});
const unsafe=await f.source({productId:'unsafe'});
const makeRef=(h,revision=h.revision)=>({...proposalInput,operationId:crypto.randomUUID(),proposals:[{id:h.proposalId,revision}]});
await lifecycle.edit({companyId:'a',proposalId:unsafe.proposalId,expectedRevision:1,changeId:'zero-edit',packs:'0',reason:'No packs needed',actor:actorScope});
await assert.rejects(store().create(makeRef(unsafe,2)),err('source_changed'));
await lifecycle.cancel({companyId:'a',proposalId:unsafe.proposalId,expectedRevision:2,changeId:'cancel-source',reason:'Source canceled',actor:actorScope});
await assert.rejects(store().create(makeRef(unsafe,3)),err('source_changed'));
const elsewhere=await f.source({productId:'elsewhere',locationId:'other-location'});
await assert.rejects(store().create({...proposalInput,operationId:'mixed-locations',proposals:[refs[1],{id:elsewhere.proposalId,revision:1}]}),err('source_changed'));
f.sql.prepare("UPDATE clover_sync_state SET last_success=NULL WHERE company_id='a'").run();
await assert.rejects(store().create(makeRef(v2)),err('conflict'));
const big=await store().create(input('fifty-lines',{lines:Array.from({length:50},(_,i)=>({...line,sku:`SERVICE-${i}`}))}));
assert.equal(big.snapshot.lines.length,50);
await assert.rejects(store().create(input('too-many',{lines:Array.from({length:51},(_,i)=>({...line,sku:`SERVICE-${i}`}))})),err('invalid_request'));
const competitive=await store().create(input('competing-cancel'));
const competitiveCancel={action:'cancel',companyId:'a',orderId:competitive.snapshot.id,operationId:'competing-cancel-1',expectedRevision:1,reason:'First manager cancellation'};
const cancels=await Promise.allSettled([store().cancel(competitiveCancel),store().cancel({...competitiveCancel,operationId:'competing-cancel-2',reason:'Second manager cancellation'})]);
assert.deepEqual(cancels.map(r=>r.status).sort(),['fulfilled','rejected']);
assert.equal((await store().get('a',competitive.snapshot.id)).events.length,2);

// Additive migration preserves existing legacy records with no inferred receipt evidence.
const upgrade=entries.find(e=>e.tag.endsWith('_purchase_order_drafts'));assert.ok(upgrade,'Missing purchase_order_drafts migration');
const old=new DatabaseSync(':memory:');old.exec('PRAGMA foreign_keys=ON');
for(const entry of entries.filter(e=>e.idx<upgrade.idx))old.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
old.exec("INSERT INTO companies VALUES('legacy','Legacy','2026-01-01'); INSERT INTO orders VALUES('legacy','old','{\"status\":\"Prepared\"}','2026-01-01')");
const legacy=JSON.stringify(old.prepare('SELECT * FROM orders').all());
old.exec(readFileSync(`drizzle/${upgrade.tag}.sql`,'utf8'));
assert.equal(JSON.stringify(old.prepare('SELECT * FROM orders').all()),legacy);
assert.equal(old.prepare('SELECT count(*) n FROM purchase_order_drafts').get().n,0);
old.close();f.sql.close();
console.log('PASS: durable PO drafts, exact manual/v1/v2 lines, company/role isolation, atomic source/membership races, replay/concurrency/lost acknowledgment, immutable cancellation/history, unchanged stock/proposals and additive compatibility.');
