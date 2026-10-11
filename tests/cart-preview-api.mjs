import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';
const f=await fixture();globalThis.__cartApi={db:f.db,user:'manager',csrf:true,env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({entryPoints:['src/app/api/cart-preview-context/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/cart-api.mjs',plugins:[{name:'cart-dependencies',setup(b){
  b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth))$/},a=>({path:a.path,namespace:'cart-test'}));
  b.onLoad({filter:/.*/,namespace:'cart-test'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__cartApi.env;':a.path==='@/db/raw'?'export const database=()=>globalThis.__cartApi.db;':a.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__cartApi.user?{userId:globalThis.__cartApi.user}:null;':'export const csrf=()=>globalThis.__cartApi.csrf;export const audit=()=>({run:async()=>{}});',loader:'js'}));
}}]});
const api=await import('../.sites-runtime/cart-api.mjs');
const request=(body={companyId:'a',orderId:'missing'},host='127.0.0.1')=>api.POST(new Request(`http://${host}/api/cart-preview-context`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
globalThis.__cartApi.user=null;assert.equal((await request()).status,401);
for(const user of ['employee','b-manager']){globalThis.__cartApi.user=user;assert.equal((await request()).status,403);}
globalThis.__cartApi.user='manager';assert.equal((await request({companyId:'b',orderId:'missing'})).status,403);
globalThis.__cartApi.csrf=false;assert.equal((await request()).status,403);globalThis.__cartApi.csrf=true;
globalThis.__cartApi.env.PANTRACK_CART_PREVIEW='disabled';assert.equal((await request()).status,404);globalThis.__cartApi.env.PANTRACK_CART_PREVIEW='enabled';
assert.equal((await request(undefined,'example.com')).status,404);assert.equal((await request()).status,404);assert.equal((await request({companyId:'a',orderId:'x',actor:'owner'})).status,400);
// Seed through the real draft service to verify the returned context is server-derived.
await build({stdin:{contents:"export {D1PurchaseOrderDrafts} from './src/lib/d1-purchase-order-drafts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/cart-po.mjs'});
const {D1PurchaseOrderDrafts}=await import('../.sites-runtime/cart-po.mjs'),store=new D1PurchaseOrderDrafts(f.db,{identity:async()=>'manager'});
const created=await store.create({action:'create',source:'manual',companyId:'a',operationId:'fixture',supplier:{id:'demo',name:'Demo',email:'demo@example.invalid',accountId:'demo',locationId:'demo',deliveryAddress:'123 Example Street'},capMinor:'50000',notes:'',lines:[{kind:'non_stock',sku:'DEMO',description:'Coffee',unitLabel:'case',packs:'2',estimatedUnitMinor:'100'}]});
const response=await request({companyId:'a',orderId:created.snapshot.id});assert.equal(response.status,200);assert.equal((await response.json()).actor,'manager');assert.match(response.headers.get('cache-control'),/no-store/);
globalThis.__cartApi.user='owner';assert.equal((await request({companyId:'a',orderId:created.snapshot.id})).status,200);
f.sql.close();delete globalThis.__cartApi;console.log('PASS: cart context anonymous/company/role/CSRF/loopback/default-off guards and server-derived draft identity.');
