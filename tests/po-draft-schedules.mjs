import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/supplier-simulation.mjs';

await build({stdin:{contents:["d1-po-draft-schedules","po-draft-schedule-contract","d1-purchasing-suppliers","d1-purchase-order-drafts"]
  .map(n=>`export * from './src/lib/${n}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-draft-schedules-tests.mjs'});
const {D1PoDraftSchedules,D1PoDraftScheduler,D1PurchasingSuppliers,D1PurchaseOrderDrafts,latestDue,zonedInstant,proposedCap}=await import('../.sites-runtime/po-draft-schedules-tests.mjs');

// Fixture items: 20 on hand, 10 incoming, target 100, capacity 120, item pack 30, at most 4 item packs.
const f=await fixture();let actor='manager',now=Date.parse('2026-10-28T15:00:00.000Z');
const clock={now:()=>new Date(now)},options={identity:async()=>actor,clock},policy={syncEnabled:true,maxLagMs:600_000};
for(const productId of ['milk','beans','cups'])await f.source({productId,clover:true});
const fresh=()=>f.sql.prepare("UPDATE clover_sync_state SET checkpoint=?,last_success=? WHERE company_id='a'").run(now-60_000,new Date(now-60_000).toISOString());
const setNow=iso=>{now=Date.parse(iso);f.setTime(iso);fresh();};
const registry=new D1PurchasingSuppliers(f.db,options);
const profile={name:'Fictional Café Supply',email:null,telephone:'',paymentTerms:'Illustrative',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'Fictional only',
  emailAcceptance:{status:'unknown',note:''},accounts:[{id:'account',reference:'A-001',status:'active'},{id:'other-account',reference:'A-002',status:'active'}],
  locations:[{id:'location',accountId:'account',reference:'Café north',address:'123 Fictional Street',status:'active'},
    {id:'other-location',accountId:'other-account',reference:'Café south',address:'456 Fictional Street',status:'active'}]};
for(const id of ['six','twelve'])await registry.saveProfile({action:'save_profile',companyId:'a',operationId:randomUUID(),reason:'Fictional setup',supplierId:id,expectedVersion:0,profile});
const map=(mappingId,supplierId,productId,packAmount,price)=>registry.saveMapping({action:'save_mapping',companyId:'a',operationId:randomUUID(),reason:'Reviewed pack',mappingId,expectedVersion:0,
  supplierId,expectedSupplierVersion:1,accountId:'account',locationId:'location',productId,expectedConfigId:`config-${productId}`,expectedConfigVersion:1,
  sku:`SKU-${mappingId}`,description:productId,unitLabel:'case',packAmount,packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:price});
await map('milk-6','six','milk','6','500');await map('beans-30','six','beans','30','2700');await map('cups-12','twelve','cups','12','1200');
const zone=(version,timeZone)=>f.sql.prepare('INSERT INTO company_time_zones(company_id,version,time_zone,actor,created_at,operation_id,fingerprint) VALUES(?,?,?,?,?,?,?)')
  .run('a',version,timeZone,'owner',new Date(now).toISOString(),randomUUID(),'fp');
const schedules=()=>new D1PoDraftSchedules(f.db,options);
const scheduler=(holder='tick-1')=>new D1PoDraftScheduler(f.db,{clock,salesPolicy:policy,holder,leaseMs:300_000,retryMs:900_000});
const fail=code=>e=>e.code===code;
const save=(extra={})=>({action:'save',companyId:'a',scheduleId:'weekly-six',expectedVersion:0,operationId:randomUUID(),supplierId:'six',accountId:'account',locationId:'location',
  weekday:1,localTime:'09:00',marginPercent:10,responsibleUserId:'manager',reason:'Monday order',...extra});
const status=(action,expectedVersion,extra={})=>({action,companyId:'a',scheduleId:'weekly-six',expectedVersion,operationId:randomUUID(),reason:'Fictional',...extra});
// Canceled drafts (a manual test draft) stay out of the scheduled-draft counts below.
const drafts=()=>f.sql.prepare("SELECT id,status,snapshot_json FROM purchase_order_drafts WHERE status!='canceled' ORDER BY created_at,id").all();
const week=(key,id='weekly-six')=>f.sql.prepare('SELECT * FROM po_draft_occurrences WHERE schedule_id=? AND week_key=?').get(id,key);
const records=()=>f.sql.prepare('SELECT schedule_id,week_key,state,attempts FROM po_draft_occurrences ORDER BY schedule_id,week_key').all().map(r=>Object.values(r).join(' '));
const review=async orderId=>{const po=new D1PurchaseOrderDrafts(f.db,options),d=await po.get('a',orderId);
  return po.review({action:'review',companyId:'a',orderId,operationId:randomUUID(),expectedRevision:d.revision,acknowledgeWarnings:true});};

// Time: the first 01:30 when clocks fall back, the first minute after the gap when they spring forward, and only the latest week.
assert.equal(new Date(zonedInstant('2026-11-01','01:30','America/New_York')).toISOString(),'2026-11-01T05:30:00.000Z');
assert.equal(new Date(zonedInstant('2027-03-14','02:30','America/New_York')).toISOString(),'2027-03-14T07:00:00.000Z');
assert.equal(new Date(zonedInstant('2026-11-02','09:00','America/New_York')).toISOString(),'2026-11-02T14:00:00.000Z');
assert.deepEqual(latestDue(Date.parse('2026-11-02T13:59:59.999Z'),1,'09:00','America/New_York'),{weekKey:'2026-10-26',dueAt:'2026-10-26T13:00:00.000Z'});
assert.deepEqual(latestDue(Date.parse('2026-11-02T14:00:00.000Z'),1,'09:00','America/New_York'),{weekKey:'2026-11-02',dueAt:'2026-11-02T14:00:00.000Z'});
assert.deepEqual(latestDue(Date.parse('2026-11-30T20:00:00.000Z'),1,'09:00','America/New_York').weekKey,'2026-11-30','Missed weeks collapse into the latest');
assert.deepEqual(latestDue(Date.parse('2026-11-01T06:29:00.000Z'),7,'01:30','America/New_York'),{weekKey:'2026-11-01',dueAt:'2026-11-01T05:30:00.000Z'},'The repeated 01:30 is the same week');
assert.equal(proposedCap(14100n,10),15510n);assert.equal(proposedCap(101n,10),112n,'Rounded up to the cent');

// Settings: owners and managers only, strict input, a time zone first, an active group, one schedule per group, replay-safe.
for(const who of [null,'employee','b-manager']){actor=who;
  for(const run of [()=>schedules().save(save()),()=>schedules().list('a'),()=>schedules().setStatus(status('pause',1))])await assert.rejects(run(),fail('forbidden'));}
actor='manager';
for(const bad of [{localTime:'9:00'},{localTime:'24:00'},{weekday:8},{weekday:0},{marginPercent:101},{operationId:'x'},{extra:true}])
  await assert.rejects(schedules().save(save(bad)),fail('invalid_request'),JSON.stringify(bad));
await assert.rejects(schedules().save(save()),fail('conflict'),'The owner sets the time zone first');
zone(1,'America/New_York');
await assert.rejects(schedules().save(save({responsibleUserId:'employee'})),fail('invalid_request'));
await assert.rejects(schedules().save(save({locationId:'other-location'})),fail('invalid_request'),'The location belongs to another account');
await assert.rejects(schedules().save(save({supplierId:'unknown'})),fail('invalid_request'));
const first=save(),saved=await schedules().save(first);
assert.deepEqual([saved.version,saved.status,saved.weekday,saved.localTime],[1,'active',1,'09:00']);
assert.deepEqual(await schedules().save(first),saved,'Exact replay');
await assert.rejects(schedules().save({...first,reason:'Different'}),fail('conflict'));
await assert.rejects(schedules().save(save()),fail('conflict'),'Stale expected version');
await assert.rejects(schedules().save(save({expectedVersion:1,supplierId:'twelve'})),fail('invalid_request'),'A schedule keeps its group');
await assert.rejects(schedules().save(save({scheduleId:'another'})),fail('conflict'),'One schedule per group');
const listed=await schedules().list('a');
assert.equal(listed.schedules[0].nextRun,'2026-11-02T14:00:00.000Z');assert.equal(listed.timeZone,'America/New_York');
// Choices for the screen: active supplier groups, and owners and managers (never staff) as responsible people.
assert.deepEqual(listed.choices.suppliers.map(s=>[s.id,s.groups.map(g=>[g.accountReference,g.locationReference])]),
  [['six',[['A-001','Café north'],['A-002','Café south']]],['twelve',[['A-001','Café north'],['A-002','Café south']]]]);
assert.deepEqual(listed.choices.people,[{userId:'owner',role:'owner'},{userId:'manager',role:'manager'}]);
// Losing the role while the list is read returns nothing.
{const prepare=f.db.prepare.bind(f.db);f.db.prepare=q=>{if(q.includes('FROM po_draft_occurrences o')){f.db.prepare=prepare;f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");}return prepare(q);};
  await assert.rejects(schedules().list('a'),fail('forbidden'));f.db.prepare=prepare;f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");}

// No catch-up for a time before the schedule existed.
setNow('2026-11-01T12:00:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks,[]);assert.deepEqual(records(),[]);

// Monday 09:00: the draft is recalculated, created for the responsible manager and linked to its week.
setNow('2026-11-02T14:00:00.000Z');
const monday=await scheduler().tick('a');
assert.deepEqual(monday.weeks.map(w=>[w.weekKey,w.state]),[['2026-11-02','drafted']]);
const [d1]=drafts(),s1=JSON.parse(d1.snapshot_json);
assert.equal(week('2026-11-02').order_id,d1.id);
assert.deepEqual(s1.lines.map(l=>[l.mappingId,l.packs]),[['beans-30','3'],['milk-6','12']]);
assert.equal(s1.capMinor,'15510','12×$5 + 3×$27 = $141.00, plus 10%');
assert.match(s1.notes,/^Created by the weekly schedule for the week of 2026-11-02\. Review before preparing a cart\./);
assert.equal(d1.status,'draft');const opened=await new D1PurchaseOrderDrafts(f.db,options).get('a',d1.id);
assert.equal(opened.events[0].actor,'manager');assert.deepEqual((await schedules().origin('a',d1.id)).weeklySchedule,{scheduleId:'weekly-six',weekKey:'2026-11-02'},'A draft says which weekly schedule created it');
assert.equal(listed.schedules[0].weeks.length,0);
const manual=await new D1PurchaseOrderDrafts(f.db,options).create({action:'create',companyId:'a',operationId:randomUUID(),source:'registry',supplierRef:{id:'twelve',version:1,accountId:'account',locationId:'location'},
  capMinor:'2000',notes:'Manual',lines:[{kind:'stock',mappingId:'cups-12',mappingVersion:1,packs:'1'}]});
assert.equal((await schedules().origin('a',manual.snapshot.id)).weeklySchedule,null,'Manual drafts carry no weekly label');
actor='employee';await assert.rejects(schedules().origin('a',d1.id),fail('forbidden'));actor='b-manager';await assert.rejects(schedules().origin('a',d1.id),fail('forbidden'));actor='manager';
await new D1PurchaseOrderDrafts(f.db,options).cancel({action:'cancel',companyId:'a',orderId:manual.snapshot.id,operationId:randomUUID(),expectedRevision:manual.revision,reason:'Fictional test draft'});
const weekList=(await schedules().list('a')).schedules[0].weeks;
assert.deepEqual(weekList.map(w=>[w.weekKey,w.state,w.orderNumber,w.orderStatus]),[['2026-11-02','drafted',s1.number,'draft']]);
// Repeated, concurrent and late checks never draft the same week twice.
const again=await scheduler('tick-2').tick('a');assert.deepEqual([again.ran,again.weeks],[true,[]],'The lease was released, so another check runs and finds nothing');
const [x,y]=await Promise.all([scheduler('tick-3').tick('a'),scheduler('tick-4').tick('a')]);
assert.deepEqual([...x.weeks,...y.weeks],[]);
setNow('2026-11-04T20:00:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks,[]);assert.equal(drafts().length,1);

// The next week is skipped while that draft waits for review; once reviewed, drafting resumes.
setNow('2026-11-09T14:30:00.000Z');
const waiting=await scheduler().tick('a');assert.deepEqual(waiting.weeks.map(w=>w.state),['skipped_waiting']);
assert.match(week('2026-11-09').reason,new RegExp(`${s1.number} from the week of 2026-11-02 is still waiting for review`));
await review(d1.id);
// Missed weeks: nothing runs for two weeks, then only the latest week is drafted.
setNow('2026-11-30T15:00:00.000Z');
assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>[w.weekKey,w.state]),[['2026-11-30','drafted']]);
assert.deepEqual(records(),['weekly-six 2026-11-02 drafted 1','weekly-six 2026-11-09 skipped_waiting 1','weekly-six 2026-11-30 drafted 1']);
await review(drafts()[1].id);

// Pause and resume: paused weeks are recorded as skipped, never caught up.
await schedules().setStatus(status('pause',1));
await assert.rejects(schedules().setStatus(status('pause',2)),fail('conflict'));
setNow('2026-12-07T14:00:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['skipped_paused']);
setNow('2026-12-08T12:00:00.000Z');await schedules().setStatus(status('resume',2));
setNow('2026-12-09T12:00:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks,[],'Resuming does not catch up');
// A change after the time has passed applies from the next week.
setNow('2026-12-14T15:00:00.000Z');await schedules().save(save({expectedVersion:3,localTime:'09:30',operationId:randomUUID()}));
assert.deepEqual((await scheduler().tick('a')).weeks,[]);
setNow('2026-12-21T14:30:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>[w.weekKey,w.state]),[['2026-12-21','drafted']]);
await review(drafts()[2].id);

// A time zone change cannot repeat the same local week.
setNow('2026-12-28T14:30:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['drafted']);
await review(drafts()[3].id);zone(2,'America/Los_Angeles');
setNow('2026-12-28T17:30:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks,[],'09:30 in Los Angeles is the same week');

// Holds: stale sales, a responsible person who lost the role, nothing needed, and missing prices.
setNow('2027-01-04T17:30:00.000Z');f.sql.prepare("UPDATE clover_sync_state SET last_success=? WHERE company_id='a'").run(new Date(now-3_600_000).toISOString());
const stale=await scheduler().tick('a');assert.deepEqual(stale.weeks.map(w=>[w.state,w.reason]),[['held','Sales data is not up to date, so the suggestions could miss recent sales.']]);
assert.equal(JSON.parse(week('2027-01-04').result_json).sales.status==='current',false,'The hold keeps the inputs it was decided on');
setNow('2027-01-11T17:30:00.000Z');f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.reason),['The responsible person is no longer an owner or manager.']);
f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
setNow('2027-01-18T17:30:00.000Z');f.sql.exec("UPDATE inventory_balances_exact SET on_hand_minor='100',version=version+1 WHERE company_id='a' AND product_id IN ('milk','beans')");
assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['nothing_needed']);
f.sql.exec("UPDATE inventory_balances_exact SET on_hand_minor='20',version=version+1 WHERE company_id='a' AND product_id IN ('milk','beans')");

// Failures: a crash after the draft is saved replays the same draft; failed calculations retry with backoff and stop after three attempts.
setNow('2027-01-25T17:30:00.000Z');
const prepare=f.db.prepare.bind(f.db);
f.db.prepare=query=>{if(query.includes("UPDATE po_draft_occurrences SET state=?")){f.db.prepare=prepare;throw new Error('Worker stopped');}return prepare(query);};
await assert.rejects(scheduler('crashed').tick('a'),/Worker stopped/);
assert.equal(f.db.prepare,prepare);const crashed=week('2027-01-25');
assert.deepEqual([crashed.state,crashed.attempts,drafts().length],['running',1,5]);
assert.deepEqual((await scheduler().tick('a')).weeks,[],'The crashed holder still has its lease');
f.sql.exec("UPDATE po_draft_tick_leases SET lease_until='2000-01-01T00:00:00.000Z'");
// Stock changes before recovery: a fresh calculation would differ, so recovery must replay the saved input.
f.sql.exec("UPDATE inventory_balances_exact SET on_hand_minor='50',version=version+1 WHERE company_id='a' AND product_id='milk'");
setNow('2027-01-25T17:36:00.000Z');const recovered=await scheduler().tick('a');
f.sql.exec("UPDATE inventory_balances_exact SET on_hand_minor='20',version=version+1 WHERE company_id='a' AND product_id='milk'");
assert.deepEqual(recovered.weeks.map(w=>w.state),['drafted']);assert.equal(drafts().length,5,'The saved draft input replayed the same draft');
assert.equal(week('2027-01-25').order_id,drafts()[4].id);assert.equal(week('2027-01-25').attempts,2);
await review(drafts()[4].id);
setNow('2027-02-01T17:30:00.000Z');
const broken=()=>{f.db.prepare=query=>{if(query.includes('FROM purchasing_mappings WHERE company_id=? AND supplier_id=? AND account_id=?'))throw new Error('Database busy');return prepare(query);};};
broken();assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['retry']);
assert.equal(week('2027-02-01').next_attempt_at,'2027-02-01T17:45:00.000Z');
setNow('2027-02-01T17:40:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks,[],'Not before the retry time');
setNow('2027-02-01T17:45:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['retry']);
assert.equal(week('2027-02-01').next_attempt_at,'2027-02-01T18:15:00.000Z','The wait grows with each attempt');
setNow('2027-02-01T18:15:00.000Z');const stopped=await scheduler().tick('a');f.db.prepare=prepare;
assert.deepEqual(stopped.weeks.map(w=>[w.state,w.reason]),[['failed','Suggestions could not be calculated. Stopped after 3 attempts.']]);
assert.deepEqual([week('2027-02-01').attempts,drafts().length],[3,5]);
// A retry that recovers drafts on its next attempt.
setNow('2027-02-08T17:30:00.000Z');broken();assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['retry']);f.db.prepare=prepare;
setNow('2027-02-08T17:45:00.000Z');assert.deepEqual((await scheduler().tick('a')).weeks.map(w=>w.state),['drafted']);
// A week still waiting to retry is replaced when the next week arrives.
await review(drafts()[5].id);
setNow('2027-02-15T17:30:00.000Z');broken();await scheduler().tick('a');f.db.prepare=prepare;
setNow('2027-02-22T17:30:00.000Z');const replaced=await scheduler().tick('a');
assert.deepEqual(replaced.weeks.map(w=>[w.weekKey,w.state,w.reason]),[['2027-02-15','held','A later week replaced this one.'],['2027-02-22','drafted',null]]);

// Prices: an item without an estimate stays out of the proposed cap (and is noted); with no estimates at all, the week is held.
for(const productId of ['tea','oats'])await f.source({productId,clover:true});
await registry.saveMapping({action:'save_mapping',companyId:'a',operationId:randomUUID(),reason:'Reviewed pack',mappingId:'tea-12',expectedVersion:0,supplierId:'twelve',expectedSupplierVersion:1,
  accountId:'account',locationId:'location',productId:'tea',expectedConfigId:'config-tea',expectedConfigVersion:1,sku:'SKU-tea-12',description:'tea',unitLabel:'case',packAmount:'12',
  packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:null});
await registry.saveMapping({action:'save_mapping',companyId:'a',operationId:randomUUID(),reason:'Reviewed pack',mappingId:'oats-south',expectedVersion:0,supplierId:'six',expectedSupplierVersion:1,
  accountId:'other-account',locationId:'other-location',productId:'oats',expectedConfigId:'config-oats',expectedConfigVersion:1,sku:'SKU-oats',description:'oats',unitLabel:'case',packAmount:'6',
  packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:null});
await schedules().save(save({scheduleId:'weekly-twelve',supplierId:'twelve',localTime:'09:00',marginPercent:0}));
await schedules().save(save({scheduleId:'weekly-south',accountId:'other-account',locationId:'other-location',localTime:'09:00'}));
setNow('2027-03-01T17:30:00.000Z');
const priced=await scheduler().tick('a'),by=id=>priced.weeks.find(w=>w.scheduleId===id);
assert.deepEqual([by('weekly-south').state,by('weekly-south').reason],['held','None of the suggested items has an estimated price, so no cap can be proposed.']);
assert.equal(by('weekly-twelve').state,'drafted');assert.equal(by('weekly-six').state,'skipped_waiting');
const mixed=JSON.parse(drafts().find(d=>d.id===by('weekly-twelve').orderId).snapshot_json);
assert.deepEqual(mixed.lines.map(l=>[l.mappingId,l.packs]),[['cups-12','6'],['tea-12','6']]);
assert.equal(mixed.capMinor,'7200','Only the priced cups count: 6 × $12, no margin');
assert.match(mixed.notes,/1 item\(s\) have no estimated price and are not in the proposed cap\./);

// One check per company at a time.
f.sql.prepare("UPDATE po_draft_tick_leases SET holder='other',lease_until=? WHERE company_id='a'").run(new Date(now+60_000).toISOString());
assert.deepEqual(await scheduler().tick('a'),{companyId:'a',ran:false,reason:'another_check_running',weeks:[]});
assert.deepEqual((await scheduler().tick('b')).reason,'time_zone_missing');

// The database refuses unsafe schedules and week records.
const at=new Date(now).toISOString();
const scheduleRow=(o={})=>{const r={company_id:'a',id:'raw',version:1,status:'active',supplier_id:'twelve',account_id:'other-account',location_id:'other-location',weekday:3,local_time:'08:00',
  margin_percent:5,responsible_user_id:'manager',reason:'',actor:'manager',created_at:at,operation_id:randomUUID(),fingerprint:'fp',...o};
  return [`INSERT INTO po_draft_schedules(${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`,Object.values(r)];};
for(const [why,o] of [['staff',{actor:'employee'}],['staff responsible',{responsible_user_id:'employee'}],['bad time',{local_time:'24:00'}],['bad minutes',{local_time:'08:60'}],
  ['weekday',{weekday:0}],['margin',{margin_percent:101}],['version gap',{version:2}],['other company',{company_id:'b',actor:'b-manager',responsible_user_id:'b-manager'}],
  ['same group',{supplier_id:'six'}],['inactive supplier',{supplier_id:'unknown'}],['status',{status:'deleted'}]]){
  const [sql,args]=scheduleRow(o);assert.throws(()=>f.sql.prepare(sql).run(...args),/Invalid or stale weekly schedule|FOREIGN KEY/,why);}
{const [sql,args]=scheduleRow({created_at:'2027-02-01T00:00:00.000Z'});f.sql.prepare(sql).run(...args);}
await registry.saveProfile({action:'save_profile',companyId:'a',operationId:randomUUID(),reason:'Fictional setup',supplierId:'eighteen',expectedVersion:0,profile});
{const [sql,args]=scheduleRow({version:2,supplier_id:'eighteen'});assert.throws(()=>f.sql.prepare(sql).run(...args),/weekly schedule/,'Group change to an unused group');}
for(const sql of ["UPDATE po_draft_schedules SET margin_percent=50","DELETE FROM po_draft_schedules"])assert.throws(()=>f.sql.exec(sql),/permanent/,sql);
const occurrence=(o={})=>{const r={company_id:'a',schedule_id:'raw',week_key:'2027-02-17',schedule_version:1,due_at:'2027-02-17T16:00:00.000Z',time_zone:'America/Los_Angeles',
  state:'running',attempts:1,holder:'raw',lease_until:new Date(now+60_000).toISOString(),created_at:at,updated_at:at,...o};
  return [`INSERT INTO po_draft_occurrences(${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`,Object.values(r)];};
for(const [why,o] of [['wrong weekday',{week_key:'2027-02-18',due_at:'2027-02-18T16:00:00.000Z'}],['due after claim',{due_at:new Date(now+1).toISOString()}],
  ['before the version',{week_key:'2027-01-27',due_at:'2027-01-27T16:00:00.000Z'}],['old time zone',{time_zone:'America/New_York'}],
  ['not running',{state:'drafted'}],['second attempt',{attempts:2}],['stale version',{schedule_version:2}],['bad week',{week_key:'2027-2-17'}]]){
  const [sql,args]=occurrence(o);assert.throws(()=>f.sql.prepare(sql).run(...args),/Invalid weekly draft occurrence/,why);}
const done=week('2027-02-22');
for(const [why,sql] of [
  ['finished weeks are final',"UPDATE po_draft_occurrences SET state='held',reason='x',order_id=NULL,draft_input_json=NULL WHERE week_key='2027-02-22'"],
  ['identity',"UPDATE po_draft_occurrences SET week_key='2027-03-01' WHERE week_key='2027-02-22'"],
  ['delete',"DELETE FROM po_draft_occurrences WHERE week_key='2027-02-22'"]])assert.throws(()=>f.sql.exec(sql),/occurrence change|permanent/,why);
assert.equal(done.state,'drafted');
const [osql,oargs]=occurrence();f.sql.prepare(osql).run(...oargs);
for(const [why,sql] of [
  ['reclaim during the lease',`UPDATE po_draft_occurrences SET attempts=2,holder='thief',lease_until='${new Date(now+120_000).toISOString()}',updated_at='${at}' WHERE schedule_id='raw'`],
  ['failed before three attempts',`UPDATE po_draft_occurrences SET state='failed',reason='x',lease_until=NULL,updated_at='${at}' WHERE schedule_id='raw'`],
  ['held without a reason',`UPDATE po_draft_occurrences SET state='held',lease_until=NULL,updated_at='${at}' WHERE schedule_id='raw'`],
  ['retry in the past',`UPDATE po_draft_occurrences SET state='retry',reason='x',lease_until=NULL,next_attempt_at='${at}',updated_at='${at}' WHERE schedule_id='raw'`],
  ['another holder finishes',`UPDATE po_draft_occurrences SET state='held',reason='x',holder='thief',lease_until=NULL,updated_at='${at}' WHERE schedule_id='raw'`],
  ['time goes backwards',`UPDATE po_draft_occurrences SET state='held',reason='x',lease_until=NULL,updated_at='2000-01-01T00:00:00.000Z' WHERE schedule_id='raw'`]])
  assert.throws(()=>f.sql.exec(sql),/occurrence change/,why);
const later=k=>new Date(now+k*1000).toISOString();
// With its draft input recorded, a drafted week must still name an existing draft.
f.sql.exec(`UPDATE po_draft_occurrences SET draft_input_json='{}',draft_actor='manager',updated_at='${at}' WHERE schedule_id='raw'`);
assert.throws(()=>f.sql.exec(`UPDATE po_draft_occurrences SET state='drafted',order_id='missing',lease_until=NULL,updated_at='${at}' WHERE schedule_id='raw'`),/occurrence change/,'Drafted without a draft');
// Expired leases may be taken over, but never beyond three attempts.
f.sql.exec(`UPDATE po_draft_occurrences SET attempts=2,holder='second',lease_until='${later(180)}',updated_at='${later(120)}' WHERE schedule_id='raw'`);
f.sql.exec(`UPDATE po_draft_occurrences SET attempts=3,holder='third',lease_until='${later(300)}',updated_at='${later(240)}' WHERE schedule_id='raw'`);
assert.throws(()=>f.sql.exec(`UPDATE po_draft_occurrences SET attempts=4,holder='fourth',lease_until='${later(420)}',updated_at='${later(360)}' WHERE schedule_id='raw'`),/occurrence change/,'A fourth attempt');
f.sql.exec(`UPDATE po_draft_occurrences SET state='failed',reason='Fictional',lease_until=NULL,updated_at='${later(360)}' WHERE schedule_id='raw'`);
console.log('PASS: weekly draft schedules: owner/manager settings with a time zone, one group per schedule and replay; DST-exact local times; one draft per week across repeated, concurrent, late and time-zone-changed checks; no catch-up for missed, paused or changed weeks; skip while a draft waits; holds for stale sales, lost roles, nothing needed; crash recovery replays the same draft; bounded retries with backoff; per-company lease; database guards on schedules and week records.');
