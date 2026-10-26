import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {cartFixture,command} from './helpers/po-cart-authorizations.mjs';

const f=await cartFixture();
globalThis.__limitsApi={db:f.db,user:'owner',verifiedAt:null,recovery:false,env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({entryPoints:['src/app/api/po-cart-spending-limits/route.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-spending-limits-api.mjs',plugins:[{name:'limits-http-dependencies',setup(b){
    // Keep the actual company wrapper, CSRF and reauthentication rule. Only identity/database/environment are fixtures.
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/chatgpt-auth)$/},args=>({path:args.path,namespace:'limits-http'}));
    b.onLoad({filter:/.*/,namespace:'limits-http'},args=>({contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__limitsApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__limitsApi.db;':
      'export const getChatGPTUser=async()=>{const s=globalThis.__limitsApi;return s.user?{userId:s.user,reauthenticatedAt:s.verifiedAt??undefined,recovery:s.recovery}:null;};',
      loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-cart-spending-limits-api.mjs');
const origin='http://127.0.0.1:5181',s=globalThis.__limitsApi;
const post=(body,extra={},host=origin)=>api.POST(new Request(host+'/api/po-cart-spending-limits',{method:'POST',
  headers:{origin:host,'content-type':'application/json',...extra},body:JSON.stringify(body)}));
const get=(companyId,host=origin,query='')=>api.GET(new Request(`${host}/api/po-cart-spending-limits?companyId=${companyId}${query}`));
const state=()=>JSON.stringify([f.sql.prepare('SELECT * FROM po_cart_budget_policies ORDER BY company_id,version').all(),
  f.sql.prepare('SELECT * FROM company_time_zones ORDER BY company_id,version').all()]);
async function denied(status,fn,code){const before=state(),res=await fn(),text=await res.text();
  assert.equal(res.status,status,text);if(code)assert.equal(JSON.parse(text).code,code);assert.equal(state(),before);}
const zone=(expectedVersion=0,extra={})=>({action:'set_time_zone',companyId:'a',operationId:randomUUID(),expectedVersion,timeZone:'America/New_York',...extra});
const limits=(expectedVersion,extra={})=>({action:'set_limits',companyId:'a',operationId:randomUUID(),expectedVersion,
  perOrderMinor:20_000,perDayMinor:30_000,perMonthMinor:null,outstandingMinor:100_000,...extra});
const verify=()=>{s.verifiedAt=Date.now()-1000;};

verify();
for(const user of [null,'employee','b-owner','nobody']){
  s.user=user;await denied(user?403:401,()=>get('a'));await denied(user?403:401,()=>post(zone()));await denied(user?403:401,()=>post(limits(1)));
}
s.user='manager';await denied(403,()=>get('a'),'forbidden');await denied(403,()=>post(zone()),'forbidden');await denied(403,()=>post(limits(1)),'forbidden');
s.user='owner';
await denied(403,()=>get('b'));await denied(403,()=>post({...zone(),companyId:'b'}));
s.env.PANTRACK_CART_PREVIEW='disabled';await denied(404,()=>get('a'));await denied(404,()=>post(zone()));s.env.PANTRACK_CART_PREVIEW='enabled';
for(const host of ['https://pantrack.example.invalid','http://localhost:5181','http://192.0.2.1']){
  await denied(404,()=>get('a',host));await denied(404,()=>post(zone(),{},host));
}
for(const headers of [{origin:'https://evil.example'},{origin:''},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await denied(403,()=>post(zone(),headers));
for(const body of [{...zone(),action:'set'},{...zone(),actor:'owner'},{...zone(),operationId:'x'},{...zone(),timeZone:'Mars/Base'},
  {...limits(1),perDayMinor:'30000'},{...limits(1),perOrderMinor:40_000},{...limits(1),version:9}])
  await denied(400,()=>post(body));
await denied(403,()=>post({...limits(1),companyId:undefined}));
await denied(400,()=>get('a',origin,'&actor=owner'));
s.verifiedAt=null;await denied(403,()=>post(zone()),'reauthentication_required');
s.recovery=true;verify();await denied(403,()=>post(zone()),'reauthentication_required');s.recovery=false;
await denied(409,()=>post(limits(1)),'time_zone_required');
const tz=await post(zone());assert.equal(tz.status,200);assert.equal(tz.headers.get('cache-control'),'private, no-store');
const saved=await post(limits(1));assert.equal(saved.status,200);const body=await saved.json();
assert.equal(body.receipt.version,2);assert.equal(body.current.limits.perDayMinor,30_000);
const view=await get('a');assert.equal(view.status,200);const status=await view.json();
assert.equal(status.timeZone.timeZone,'America/New_York');assert.deepEqual(status.history.map(h=>h.version),[2,1]);
assert.equal(status.usage.dayMinor,0);
s.verifiedAt=null;await denied(403,()=>post(limits(2,{perDayMinor:40_000})),'reauthentication_required');
const tightened=await post(limits(2,{perDayMinor:25_000}));assert.equal(tightened.status,200,'Tightening needs no password');
await denied(409,()=>post(limits(2,{perDayMinor:24_000})),'conflict');
// A manager refused by an owner limit sees which limit, not the amounts.
f.setUser('manager');
await assert.rejects(f.service().authorize(command(await f.reviewed({capMinor:'20001'}))),e=>e.code==='limit_exceeded'&&!e.message.includes('$'));
console.log('PASS: spending-limit HTTP owner-only access, anonymous/employee/manager/wrong-company denial, default-off loopback, actual CSRF/origin, strict intent, password only when loosening, conflicts and private responses.');
