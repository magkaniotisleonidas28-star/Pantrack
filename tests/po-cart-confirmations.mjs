import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced,cancel} from './helpers/po-cart-jobs.mjs';
import {cancelCommand,errorCode} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-po-cart-confirmations.ts';export * from './src/lib/po-cart-confirmation-contract.ts';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-confirmation-tests.mjs'});
const {D1PoCartConfirmations}=await import('../.sites-runtime/po-cart-confirmation-tests.mjs');

const f=await jobFixture();
const confirmations=()=>new D1PoCartConfirmations(f.db,f.options);
const nonStock={kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'};
let clock=Date.parse('2026-10-02T12:00:00.000Z');const tick=()=>{clock+=60_000;f.setTime(new Date(clock).toISOString());};
// A fictional job whose every line was verified by the fake worker: the cart is ready.
async function ready(productIds,capMinor='15000'){
  tick();const lines=[];for(const id of productIds)lines.push(await f.stock(id));
  const a=await f.authorized({lines:[...lines,nonStock],capMinor});tick();
  let j=(await f.jobs().enqueue(enqueue(a))).current.job;const claim=await f.worker().claim(operation(j)),fence=claim.receipt.fence;
  for(const line of j.inputs.preflight.lines){
    const begun=await f.worker().beginAttempt({...fenced(j,fence),lineId:line.lineId});
    j=(await f.worker().recordResult({...fenced(j,fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current.job;
  }
  assert.equal(j.state,'ready');tick();return {a,j};
}
const record=(j,patch={},lineFor=l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor}))=>({action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,
  operationId:randomUUID(),supplierReference:'SUP-'+j.id.slice(0,8),expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(lineFor),extras:[],charges:[],note:'Confirmation email',...patch});
const incoming=productId=>f.sql.prepare("SELECT incoming_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id=?").get(productId).incoming_minor;
const activeCommitments=authorizationId=>f.sql.prepare("SELECT COUNT(*) AS n FROM po_cart_commitments WHERE company_id='a' AND authorization_id=? AND active=1").get(authorizationId).n;
const state=()=>JSON.stringify(['po_cart_confirmations','inventory_order_incoming','inventory_balances_exact','po_cart_commitments','po_cart_reservations']
  .map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
async function refused(code,fn){const before=state();await assert.rejects(fn,errorCode(code));assert.equal(state(),before);}

// Within the cap: one batch records it, adds order-linked incoming at the frozen conversion and releases commitments.
{
  const {a,j}=await ready(['beans','milk']),beans=j.inputs.preflight.lines.find(l=>l.productId==='beans'),milk=j.inputs.preflight.lines.find(l=>l.productId==='milk');
  const before={beans:incoming('beans'),milk:incoming('milk')};assert.equal(activeCommitments(a.id),2);
  for(const user of [null,'employee','b-manager','b-owner']){f.setUser(user);await refused('forbidden',()=>confirmations().record(record(j)));}
  f.setUser('manager');
  await refused('invalid_request',()=>confirmations().record(record(j,{lines:[]})));
  await refused('invalid_request',()=>confirmations().record(record(j,{lines:[...record(j).lines,record(j).lines[0]]})));
  await refused('invalid_request',()=>confirmations().record(record(j,{expectedDelivery:'2026-02-30'})));
  await refused('invalid_request',()=>confirmations().record(record(j,{lines:record(j).lines.map(l=>({...l,packs:'1.5'}))})));
  await refused('conflict',()=>confirmations().record(record(j,{expectedJobRevision:j.revision-1})));
  const input=record(j,{lines:j.inputs.preflight.lines.map(l=>l.lineId===milk.lineId?{lineId:l.lineId,packs:'1',unitMinor:'120'}:{lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor}),
    charges:[{kind:'delivery',description:'Delivery fee',amountMinor:'500'}]});
  const saved=await confirmations().record(input);assert.equal(saved.receipt.state,'confirmed');
  assert.equal(BigInt(incoming('beans'))-BigInt(before.beans),BigInt(beans.stockUnitsPerPack.minor)*BigInt(beans.packs),'Authorized packs at the frozen conversion');
  assert.equal(BigInt(incoming('milk'))-BigInt(before.milk),BigInt(milk.stockUnitsPerPack.minor),'One confirmed pack, not the two authorized');
  assert.equal(activeCommitments(a.id),0,'Commitments transfer to order-linked incoming');
  assert.equal(f.sql.prepare("SELECT state FROM po_cart_reservations WHERE company_id='a' AND authorization_id=?").get(a.id).state,'reserved','Spending stays held until delivery');
  const view=await confirmations().get({companyId:'a',jobId:j.id});
  assert.equal(view.confirmation.state,'confirmed');assert.equal(view.confirmation.chargesMinor,500);
  const m=view.confirmation.lines.find(l=>l.lineId===milk.lineId);assert.deepEqual([m.packsChanged,m.priceChanged,m.lineMinor],[true,true,'120']);
  assert.equal(view.incoming.length,2);
  // Exact replay returns the receipt; a reused identity with different input conflicts.
  assert.deepEqual(await confirmations().record(input),saved);
  await refused('conflict',()=>confirmations().record({...input,note:'Different'}));
  await refused('conflict',()=>confirmations().record(record(j)),'One confirmation per order');
  // Duplicate supplier reference within the account is refused for another order.
  const other=await ready(['cups']);
  await refused('conflict',()=>confirmations().record(record(other.j,{supplierReference:input.supplierReference})));
  // A confirmed purchase is not undone by cancelling its preparation or permission.
  await assert.rejects(f.jobs().cancel(cancel(j)));
  const current=(await f.jobs().get({companyId:'a',jobId:j.id})).authorization.authorization;
  await assert.rejects(f.service().cancel(cancelCommand(current)));
  assert.equal((await f.jobs().get({companyId:'a',jobId:j.id})).job.state,'ready');
  for(const sql of ["UPDATE po_cart_confirmations SET note='x'","DELETE FROM po_cart_confirmations"])assert.throws(()=>f.sql.exec(sql),/immutable/);
  // Confirming the other order under its own number ends its account cart ownership.
  assert.equal(f.sql.prepare("SELECT job_id FROM po_cart_owners WHERE company_id='a'").get().job_id,other.j.id);
  await confirmations().record(record(other.j));
  assert.equal(f.sql.prepare("SELECT job_id FROM po_cart_owners WHERE company_id='a'").get().job_id,null,'Checkout is proven, so the account is free');
}
// Zero packs and extra items: the unconfirmed product gets no incoming but is released; extras cost money only.
{
  const {a,j}=await ready(['flour','sugar']),flour=j.inputs.preflight.lines.find(l=>l.productId==='flour');
  const before={flour:incoming('flour'),sugar:incoming('sugar')};
  const saved=await confirmations().record(record(j,{extras:[{sku:'SUB-1',description:'Substituted brand',packs:'1',unitMinor:'300'}]},
    l=>({lineId:l.lineId,packs:l.lineId===flour.lineId?'0':l.packs,unitMinor:l.unitMinor})));
  assert.equal(saved.receipt.state,'confirmed');assert.equal(incoming('flour'),before.flour);assert.notEqual(incoming('sugar'),before.sugar);
  assert.equal(activeCommitments(a.id),0);
  const view=await confirmations().get({companyId:'a',jobId:j.id});assert.equal(view.confirmation.extras[0].lineMinor,'300');assert.equal(view.incoming.length,1);
}
// Over the cap: recorded for owner review with no stock effect; commitments stay held.
{
  const {a,j}=await ready(['rice'],'1000'),before=incoming('rice');
  const saved=await confirmations().record(record(j,{charges:[{kind:'tax',description:'',amountMinor:'900'}]}));
  assert.equal(saved.receipt.state,'needs_owner_review');assert.equal(incoming('rice'),before);assert.equal(activeCommitments(a.id),1);
  assert.equal((await confirmations().get({companyId:'a',jobId:j.id})).incoming.length,0);
}
// Inventory that cannot take the order (a later count) saves nothing; a lost acknowledgment replays.
{
  const {a,j}=await ready(['salt']);
  f.sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at=? WHERE company_id='a' AND product_id='salt'").run(new Date(clock+3600_000).toISOString());
  await refused('conflict',()=>confirmations().record(record(j)));
  f.sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at=? WHERE company_id='a' AND product_id='salt'").run(new Date(clock-3600_000).toISOString());
  const input=record(j),batch=f.db.batch.bind(f.db);
  // Lose only the save's acknowledgment: it commits, then the caller sees an error.
  f.db.batch=async statements=>{if(statements.some(st=>st.query.includes('INSERT INTO po_cart_confirmations'))){f.db.batch=batch;f.db.loseAcknowledgment=true;}return batch(statements);};
  const replayed=await confirmations().record(input);assert.equal(f.db.batch,batch,'The lost acknowledgment was injected on the save');assert.equal(replayed.receipt.state,'confirmed');assert.equal(activeCommitments(a.id),0);
}
// A job that is not ready cannot be confirmed.
{
  tick();const a=await f.authorized({lines:[await f.stock('oats'),nonStock]});const j=(await f.jobs().enqueue(enqueue(a))).current.job;
  await refused('conflict',()=>confirmations().record(record(j)));
  await assert.rejects(confirmations().get({companyId:'b',jobId:j.id}),errorCode('forbidden'));
}
console.log('PASS: supplier confirmations account for every line, add order-linked incoming once at frozen conversions and release commitments within the cap, hold over-cap totals with no stock effect, reject duplicates and stale jobs, replay exactly and lock confirmed purchases.');
