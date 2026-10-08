import assert from 'node:assert/strict';
import {core,fixture} from './helpers/supplier-simulation.mjs';
const reject=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const tables=['inventory_balances_exact','inventory_events_exact','inventory_reconciliations','replenishment_proposal_origins','replenishment_proposal_states','replenishment_proposal_events'];
const snapshot=f=>Object.fromEntries(tables.map(t=>[t,f.sql.prepare(`SELECT * FROM ${t} ORDER BY company_id`).all()]));

// The largest group fits D1's per-query bound limit and preserves every line.
{
  const f=await fixture({limits:{perOrderMinor:1_000_000,perUtcDayMinor:1_000_000}}),handoffs=[];
  for(let i=0;i<50;i++)handoffs.push(await f.source());
  const o=await f.approved('large-group',handoffs);
  assert.equal(o.quote.lines.length,50);assert.equal(o.quote.totalMinor,150_250);
  await f.engine().send(f.command(o,'large-send'));assert.equal(f.connector.calls,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM supplier_simulation_source_holds').get().n,50);
  f.sql.close();
}

// Upgrade from 0021 preserves fictional stock, proposals and their history.
{
  const f=await fixture({beforeNewMigration:true});await f.source();
  const before=snapshot(f);f.applyNewMigration();assert.deepEqual(snapshot(f),before);
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);f.sql.close();
}
// Exact approval, immutable receipts/history, authorization, cancellation and source holds.
{
  const f=await fixture(),h=await f.source(),e=f.engine(),before=snapshot(f);
  const create={companyId:'a',orderId:'order',operationId:'create',handoffs:[h]};
  let o=await e.create(create);assert.deepEqual(await e.create(create),o);
  for(const user of [null,'employee','b-manager']){
    f.setUser(user);
    for(const call of [()=>e.get('a','order'),()=>e.history('a','order'),()=>e.create(create),()=>e.quote(f.command(o,'q')),()=>e.approve({...f.command(o,'a'),quoteFingerprint:'x'}),()=>e.send(f.command(o,'s')),()=>e.cancel({...f.command(o,'c'),reason:'testing cancel'}),()=>e.reconcile(f.command(o,'r'))])await reject(call(),'forbidden');
  }
  f.setUser('manager');await reject(e.get('b','order'),'forbidden');
  await reject(e.create({...create,handoffs:[{...h,packs:'2'}]}),'conflict');
  o=await e.quote(f.command(o,'quote'));
  await reject(e.approve({...f.command(o,'wrong-quote'),quoteFingerprint:'estimate-only'}),'conflict');
  const approve={...f.command(o,'approve'),quoteFingerprint:core.canonicalJson(o.quote)};
  o=await e.approve(approve);const approval=o.approvalId;
  assert.deepEqual(await e.approve(approve),o);
  f.setUser('owner');await reject(e.approve(approve),'conflict');f.setUser('manager');
  const approved=o;
  o=await e.quote(f.command(o,'requote'));assert.equal(o.approvalId,null);
  await reject(e.send(f.command(o,'not-approved')),'conflict');
  await reject(e.approve({...f.command(o,'old-quote'),quoteFingerprint:core.canonicalJson(approved.quote)}),'conflict');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM supplier_simulation_approvals WHERE id=?').get(approval).n,1);
  o=await e.approve({...f.command(o,'approve-new'),quoteFingerprint:core.canonicalJson(o.quote)});
  const duplicate=await f.approved('different-id',[h]);
  const send=f.command(o,'send');const sends=await Promise.all([e.send(send),e.send(send)]);
  assert.deepEqual(sends[0],sends[1]);assert.equal(sends[0].status,'sending');
  assert.equal(f.connector.calls,1);o=await e.get('a','order');assert.equal(o.status,'accepted');
  assert.deepEqual(await e.send(send),sends[0]);assert.equal(f.connector.calls,1);
  await reject(e.send(f.command(duplicate,'duplicate-source')),'guard_failed');assert.equal(f.connector.calls,1);
  await reject(e.cancel({...f.command(o,'cancel-sent'),reason:'Too late to cancel'}),'conflict');
  const history=await e.history('a','order');assert.equal(history.length,o.revision);
  assert.deepEqual(history.map(x=>x.kind),['create','quote','approve','quote','approve','send','outcome']);
  for(const table of ['supplier_simulation_quotes','supplier_simulation_approvals','supplier_simulation_operations','supplier_simulation_events']){
    assert.throws(()=>f.sql.prepare(`DELETE FROM ${table}`).run(),/immutable/);
    const col=table==='supplier_simulation_operations'?'fingerprint':table==='supplier_simulation_quotes'?'quote_json':table==='supplier_simulation_approvals'?'actor':'actor';
    assert.throws(()=>f.sql.prepare(`UPDATE ${table} SET ${col}='tampered'`).run(),/immutable/);
  }
  assert.throws(()=>f.sql.prepare("UPDATE supplier_simulation_orders SET status='approved',revision=revision+1 WHERE id='order'").run(),/transition/);
  assert.deepEqual(snapshot(f),before,'Simulation must not alter stock, incoming or proposal history.');
  f.setUser('b-manager');const bh=await f.source({companyId:'b'}),bo=await f.approved('order',[bh]);
  await f.engine().send(f.command(bo,'b-send'));assert.equal((await f.engine().get('b','order')).companyId,'b');
  await reject(f.engine().get('a','order'),'forbidden');
  f.sql.close();
}
// All quote-bearing actions fail on changed source or expired quote, with atomic race guards.
for(const action of ['create','quote','approve','send']){
  const f=await fixture(),h=await f.source(),e=f.engine();
  let o;
  if(action!=='create')o=await e.create({companyId:'a',orderId:'stale',operationId:'create',handoffs:[h]});
  if(['approve','send'].includes(action))o=await e.quote(f.command(o,'quote'));
  if(action==='send')o=await e.approve({...f.command(o,'approve'),quoteFingerprint:core.canonicalJson(o.quote)});
  const before=snapshot(f);
  f.db.beforeBatch=()=>f.sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a'").run();
  const call=action==='create'?e.create({companyId:'a',orderId:'stale',operationId:'stale',handoffs:[h]}):action==='quote'?e.quote(f.command(o,'stale')):action==='approve'?e.approve({...f.command(o,'stale'),quoteFingerprint:core.canonicalJson(o.quote)}):e.send(f.command(o,'stale'));
  await reject(call,'guard_failed');assert.equal(f.connector.calls,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM supplier_simulation_operations WHERE operation_id='stale'").get().n,0);
  // The engine does not add source invalidation events on its failed reads/writes.
  assert.deepEqual(snapshot(f).replenishment_proposal_events,before.replenishment_proposal_events);
  f.sql.close();
}
{
  const f=await fixture(),h=await f.source(),e=f.engine();let o=await f.approved('expiry',[h]);
  f.setTime('2026-10-01T12:01:00.000Z');await reject(e.send(f.command(o,'expired-send')),'invalid_request');
  o=await e.quote(f.command(o,'renew'));f.setTime('2026-10-01T12:02:00.000Z');
  await reject(e.approve({...f.command(o,'expired-approve'),quoteFingerprint:core.canonicalJson(o.quote)}),'invalid_request');
  assert.equal(f.connector.calls,0);f.sql.close();
}
// Revocation between read and commit, settings/config changes, proposal edits and v2 Clover health.
{
  const f=await fixture(),h=await f.source(),o=await f.approved('role-race',[h]);
  f.db.beforeBatch=()=>f.sql.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();
  await reject(f.engine().send(f.command(o,'role-race-send')),'guard_failed');assert.equal(f.connector.calls,0);f.sql.close();
}
for(const change of ['settings','config','edit','cancel']){
  const f=await fixture(),h=await f.source(),o=await f.approved('changed',[h]);
  if(change==='settings'){
    const row=f.sql.prepare("SELECT * FROM replenishment_settings_versions WHERE company_id='a'").get();
    const columns=Object.keys(row),values=columns.map(k=>k==='version'?row[k]+1:k==='change_id'?'replacement':row[k]);
    f.sql.prepare(`INSERT INTO replenishment_settings_versions(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values);
  }else if(change==='config')f.sql.prepare("UPDATE inventory_config_versions SET status='retired' WHERE company_id='a'").run();
  else{
    const lifecycle=new core.D1ReplenishmentLifecycle(f.db,{clock:f.options.clock});
    const command={companyId:'a',proposalId:h.proposalId,expectedRevision:1,changeId:'source-change',actor:{companyId:'a',userId:'manager',role:'manager'},reason:'Fictional source change'};
    if(change==='edit')await lifecycle.edit({...command,packs:'2'});else await lifecycle.cancel(command);
  }
  await assert.rejects(f.engine().send(f.command(o,'changed-send')),e=>['source_changed','guard_failed'].includes(e.code));
  assert.equal(f.connector.calls,0);f.sql.close();
}
for(const enabled of [true,false]){
  const f=await fixture(),h=await f.source({clover:true});assert.equal(h.contract,'pantrack.replenishment-handoff.v2');
  const o=await f.approved('clover',[h]);
  if(enabled)f.db.beforeBatch=()=>f.sql.prepare("UPDATE clover_sync_state SET last_error='simulated sync error' WHERE company_id='a'").run();
  else f.options.salesPolicy={syncEnabled:false,maxLagMs:600_000};
  await reject(f.engine().send(f.command(o,'clover-send')),'guard_failed');assert.equal(f.connector.calls,0);f.sql.close();
}
for(const change of ['disconnect','checkpoint','stale']){
  const f=await fixture(),h=await f.source({clover:true}),e=f.engine();
  const o=await e.create({companyId:'a',orderId:'clover-guard',operationId:'create',handoffs:[h]});
  if(change==='disconnect')f.sql.prepare("DELETE FROM clover_connections WHERE company_id='a'").run();
  if(change==='checkpoint')f.sql.prepare("UPDATE clover_sync_state SET checkpoint=checkpoint+1 WHERE company_id='a'").run();
  if(change==='stale')f.setTime('2026-10-01T12:11:00.000Z');
  await reject(e.quote(f.command(o,'quote-changed-health')),'guard_failed');
  assert.equal(f.connector.calls,0);f.sql.close();
}
// Source edits while accepted cannot bypass source hold with a higher revision or another order ID.
{
  const f=await fixture(),h=await f.source(),o=await f.approved('held',[h]);await f.engine().send(f.command(o,'send'));
  await new core.D1ReplenishmentLifecycle(f.db,{clock:f.options.clock}).edit({companyId:'a',proposalId:h.proposalId,expectedRevision:1,changeId:'new-revision',actor:{companyId:'a',userId:'manager',role:'manager'},packs:'2',reason:'Fictional higher revision'});
  const newer=(await new core.D1ReplenishmentLifecycle(f.db,{clock:f.options.clock}).get('a',h.proposalId,{companyId:'a',userId:'manager',role:'manager'})).handoff;
  const next=await f.approved('bypass',[newer]);await reject(f.engine().send(f.command(next,'bypass-send')),'guard_failed');assert.equal(f.connector.calls,1);f.sql.close();
}
// Clearing the upstream quantity then creating a new proposal cannot bypass an accepted product hold.
{
  const f=await fixture(),h=await f.source(),o=await f.approved('product-held',[h]);await f.engine().send(f.command(o,'send'));
  const actor={companyId:'a',userId:'manager',role:'manager'};
  await new core.D1ReplenishmentLifecycle(f.db,{clock:f.options.clock}).edit({companyId:'a',proposalId:h.proposalId,expectedRevision:1,changeId:'zero',actor,packs:'0',reason:'Fictional replacement attempt'});
  await new core.D1ReplenishmentProposalOrigins(f.db,{clock:f.options.clock}).create({companyId:'a',productId:h.productId,id:'replacement-source',createId:'replacement-source',actor,
    sales:{companyId:'a',source:'fictional_fixture',status:'current',heldEventCount:0},supplier:{...h.supplier,companyId:'a'},
    priceEstimate:{companyId:'a',source:'fictional_fixture',currency:'USD',perPackMinor:'900'}});
  const replacement=(await new core.D1ReplenishmentLifecycle(f.db,{clock:f.options.clock}).get('a','replacement-source',actor)).handoff;
  const next=await f.approved('product-bypass',[replacement]);await reject(f.engine().send(f.command(next,'product-bypass-send')),'guard_failed');
  assert.equal(f.connector.calls,1);f.sql.close();
}
// Different operation IDs competing for the same approved revision still produce one call.
{
  const f=await fixture(),o=await f.approved('send-race',[await f.source()]);
  const results=await Promise.allSettled([f.engine().send(f.command(o,'send-one')),f.engine().send(f.command(o,'send-two'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.connector.calls,1);f.sql.close();
}
// Budget competition, current limits, new UTC day exposure, and rejected release.
{
  const f=await fixture({limits:{perOrderMinor:4000,perUtcDayMinor:4000}}),a=await f.approved('a',[await f.source()]),b=await f.approved('b',[await f.source()]);
  const results=await Promise.allSettled([f.engine().send(f.command(a,'send-a')),f.engine().send(f.command(b,'send-b'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.connector.calls,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM supplier_simulation_reservations').get().n,1);f.sql.close();
}
{
  const f=await fixture(),o=await f.approved('limits',[await f.source()]);f.setLimits({perOrderMinor:3000,perUtcDayMinor:20_000});
  await reject(f.engine().send(f.command(o,'limit-send')),'guard_failed');assert.equal(f.connector.calls,0);f.sql.close();
}
for(const scenario of ['timeout','lost_response','rejected','accepted']){
  const f=await fixture({scenario,limits:{perOrderMinor:4000,perUtcDayMinor:4000}}),o=await f.approved('first',[await f.source()]);
  await f.engine().send(f.command(o,'send-first'));
  if(scenario!=='rejected')f.setTime('2026-10-02T12:00:00.000Z');
  const next=await f.approved('second',[await f.source()]);
  if(['timeout','lost_response'].includes(scenario))await reject(f.engine().send(f.command(next,'send-second')),'guard_failed');
  else await f.engine().send(f.command(next,'send-second'));
  assert.equal(f.connector.calls,['timeout','lost_response'].includes(scenario)?1:2);f.sql.close();
}
// Unknown results retain source/budget, restart reconciles once, not-found never releases.
for(const scenario of ['lost_response','timeout','malformed','mismatched']){
  const f=await fixture({scenario}),o=await f.approved('uncertain',[await f.source()]);
  const send=f.command(o,'send');await f.engine().send(send);
  let current=await f.engine().get('a','uncertain');assert.equal(current.status,'unknown');
  assert.equal(f.sql.prepare('SELECT state FROM supplier_simulation_reservations').get().state,'reserved');
  await reject(f.engine().send(f.command(current,'resubmit')),'conflict');
  const cmd=f.command(current,'reconcile'),reconciled=await f.engine().reconcile(cmd);
  assert.equal(reconciled.status,scenario==='timeout'?'unknown':'accepted');assert.deepEqual(await f.engine().reconcile(cmd),reconciled);
  assert.equal(f.connector.calls,1);
  assert.equal(f.sql.prepare('SELECT active FROM supplier_simulation_source_holds').get().active,1);
  assert.equal(f.sql.prepare('SELECT state FROM supplier_simulation_reservations').get().state,scenario==='timeout'?'reserved':'spent');
  if(reconciled.status==='accepted')await reject(f.engine().reconcile(f.command(reconciled,'downgrade')),'conflict');
  f.sql.close();
}
// Rejected outcomes release exposure and source, allowing a separate explicit approval/send.
{
  const f=await fixture({scenario:'rejected'}),h=await f.source(),o=await f.approved('rejected',[h]);await f.engine().send(f.command(o,'send'));
  assert.equal((await f.engine().get('a','rejected')).status,'rejected');assert.equal(f.sql.prepare('SELECT active FROM supplier_simulation_source_holds').get().active,0);
  assert.equal(f.sql.prepare('SELECT state FROM supplier_simulation_reservations').get().state,'released');
  const replacement=await f.approved('replacement',[h]);await f.engine().send(f.command(replacement,'replacement-send'));assert.equal(f.connector.calls,2);f.sql.close();
}
// Lost D1 acknowledgment and crash after claim do not invoke or retry the connector.
// Expiry during the claim acknowledgment skips the call and conservatively retains the claim for review.
{
  const f=await fixture(),o=await f.approved('expiry-race',[await f.source()]);
  f.db.beforeBatch=()=>f.setTime('2026-10-01T12:01:00.000Z');
  await f.engine().send(f.command(o,'send'));
  assert.equal(f.connector.calls,0);assert.equal((await f.engine().get('a','expiry-race')).status,'unknown');
  assert.equal(f.sql.prepare('SELECT state FROM supplier_simulation_reservations').get().state,'reserved');f.sql.close();
}
{
  const f=await fixture(),h=await f.source(),e=f.engine();f.db.loseAcknowledgment=true;
  const create={companyId:'a',orderId:'crash',operationId:'create',handoffs:[h]};const created=await e.create(create);
  assert.deepEqual(await e.create(create),created);
  let o=await e.quote(f.command(created,'quote'));f.db.loseAcknowledgment=true;
  const approve={...f.command(o,'approve'),quoteFingerprint:core.canonicalJson(o.quote)};o=await e.approve(approve);assert.deepEqual(await f.engine().approve(approve),o);
  f.db.loseAcknowledgment=true;const send=f.command(o,'send');const receipt=await e.send(send);assert.equal(receipt.status,'sending');assert.equal(f.connector.calls,0);
  assert.deepEqual(await f.engine().send(send),receipt);assert.equal(f.connector.calls,0);
  const unknown=await f.engine().reconcile(f.command(receipt,'recover'));assert.equal(unknown.status,'unknown');
  assert.equal(f.sql.prepare('SELECT state FROM supplier_simulation_reservations').get().state,'reserved');f.sql.close();
}
// Mid-transaction failure rolls back the claim, holds, reservation and audit completely.
// A crash after provider acceptance but before result persistence remains a held send, recoverable by lookup.
{
  const f=await fixture(),o=await f.approved('result-crash',[await f.source()]);
  f.sql.exec("CREATE TRIGGER injected_result_fail BEFORE INSERT ON supplier_simulation_events WHEN NEW.kind='outcome' BEGIN SELECT RAISE(ABORT,'injected result crash'); END;");
  await assert.rejects(f.engine().send(f.command(o,'send')),/injected result crash/);
  const sent=await f.engine().get('a','result-crash');assert.equal(sent.status,'sending');assert.equal(f.connector.calls,1);
  f.sql.exec('DROP TRIGGER injected_result_fail');
  const settled=await f.engine().reconcile(f.command(sent,'recover'));assert.equal(settled.status,'accepted');assert.equal(f.connector.calls,1);f.sql.close();
}
{
  const f=await fixture(),o=await f.approved('rollback',[await f.source()]);
  f.sql.exec("CREATE TRIGGER injected_send_fail BEFORE INSERT ON supplier_simulation_events WHEN NEW.kind='send' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  await assert.rejects(f.engine().send(f.command(o,'rollback-send')),/injected failure/);
  assert.equal((await f.engine().get('a','rollback')).status,'approved');assert.equal(f.connector.calls,0);
  for(const table of ['supplier_simulation_source_holds','supplier_simulation_reservations'])assert.equal(f.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM supplier_simulation_operations WHERE operation_id='rollback-send'").get().n,0);
  f.sql.exec('DROP TRIGGER injected_send_fail');await f.engine().send(f.command(o,'rollback-send'));assert.equal(f.connector.calls,1);
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');f.sql.close();
}
// Cancel only before send, with durable replay and immutable reason.
{
  const f=await fixture(),o=await f.approved('cancel',[await f.source()]),cmd={...f.command(o,'cancel'),reason:'Fictional manager cancellation'};
  const canceled=await f.engine().cancel(cmd);assert.equal(canceled.status,'canceled');assert.deepEqual(await f.engine().cancel(cmd),canceled);
  await reject(f.engine().cancel({...cmd,reason:'Different reason'}),'conflict');assert.equal(f.connector.calls,0);f.sql.close();
}
console.log('PASS: C4 durable authorization, exact approval, source/version races, replay, concurrency, budgets, crash recovery and unchanged inventory/history.');
