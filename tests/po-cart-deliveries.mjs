import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';
import {errorCode} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:["d1-po-cart-deliveries","d1-po-cart-confirmations","d1-inventory-management"].map(n=>`export * from './src/lib/${n}.ts';`).join('\n'),resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-delivery-tests.mjs'});
const {D1PoCartDeliveries,D1PoCartConfirmations,D1InventoryManagementService}=await import('../.sites-runtime/po-cart-delivery-tests.mjs');

const f=await jobFixture();
const deliveries=()=>new D1PoCartDeliveries(f.db,f.options),confirmations=()=>new D1PoCartConfirmations(f.db,f.options);
const nonStock={kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'};
let clock=Date.parse('2026-10-02T12:00:00.000Z');const tick=(ms=60_000)=>{clock+=ms;f.setTime(new Date(clock).toISOString());return new Date(clock).toISOString();};
// A ready fictional cart confirmed within the cap, with one substituted extra item.
async function confirmed(productIds,extras=[{sku:'SUB-1',description:'Oat milk substitute',packs:'1',unitMinor:'100'}]){
  f.setUser('manager');tick();const lines=[];for(const id of productIds)lines.push(await f.stock(id));
  const a=await f.authorized({lines:[...lines,nonStock]});tick();
  let j=(await f.jobs().enqueue(enqueue(a))).current.job;const fence=(await f.worker().claim(operation(j))).receipt.fence;
  for(const line of j.inputs.preflight.lines){
    const begun=await f.worker().beginAttempt({...fenced(j,fence),lineId:line.lineId});
    j=(await f.worker().recordResult({...fenced(j,fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current.job;
  }
  tick();f.setUser('manager');
  const saved=await confirmations().record({action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,operationId:randomUUID(),supplierReference:'SUP-'+j.id.slice(0,8),
    expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras,charges:[],note:''});
  assert.equal(saved.receipt.state,'confirmed');tick();
  const line=id=>j.inputs.preflight.lines.find(l=>l.productId===id),supplies=j.inputs.preflight.lines.find(l=>l.kind==='non_stock');
  return {a,j,confirmationId:saved.receipt.confirmationId,line,supplies};
}
const balance=productId=>({...f.sql.prepare("SELECT on_hand_minor,incoming_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id=?").get(productId)});
const per=l=>BigInt(l.stockUnitsPerPack.minor);
const state=()=>JSON.stringify(['po_cart_deliveries','inventory_order_receipts','inventory_order_incoming','inventory_balances_exact','inventory_events_exact']
  .map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
async function refused(code,fn){const before=state();await assert.rejects(fn,errorCode(code));assert.equal(state(),before);}
const count=(confirmationId,lines,patch={})=>({action:'count',companyId:'a',confirmationId,operationId:randomUUID(),deliveredAt:new Date(clock-30_000).toISOString(),
  lines:lines.map(([lineId,receivedPacks,damagedPacks='0'])=>({lineId,receivedPacks,damagedPacks})),note:'',...patch});
const approve=(deliveryId,lines,patch={})=>({action:'approve',companyId:'a',deliveryId,operationId:randomUUID(),
  lines:lines.map(([lineId,acceptPacks,excessPacks='0',releaseRest=false])=>({lineId,acceptPacks,excessPacks,releaseRest})),note:'',...patch});
const managerView=jobId=>{f.setUser('manager');return deliveries().manager({companyId:'a',view:'manager',jobId});};
const pendingId=async jobId=>(await managerView(jobId)).deliveries.find(d=>d.state==='counted').id;

// Blind staff counts, then a manager approves part of the order into stock through A's port.
{
  const {j,confirmationId,line,supplies}=await confirmed(['beans','milk']),beans=line('beans'),milk=line('milk');
  const before={beans:balance('beans'),milk:balance('milk')};
  // Access: anonymous and other-company users see nothing; staff see names and packs only, no prices or expected amounts.
  for(const user of [null,'b-employee','b-manager']){f.setUser(user);await refused('forbidden',()=>deliveries().staff({companyId:'a',view:'staff'}));}
  f.setUser('employee');await refused('forbidden',()=>deliveries().manager({companyId:'a',view:'manager',jobId:j.id}));
  const list=await deliveries().staff({companyId:'a',view:'staff'}),order=list.orders.find(o=>o.confirmationId===confirmationId);
  assert.deepEqual(Object.keys(order).sort(),['confirmationId','expectedDelivery','lines','supplierReference','waitingForReview']);
  for(const l of order.lines)assert.deepEqual(Object.keys(l).sort(),['description','lineId','sku','unitLabel'],'Blind count: no packs or prices');
  assert.deepEqual(order.lines.map(l=>l.lineId),[beans.lineId,milk.lineId,supplies.lineId,'extra-1']);
  assert.doesNotMatch(JSON.stringify(list),/Minor|packs|Packs|price/,'Nothing about amounts reaches staff');
  // Strict counts: every listed item once, damaged within received, something arrived, a real past time.
  const all=[[beans.lineId,'1'],[milk.lineId,'3','1'],[supplies.lineId,'1'],['extra-1','0']];
  for(const input of [count(confirmationId,all.slice(1)),count(confirmationId,[...all,all[0]]),count(confirmationId,all.map(([id])=>[id,'1','2'])),
    count(confirmationId,all.map(([id])=>[id,'0'])),count(confirmationId,all,{deliveredAt:new Date(clock+3600_000).toISOString()}),
    count(confirmationId,all,{deliveredAt:'2026-10-02 12:00'}),count(confirmationId,all.map(([id])=>[id,'1.5']))])
    await refused('invalid_request',()=>deliveries().count(input));
  await refused('missing',()=>deliveries().count(count('unknown',all)));
  f.setUser('b-employee');await refused('forbidden',()=>deliveries().count(count(confirmationId,all)));
  f.setUser('employee');const input=count(confirmationId,all,{note:'One milk pack crushed'}),saved=await deliveries().count(input);
  assert.equal(saved.receipt.state,'counted');assert.deepEqual(await deliveries().count(input),saved,'Exact replay');
  await refused('conflict',()=>deliveries().count({...input,note:'Different'}));
  await refused('conflict',()=>deliveries().count(count(confirmationId,all)),'One pending count per order');
  assert.equal((await deliveries().staff({companyId:'a',view:'staff'})).orders.find(o=>o.confirmationId===confirmationId).waitingForReview,true);
  assert.deepEqual(balance('beans'),before.beans,'A count alone never changes stock');
  // Only owners and managers decide; staff cannot approve or post stock.
  const id=saved.receipt.deliveryId,decision=[[beans.lineId,'1'],[milk.lineId,'2'],[supplies.lineId,'1'],['extra-1','0','0',true]];
  for(const user of [null,'employee','b-manager']){f.setUser(user);await refused('forbidden',()=>deliveries().approve(approve(id,decision)));}
  f.setUser('manager');
  const view=await managerView(j.id);
  assert.deepEqual(view.lines.map(l=>[l.kind,l.confirmedPacks,l.owedPacks]),[['stock',beans.packs,beans.packs],['stock',milk.packs,milk.packs],['non_stock','1','1'],['extra','1','1']]);
  assert.deepEqual(view.deliveries[0].count.find(l=>l.lineId===milk.lineId),{lineId:milk.lineId,receivedPacks:'3',damagedPacks:'1'});
  for(const bad of [decision.slice(1),[[beans.lineId,'2'],...decision.slice(1)],[[beans.lineId,'0'],[milk.lineId,'3'],...decision.slice(2)],
    [[beans.lineId,'1','1'],...decision.slice(1)],[decision[0],[milk.lineId,'2','1'],...decision.slice(2)]])
    await refused('invalid_request',()=>deliveries().approve(approve(id,bad)));
  const approval=approve(id,decision,{note:'Beans short; substitute not coming'}),done=await deliveries().approve(approval);
  assert.equal(done.receipt.state,'approved');assert.deepEqual(await deliveries().approve(approval),done,'Exact replay');
  await refused('conflict',()=>deliveries().approve(approve(id,decision)),'A count is decided once');
  await refused('conflict',()=>deliveries().recount({action:'recount',companyId:'a',deliveryId:id,operationId:randomUUID(),note:'Late'}));
  assert.deepEqual(balance('beans'),{on_hand_minor:String(BigInt(before.beans.on_hand_minor)+per(beans)),incoming_minor:String(BigInt(before.beans.incoming_minor)-per(beans))});
  assert.deepEqual(balance('milk'),{on_hand_minor:String(BigInt(before.milk.on_hand_minor)+2n*per(milk)),incoming_minor:String(BigInt(before.milk.incoming_minor)-2n*per(milk))},'Damaged pack never enters stock');
  const after=await managerView(j.id);
  assert.deepEqual(after.lines.map(l=>[l.acceptedPacks,l.releasedPacks,l.owedPacks]),[['1','0',String(BigInt(beans.packs)-1n)],[milk.packs,'0','0'],['1','0','0'],['0','1','0']]);
  assert.equal(after.complete,false);
  const d=after.deliveries[0];assert.deepEqual([d.state,d.countedBy,d.decidedBy,d.stockAdded,d.decisionNote],['approved','employee','manager',true,'Beans short; substitute not coming']);
  for(const sql of ["UPDATE po_cart_deliveries SET count_note='x'","UPDATE po_cart_deliveries SET state='recount'","DELETE FROM po_cart_deliveries"])assert.throws(()=>f.sql.exec(sql),/delivery decision|permanent/,sql);
  // The rest arrives with one extra pack; the manager counts it alone and approves it (both recorded).
  f.setUser('employee');assert.deepEqual((await deliveries().staff({companyId:'a',view:'staff'})).orders.find(o=>o.confirmationId===confirmationId).lines.map(l=>l.lineId),[beans.lineId]);
  f.setUser('manager');tick();const second=await deliveries().count(count(confirmationId,[[beans.lineId,String(BigInt(beans.packs))]]));
  const mid=balance('beans');
  await refused('invalid_request',()=>deliveries().approve(approve(second.receipt.deliveryId,[[beans.lineId,'1','1',true]])));
  await deliveries().approve(approve(second.receipt.deliveryId,[[beans.lineId,'1','1']]));
  assert.deepEqual(balance('beans'),{on_hand_minor:String(BigInt(mid.on_hand_minor)+2n*per(beans)),incoming_minor:String(BigInt(mid.incoming_minor)-per(beans))},'Excess adds stock only');
  const final=await managerView(j.id);assert.equal(final.complete,true);assert.equal(final.deliveries[1].countedBy,final.deliveries[1].decidedBy,'Self-approval is allowed and recorded');
  f.setUser('employee');assert.equal((await deliveries().staff({companyId:'a',view:'staff'})).orders.some(o=>o.confirmationId===confirmationId),false,'Nothing left to count');
  await refused('conflict',()=>deliveries().count(count(confirmationId,[[beans.lineId,'1']])));
}
// A recount needs a reason, changes no stock and lets staff count again.
{
  const {j,confirmationId,line,supplies}=await confirmed(['cups'],[]),cups=line('cups'),before=balance('cups');
  f.setUser('employee');const first=await deliveries().count(count(confirmationId,[[cups.lineId,'1'],[supplies.lineId,'0']]));
  f.setUser('employee');await refused('forbidden',()=>deliveries().recount({action:'recount',companyId:'a',deliveryId:first.receipt.deliveryId,operationId:randomUUID(),note:'Again'}));
  f.setUser('manager');await refused('invalid_request',()=>deliveries().recount({action:'recount',companyId:'a',deliveryId:first.receipt.deliveryId,operationId:randomUUID(),note:' '}));
  const recount=await deliveries().recount({action:'recount',companyId:'a',deliveryId:first.receipt.deliveryId,operationId:randomUUID(),note:'Count the back shelf too'});
  assert.equal(recount.receipt.state,'recount');assert.deepEqual(balance('cups'),before);
  f.setUser('employee');tick();const again=await deliveries().count(count(confirmationId,[[cups.lineId,'2'],[supplies.lineId,'1']]));
  f.setUser('manager');await deliveries().approve(approve(again.receipt.deliveryId,[[cups.lineId,'2'],[supplies.lineId,'1']]));
  assert.equal(BigInt(balance('cups').on_hand_minor)-BigInt(before.on_hand_minor),2n*per(cups));
  assert.deepEqual((await managerView(j.id)).deliveries.map(d=>[d.state,d.stockAdded]),[['recount',false],['approved',true]]);
}
// Count cutoff, end to end: a physical count after the delivery already included it.
{
  const {confirmationId,line,supplies}=await confirmed(['flour'],[]),flour=line('flour');
  f.setUser('employee');const delivered=tick();tick();
  const saved=await deliveries().count(count(confirmationId,[[flour.lineId,flour.packs],[supplies.lineId,'1']],{deliveredAt:delivered}));
  const inventory=new D1InventoryManagementService(f.db,f.options),v=f.sql.prepare("SELECT version FROM inventory_balances_exact WHERE company_id='a' AND product_id='flour'").get().version;
  f.setUser('manager');tick();await inventory.recordCount({companyId:'a',productId:'flour',operationId:'count-flour',expectedVersion:v,actor:'manager',amount:'30',unitId:'each',effectiveAt:new Date(clock-10_000).toISOString(),note:'Shelf count'});
  const before=balance('flour');tick();
  await deliveries().approve(approve(saved.receipt.deliveryId,[[flour.lineId,flour.packs],[supplies.lineId,'1']]));
  assert.deepEqual(balance('flour'),{on_hand_minor:before.on_hand_minor,incoming_minor:String(BigInt(before.incoming_minor)-BigInt(flour.packs)*per(flour))},'Counted stock is not added twice');
}
// A stock change between preparing and saving an approval saves nothing; a lost acknowledgment replays.
{
  const {confirmationId,line,supplies}=await confirmed(['sugar'],[]),sugar=line('sugar');
  f.setUser('employee');const saved=await deliveries().count(count(confirmationId,[[sugar.lineId,'1'],[supplies.lineId,'1']]));
  f.setUser('manager');const batch=f.db.batch.bind(f.db);
  f.db.batch=async statements=>{f.db.batch=batch;f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='sugar'");return batch(statements);};
  const records=()=>JSON.stringify(['po_cart_deliveries','inventory_order_receipts','inventory_order_incoming','inventory_events_exact'].map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
  const kept=records(),stock=balance('sugar');
  await assert.rejects(deliveries().approve(approve(saved.receipt.deliveryId,[[sugar.lineId,'1'],[supplies.lineId,'1']])),errorCode('conflict'));
  assert.equal(f.db.batch,batch);assert.equal(records(),kept,'Nothing saved');assert.deepEqual(balance('sugar'),stock);
  const input=approve(saved.receipt.deliveryId,[[sugar.lineId,'1'],[supplies.lineId,'1']]);
  f.db.batch=async statements=>{if(statements.some(st=>st.query.includes('UPDATE po_cart_deliveries'))){f.db.batch=batch;f.db.loseAcknowledgment=true;}return batch(statements);};
  const replayed=await deliveries().approve(input);assert.equal(f.db.batch,batch,'The lost acknowledgment was injected on the save');assert.equal(replayed.receipt.state,'approved');
  // A revoked manager can no longer decide or read.
  f.sql.exec("INSERT INTO memberships(user_id,company_id,role) VALUES('temp-manager','a','manager')");f.setUser('temp-manager');
  const second=await deliveries().count(count(confirmationId,[[sugar.lineId,'1']]));
  f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='temp-manager'");
  await refused('forbidden',()=>deliveries().approve(approve(second.receipt.deliveryId,[[sugar.lineId,'1']])));
  await refused('forbidden',()=>deliveries().staff({companyId:'a',view:'staff'}));
}
// The database refuses counts for orders that are not confirmed within the cap, and decisions by staff.
{
  const {j,confirmationId}=await confirmed(['rice'],[]),at=new Date(clock).toISOString();
  const insert=(user,confirmation=confirmationId,job=j.id,state='counted')=>`INSERT INTO po_cart_deliveries(company_id,id,confirmation_id,job_id,delivered_at,count_json,count_note,counted_by,counted_at,count_operation_id,count_fingerprint,state)
    VALUES('a','raw-${user}-${state}','${confirmation}','${job}','${at}','[{"lineId":"x"}]','','${user}','${at}','op-${user}-${state}','fp','${state}')`;
  for(const sql of [insert('b-employee'),insert('employee',confirmationId,'other-job'),insert('employee',confirmationId,j.id,'approved')])assert.throws(()=>f.sql.exec(sql),/Invalid delivery count|FOREIGN KEY/,sql);
  f.sql.exec(insert('employee'));
  assert.throws(()=>f.sql.exec(`UPDATE po_cart_deliveries SET state='approved',decision_json='[]',decision_note='',stock_receipt=0,decided_by='employee',decided_at='${at}',decision_operation_id='d',decision_fingerprint='f' WHERE id='raw-employee-counted'`),/delivery decision/);
  assert.throws(()=>f.sql.exec(`UPDATE po_cart_deliveries SET state='approved',decision_json='[]',decision_note='',stock_receipt=1,decided_by='manager',decided_at='${at}',decision_operation_id='d',decision_fingerprint='f' WHERE id='raw-employee-counted'`),/delivery decision/,'Stock receipts must exist');
  assert.throws(()=>f.sql.exec("INSERT INTO po_cart_delivery_guards(reason) VALUES('x')"),/delivery changed/);
}
console.log('PASS: delivery receiving lets staff count blind without amounts or prices, lets only owners and managers approve or ask for a recount, posts accepted, released and excess stock once through A\'s port, keeps damaged packs and counted stock out, replays exactly and saves nothing on stale stock.');
