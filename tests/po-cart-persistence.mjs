import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cartFixture,configure,connection,connectionVersion,command,cancelCommand,errorCode,tables,cartTables} from './helpers/po-cart-authorizations.mjs';

const f=await cartFixture();
const cartState=()=>tables(f.sql,cartTables);
const stockState=()=>tables(f.sql,['inventory','inventory_events','inventory_balances_exact','inventory_events_exact','inventory_reconciliations']);
async function unchanged(fn){const before=cartState();await fn();assert.equal(cartState(),before,'Failure leaves no partial authorization, claims, exposure, receipt or audit');}
async function canceled(result){return f.service().cancel(cancelCommand(result.current.authorization));}
const start=a=>{const {reason,...input}=cancelCommand(a);return {...input,action:'start'};};
try{
  const line=await f.stock('coffee'),order=await f.reviewed({lines:[line]}),input=command(order),inventory=stockState();
  assert.equal((await f.service().get({companyId:'a',orderId:input.orderId})).authorization,null);
  for(const user of [null,'employee','b-manager','revoked']){
    f.setUser(user);
    await unchanged(()=>assert.rejects(f.service().authorize(input),errorCode('forbidden')));
    await assert.rejects(f.service().get({companyId:'a',orderId:input.orderId}),errorCode('forbidden'));
  }
  f.setUser('manager');
  await unchanged(()=>assert.rejects(f.service().authorize({...input,companyId:'b'}),errorCode('forbidden')));
  f.setUser('b-manager');
  await unchanged(()=>assert.rejects(f.service().authorize({...input,companyId:'b'}),errorCode('missing')));f.setUser('manager');
  for(const patch of [{actor:'owner'},{capMinor:'1'},{connection},{lines:[]},{mode:'real'},
    {operationId:'not-uuid'},{expectedRevision:0},{action:'start'}])
    await unchanged(()=>assert.rejects(f.service().authorize({...input,...patch}),errorCode('invalid_request')));
  await unchanged(()=>assert.rejects(f.service().authorize({...input,expectedRevision:1}),errorCode('source_changed')));

  const results=await Promise.all([f.service().authorize(input),f.service().authorize(input)]);
  assert.deepEqual(...results);
  const a=results[0].current.authorization;
  assert.equal(results[0].current.valid,true);assert.equal(a.inputs.preflight.actor,'manager');
  assert.deepEqual(a.inputs.snapshot,order.snapshot);assert.equal(a.inputs.policy.perOrderMinor,50000);
  assert.equal(results[0].current.reservation.totalMinor,15000);
  assert.equal(results[0].current.commitments[0].quantity.minor,'60');
  assert.ok(Object.isFrozen(a.inputs.preflight.lines[0].stockQuantity));
  for(const t of cartTables)assert.equal(f.sql.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n,1);
  assert.equal(stockState(),inventory,'Preparation never changes on-hand, confirmed incoming or inventory history');
  assert.deepEqual(await f.service().revalidate('a',a.id),a);
  await unchanged(()=>assert.rejects(f.service().authorize({...input,operationId:randomUUID()}),errorCode('conflict')));
  await unchanged(()=>assert.rejects(f.service().authorize({...input,expectedRevision:999}),errorCode('conflict')));
  f.setUser('owner');await unchanged(()=>assert.rejects(f.service().authorize(input),errorCode('conflict')));f.setUser('manager');
  const duplicateOrder=await f.reviewed({lines:[line]});
  await unchanged(()=>assert.rejects(f.service().authorize(command(duplicateOrder)),errorCode('conflict')));

  const cancel=cancelCommand(a);
  for(const user of [null,'employee','b-manager']){f.setUser(user);await unchanged(()=>assert.rejects(f.service().cancel(cancel),errorCode('forbidden')));}
  f.setUser('manager');
  await unchanged(()=>assert.rejects(f.service().cancel({...cancel,expectedRevision:999}),errorCode('conflict')));
  f.db.loseAcknowledgment=true;
  const released=await f.service().cancel(cancel);
  assert.equal(released.current.authorization.status,'canceled');assert.equal(released.current.valid,false);
  assert.equal(released.current.reservation.state,'released');assert.equal(released.current.commitments[0].active,false);
  assert.deepEqual(await f.service().cancel(cancel),released);
  await unchanged(()=>assert.rejects(f.service().cancel({...cancel,reason:'Different reason'}),errorCode('conflict')));
  const oldRetry=await f.service().authorize(input);
  assert.deepEqual(oldRetry.receipt,results[0].receipt);assert.equal(oldRetry.current.authorization.status,'canceled');assert.equal(oldRetry.current.valid,false);
  await assert.rejects(f.service().revalidate('a',a.id),errorCode('source_changed'));
  const newResult=await f.service().authorize({...input,operationId:randomUUID()});
  const newA=newResult.current.authorization;
  assert.notEqual(newA.id,a.id);assert.equal(newResult.current.valid,true);
  // Replaying a canceled older grant never returns the replacement grant as its authority.
  assert.equal((await f.service().authorize(input)).current.authorization.id,a.id);
  assert.equal((await f.service().get({companyId:'a',orderId:input.orderId})).authorization.id,newA.id);
  await canceled(newResult);
  assert.equal((await f.service().get({companyId:'a',orderId:input.orderId})).authorization.id,newA.id,'Generation resolves equal-clock history deterministically');

  const lostOrder=await f.reviewed(),lostInput=command(lostOrder);
  f.db.loseAcknowledgment=true;const lost=await f.service().authorize(lostInput);
  assert.deepEqual(await f.service().authorize(lostInput),lost);await canceled(lost);

  // Transaction membership recheck, including reads, cancellation and internal use.
  const revokeOrder=await f.reviewed(),revokeInput=command(revokeOrder);
  f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
  await unchanged(()=>assert.rejects(f.service().authorize(revokeInput),errorCode('forbidden')));
  f.sql.exec("INSERT INTO memberships VALUES('manager','a','manager')");
  const revokeResult=await f.service().authorize(revokeInput);
  f.db.beforeBatch=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
  await unchanged(()=>assert.rejects(f.service().cancel(cancelCommand(revokeResult.current.authorization)),errorCode('forbidden')));
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
  await unchanged(()=>assert.rejects(f.service().markPreparationStarted(start(revokeResult.current.authorization)),errorCode('forbidden')));
  f.setUser('owner');
  assert.equal((await f.service().get({companyId:'a',orderId:revokeOrder.snapshot.id})).valid,false,'Revoking original authorizer also blocks other consumers');
  await canceled(revokeResult);f.sql.exec("INSERT INTO memberships VALUES('manager','a','manager')");f.setUser('manager');

  // Failure late in the batch rolls all generated claims and receipts back.
  const atomic=command(await f.reviewed());
  f.sql.exec("CREATE TEMP TRIGGER inject_cart_failure BEFORE INSERT ON po_cart_events BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await unchanged(()=>assert.rejects(f.service().authorize(atomic),errorCode('conflict')));
  f.sql.exec('DROP TRIGGER inject_cart_failure');
  await canceled(await f.service().authorize(atomic));

  // Both different operation identities and different POs contend atomically.
  const raceOrder=await f.reviewed({lines:[line]}),raceInput=command(raceOrder);
  const race=await Promise.allSettled([f.service().authorize(raceInput),f.service().authorize({...raceInput,operationId:randomUUID()})]);
  assert.deepEqual(race.map(r=>r.status).sort(),['fulfilled','rejected']);await canceled(race.find(r=>r.status==='fulfilled').value);
  const productRace=await Promise.allSettled([f.service().authorize(command(await f.reviewed({lines:[line]}))),
    f.service().authorize(command(await f.reviewed({lines:[line]})))]);
  assert.deepEqual(productRace.map(r=>r.status).sort(),['fulfilled','rejected']);await canceled(productRace.find(r=>r.status==='fulfilled').value);

  // Missing/changed policy and connection never silently fall back to defaults.
  configure(f.sql,'b');f.setUser('b-manager');
  const bOrder=await f.reviewed({companyId:'b'});f.setUser('manager');
  const changed=await f.service().authorize(command(await f.reviewed()));
  connectionVersion(f.sql,{paused:true});
  assert.equal((await f.service().get({companyId:'a',orderId:changed.current.authorization.orderId})).valid,false);
  assert.equal((await f.service().authorize({...changed.current.authorization.inputs.preflight.request,action:'authorize'})).current.valid,false);
  await unchanged(()=>assert.rejects(f.service().markPreparationStarted(start(changed.current.authorization))));
  assert.equal(f.sql.prepare("SELECT state FROM po_cart_reservations WHERE authorization_id=?").get(changed.current.authorization.id).state,'reserved');
  await canceled(changed);connectionVersion(f.sql,{});
  const policyResult=await f.service().authorize(command(await f.reviewed()));
  f.sql.exec("INSERT INTO po_cart_budget_policies VALUES('a',2,50000,100000)");
  assert.equal((await f.service().get({companyId:'a',orderId:policyResult.current.authorization.orderId})).valid,false);
  await canceled(policyResult);

  const budgetInputs=await Promise.all([0,1,2].map(async()=>command(await f.reviewed({capMinor:'40000'}))));
  const budgets=await Promise.allSettled(budgetInputs.map(i=>f.service().authorize(i)));
  assert.equal(budgets.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(f.sql.prepare("SELECT SUM(total_minor) n FROM po_cart_reservations WHERE company_id='a' AND state='reserved'").get().n,80000);
  const winner=budgets.find(r=>r.status==='fulfilled').value;
  const startInput=start(winner.current.authorization),started=await f.service().markPreparationStarted(startInput);
  assert.deepEqual(await f.service().markPreparationStarted(startInput),started);
  const unresolved=await canceled(started);
  assert.equal(unresolved.current.reservation.state,'reserved');assert.equal(unresolved.current.authorization.releasedAt,null);
  assert.equal(unresolved.current.authorization.status,'canceled');assert.equal(unresolved.current.valid,false);
  await unchanged(()=>assert.rejects(f.service().authorize(budgetInputs[budgets.findIndex(r=>r.status==='rejected')]),errorCode('conflict')));
  const overOrder=command(await f.reviewed({capMinor:'50001'}));
  await unchanged(()=>assert.rejects(f.service().authorize(overOrder),errorCode('conflict')));
  const other=budgets.filter(r=>r.status==='fulfilled').map(r=>r.value).find(r=>r!==winner);await canceled(other);
  const replacement=await f.service().authorize(command(await f.reviewed({capMinor:'50000'})));await canceled(replacement);

  // PO edits/cancel invalidate and release in the same draft transaction before start.
  const editable=await f.reviewed({lines:[line]}),editResult=await f.service().authorize(command(editable));
  const edit={...f.createInput({lines:[line]}),action:'edit',orderId:editable.snapshot.id,expectedRevision:editable.revision,reason:'Correct PO note',notes:'Changed note'};
  f.sql.exec("CREATE TEMP TRIGGER inject_po_failure BEFORE INSERT ON purchase_order_draft_events WHEN NEW.kind='edit' BEGIN SELECT RAISE(ABORT,'injected'); END");
  await unchanged(()=>assert.rejects(f.drafts.edit(edit),errorCode('conflict')));f.sql.exec('DROP TRIGGER inject_po_failure');
  await f.drafts.edit(edit);
  let status=await f.service().get({companyId:'a',orderId:editable.snapshot.id});
  assert.equal(status.authorization.status,'invalidated');assert.equal(status.authorization.revision,2);
  assert.equal(status.reservation.state,'released');assert.equal(status.events.at(-1).kind,'invalidated');assert.equal(status.events.at(-1).actor,'manager');
  await assert.rejects(f.service().authorize(command(editable)),errorCode('source_changed'));

  // A cancel between source inspection and status serialization cannot revive permission.
  const concurrentInput=command(await f.reviewed()),concurrent=await f.service().authorize(concurrentInput);
  const batch=f.db.batch.bind(f.db);let cancelDuringRead=true;
  f.db.batch=async statements=>{
    if(cancelDuringRead&&statements[0].query.startsWith('SELECT * FROM po_cart_authorizations')){
      cancelDuringRead=false;await f.service().cancel(cancelCommand(concurrent.current.authorization));
    }
    return batch(statements);
  };
  const consistent=await f.service().authorize(concurrentInput);f.db.batch=batch;
  assert.equal(consistent.current.authorization.status,'canceled');assert.equal(consistent.current.valid,false);
  assert.equal(consistent.current.reservation.state,'released');assert.equal(consistent.current.events.at(-1).kind,'cancel');
}finally{f.sql.close();}

console.log('PASS: durable atomic authorization, identity/source policy guards, race/replay/lost-response recovery, conservative spending and safe cancellation.');
