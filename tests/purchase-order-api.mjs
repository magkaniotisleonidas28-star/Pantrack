import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';
const f=await fixture();
globalThis.__poApi={db:f.db,user:'manager',env:{PANTRACK_PO_DRAFT_PREVIEW:'enabled'},csrf:true};
await build({entryPoints:['src/app/api/purchase-orders/route.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-api.mjs',plugins:[{name:'po-http-dependencies',setup(b){
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth|a8-review-source))$/},args=>({path:args.path,namespace:'po-http'}));
    b.onLoad({filter:/.*/,namespace:'po-http'},args=>({contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__poApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__poApi.db;':
      args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__poApi.user?{userId:globalThis.__poApi.user}:null;':
      args.path==='@/lib/auth'?'export const csrf=()=>globalThis.__poApi.csrf; export const audit=()=>({run:async()=>{}});':
      'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-api.mjs');
const body={action:'create',source:'manual',companyId:'a',operationId:'http-create',
  supplier:{id:'supplier',name:'Fictional Supplier',email:'orders@example.invalid',accountId:'account',locationId:'café',deliveryAddress:'123 Example Street'},
  capMinor:'5000',notes:'',lines:[{kind:'non_stock',sku:'NONSTOCK',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:null}]};
const get=(company='a',query='')=>api.GET(new Request(`http://localhost/api/purchase-orders?companyId=${company}${query}`));
const post=(data=body)=>api.POST(new Request('http://localhost/api/purchase-orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}));
globalThis.__poApi.user=null;assert.equal((await get()).status,401);assert.equal((await post()).status,401);
for(const user of ['employee','b-manager']){globalThis.__poApi.user=user;assert.equal((await get()).status,403);assert.equal((await post()).status,403);}
globalThis.__poApi.user='manager';assert.equal((await get('b')).status,403);
globalThis.__poApi.env.PANTRACK_PO_DRAFT_PREVIEW='disabled';assert.equal((await get()).status,404);assert.equal((await post()).status,404);
globalThis.__poApi.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';globalThis.__poApi.csrf=false;assert.equal((await post()).status,403);globalThis.__poApi.csrf=true;
const response=await post();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
const order=(await response.json()).order;
assert.deepEqual((await (await post()).json()).order,order);
assert.equal((await (await get()).json()).orders.length,1);
assert.deepEqual((await (await get('a',`&orderId=${order.snapshot.id}`)).json()).order,order);
assert.equal((await get('a','&offset=-1')).status,400);assert.equal((await get('a','&orderId=foreign')).status,404);
assert.equal((await get('a','&view=choices')).status,200);
assert.equal((await post({...body,action:'send'})).status,400);
assert.equal((await post({...body,operationId:'bad',lines:[{...body.lines[0],packs:'0'}]})).status,400);
assert.equal((await post({...body,notes:'changed'})).status,409);
const edit={...body,action:'edit',operationId:'http-edit',orderId:order.snapshot.id,expectedRevision:1,reason:'Correct bags quantity',lines:[{...body.lines[0],packs:'3'}]};
const review={action:'review',companyId:'a',orderId:order.snapshot.id,operationId:'http-review',expectedRevision:2,acknowledgeWarnings:true};
for(const user of [null,'employee','b-manager']){
  globalThis.__poApi.user=user;
  assert.equal((await post(edit)).status,user?403:401);assert.equal((await post(review)).status,user?403:401);
  assert.equal((await get('a',`&orderId=${order.snapshot.id}&revision=1`)).status,user?403:401);
}globalThis.__poApi.user='manager';
globalThis.__poApi.csrf=false;assert.equal((await post(edit)).status,403);assert.equal((await post(review)).status,403);globalThis.__poApi.csrf=true;
assert.equal((await post({...edit,companyId:'b'})).status,403);
assert.equal((await post(edit)).status,200);assert.equal((await post({...edit,operationId:'stale-edit'})).status,409);
assert.equal((await post(review)).status,200);
const reviewed=(await (await post(review)).json()).order;assert.equal(reviewed.status,'reviewed');assert.equal(reviewed.review.contentRevision,2);
assert.deepEqual((await (await get('a',`&orderId=${order.snapshot.id}&revision=1`)).json()).order,order);
assert.equal((await get('a',`&orderId=${order.snapshot.id}&revision=0`)).status,400);
assert.equal((await get('a',`&orderId=${order.snapshot.id}&revision=999`)).status,404);
assert.equal((await get('a','&revision=1')).status,400);
assert.equal((await post({...review,action:'approve'})).status,400);
const canceled=await post({action:'cancel',companyId:'a',orderId:order.snapshot.id,operationId:'http-cancel',expectedRevision:3,reason:'Reviewed replacement'});
assert.equal(canceled.status,200);assert.equal((await canceled.json()).order.status,'canceled');
globalThis.__poApi.user='employee';assert.equal((await get('a',`&orderId=${order.snapshot.id}`)).status,403);
assert.equal((await post({action:'cancel',companyId:'a',orderId:order.snapshot.id,operationId:'employee-cancel',expectedRevision:2,reason:'Forbidden cancellation'})).status,403);
globalThis.__poApi.user='owner';assert.equal((await get()).status,200);
f.sql.close();delete globalThis.__poApi;
console.log('PASS: PO route anonymous/company/role/gate/CSRF guards, draft create/detail/history/cancel, replay/conflicts, strict actions and private no-store responses.');
