import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';
import {errorCode} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:["d1-po-cart-confirmations","d1-po-cart-deliveries"].map(n=>`export * from './src/lib/${n}.ts';`).join('\n'),resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-over-cap-tests.mjs'});
const {D1PoCartConfirmations,D1PoCartDeliveries}=await import('../.sites-runtime/po-cart-over-cap-tests.mjs');

const f=await jobFixture();let verifiedAt=null;
const confirmations=()=>new D1PoCartConfirmations(f.db,{...f.options,reauthentication:async()=>verifiedAt===null?null:{reauthenticatedAt:verifiedAt}});
const nonStock={kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'};
let clock=Date.parse('2026-10-02T12:00:00.000Z');const tick=(ms=60_000)=>{clock+=ms;f.setTime(new Date(clock).toISOString());};
async function ready(productIds,capMinor){
  f.setUser('manager');tick();const lines=[];for(const id of productIds)lines.push(await f.stock(id));
  const a=await f.authorized({lines:[...lines,nonStock],capMinor});tick();
  let j=(await f.jobs().enqueue(enqueue(a))).current.job;const fence=(await f.worker().claim(operation(j))).receipt.fence;
  for(const line of j.inputs.preflight.lines){
    const begun=await f.worker().beginAttempt({...fenced(j,fence),lineId:line.lineId});
    j=(await f.worker().recordResult({...fenced(j,fence),attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current.job;
  }
  tick();return {a,j};
}
// Records what the supplier confirmed, with a tax charge that takes it over the cap.
async function overCap(productId,capMinor='1000',tax='900'){
  const {a,j}=await ready([productId],capMinor);f.setUser('manager');
  const saved=await confirmations().record({action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,operationId:randomUUID(),supplierReference:'SUP-'+j.id.slice(0,8),
    expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[{kind:'tax',description:'',amountMinor:tax}],note:''});
  assert.equal(saved.receipt.state,'needs_owner_review');tick();
  const row=f.sql.prepare('SELECT id,total_minor,cap_minor FROM po_cart_confirmations WHERE job_id=?').get(j.id);
  return {a,j,id:saved.receipt.confirmationId,total:row.total_minor,cap:row.cap_minor,line:j.inputs.preflight.lines.find(l=>l.productId===productId)};
}
const incoming=productId=>f.sql.prepare("SELECT incoming_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id=?").get(productId).incoming_minor;
const active=id=>f.sql.prepare("SELECT COUNT(*) AS n FROM po_cart_commitments WHERE company_id='a' AND authorization_id=? AND active=1").get(id).n;
const hold=id=>({...f.sql.prepare("SELECT state,total_minor FROM po_cart_reservations WHERE company_id='a' AND authorization_id=?").get(id)});
const state=()=>JSON.stringify(['po_cart_confirmation_reviews','po_cart_reservations','po_cart_commitments','inventory_order_incoming','inventory_balances_exact']
  .map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
async function refused(code,fn){const before=state();await assert.rejects(fn,errorCode(code));assert.equal(state(),before);}
const approve=(id,note='')=>({action:'approve_over_cap',companyId:'a',confirmationId:id,operationId:randomUUID(),note});
const holdNote=(id,note)=>({action:'hold_note',companyId:'a',confirmationId:id,operationId:randomUUID(),note});
const view=async j=>(await confirmations().get({companyId:'a',jobId:j.id})).confirmation;

// The owner approves after confirming their password; managers and others never can.
{
  const {a,j,id,total,cap,line}=await overCap('rice'),before=incoming('rice');
  f.setUser('manager');const seen=await view(j);
  assert.deepEqual([seen.canReview,seen.approval,seen.notes],[false,null,[]],'A manager sees it waiting for the owner');
  f.setUser('owner');assert.equal((await view(j)).canReview,true);
  for(const user of [null,'manager','employee','b-owner']){f.setUser(user);verifiedAt=clock;
    await refused('forbidden',()=>confirmations().approveOverCap(approve(id)));await refused('forbidden',()=>confirmations().holdOverCap(holdNote(id,'Not yet')));}
  f.setUser('owner');verifiedAt=null;await refused('reauthentication_required',()=>confirmations().approveOverCap(approve(id)));
  verifiedAt=clock-6*60_000;await refused('reauthentication_required',()=>confirmations().approveOverCap(approve(id)),'A password confirmed over five minutes ago');
  // Left held with a note: nothing else changes.
  await refused('invalid_request',()=>confirmations().holdOverCap(holdNote(id,' ')));
  const noteInput=holdNote(id,'Ask the supplier to drop the tax line'),noted=await confirmations().holdOverCap(noteInput);
  assert.equal(noted.receipt.kind,'note');assert.deepEqual(await confirmations().holdOverCap(noteInput),noted,'Exact replay');
  await refused('conflict',()=>confirmations().holdOverCap({...noteInput,note:'Different'}));
  assert.deepEqual([hold(a.id),incoming('rice'),active(a.id)],[{state:'reserved',total_minor:cap},before,1]);
  assert.deepEqual((await view(j)).notes.map(n=>[n.by,n.note]),[['owner','Ask the supplier to drop the tax line']]);
  // Approval: the held amount rises to the confirmed total, incoming is added once, product holds end.
  verifiedAt=clock-60_000;tick();const input=approve(id,'Supplier raised prices'),approved=await confirmations().approveOverCap(input);
  assert.equal(approved.receipt.kind,'approved');assert.deepEqual(await confirmations().approveOverCap(input),approved,'Exact replay');
  assert.deepEqual(hold(a.id),{state:'reserved',total_minor:total},'The full total now counts toward the limits');
  assert.equal(BigInt(incoming('rice'))-BigInt(before),BigInt(line.packs)*BigInt(line.stockUnitsPerPack.minor));assert.equal(active(a.id),0);
  const after=await view(j);assert.deepEqual([after.approval.by,after.approval.totalMinor,after.approval.note,after.canReview],['owner',total,'Supplier raised prices',false]);
  await refused('conflict',()=>confirmations().approveOverCap(approve(id)));await refused('conflict',()=>confirmations().holdOverCap(holdNote(id,'Too late')));
  // The approved order is received like any confirmed one.
  f.setUser('employee');const list=await new D1PoCartDeliveries(f.db,f.options).staff({companyId:'a',view:'staff'});
  assert.ok(list.orders.some(o=>o.confirmationId===id),'Staff can count its delivery');
  f.setUser('owner');assert.equal((await new D1PoCartDeliveries(f.db,f.options).manager({companyId:'a',view:'manager',jobId:j.id})).confirmationId,id);
}
// Within the cap, there is nothing to review.
{
  const {j}=await ready(['beans'],'15000');f.setUser('manager');
  const saved=await confirmations().record({action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,operationId:randomUUID(),supplierReference:'SUP-IN-CAP',
    expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''});
  f.setUser('owner');verifiedAt=clock;await refused('conflict',()=>confirmations().approveOverCap(approve(saved.receipt.confirmationId)));
  await refused('missing',()=>confirmations().approveOverCap(approve('unknown')));
}
// Over a limit: approval is still allowed, the overage is shown, and new carts are refused afterwards.
{
  const zone=randomUUID();f.sql.prepare('INSERT INTO company_time_zones(company_id,version,time_zone,actor,created_at,operation_id,fingerprint) VALUES(?,?,?,?,?,?,?)')
    .run('a',1,'America/New_York','owner',new Date(clock).toISOString(),zone,'fp');
  const {a,j,id,total}=await overCap('sugar','1000','60000');
  const used=f.sql.prepare("SELECT COALESCE(SUM(total_minor),0) AS n FROM po_cart_reservations WHERE company_id='a' AND state='reserved'").get().n;
  f.sql.prepare(`INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,per_day_minor,per_month_minor,actor,created_at,operation_id,fingerprint)
    VALUES('a',(SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id='a'),20000,?,?,?,'owner',?,?,'fp')`).run(used+10_000,30_000,1_000_000,new Date(clock).toISOString(),randomUUID());
  // Every order in this test started on the same New York day, so the day's use is all of them.
  const day=f.sql.prepare(`SELECT COALESCE(SUM(r.total_minor),0) AS n FROM po_cart_reservations r JOIN po_cart_authorizations x ON x.company_id=r.company_id AND x.id=r.authorization_id
    WHERE r.company_id='a' AND NOT (x.started_at IS NULL AND x.released_at IS NOT NULL)`).get().n;
  f.setUser('owner');const warned=await view(j);
  const over=Object.fromEntries(warned.warnings.map(w=>[w.limit,w.overByMinor]));
  assert.deepEqual(Object.keys(over).sort(),['in_progress','per_day','per_order'],'The month limit is not exceeded');
  assert.equal(over.per_day,day+total-1000-30_000,'That day: what it already used, plus the increase, beyond the limit');
  assert.equal(over.per_order,total-20000);assert.equal(over.in_progress,total-1000-10_000,'In progress: the increase beyond the remaining room');
  verifiedAt=clock;tick();await confirmations().approveOverCap(approve(id));assert.equal(hold(a.id).total_minor,total,'Counted even though it goes over');
  f.setUser('manager');tick();await assert.rejects(f.authorized({lines:[nonStock],capMinor:'1000'}),'A new cart no longer fits');
  f.sql.prepare(`INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,per_day_minor,per_month_minor,actor,created_at,operation_id,fingerprint)
    VALUES('a',(SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id='a'),50000,10000000,10000000,10000000,'owner',?,?,'fp')`).run(new Date(clock).toISOString(),randomUUID());
}
// A stock change while approving saves nothing; a lost acknowledgment replays.
{
  const {a,id}=await overCap('flour'),batch=f.db.batch.bind(f.db);f.setUser('owner');verifiedAt=clock;
  f.db.batch=async s=>{f.db.batch=batch;f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='flour'");return batch(s);};
  const kept=JSON.stringify(['po_cart_confirmation_reviews','po_cart_reservations','inventory_order_incoming'].map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
  await assert.rejects(confirmations().approveOverCap(approve(id)),errorCode('conflict'));
  assert.equal(JSON.stringify(['po_cart_confirmation_reviews','po_cart_reservations','inventory_order_incoming'].map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all())),kept);
  f.db.batch=async s=>{f.db.batch=batch;f.db.loseAcknowledgment=true;return batch(s);};
  assert.equal((await confirmations().approveOverCap(approve(id))).receipt.kind,'approved');assert.equal(f.db.batch,batch);
  assert.equal(hold(a.id).state,'reserved');
}
// The database refuses unsafe reviews, raises and receiving of unapproved over-cap orders.
{
  const {a,j,id,total,cap}=await overCap('oil'),at=new Date(clock).toISOString();
  const insert=(o={})=>{const r={company_id:'a',id:randomUUID(),confirmation_id:id,kind:'approved',approved_total_minor:total,note:'',actor:'owner',created_at:at,
    reauthenticated_at:new Date(clock-60_000).toISOString(),operation_id:randomUUID(),fingerprint:'fp',...o};
    return ()=>f.sql.prepare(`INSERT INTO po_cart_confirmation_reviews(${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`).run(...Object.values(r));};
  for(const [why,o] of [['manager',{actor:'manager'}],['wrong total',{approved_total_minor:total-1}],['no password confirmation',{reauthenticated_at:null}],
    ['old password confirmation',{reauthenticated_at:new Date(clock-6*60_000).toISOString()}],['confirmation after the approval',{reauthenticated_at:new Date(clock+1000).toISOString()}],
    ['blank note',{kind:'note',approved_total_minor:null,reauthenticated_at:null,note:' '}],['note with a total',{kind:'note',reauthenticated_at:null,note:'x'}],
    ['unknown kind',{kind:'rejected'}],['another company',{company_id:'b',actor:'b-owner'}]])
    assert.throws(insert(o),/Invalid or stale over-cap review|FOREIGN KEY/,why);
  const at2=new Date(clock).toISOString();
  assert.throws(()=>f.sql.prepare(`INSERT INTO po_cart_deliveries(company_id,id,confirmation_id,job_id,delivered_at,count_json,count_note,counted_by,counted_at,count_operation_id,count_fingerprint,state)
    VALUES('a','raw-count',?,?,?,'[{"lineId":"x"}]','','employee',?,'raw-op','fp','counted')`).run(id,j.id,at2,at2),/Invalid delivery count/,'No counting before approval');
  assert.throws(()=>f.sql.prepare("UPDATE po_cart_reservations SET total_minor=? WHERE company_id='a' AND authorization_id=?").run(total,a.id),/Unsafe cart exposure/,'No raise without approval');
  // Nor can it be closed (which would settle its hold) before approval, even marking everything as not arriving.
  const release=JSON.stringify(j.inputs.preflight.lines.map(l=>({lineId:l.lineId,releasePacks:l.packs})));
  assert.throws(()=>f.sql.prepare(`INSERT INTO po_cart_order_closures(company_id,confirmation_id,job_id,authorization_id,kind,release_json,stock_receipt,note,closed_by,closed_at,operation_id,fingerprint)
    VALUES('a',?,?,?,'closed_short',?,0,'Not coming','owner',?,?,'fp')`).run(id,j.id,a.id,release,at2,randomUUID()),/Invalid or stale order closure/,'No closing before approval');
  assert.throws(()=>f.sql.prepare("UPDATE po_cart_commitments SET active=0 WHERE company_id='a' AND authorization_id=?").run(a.id),/Unsafe cart commitment release/,'Holds stay before approval');
  insert()();assert.equal(hold(a.id).total_minor,total,'The approval raised the hold');
  assert.throws(insert({kind:'note',approved_total_minor:null,reauthenticated_at:null,note:'Later'}),/over-cap review/,'No notes after approval');
  assert.throws(insert(),/over-cap review|UNIQUE/,'One approval');
  assert.throws(()=>f.sql.prepare("UPDATE po_cart_reservations SET total_minor=? WHERE company_id='a' AND authorization_id=?").run(total+1,a.id),/Unsafe cart exposure/,'Only the approved total');
  for(const sql of ["UPDATE po_cart_confirmation_reviews SET note='x'","DELETE FROM po_cart_confirmation_reviews"])assert.throws(()=>f.sql.exec(sql),/permanent/,sql);
  assert.equal(cap<total,true);
}
console.log('PASS: over-cap confirmations: owner-only review (managers see it waiting), password confirmed within five minutes, held-with-a-note changes nothing, approval raises the held amount to the confirmed total, adds incoming once and releases product holds, receiving follows, limit overages are shown yet counted, stale stock saves nothing, lost acknowledgments replay, and the database refuses unsafe reviews, raises and counts.');
