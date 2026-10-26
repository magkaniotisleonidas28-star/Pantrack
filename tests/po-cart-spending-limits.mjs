import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {cartFixture,command,cancelCommand,errorCode} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:['d1-po-cart-spending-limits','po-cart-spending-limits-contract','reauthentication']
  .map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-spending-limits-tests.mjs'});
const limitsCore=await import('../.sites-runtime/po-cart-spending-limits-tests.mjs');
const {spendingWindow,validTimeZone,loosens,SPENDING_LIMIT_NOTICE}=limitsCore;

// Windows: exact US DST days, a non-DST zone, month/year ends, and first-instant properties elsewhere.
{
  const ny=spendingWindow('2026-03-08T12:00:00.000Z','America/New_York',1);
  assert.deepEqual([ny.dayStart,ny.dayEnd],['2026-03-08T05:00:00.000Z','2026-03-09T04:00:00.000Z'],'Spring-forward day is 23 hours');
  const fall=spendingWindow('2026-11-01T12:00:00.000Z','America/New_York',1);
  assert.deepEqual([fall.dayStart,fall.dayEnd,fall.monthStart,fall.monthEnd],
    ['2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z','2026-11-01T04:00:00.000Z','2026-12-01T05:00:00.000Z'],'Fall-back day is 25 hours');
  assert.equal(spendingWindow('2026-11-01T03:59:59.999Z','America/New_York',1).monthStart,'2026-10-01T04:00:00.000Z','Last October instant stays in October');
  const tokyo=spendingWindow('2026-10-01T12:00:00.000Z','Asia/Tokyo',1);
  assert.deepEqual([tokyo.dayStart,tokyo.dayEnd,tokyo.monthStart,tokyo.monthEnd],
    ['2026-09-30T15:00:00.000Z','2026-10-01T15:00:00.000Z','2026-09-30T15:00:00.000Z','2026-10-31T15:00:00.000Z']);
  assert.equal(spendingWindow('2026-12-31T23:30:00.000Z','America/Los_Angeles',1).monthEnd,'2027-01-01T08:00:00.000Z','Year boundary');
  const local=(ms,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
  for(const timeZone of ['America/Havana','Australia/Lord_Howe','Asia/Kolkata','Pacific/Kiritimati','Pacific/Pago_Pago','UTC'])
    for(const at of ['2026-03-08T05:30:00.000Z','2026-04-05T15:00:00.000Z','2026-10-04T15:45:00.000Z','2026-11-01T05:00:00.000Z']){
      const w=spendingWindow(at,timeZone,1),start=Date.parse(w.dayStart),end=Date.parse(w.dayEnd),now=Date.parse(at);
      assert.ok(start<=now&&now<end,`${timeZone} ${at} lies inside its day`);
      assert.equal(local(start,timeZone),local(now,timeZone));assert.notEqual(local(start-1,timeZone),local(now,timeZone),`${timeZone} day starts at its first instant`);
      assert.notEqual(local(end,timeZone),local(now,timeZone));assert.equal(local(end-1,timeZone),local(now,timeZone));
      assert.ok(end-start>=22*3600_000&&end-start<=26*3600_000);
      assert.ok(Date.parse(w.monthStart)<=start&&end<=Date.parse(w.monthEnd));
    }
  for(const valid of ['America/New_York','UTC','Asia/Kolkata','Europe/Kyiv','America/Argentina/Buenos_Aires','Etc/GMT+5'])assert.equal(validTimeZone(valid),true,valid);
  for(const invalid of ['america/new_york','Mars/Base','EST5EDT; DROP','','US/Eastern ',' UTC','A'.repeat(65)])assert.equal(validTimeZone(invalid),false,invalid);
  const kolkata=spendingWindow('2026-10-01T12:00:00.000Z','Asia/Kolkata',1);assert.equal(kolkata.dayStart,'2026-09-30T18:30:00.000Z','A linked name computes its zone');
}
// Loosening: anything other than tightening an owner-set policy.
{
  const prev={version:2,perOrderMinor:100,perDayMinor:200,perMonthMinor:300,outstandingMinor:400,ownerSet:true,actor:'owner',createdAt:'x'};
  const next=patch=>({action:'set_limits',companyId:'a',operationId:randomUUID(),expectedVersion:2,perOrderMinor:100,perDayMinor:200,perMonthMinor:300,outstandingMinor:400,...patch});
  assert.equal(loosens(prev,next({})),false);assert.equal(loosens(prev,next({perOrderMinor:99,perDayMinor:150,perMonthMinor:250,outstandingMinor:300})),false);
  for(const p of [{perOrderMinor:101},{perDayMinor:201},{perMonthMinor:301},{perMonthMinor:null},{outstandingMinor:401}])assert.equal(loosens(prev,next(p)),true,JSON.stringify(p));
  assert.equal(loosens({...prev,perMonthMinor:null},next({perMonthMinor:300})),false,'Adding a month limit tightens');
  assert.equal(loosens(null,next({})),true);assert.equal(loosens({...prev,ownerSet:false,perDayMinor:null,perMonthMinor:null},next({})),true,'Replacing a test policy is a first setup');
}

const f=await cartFixture();
let who='manager',at='2026-10-01T12:00:00.000Z',verifiedAt=null,recovery=false;
const as=user=>{who=user;f.setUser(user);},time=value=>{at=value;f.setTime(value);};
const verify=(ago=60_000)=>{verifiedAt=Date.parse(at)-ago;};
const limits=()=>new limitsCore.D1PoCartSpendingLimits(f.db,{clock:f.options.clock,
  identity:async()=>who?{userId:who,reauthenticatedAt:verifiedAt??undefined,recovery}:null});
const policies=()=>JSON.stringify(f.sql.prepare('SELECT * FROM po_cart_budget_policies ORDER BY company_id,version').all());
const zones=()=>JSON.stringify(f.sql.prepare('SELECT * FROM company_time_zones ORDER BY company_id,version').all());
const audits=action=>f.sql.prepare('SELECT company_id,actor,target FROM security_audit WHERE action=? ORDER BY created,target').all(action).map(r=>({...r}));
async function unchanged(code,fn){const before=policies()+zones();await assert.rejects(fn,errorCode(code));assert.equal(policies()+zones(),before);}
const zone=(timeZone,expectedVersion,extra={})=>({action:'set_time_zone',companyId:'a',operationId:randomUUID(),expectedVersion,timeZone,...extra});
const set=(expectedVersion,patch={})=>({action:'set_limits',companyId:'a',operationId:randomUUID(),expectedVersion,
  perOrderMinor:20_000,perDayMinor:30_000,perMonthMinor:50_000,outstandingMinor:100_000,...patch});

// Owner only, for reads and writes, before and after verification.
for(const user of [null,'manager','employee','b-owner','nobody']){
  as(user);verify();
  await assert.rejects(limits().get({companyId:'a'}),errorCode('forbidden'));
  await unchanged('forbidden',()=>limits().setTimeZone(zone('America/New_York',0)));
  await unchanged('forbidden',()=>limits().setLimits(set(1)));
}
as('owner');verifiedAt=null;
let view=await limits().get({companyId:'a'});
assert.equal(view.timeZone,null);assert.equal(view.usage,null);assert.equal(view.notice,SPENDING_LIMIT_NOTICE);
assert.deepEqual(view.limits,{version:1,perOrderMinor:50000,perDayMinor:null,perMonthMinor:null,outstandingMinor:100000,ownerSet:false,actor:null,createdAt:null});
await assert.rejects(limits().get({companyId:'a',extra:'x'}),errorCode('invalid_request'));

// Time zone: always needs a recent, non-recovery password confirmation.
await unchanged('time_zone_required',()=>{verify();return limits().setLimits(set(1));});
verifiedAt=null;await unchanged('reauthentication_required',()=>limits().setTimeZone(zone('America/New_York',0)));
verify(5*60_000+1);await unchanged('reauthentication_required',()=>limits().setTimeZone(zone('America/New_York',0)));
verify();recovery=true;await unchanged('reauthentication_required',()=>limits().setTimeZone(zone('America/New_York',0)));recovery=false;
for(const timeZone of ['america/new_york','Mars/Base','US/Eastern ',''])await unchanged('invalid_request',()=>limits().setTimeZone(zone(timeZone,0)));
await unchanged('conflict',()=>limits().setTimeZone(zone('America/New_York',1)));
const firstZone=zone('America/New_York',0);
const z1=await limits().setTimeZone(firstZone);
assert.deepEqual({...z1.receipt},{operationId:firstZone.operationId,action:'set_time_zone',version:1,actor:'owner',at});
verifiedAt=null;assert.deepEqual(await limits().setTimeZone(firstZone),z1,'Exact replay returns the original receipt without asking again');
await unchanged('conflict',()=>limits().setTimeZone({...firstZone,timeZone:'Asia/Tokyo'}));
verify();await unchanged('invalid_request',()=>limits().setTimeZone(zone('America/New_York',1)));

// Limits: first setup and loosening need the password; tightening does not.
verifiedAt=null;await unchanged('reauthentication_required',()=>limits().setLimits(set(1)));
await unchanged('invalid_request',()=>limits().setLimits(set(1,{perOrderMinor:30_001})));
await unchanged('invalid_request',()=>limits().setLimits(set(1,{perMonthMinor:29_999})));
await unchanged('invalid_request',()=>limits().setLimits(set(1,{outstandingMinor:19_999})));
await unchanged('invalid_request',()=>limits().setLimits(set(1,{perDayMinor:30_000.5})));
verify();await unchanged('conflict',()=>limits().setLimits(set(0)));
const first=set(1),l2=await limits().setLimits(first);
assert.equal(l2.receipt.version,2);assert.equal(l2.current.limits.ownerSet,true);assert.equal(l2.current.limits.actor,'owner');
verifiedAt=null;assert.deepEqual(await limits().setLimits(first),l2);
await unchanged('conflict',()=>limits().setLimits({...first,perDayMinor:25_000}));
const l3=await limits().setLimits(set(2,{perOrderMinor:15_000,perDayMinor:25_000,perMonthMinor:40_000,outstandingMinor:90_000}));
assert.equal(l3.receipt.version,3,'Tightening needs no password');
for(const p of [{perOrderMinor:15_001},{perDayMinor:25_001},{perMonthMinor:40_001},{perMonthMinor:null},{outstandingMinor:90_001}])
  await unchanged('reauthentication_required',()=>limits().setLimits(set(3,{perOrderMinor:15_000,perDayMinor:25_000,perMonthMinor:40_000,outstandingMinor:90_000,...p})));
verify();const l4=await limits().setLimits(set(3));assert.equal(l4.receipt.version,4);
view=await limits().get({companyId:'a'});
assert.deepEqual(view.history.map(h=>[h.version,h.ownerSet]),[[4,true],[3,true],[2,true],[1,false]]);
assert.deepEqual(view.usage.window,spendingWindow(at,'America/New_York',1));
assert.deepEqual(audits('spending_limits.changed').map(a=>a.target),['version 2','version 3','version 4']);
assert.deepEqual(audits('company_time_zone.changed'),[{company_id:'a',actor:'owner',target:'version 1'}]);

// The database refuses edits, deletes, fixture rows over owner rows, and malformed owner rows.
for(const sql of ["UPDATE po_cart_budget_policies SET per_day_minor=1 WHERE company_id='a' AND version=4",
  "DELETE FROM po_cart_budget_policies WHERE company_id='a' AND version=4","UPDATE company_time_zones SET time_zone='UTC'",
  "DELETE FROM company_time_zones",
  "INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES('a',5,50000,100000)",
  `INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,per_day_minor,actor,created_at,operation_id,fingerprint) VALUES('a',5,100,1000,500,'manager','${at}','${randomUUID()}','x')`,
  `INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,actor,created_at,operation_id,fingerprint) VALUES('a',5,100,1000,'owner','${at}','${randomUUID()}','x')`,
  `INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,per_day_minor,per_month_minor,actor,created_at,operation_id,fingerprint) VALUES('a',5,100,1000,500,400,'owner','${at}','${randomUUID()}','x')`,
  `INSERT INTO company_time_zones VALUES('a',2,'Asia/Tokyo','manager','${at}','${randomUUID()}','x')`,
  `INSERT INTO company_time_zones VALUES('a',2,'Asia/Tokyo; x','owner','${at}','${randomUUID()}','x')`,
  `INSERT INTO company_time_zones VALUES('a',3,'Asia/Tokyo','owner','${at}','${randomUUID()}','x')`,
])assert.throws(()=>f.sql.exec(sql),/immutable|Invalid/,sql);

// Enforcement: per order 200.00, day 300.00, month 500.00, in progress 1000.00 (version 4).
as('manager');
const authorize=async cap=>(await f.service().authorize(command(await f.reviewed({capMinor:String(cap)})))).current.authorization;
const refused=async(cap,label)=>{const before=f.sql.prepare('SELECT COUNT(*) AS n FROM po_cart_reservations').get().n;
  await assert.rejects(authorize(cap),e=>e.code==='limit_exceeded'&&e.message.includes(label)&&(who==='owner'?e.message.includes('$'):!e.message.includes('$')),label);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM po_cart_reservations').get().n,before);};
await refused(20_001,'per-order');
const a1=await authorize(20_000);assert.equal(a1.inputs.policy.perDayMinor,30_000);assert.deepEqual(a1.inputs.window,spendingWindow(at,'America/New_York',1));
const a2=await authorize(10_000);await refused(100,'daily');
as('owner');await assert.rejects(authorize(100),e=>e.code==='limit_exceeded'&&e.message.includes('$0.00 of $300.00 remains'));as('manager');
await f.service().cancel(cancelCommand(a2));const a3=await authorize(10_000);
assert.ok(a3,'Canceled-before-start work frees daily budget');
await f.service().markPreparationStarted({action:'start',companyId:'a',authorizationId:a3.id,expectedRevision:a3.revision,operationId:randomUUID()});
const started=(await f.service().get({companyId:'a',orderId:a3.orderId})).authorization;
await f.service().cancel(cancelCommand(started));await refused(100,'daily');
as('owner');assert.equal((await limits().get({companyId:'a'})).usage.dayMinor,30_000,'Started work still counts after cancellation');as('manager');
time('2026-10-02T03:59:59.999Z');await refused(100,'daily');
time('2026-10-02T04:00:00.000Z');const a4=await authorize(20_000);assert.ok(a4,'A new café day starts at local midnight');
await refused(5_000,'monthly');
time('2026-10-31T23:00:00.000Z');await refused(1_000,'monthly');
time('2026-11-01T04:00:00.000Z');const a5=await authorize(20_000);assert.ok(a5,'A new café month starts on the fall-back day');
as('owner');view=await limits().get({companyId:'a'});
assert.deepEqual([view.usage.dayMinor,view.usage.monthMinor,view.usage.outstandingMinor],[20_000,20_000,70_000]);
assert.equal(view.usage.window.dayEnd,'2026-11-02T05:00:00.000Z');

// In progress: tightening below current exposure blocks new work at once.
verifiedAt=null;await limits().setLimits(set(4,{outstandingMinor:70_000}));as('manager');await refused(100,'in-progress');

// The reservation guard is authoritative even if the service pre-check is skipped or its window is wrong.
as('owner');verify();await limits().setLimits(set(5,{outstandingMinor:1_000_000_000}));as('manager');
const bypass=window=>{const s=f.service();s.ownerLimits=async(companyId,_actor,_policy,_cap,stamp)=>{
  const zoneRow=f.sql.prepare('SELECT version,time_zone FROM company_time_zones WHERE company_id=? ORDER BY version DESC LIMIT 1').get(companyId);
  return window(spendingWindow(stamp,zoneRow.time_zone,zoneRow.version),stamp);};return s;};
const forced=async(window,cap=1_000)=>{const before=f.sql.prepare('SELECT COUNT(*) AS n FROM po_cart_authorizations').get().n;
  const order=await f.reviewed({capMinor:String(cap)});await assert.rejects(bypass(window).authorize(command(order)),errorCode('conflict'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM po_cart_authorizations').get().n,before);};
await forced(w=>w,15_000);
await forced(w=>({...w,timeZoneVersion:7}));await forced(w=>({...w,timeZone:'Asia/Tokyo'}));
await forced(w=>({...w,dayStart:w.dayEnd}));await forced(w=>({...w,dayEnd:new Date(Date.parse(w.dayStart)+30*3600_000).toISOString()}));
await forced(w=>({...w,monthStart:w.dayEnd}));await forced(w=>({...w,dayStart:'2026-11-01'}));
await forced(()=>undefined);
assert.ok(await bypass(w=>w).authorize(command(await f.reviewed({capMinor:'1000'}))),'Control: a correct window commits');
time('2026-11-02T12:00:00.000Z');await authorize(20_000);await forced(w=>w,10_000);
assert.ok(await bypass(w=>w).authorize(command(await f.reviewed({capMinor:'1000'}))),'Control: within the day and month');

// A time-zone change between the pre-check and the commit refuses the authorization.
{
  const order=await f.reviewed({capMinor:'1000'}),before=f.sql.prepare('SELECT COUNT(*) AS n FROM po_cart_authorizations').get().n;
  const s=f.service(),precheck=s.ownerLimits.bind(s);
  s.ownerLimits=async(...args)=>{const window=await precheck(...args);
    f.sql.prepare('INSERT INTO company_time_zones VALUES(?,?,?,?,?,?,?)').run('a',2,'Asia/Tokyo','owner',at,randomUUID(),'race');return window;};
  await assert.rejects(s.authorize(command(order)),errorCode('conflict'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM po_cart_authorizations').get().n,before);
  const after=await f.service().authorize(command(order));assert.equal(after.current.authorization.inputs.window.timeZone,'Asia/Tokyo');
}
// Concurrent authorizations for the last daily budget: exactly one commits.
{
  as('owner');time('2026-11-05T12:00:00.000Z');verify();
  await limits().setLimits(set(6,{perOrderMinor:20_000,perDayMinor:20_000,perMonthMinor:null,outstandingMinor:1_000_000_000}));as('manager');
  const orders=[await f.reviewed({capMinor:'15000'}),await f.reviewed({capMinor:'15000'})];
  const results=await Promise.allSettled(orders.map(o=>f.service().authorize(command(o))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(['conflict','limit_exceeded'].includes(results.find(r=>r.status==='rejected').reason.code));
  as('owner');assert.equal((await limits().get({companyId:'a'})).usage.dayMinor,15_000);
}
// An owner demoted between the service check and the commit saves nothing.
{
  as('owner');verify();const before=policies()+zones();
  f.db.beforeBatch=()=>f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='owner'");
  await assert.rejects(limits().setLimits(set(7,{perDayMinor:25_000})),errorCode('conflict'));assert.equal(f.db.beforeBatch,null,'Reached the commit');assert.equal(policies()+zones(),before);
  f.sql.exec("UPDATE memberships SET role='owner' WHERE company_id='a' AND user_id='owner'");
  f.db.beforeBatch=()=>f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='owner'");
  await assert.rejects(limits().setTimeZone(zone('America/Chicago',2)),errorCode('conflict'));assert.equal(f.db.beforeBatch,null,'Reached the commit');assert.equal(policies()+zones(),before);
  f.sql.exec("UPDATE memberships SET role='owner' WHERE company_id='a' AND user_id='owner'");
}
// Companies stay isolated: company b keeps its test policy and cannot see or use company a's limits.
{
  as('b-owner');verify();
  const b=await limits().get({companyId:'b'});assert.equal(b.limits,null);assert.equal(b.timeZone,null);assert.deepEqual(b.history,[]);
  await assert.rejects(limits().setLimits({...set(0),companyId:'b'}),errorCode('time_zone_required'));
  await assert.rejects(limits().get({companyId:'a'}),errorCode('forbidden'));
}
console.log('PASS: owner-only versioned spending limits and café time zone, password only when loosening, audited immutable history, per-order/day/month/in-progress enforcement with exact DST windows, authoritative reservation guard, races and company isolation.');
