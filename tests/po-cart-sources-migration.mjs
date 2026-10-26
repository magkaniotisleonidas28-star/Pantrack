import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {unstable_splitSqlQuery} from 'wrangler';
import {LocalD1,entries,core} from './helpers/supplier-simulation.mjs';
import {cartCore,cartFixture,configure,connectionVersion,command,cancelCommand,errorCode,tables,cartTables,supplier} from './helpers/po-cart-authorizations.mjs';

const start=a=>{const {reason,...input}=cancelCommand(a);return {...input,action:'start'};};
const f=await cartFixture();
const snapshot=()=>tables(f.sql,cartTables);
const current=a=>f.service().get({companyId:a.companyId,orderId:a.orderId});
async function sourceHold(a,mutate){
  mutate();const held=await current(a);
  assert.equal(held.valid,false);assert.equal(held.reservation.state,'reserved');
  assert.ok(held.commitments.every(c=>c.active));
  await assert.rejects(f.service().revalidate(a.companyId,a.id),errorCode('source_changed'));
  const before=snapshot();await assert.rejects(f.service().markPreparationStarted(start(a)));assert.equal(snapshot(),before);
  const cancel=cancelCommand(a),released=await f.service().cancel(cancel);
  assert.equal(released.current.reservation.state,'released');assert.ok(released.current.commitments.every(c=>!c.active));
  assert.deepEqual(await f.service().cancel(cancel),released);
}
try{
  // An originating proposal and its PO represent one quantity, not competing purchases.
  const h=await f.proposed('proposal-coffee');
  const order=await f.reviewed({source:'proposals',proposals:[{id:h.proposalId,revision:h.revision}]});
  const upstream=tables(f.sql,['replenishment_proposal_origins','replenishment_proposal_states','replenishment_proposal_events']);
  const result=await f.service().authorize(command(order)),a=result.current.authorization;
  assert.equal(result.current.valid,true);assert.equal(result.current.commitments.length,1);
  assert.equal(result.current.commitments[0].proposalId,h.proposalId);
  assert.deepEqual(result.current.commitments[0].quantity,h.stockQuantity??{dimension:'count',minor:String(BigInt(h.packs)*BigInt(h.stockUnitsPerPack.minor))});
  assert.equal(tables(f.sql,['replenishment_proposal_origins','replenishment_proposal_states','replenishment_proposal_events']),upstream,'Authorization preserves all original A history');
  const competing=await f.reviewed({source:'proposals',proposals:[{id:h.proposalId,revision:h.revision}]});
  const prior=snapshot();await assert.rejects(f.service().authorize(command(competing)),errorCode('conflict'));assert.equal(snapshot(),prior);
  // A cannot edit/replenish or simulation-send the same work around the PO claim.
  await assert.rejects(f.lifecycle.edit({companyId:'a',proposalId:h.proposalId,expectedRevision:h.revision,changeId:randomUUID(),
    actor:f.actor,packs:'2',reason:'Competing quantity edit'}));
  const sim=await f.approved('competing-simulation',[h]);
  await assert.rejects(f.engine().send(f.command(sim,'competing-send')));
  assert.equal(f.connector.calls,0);
  await sourceHold(a,()=>f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE product_id='proposal-coffee'"));

  // A previously canceled proposal cannot be replaced while a manual PO holds its product.
  const manualLine=await f.stock('manual-product'),manual=await f.reviewed({lines:[manualLine]});
  const manualResult=await f.service().authorize(command(manual));
  const origin=f.sql.prepare("SELECT * FROM replenishment_proposal_origins WHERE product_id='manual-product'").get();
  const fresh=()=>f.sql.prepare('INSERT INTO replenishment_proposal_origins VALUES(?,?,?,?,?,?,?,?)')
    .run('a','fresh-manual-proposal','fresh-manual-create','manual-product',origin.initial_status,origin.snapshot_json,'manager',origin.created_at);
  assert.throws(fresh,/Product held by PO/);
  await f.service().cancel(cancelCommand(manualResult.current.authorization));fresh();

  // Existing A commitments block unrelated manual POs (the original is the only exception).
  const independent=await f.source({productId:'existing-proposal'});
  const unrelated=await f.reviewed({lines:[{...manualLine,productId:independent.productId,expectedConfigId:independent.inventoryConfigId,sku:'UNRELATED'}]});
  const noChange=snapshot();await assert.rejects(f.service().authorize(command(unrelated)),errorCode('conflict'));assert.equal(snapshot(),noChange);
  // Existing simulation exposure also blocks the same proposal from a PO.
  const simH=await f.proposed('simulation-held'),simOrder=await f.approved('simulation-held',[simH]);
  await f.engine().send(f.command(simOrder,'sim-held-send'));
  const blocked=await f.reviewed({source:'proposals',proposals:[{id:simH.proposalId,revision:simH.revision}]});
  await assert.rejects(f.service().authorize(command(blocked)),errorCode('conflict'));

  const canceledH=await f.proposed('source-canceled'),canceledPo=await f.reviewed({source:'proposals',proposals:[{id:canceledH.proposalId,revision:canceledH.revision}]});
  const canceledA=(await f.service().authorize(command(canceledPo))).current.authorization;
  await f.lifecycle.cancel({companyId:'a',proposalId:canceledH.proposalId,expectedRevision:canceledH.revision,changeId:randomUUID(),actor:f.actor,reason:'Source no longer wanted'});
  await sourceHold(canceledA,()=>{});

  const cloverH=await f.proposed('clover-source',{clover:true}),cloverPo=await f.reviewed({source:'proposals',proposals:[{id:cloverH.proposalId,revision:cloverH.revision}]});
  const cloverA=(await f.service().authorize(command(cloverPo))).current.authorization;
  await sourceHold(cloverA,()=>f.setTime('2026-10-01T12:30:00.000Z'));
  f.setTime('2026-10-01T12:00:00.000Z');

  const configLine=await f.stock('config-changed'),configPo=await f.reviewed({lines:[configLine]}),configA=(await f.service().authorize(command(configPo))).current.authorization;
  await sourceHold(configA,()=>f.sql.exec("UPDATE inventory_config_versions SET status='replaced',replaced_at='2026-10-01T12:01:00.000Z' WHERE product_id='config-changed'"));

  // Registry profile/mapping versions and supplier-specific conversions remain bound.
  const mappedLine=await f.stock('mapped'),registry=new cartCore.D1PurchasingSuppliers(f.db,f.options);
  const profile={name:supplier.name,email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'',
    emailAcceptance:{status:'unknown',note:''},accounts:[{id:'account',reference:supplier.accountId,status:'active'}],
    locations:[{id:'location',accountId:'account',reference:supplier.locationId,address:supplier.deliveryAddress,status:'active'}]};
  await registry.saveProfile({action:'save_profile',companyId:'a',supplierId:supplier.id,expectedVersion:0,operationId:randomUUID(),reason:'Fictional profile',profile});
  const mapping={action:'save_mapping',companyId:'a',mappingId:'mapped',expectedVersion:0,operationId:randomUUID(),reason:'Exact fictional mapping',
    supplierId:supplier.id,expectedSupplierVersion:1,accountId:'account',locationId:'location',productId:'mapped',expectedConfigId:mappedLine.expectedConfigId,
    expectedConfigVersion:1,sku:'MAPPED',description:'Mapped stock',unitLabel:'supplier case of 6',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:'100'};
  await registry.saveMapping(mapping);
  const registryInput={source:'registry',supplierRef:{id:supplier.id,version:1,accountId:'account',locationId:'location'},
    lines:[{kind:'stock',mappingId:'mapped',mappingVersion:1,packs:'2'}]};
  // The manual supplier field is not part of registry intent.
  const regCreate=f.createInput(registryInput);delete regCreate.supplier;
  let regPo=await f.drafts.create(regCreate);regPo=await f.drafts.review({...command(regPo),action:'review',acknowledgeWarnings:true});
  const regA=(await f.service().authorize(command(regPo))).current.authorization;
  assert.equal(regA.inputs.preflight.lines[0].stockQuantity.minor,'12','Use mapping conversion, not the inventory default case of 30');
  await registry.saveMapping({...mapping,expectedVersion:1,operationId:randomUUID(),packAmount:'8'});
  await sourceHold(regA,()=>{});
  await assert.rejects(f.service().authorize(command(regPo)),errorCode('source_changed'));

  const reg2Create={...regCreate,operationId:randomUUID(),lines:[{...regCreate.lines[0],mappingVersion:2}]};
  let reg2=await f.drafts.create(reg2Create);reg2=await f.drafts.review({...command(reg2),action:'review',acknowledgeWarnings:true});
  const reg2A=(await f.service().authorize(command(reg2))).current.authorization;
  await registry.saveProfile({action:'save_profile',companyId:'a',supplierId:supplier.id,expectedVersion:1,operationId:randomUUID(),reason:'Changed delivery instructions',profile:{...profile,notes:'Changed'}});
  await sourceHold(reg2A,()=>{});

  // Current source predicates must still hold immediately before the atomic batch.
  const raceLine=await f.stock('race-config'),racePo=await f.reviewed({lines:[raceLine]}),raceInput=command(racePo),beforeRace=snapshot();
  f.db.beforeBatch=()=>f.sql.exec("UPDATE inventory_config_versions SET status='replaced',replaced_at='2026-10-01T12:01:00.000Z' WHERE product_id='race-config'");
  await assert.rejects(f.service().authorize(raceInput),errorCode('conflict'));assert.equal(snapshot(),beforeRace);
  const connectionPo=await f.reviewed(),connectionInput=command(connectionPo),beforeConnection=snapshot();
  f.db.beforeBatch=()=>connectionVersion(f.sql,{locationId:'OTHER'});
  await assert.rejects(f.service().authorize(connectionInput),errorCode('conflict'));assert.equal(snapshot(),beforeConnection);
  connectionVersion(f.sql,{});
  const budgetPo=await f.reviewed(),budgetInput=command(budgetPo),beforeBudget=snapshot();
  f.db.beforeBatch=()=>f.sql.exec("INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES('a',2,50000,100000)");
  await assert.rejects(f.service().authorize(budgetInput),errorCode('conflict'));assert.equal(snapshot(),beforeBudget);

  // PO cancellation after start revokes permission without inventing supplier cancellation.
  const startedLine=await f.stock('started-po'),startedPo=await f.reviewed({lines:[startedLine]});
  const startedA=(await f.service().authorize(command(startedPo))).current.authorization;
  const marked=await f.service().markPreparationStarted(start(startedA));
  await f.drafts.cancel({...command(startedPo),action:'cancel',reason:'Cancel PO after preparation attempt'});
  const unresolved=await current(startedA);
  assert.equal(unresolved.authorization.status,'invalidated');assert.equal(unresolved.reservation.state,'reserved');assert.equal(unresolved.commitments[0].active,true);
  assert.equal(unresolved.authorization.startedAt,marked.current.authorization.startedAt);assert.equal(unresolved.authorization.releasedAt,null);
  const canceled=await f.service().cancel(cancelCommand(unresolved.authorization));
  assert.equal(canceled.current.reservation.state,'reserved');assert.equal(canceled.current.commitments[0].active,true);
  assert.equal(canceled.current.authorization.inputs.preflight.authorization,'required');
  const neverStarted=await f.reviewed(),neverA=(await f.service().authorize(command(neverStarted))).current.authorization;
  await f.drafts.cancel({...command(neverStarted),action:'cancel',reason:'Cancel before preparation'});
  assert.equal((await current(neverA)).reservation.state,'released');
  for(const table of ['po_cart_connections','po_cart_budget_policies','po_cart_events','po_cart_operations']){
    assert.throws(()=>f.sql.exec(`UPDATE ${table} SET company_id=company_id`),/immutable/);
    assert.throws(()=>f.sql.exec(`DELETE FROM ${table}`),/immutable/);
  }
  assert.throws(()=>f.sql.exec("UPDATE po_cart_authorizations SET payload_json='{}'"),/Invalid cart authorization transition/);
  assert.throws(()=>f.sql.exec("UPDATE po_cart_reservations SET state='released' WHERE state='reserved'"),/Unsafe/);
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);

  // Real file reopen proves service/process-memory independence and receipt permanence.
  const root=mkdtempSync(join(tmpdir(),'pantrack-cart-restart-')),filename=join(root,'restart.sqlite');
  try{
    f.sql.prepare('VACUUM INTO ?').run(filename);
    let disk=new DatabaseSync(filename),db=new LocalD1(disk),restarted=new cartCore.D1PoCartAuthorizations(db,f.options);
    assert.deepEqual(await restarted.get({companyId:'a',orderId:startedA.orderId}),canceled.current);
    disk.close();disk=new DatabaseSync(filename);db=new LocalD1(disk);restarted=new cartCore.D1PoCartAuthorizations(db,f.options);
    assert.deepEqual(await restarted.cancel({...cancelCommand(unresolved.authorization),operationId:canceled.receipt.operationId}),canceled);
    assert.equal((await restarted.get({companyId:'a',orderId:startedA.orderId})).reservation.state,'reserved');disk.close();
  }finally{rmSync(root,{recursive:true,force:true});}
}finally{f.sql.close();}

