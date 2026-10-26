import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';
import {errorCode} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:["d1-po-cart-deliveries","d1-po-cart-confirmations","d1-po-cart-spending-limits"].map(n=>`export * from './src/lib/${n}.ts';`).join('\n'),resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-closure-tests.mjs'});
const {D1PoCartDeliveries,D1PoCartConfirmations,D1PoCartSpendingLimits}=await import('../.sites-runtime/po-cart-closure-tests.mjs');

const f=await jobFixture();
const deliveries=()=>new D1PoCartDeliveries(f.db,f.options),confirmations=()=>new D1PoCartConfirmations(f.db,f.options);
const nonStock={kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'};
let clock=Date.parse('2026-10-02T12:00:00.000Z');const tick=(ms=60_000)=>{clock+=ms;f.setTime(new Date(clock).toISOString());return new Date(clock).toISOString();};
// A ready fictional cart confirmed within the cap. `packs` overrides what the supplier confirmed per line.
async function confirmed(productIds,{extras=[],packs=l=>l.packs}={}){
  f.setUser('manager');tick();const lines=[];for(const id of productIds)lines.push(await f.stock(id));
  const a=await f.authorized({lines:[...lines,nonStock]});tick();
  let j=(await f.jobs().enqueue(enqueue(a))).current.job;const fence=(await f.worker().claim(operation(j))).receipt.fence;
  for(const line of j.inputs.preflight.lines){
    const begun=await f.worker().beginAttempt({...fenced(j,fence),lineId:line.lineId});
    j=(await f.worker().recordResult({...fenced(j,fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current.job;
  }
  tick();f.setUser('manager');
  const saved=await confirmations().record({action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,operationId:randomUUID(),supplierReference:'SUP-'+j.id.slice(0,8),
    expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:packs(l),unitMinor:l.unitMinor})),extras,charges:[],note:''});
  assert.equal(saved.receipt.state,'confirmed');tick();
  const line=id=>j.inputs.preflight.lines.find(l=>l.productId===id),supplies=j.inputs.preflight.lines.find(l=>l.kind==='non_stock');
  return {a,j,confirmationId:saved.receipt.confirmationId,line,supplies};
}
const balance=productId=>({...f.sql.prepare("SELECT on_hand_minor,incoming_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id=?").get(productId)});
const per=l=>BigInt(l.stockUnitsPerPack.minor);
const hold=a=>f.sql.prepare("SELECT state FROM po_cart_reservations WHERE company_id='a' AND authorization_id=?").get(a.id).state;
const state=()=>JSON.stringify(['po_cart_order_closures','po_cart_reservations','po_cart_deliveries','inventory_order_receipts','inventory_order_incoming','inventory_balances_exact','inventory_events_exact']
  .map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
async function refused(code,fn){const before=state();await assert.rejects(fn,errorCode(code));assert.equal(state(),before);}
const count=(confirmationId,lines)=>({action:'count',companyId:'a',confirmationId,operationId:randomUUID(),deliveredAt:new Date(clock-30_000).toISOString(),
  lines:lines.map(([lineId,receivedPacks])=>({lineId,receivedPacks,damagedPacks:'0'})),note:''});
const approve=(deliveryId,lines)=>({action:'approve',companyId:'a',deliveryId,operationId:randomUUID(),
  lines:lines.map(([lineId,acceptPacks])=>({lineId,acceptPacks,excessPacks:'0',releaseRest:false})),note:''});
const close=(confirmationId,note='')=>({action:'close',companyId:'a',confirmationId,operationId:randomUUID(),note});
const managerView=jobId=>{f.setUser('manager');return deliveries().manager({companyId:'a',view:'manager',jobId});};
const usage=()=>new D1PoCartSpendingLimits(f.db,f.options).usage('a',{version:1,timeZone:'UTC',actor:'owner',createdAt:'2026-10-01T00:00:00.000Z'},new Date(clock).toISOString());

// The approval that resolves everything closes the order and settles its in-progress hold only.
{
  const {a,j,confirmationId,line,supplies}=await confirmed(['beans']),beans=line('beans');
  assert.equal(hold(a),'reserved');const before=await usage();
  f.setUser('employee');const counted=await deliveries().count(count(confirmationId,[[beans.lineId,beans.packs],[supplies.lineId,'1']]));
  f.setUser('manager');tick();await deliveries().approve(approve(counted.receipt.deliveryId,[[beans.lineId,beans.packs],[supplies.lineId,'1']]));
  const view=await managerView(j.id);
  assert.equal(view.closure.kind,'complete');assert.equal(view.closure.closedBy,'manager');assert.deepEqual(view.closure.released,[]);assert.equal(view.hold,'settled');
  assert.equal(hold(a),'settled');const after=await usage(),cap=a.inputs.preflight.capMinor;
  assert.equal(before.outstandingMinor-after.outstandingMinor,Number(cap),'The in-progress hold is freed');
  assert.deepEqual([after.dayMinor,after.monthMinor],[before.dayMinor,before.monthMinor],'Daily and monthly limits keep counting the cap');
  // A closed order takes no more counts and cannot be closed again.
  f.setUser('employee');assert.equal((await deliveries().staff({companyId:'a',view:'staff'})).orders.some(o=>o.confirmationId===confirmationId),false);
  f.setUser('manager');await refused('conflict',()=>deliveries().close(close(confirmationId,'Again')));
  for(const sql of ["UPDATE po_cart_order_closures SET note='Changed'","DELETE FROM po_cart_order_closures","UPDATE po_cart_reservations SET state='reserved' WHERE state='settled'",
    "UPDATE po_cart_reservations SET state='released' WHERE state='settled'","UPDATE po_cart_reservations SET state='settled' WHERE state='settled'"])assert.throws(()=>f.sql.exec(sql),/permanent|Unsafe cart exposure/,sql);
  const at=new Date(clock).toISOString();
  assert.throws(()=>f.sql.exec(`INSERT INTO po_cart_deliveries(company_id,id,confirmation_id,job_id,delivered_at,count_json,count_note,counted_by,counted_at,count_operation_id,count_fingerprint,state)
    VALUES('a','after-close','${confirmationId}','${j.id}','${at}','[{"lineId":"x"}]','','employee','${at}','op-after-close','fp','counted')`),/Invalid delivery count/,'The database refuses counts on a closed order');
}
// A manager closes an order early: the rest will not arrive, its incoming stock is released, and the hold settles.
{
  const {a,j,confirmationId,line,supplies}=await confirmed(['milk','cups'],{extras:[{sku:'SUB-1',description:'Oat milk substitute',packs:'2',unitMinor:'100'}]});
  const milk=line('milk'),cups=line('cups'),before={milk:balance('milk'),cups:balance('cups')};
  f.setUser('employee');const counted=await deliveries().count(count(confirmationId,[[milk.lineId,'1'],[cups.lineId,'0'],[supplies.lineId,'1'],['extra-1','1']]));
  // A count waiting for review blocks closing; staff, other companies and anonymous users cannot close.
  for(const user of [null,'employee','b-manager']){f.setUser(user);await refused('forbidden',()=>deliveries().close(close(confirmationId,'Supplier out of stock')));}
  f.setUser('manager');await refused('conflict',()=>deliveries().close(close(confirmationId,'Supplier out of stock')));
  tick();await deliveries().approve(approve(counted.receipt.deliveryId,[[milk.lineId,'1'],[cups.lineId,'0'],[supplies.lineId,'1'],['extra-1','1']]));
  assert.equal(hold(a),'reserved','A partial delivery keeps the order open');
  const mid={milk:balance('milk'),cups:balance('cups')};
  for(const note of ['',' '])await refused('invalid_request',()=>deliveries().close(close(confirmationId,note)));
  await refused('missing',()=>deliveries().close(close('unknown','x')));
  tick();const input=close(confirmationId,'Supplier discontinued cups'),done=await deliveries().close(input);
  assert.equal(done.receipt.kind,'closed_short');assert.deepEqual(await deliveries().close(input),done,'Exact replay');
  await refused('conflict',()=>deliveries().close({...input,note:'Different reason'}));
  const owedMilk=BigInt(milk.packs)-1n,owedCups=BigInt(cups.packs);
  assert.deepEqual(balance('milk'),{on_hand_minor:mid.milk.on_hand_minor,incoming_minor:String(BigInt(mid.milk.incoming_minor)-owedMilk*per(milk))},'Released, not added');
  assert.deepEqual(balance('cups'),{on_hand_minor:before.cups.on_hand_minor,incoming_minor:String(BigInt(before.cups.incoming_minor)-owedCups*per(cups))});
  assert.deepEqual(f.sql.prepare('SELECT quantity_minor=CAST(CAST(received_minor AS INTEGER)+CAST(released_minor AS INTEGER) AS TEXT) AS resolved FROM inventory_order_incoming WHERE confirmation_id=?').all(confirmationId).map(r=>r.resolved),[1,1]);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM inventory_order_receipts WHERE receipt_id=?').get(input.operationId).n,2);
  const view=await managerView(j.id);
  assert.deepEqual(view.lines.map(l=>[l.acceptedPacks,l.releasedPacks,l.owedPacks]),[['1',String(owedMilk),'0'],['0',String(owedCups),'0'],['1','0','0'],['1','1','0']]);
  assert.deepEqual([view.closure.kind,view.closure.note,view.closure.stockLowered,view.hold],['closed_short','Supplier discontinued cups',true,'settled']);
  assert.equal(hold(a),'settled');
  f.setUser('employee');await refused('conflict',()=>deliveries().count(count(confirmationId,[[milk.lineId,'1']])));
}
// An order with nothing left to receive closes without a reason; non-stock releases post no stock.
{
  const {a,j,confirmationId,supplies}=await confirmed(['rice'],{packs:l=>l.kind==='stock'?'0':l.packs});
  f.setUser('employee');assert.deepEqual((await deliveries().staff({companyId:'a',view:'staff'})).orders.find(o=>o.confirmationId===confirmationId).lines.map(l=>l.lineId),[supplies.lineId]);
  f.setUser('manager');const done=await deliveries().close(close(confirmationId,'Supplies cancelled'));assert.equal(done.receipt.kind,'closed_short');
  assert.deepEqual([(await managerView(j.id)).closure.stockLowered,hold(a)],[false,'settled']);
}
// Freeing the hold lets a new order fit within the in-progress limit again.
{
  const {a,j,confirmationId,supplies}=await confirmed([]);
  const reserved=(await usage()).outstandingMinor;
  f.sql.prepare('INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES(?,(SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id=?),?,?)')
    .run('a','a',15000,reserved);
  f.setUser('manager');tick();await assert.rejects(f.authorized({lines:[nonStock]}),'The in-progress limit is full');
  f.setUser('employee');const counted=await deliveries().count(count(confirmationId,[[supplies.lineId,'1']]));
  f.setUser('manager');tick();await deliveries().approve(approve(counted.receipt.deliveryId,[[supplies.lineId,'1']]));
  assert.equal((await managerView(j.id)).closure.kind,'complete');assert.equal(hold(a),'settled');
  tick();const next=await f.authorized({lines:[nonStock]});assert.equal(hold(next),'reserved','A new order fits once the closed order frees its hold');
  f.sql.prepare('INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES(?,(SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id=?),?,?)')
    .run('a','a',50000,1000000);
}
// A stock change while closing saves nothing; a lost acknowledgment replays; concurrent closes close once; a revoked manager is refused.
{
  const {a,confirmationId,line}=await confirmed(['sugar']),sugar=line('sugar'),batch=f.db.batch.bind(f.db),incoming=BigInt(balance('sugar').incoming_minor);
  f.setUser('manager');const kept=state();
  f.db.batch=async statements=>{f.db.batch=batch;f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='sugar'");return batch(statements);};
  await assert.rejects(deliveries().close(close(confirmationId,'Not coming')),errorCode('conflict'));
  assert.equal(f.db.batch,batch);
  const unchanged=JSON.parse(state()),was=JSON.parse(kept);unchanged[5]=was[5]=null;assert.deepEqual(unchanged,was,'Nothing saved besides the injected stock change');
  assert.equal(hold(a),'reserved');
  f.sql.exec("INSERT INTO memberships(user_id,company_id,role) VALUES('temp-manager','a','manager')");f.setUser('temp-manager');const revoked=close(confirmationId,'Not coming');
  f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='temp-manager'");await refused('forbidden',()=>deliveries().close(revoked));
  f.setUser('manager');const input=close(confirmationId,'Not coming');
  f.db.batch=async statements=>{if(statements.some(st=>st.query.includes('po_cart_order_closures'))){f.db.batch=batch;f.db.loseAcknowledgment=true;}return batch(statements);};
  const [first,second]=await Promise.allSettled([deliveries().close(input),deliveries().close(close(confirmationId,'Other reason'))]);
  assert.equal(f.db.batch,batch,'The lost acknowledgment was injected on the save');
  assert.equal(first.status,'fulfilled');assert.equal(first.value.receipt.kind,'closed_short');
  assert.equal(second.status,'rejected');assert.equal(second.reason.code,'conflict','A second close is refused');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_order_closures WHERE confirmation_id=?').get(confirmationId).n,1);assert.equal(hold(a),'settled');
  assert.equal(BigInt(balance('sugar').incoming_minor),incoming-BigInt(sugar.packs)*per(sugar),'Only this order\'s incoming is released');
}
// The database refuses closures that leave anything owed, lack a reason, come from staff or another company, or skip a pending count.
// Each refused row breaks exactly one rule; the last one is accepted once the pending count is sent back.
{
  const insert=(o,{kind='closed_short',release,stock=0,note='Not coming',by='manager',company='a',op=randomUUID()})=>`INSERT INTO po_cart_order_closures(company_id,confirmation_id,job_id,authorization_id,kind,release_json,stock_receipt,note,closed_by,closed_at,operation_id,fingerprint)
    VALUES('${company}','${o.confirmationId}','${o.j.id}','${o.a.id}','${kind}','${JSON.stringify(release)}',${stock},'${note}','${by}','${new Date(clock).toISOString()}','${op}','fp')`;
  // Stock: a closure must release the order's incoming stock through the receipt port.
  const stocked=await confirmed(['oil']),oil=stocked.line('oil');
  assert.throws(()=>f.sql.exec(insert(stocked,{release:[{lineId:oil.lineId,releasePacks:oil.packs},{lineId:stocked.supplies.lineId,releasePacks:'1'}]})),/Invalid or stale order closure/,'Incoming not released');
  const o=await confirmed([],{extras:[{sku:'SUB-2',description:'Substitute',packs:'2',unitMinor:'100'}]}),supplies=o.supplies.lineId;
  const all=[{lineId:supplies,releasePacks:'1'},{lineId:'extra-1',releasePacks:'2'}];
  for(const [why,input] of [
    ['complete while owed',{kind:'complete',release:[],note:''}],
    ['unknown kind',{kind:'done',release:all}],
    ['no reason',{release:all,note:' '}],
    ['still owed',{release:all.slice(0,1)}],
    ['unknown line',{release:[...all,{lineId:'extra-2',releasePacks:'1'}]}],
    ['duplicate line',{release:[all[0],{lineId:'extra-1',releasePacks:'1'},{lineId:'extra-1',releasePacks:'1'}]}],
    ['leading zero',{release:[all[0],{lineId:'extra-1',releasePacks:'02'}]}],
    ['number, not text',{release:[all[0],{lineId:'extra-1',releasePacks:2}]}],
    ['claims stock without receipts',{release:all,stock:1}],
    ['staff',{release:all,by:'employee'}],
    ['other company',{release:all,company:'b',by:'b-manager'}],
  ])assert.throws(()=>f.sql.exec(insert(o,input)),/Invalid or stale order closure|FOREIGN KEY/,why);
  assert.throws(()=>f.sql.exec(`UPDATE po_cart_reservations SET state='settled' WHERE company_id='a' AND authorization_id='${o.a.id}'`),/Unsafe cart exposure/,'Settling needs a closure');
  f.setUser('employee');const pending=await deliveries().count(count(o.confirmationId,[[supplies,'1'],['extra-1','0']]));
  assert.throws(()=>f.sql.exec(insert(o,{release:all})),/Invalid or stale order closure/,'A count waits for review');
  f.setUser('manager');await deliveries().recount({action:'recount',companyId:'a',deliveryId:pending.receipt.deliveryId,operationId:randomUUID(),note:'Again'});
  f.sql.exec(insert(o,{release:all}));assert.equal(hold(o.a),'settled','The closure settles the hold');
}
console.log('PASS: order closure settles the in-progress hold (daily and monthly keep the cap) when the last delivery is approved or a manager closes early with a reason, releases incoming stock without adding it, ends counting, replays exactly, saves nothing on stale stock, and the database refuses unsafe closures and settlements.');
