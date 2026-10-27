import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,operation,fenced} from './helpers/po-cart-jobs.mjs';

const f=await jobFixture();
globalThis.__confirmApi={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({entryPoints:['src/app/api/po-cart-confirmations/route.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-confirmations-api.mjs',plugins:[{name:'confirm-http-dependencies',setup(b){
    // Keep the actual company wrapper and CSRF function. Only identity/database/environment are fixtures.
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|a8-review-source))$/},args=>({path:args.path,namespace:'confirm-http'}));
    b.onLoad({filter:/.*/,namespace:'confirm-http'},args=>({contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__confirmApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__confirmApi.db;':
      args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__confirmApi.user?{userId:globalThis.__confirmApi.user,reauthenticatedAt:globalThis.__confirmApi.verifiedAt}:null;':
      'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-cart-confirmations-api.mjs');
const origin='http://127.0.0.1:5181',s=globalThis.__confirmApi;
const post=(body,extra={},host=origin)=>api.POST(new Request(host+'/api/po-cart-confirmations',{method:'POST',headers:{origin:host,'content-type':'application/json',...extra},body:JSON.stringify(body)}));
const get=(companyId,jobId,host=origin,query='')=>api.GET(new Request(`${host}/api/po-cart-confirmations?companyId=${companyId}&jobId=${jobId}${query}`));
const state=()=>JSON.stringify(['po_cart_confirmations','inventory_order_incoming','po_cart_commitments'].map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
async function denied(status,fn){const before=state(),res=await fn();assert.equal(res.status,status,await res.text());assert.equal(state(),before);}

f.setTime('2026-10-02T12:00:00.000Z');
const a=await f.authorized({lines:[await f.stock('beans'),{kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
let j=(await f.jobs().enqueue(enqueue(a))).current.job;const fence=(await f.worker().claim(operation(j))).receipt.fence;
for(const line of j.inputs.preflight.lines){const b=await f.worker().beginAttempt({...fenced(j,fence),lineId:line.lineId});
  j=(await f.worker().recordResult({...fenced(j,fence),attemptId:b.receipt.attemptId,outcome:'verified',observation:line})).current.job;}
f.setTime('2026-10-02T12:05:00.000Z');
const body={action:'record',companyId:'a',jobId:j.id,expectedJobRevision:j.revision,operationId:randomUUID(),supplierReference:'SUP-HTTP-1',
  expectedDelivery:'2026-10-09',lines:j.inputs.preflight.lines.map(l=>({lineId:l.lineId,packs:l.packs,unitMinor:l.unitMinor})),extras:[],charges:[],note:''};
for(const user of [null,'employee','b-manager']){s.user=user;await denied(user?403:401,()=>get('a',j.id));await denied(user?403:401,()=>post(body));}
s.user='manager';
await denied(403,()=>get('b',j.id));await denied(403,()=>post({...body,companyId:'b'}));
s.env.PANTRACK_CART_PREVIEW='disabled';await denied(404,()=>get('a',j.id));await denied(404,()=>post(body));s.env.PANTRACK_CART_PREVIEW='enabled';
for(const host of ['https://pantrack.example.invalid','http://localhost:5181'])await denied(404,()=>post(body,{},host));
for(const headers of [{origin:'https://evil.example'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await denied(403,()=>post(body,headers));
for(const extra of [{action:'approve'},{actor:'owner'},{state:'confirmed'},{operationId:'x'},{expectedDelivery:'soon'},{lines:[]},{charges:[{kind:'tip',description:'',amountMinor:'1'}]}])
  await denied(400,()=>post({...body,...extra}));
const view=await get('a',j.id);assert.equal(view.status,200);const before=await view.json();
assert.equal(before.confirmation,null);assert.equal(before.authorizedLines.length,2);assert.equal(before.job.state,'ready');
const [r1,r2]=await Promise.all([post(body),post(body)]);assert.equal(r1.status,200);assert.equal(r2.status,200);
assert.deepEqual(await r1.json(),await r2.json(),'Concurrent identical saves return one receipt');
assert.match(r1.headers.get('cache-control'),/no-store/);
const after=await (await get('a',j.id)).json();assert.equal(after.confirmation.state,'confirmed');assert.equal(after.incoming.length,1);
await denied(409,()=>post({...body,operationId:randomUUID(),supplierReference:'SUP-HTTP-2'}));
// Owner review actions: owner only, password confirmation required, strict input, and nothing to review within the cap.
const confirmationId=after.confirmation.id,review=(action,extra={})=>({action,companyId:'a',confirmationId,operationId:randomUUID(),note:'Fictional',...extra});
const reviews=()=>JSON.stringify(f.sql.prepare('SELECT * FROM po_cart_confirmation_reviews').all());
async function untouched(status,run,message){const before=reviews(),res=await run(),data=await res.json();assert.equal(res.status,status,JSON.stringify(data));
  if(message)assert.equal(data.error,message);assert.equal(reviews(),before);return data;}
await untouched(403,()=>post(review('approve_over_cap')),'Only the company owner can review an over-cap confirmation.');
await untouched(403,()=>post(review('hold_note')),'Only the company owner can review an over-cap confirmation.');
s.user='owner';s.verifiedAt=undefined;
assert.equal((await untouched(403,()=>post(review('approve_over_cap')))).code,'reauthentication_required');
s.verifiedAt=Date.now()-60_000;// The route has no injected clock, so the password confirmation is a minute ago in real time.
await untouched(409,()=>post(review('approve_over_cap')),'This confirmation is within its cap and needs no owner review.');
await untouched(400,()=>post(review('hold_note',{note:' '})),'Say what should happen with this order.');
await untouched(400,()=>post(review('reject')),'Choose record, approve_over_cap or hold_note.');
await untouched(400,()=>post(review('approve_over_cap',{amount:'1'})));
s.user='manager';
console.log('PASS: owner review over HTTP: managers refused by the service, password confirmation required, strict input and no review within the cap.');
console.log('PASS: confirmation HTTP identity/company/role, default-off loopback, actual CSRF/origin, strict intent, concurrent replay and private responses.');