// Upgrade populated 0000–0027 without altering any prior table row.
const old=new DatabaseSync(':memory:');old.exec('PRAGMA foreign_keys=ON');
for(const e of entries.filter(e=>e.idx<28))old.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
old.exec("INSERT INTO companies VALUES('a','Fictional upgrade cafe','2026-10-01'); INSERT INTO memberships VALUES('manager','a','manager')");
const options={identity:async()=>'manager'},drafts=new cartCore.D1PurchaseOrderDrafts(new LocalD1(old),options);
const input={action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Historical populated PO',
  lines:[{kind:'non_stock',sku:'OLD',description:'Historical item',unitLabel:'case',packs:'2',estimatedUnitMinor:'100'}]};
let historical=await drafts.create(input);historical=await drafts.review({...command(historical),action:'review',acknowledgeWarnings:true});
old.exec("INSERT INTO inventory(company_id,product_id,data,version) VALUES('a','legacy','{\"onHand\":42}',1)");
const names=old.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
const before=tables(old,names);
// Exercise the shipping CLI splitter as well as SQLite: CASE needs preceding whitespace.
for(const statement of unstable_splitSqlQuery(readFileSync('drizzle/0028_po_cart_authorizations.sql','utf8')))old.exec(statement);
assert.equal(tables(old,names),before);
const upgraded=new cartCore.D1PoCartAuthorizations(new LocalD1(old),options);
await assert.rejects(upgraded.authorize(command(historical)),errorCode('source_changed'));
// Config alone is insufficient without a budget policy.
configure(old); // Remove the policy only in a separate old-shaped fixture below; history is append-only.
assert.deepEqual(await drafts.get('a',historical.snapshot.id),historical);
const saved=await upgraded.authorize(command(historical));assert.equal(saved.current.valid,true);
assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(),[]);old.close();

