import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';

const f=await jobFixture();
globalThis.__deliveryApi={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({stdin:{contents:"export * from './src/app/api/po-cart-deliveries/route.ts';export {D1PoCartConfirmations} from './src/lib/d1-po-cart-confirmations.ts';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-deliveries-api.mjs',plugins:[{name:'delivery-http-dependencies',setup(b){
    // Keep the actual company wrapper and CSRF function. Only identity/database/environment are fixtures.
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/chatgpt-auth)$/},args=>({path:args.path,namespace:'delivery-http'}));
    b.onLoad({filter:/.*/,namespace:'delivery-http'},args=>({contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__deliveryApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__deliveryApi.db;':
      'export const getChatGPTUser=async()=>globalThis.__deliveryApi.user?{userId:globalThis.__deliveryApi.user}:null;',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-cart-deliveries-api.mjs');
const origin='http://127.0.0.1:5181',s=globalThis.__deliveryApi;
const post=(body,extra={},host=origin)=>api.POST(new Request(host+'/api/po-cart-deliveries',{method:'POST',headers:{origin:host,'content-type':'application/json',...extra},body:JSON.stringify(body)}));
const get=(query,host=origin)=>api.GET(new Request(`${host}/api/po-cart-deliveries?${new URLSearchParams(query)}`));
const state=()=>JSON.stringify(['po_cart_deliveries','inventory_order_receipts','inventory_balances_exact'].map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
async function denied(status,fn){const before=state(),res=await fn();assert.equal(res.status,status,await res.text());assert.equal(state(),before);}

// A ready fictional cart confirmed within the cap.
f.setTime('2026-10-02T12:00:00.000Z');
const a=await f.authorized({lines:[await f.stock('beans'),{kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
let j=(await f.jobs().enqueue(enqueue(a))).current.job;const fence=(await f.worker().claim(operation(j))).receipt.fence;
for(const line of j.inputs.preflight.lines){const b=await f.worker().beginAttempt({...fenced(j,fence),lineId:line.lineId});
  j=(await f.worker().recordResult({...fenced(j,fence),attemptId:b.receipt.attemptId,outcome:'verified',observation:line})).current.job;}
f.setTime('2026-10-02T12:05:00.000Z');
const confirmationId=(await new api.D1PoCartConfirmations(f.db,f.options).record({action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,operationId:randomUUID(),
  supplierReference:'SUP-HTTP-1',expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''})).receipt.confirmationId;
f.setTime('2026-10-02T12:10:00.000Z');
const [beans,supplies]=j.inputs.preflight.lines;
const count={action:'count',companyId:'a',confirmationId,operationId:randomUUID(),deliveredAt:'2026-10-02T12:09:00.000Z',
  lines:[{lineId:beans.lineId,receivedPacks:'2',damagedPacks:'0'},{lineId:supplies.lineId,receivedPacks:'1',damagedPacks:'0'}],note:''};
const staff={companyId:'a',view:'staff'},manager={companyId:'a',view:'manager',jobId:j.id};

// Identity, company and role: staff may list and count; only owners and managers read the comparison or decide.
for(const user of [null,'b-employee','b-manager']){s.user=user;await denied(user?403:401,()=>get(staff));await denied(user?403:401,()=>post(count));}
s.user='employee';await denied(403,()=>get(manager));
await denied(403,()=>get({...staff,companyId:'b'}));await denied(403,()=>post({...count,companyId:'b'}));
s.env.PANTRACK_CART_PREVIEW='disabled';await denied(404,()=>get(staff));await denied(404,()=>post(count));s.env.PANTRACK_CART_PREVIEW='enabled';
for(const host of ['https://pantrack.example.invalid','http://localhost:5181'])await denied(404,()=>post(count,{},host));
for(const headers of [{origin:'https://evil.example'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await denied(403,()=>post(count,headers));
for(const extra of [{action:'close'},{actor:'manager'},{state:'approved'},{operationId:'x'},{lines:[]},{lines:[{lineId:beans.lineId,receivedPacks:'-1',damagedPacks:'0'}]}])
  await denied(400,()=>post({...count,...extra}));
const list=await get(staff);assert.equal(list.status,200);assert.match(list.headers.get('cache-control'),/no-store/);
const body=await list.json();assert.doesNotMatch(JSON.stringify(body),/Minor|packs|Packs|price/,'Staff responses carry no amounts or prices');
assert.equal(body.orders.length,1);
const [r1,r2]=await Promise.all([post(count),post(count)]);assert.equal(r1.status,200);assert.equal(r2.status,200);
const receipt=(await r1.json()).receipt;assert.deepEqual((await r2.json()).receipt,receipt,'Concurrent identical counts return one receipt');
// Staff cannot approve or ask for a recount; a manager approves once.
const decision={action:'approve',companyId:'a',deliveryId:receipt.deliveryId,operationId:randomUUID(),
  lines:[{lineId:beans.lineId,acceptPacks:'2',excessPacks:'0',releaseRest:false},{lineId:supplies.lineId,acceptPacks:'1',excessPacks:'0',releaseRest:false}],note:''};
await denied(403,()=>post(decision));await denied(403,()=>post({action:'recount',companyId:'a',deliveryId:receipt.deliveryId,operationId:randomUUID(),note:'Again'}));
s.user='manager';
for(const extra of [{lines:[{lineId:beans.lineId,acceptPacks:'3',excessPacks:'0',releaseRest:false},decision.lines[1]]},{lines:[{...decision.lines[0],releaseRest:'yes'},decision.lines[1]]}])
  await denied(400,()=>post({...decision,...extra}));
const view=await (await get(manager)).json();assert.equal(view.deliveries[0].state,'counted');assert.equal(view.lines[0].owedPacks,beans.packs);
const approved=await post(decision);assert.equal(approved.status,200);assert.equal((await approved.json()).receipt.state,'approved');
await denied(409,()=>post({...decision,operationId:randomUUID()}));
const after=await (await get(manager)).json();assert.equal(after.complete,true);assert.equal(after.deliveries[0].stockAdded,true);
console.log('PASS: delivery HTTP identity/company/role (staff count only), default-off loopback, actual CSRF/origin, strict intent, no amounts for staff, concurrent replay and private responses.');
