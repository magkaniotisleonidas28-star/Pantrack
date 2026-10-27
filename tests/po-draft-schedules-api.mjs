import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {fixture} from './helpers/supplier-simulation.mjs';

const f=await fixture();
globalThis.__tickApi={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({stdin:{contents:"export {POST} from './src/app/api/po-draft-schedules/tick/route.ts';export {GET as listSchedules,POST as changeSchedule} from './src/app/api/po-draft-schedules/route.ts';export {D1PurchasingSuppliers} from './src/lib/d1-purchasing-suppliers.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-draft-schedules-api.mjs',plugins:[{name:'tick-http-dependencies',setup(b){
    // Keep the actual token digest, company wrapper, CSRF check and services. Only identity, database and environment are fixtures.
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/chatgpt-auth)$/},args=>({path:args.path,namespace:'tick-http'}));
    b.onLoad({filter:/.*/,namespace:'tick-http'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__tickApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__tickApi.db;':
      'export const getChatGPTUser=async()=>globalThis.__tickApi.user?{userId:globalThis.__tickApi.user}:null;',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-draft-schedules-api.mjs');
const token='fictional-scheduler-token',hash=v=>createHash('sha256').update(v).digest('hex');
f.sql.prepare("INSERT INTO automation_settings(company_id,data,scheduler_hash) VALUES('a','{}',?),('b','{}',?)").run(hash(token),hash('other-company-token'));
f.sql.prepare('INSERT INTO company_time_zones(company_id,version,time_zone,actor,created_at,operation_id,fingerprint) VALUES(?,?,?,?,?,?,?)')
  .run('a',1,'America/New_York','owner','2026-10-01T12:00:00.000Z',randomUUID(),'fp');
const tick=(companyId='a',auth=`Bearer ${token}`,host='http://127.0.0.1:5181')=>api.POST(new Request(`${host}/api/po-draft-schedules/tick?companyId=${companyId}`,
  {method:'POST',headers:auth?{authorization:auth}:{}}));
const leases=()=>JSON.stringify(f.sql.prepare('SELECT * FROM po_draft_tick_leases').all());
async function refused(status,run){const before=leases(),res=await run();assert.equal(res.status,status,await res.text());assert.equal(leases(),before,'A refused check runs nothing');}

globalThis.__tickApi.env.PANTRACK_CART_PREVIEW='disabled';await refused(404,()=>tick());globalThis.__tickApi.env.PANTRACK_CART_PREVIEW='enabled';
for(const host of ['http://localhost:5181','https://pantrack.example.invalid'])await refused(404,()=>tick('a',`Bearer ${token}`,host));
for(const [companyId,auth] of [['a',null],['a','Bearer wrong'],['a',token],['b',`Bearer ${token}`],['c',`Bearer ${token}`],['',`Bearer ${token}`],['a','Bearer '+'x'.repeat(200)]])
  await refused(401,()=>tick(companyId,auth));
const ok=await tick();assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/no-store/);
assert.deepEqual(await ok.json(),{companyId:'a',ran:true,reason:null,weeks:[]});
const other=await tick('b','Bearer other-company-token');assert.equal(other.status,200);assert.equal((await other.json()).reason,'time_zone_missing','Each company runs only its own check');

// The schedule settings route: owners and managers of the company only, the same gates as the other cart routes, strict actions.
await new api.D1PurchasingSuppliers(f.db,{identity:async()=>'manager'}).saveProfile({action:'save_profile',companyId:'a',operationId:randomUUID(),reason:'Fictional',supplierId:'six',expectedVersion:0,
  profile:{name:'Fictional supplier',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'',emailAcceptance:{status:'unknown',note:''},
    accounts:[{id:'account',reference:'A-1',status:'active'}],locations:[{id:'location',accountId:'account',reference:'North',address:'1 Fictional Street',status:'active'},
      {id:'closed',accountId:'account',reference:'Closed café',address:'3 Fictional Street',status:'archived'}]}});
const s=globalThis.__tickApi,origin='http://127.0.0.1:5181';
const get=(companyId='a',host=origin)=>api.listSchedules(new Request(`${host}/api/po-draft-schedules?companyId=${companyId}`));
const post=(body,headers={},host=origin)=>api.changeSchedule(new Request(host+'/api/po-draft-schedules',{method:'POST',headers:{origin:host,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
const rows=()=>JSON.stringify(f.sql.prepare('SELECT * FROM po_draft_schedules ORDER BY 1,2,3').all());
async function unchanged(status,run){const before=rows(),res=await run();assert.equal(res.status,status,await res.text());assert.equal(rows(),before);return res;}
const save={action:'save',companyId:'a',scheduleId:'weekly',expectedVersion:0,operationId:randomUUID(),supplierId:'six',accountId:'account',locationId:'location',
  weekday:1,localTime:'09:00',marginPercent:10,responsibleUserId:'manager',reason:''};
for(const user of [null,'employee','b-manager']){s.user=user;await unchanged(user?403:401,()=>get());await unchanged(user?403:401,()=>post(save));}
s.user='employee';assert.equal((await (await post(save)).json()).error,'You do not have permission for this company action.','The company route refuses staff itself');
assert.equal((await (await get()).json()).error,'You do not have permission for this company action.','Also for reading');
s.user='manager';await unchanged(403,()=>get('b'));await unchanged(403,()=>post({...save,companyId:'b'}));
s.env.PANTRACK_CART_PREVIEW='disabled';await unchanged(404,()=>get());await unchanged(404,()=>post(save));s.env.PANTRACK_CART_PREVIEW='enabled';
for(const host of ['http://localhost:5181','https://pantrack.example.invalid'])await unchanged(404,()=>post(save,{},host));
for(const headers of [{origin:'https://evil.example'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await unchanged(403,()=>post(save,headers));
for(const body of [{...save,action:'delete'},{...save,extra:1},{...save,localTime:'25:00'}])await unchanged(400,()=>post(body));
assert.equal((await (await post({...save,action:'delete'})).json()).error,'Choose save, pause or resume.','Unknown actions never reach a service');
const listed=await get();assert.equal(listed.status,200);assert.match(listed.headers.get('cache-control'),/no-store/);
assert.deepEqual((await listed.json()).choices.suppliers.map(x=>[x.id,x.groups.map(g=>g.locationId)]),[['six',['location']]],'Archived locations are not offered');
const saved=await post(save);assert.equal(saved.status,200);assert.equal((await saved.json()).version,1);
assert.equal((await post(save)).status,200,'Exact replay');
const pause={action:'pause',companyId:'a',scheduleId:'weekly',expectedVersion:1,operationId:randomUUID(),reason:''};
assert.equal((await (await post(pause)).json()).status,'paused');await unchanged(409,()=>post({...pause,operationId:randomUUID()}));
assert.equal((await (await post({...pause,action:'resume',expectedVersion:2,operationId:randomUUID()})).json()).status,'active');
const lookup=await api.listSchedules(new Request(`${origin}/api/po-draft-schedules?companyId=a&orderId=unknown`));
assert.equal(lookup.status,200);assert.deepEqual(await lookup.json(),{weeklySchedule:null},'The label lookup answers for drafts without a schedule');
s.user='employee';assert.equal((await api.listSchedules(new Request(`${origin}/api/po-draft-schedules?companyId=a&orderId=unknown`))).status,403);s.user='manager';
console.log('PASS: weekly schedule settings route: anonymous, staff and other-company refusals (the company route itself refuses staff), default-off loopback, actual CSRF/origin, strict actions, private list with supplier choices, save, replay, pause and resume.');
console.log('PASS: weekly draft tick route: preview flag and loopback only, the company\'s own scheduler token (hash compared, other companies\' tokens refused), private responses, and refusals run nothing.');