const missing=new DatabaseSync(':memory:');missing.exec('PRAGMA foreign_keys=ON');
for(const e of entries)missing.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
missing.exec("INSERT INTO companies VALUES('a','Missing policy cafe','2026-10-01'); INSERT INTO memberships VALUES('manager','a','manager')");
const missingDrafts=new cartCore.D1PurchaseOrderDrafts(new LocalD1(missing),options);
let noPolicy=await missingDrafts.create({...input,operationId:randomUUID()});noPolicy=await missingDrafts.review({...command(noPolicy),action:'review',acknowledgeWarnings:true});
const {connection}=await import('./helpers/po-cart-authorizations.mjs');
missing.prepare('INSERT INTO po_cart_connections VALUES(?,?,?,?)').run('a',connection.id,1,JSON.stringify(connection));
await assert.rejects(new cartCore.D1PoCartAuthorizations(new LocalD1(missing),options).authorize(command(noPolicy)),errorCode('policy_missing'));
assert.equal(missing.prepare('SELECT COUNT(*) n FROM po_cart_authorizations').get().n,0);missing.close();
console.log(`PASS: A/C alias and cross-consumer guards, source/config/mapping/profile/connection/policy races, unresolved PO cancellation, disk restart and populated ${names.length}-table upgrade.`);
