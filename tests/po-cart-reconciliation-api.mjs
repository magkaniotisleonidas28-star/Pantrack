import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {reconciliationFixture} from './helpers/po-cart-reconciliation.mjs';
const f=await reconciliationFixture();
globalThis.__reconcileAPI={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled',PANTRACK_CART_BROWSER_LOCAL:'enabled'}};
await build({entryPoints:['src/app/api/po-cart-jobs/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/reconciliation-api.mjs',plugins:[{name:'reconciliation-http',setup(b){
 b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|a8-review-source))$/},a=>({path:a.path,namespace:'reconcile'}));
 b.onLoad({filter:/.*/,namespace:'reconcile'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__reconcileAPI.env;':a.path==='@/db/raw'?'export const database=()=>globalThis.__reconcileAPI.db;':a.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__reconcileAPI.user?{userId:globalThis.__reconcileAPI.user}:null;':'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));}}]});
const api=await import('../.sites-runtime/reconciliation-api.mjs'),origin='http://127.0.0.1:5181';
const post=(body,host=origin,headers={})=>api.POST(new Request(host+'/api/po-cart-jobs?view=manager',{method:'POST',headers:{origin:host,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
try{
 const s=await f.open();await f.close(s);const body=await f.body(s);
 for(const action of ['acceptVerifiedCart','abandonVerifiedCart']){
  for(const user of [null,'employee','b-manager']){globalThis.__reconcileAPI.user=user;assert.equal((await post({...body,action})).status,user?403:401);}globalThis.__reconcileAPI.user='manager';
  assert.equal((await post({...body,action,companyId:'b'})).status,403);
  for(const patch of [{note:''},{note:'x'.repeat(501)},{expectedAuthorizationRevision:0},{sessionId:'bad'},{operationId:'bad'},{cookie:'private'},{observation:[]}])assert.equal((await post({...body,action,...patch})).status,400);
 }
 assert.equal((await post(body,origin,{origin:'https://external.invalid'})).status,403);
 assert.equal((await post(body,'https://example.invalid')).status,404);
 globalThis.__reconcileAPI.env.PANTRACK_CART_BROWSER_LOCAL='disabled';assert.equal((await post(body)).status,404);globalThis.__reconcileAPI.env.PANTRACK_CART_BROWSER_LOCAL='enabled';
 f.loseDecision();const r=await post(body);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'private, no-store');const saved=await r.json();assert.deepEqual(Object.keys(saved),['receipt']);assert.deepEqual(await(await post(body)).json(),saved);
 for(const key of ['secret','cookie','credential','profile','observation','sessionUrl','fingerprint'])assert.ok(!JSON.stringify(saved).includes(key));
 assert.equal((await post({...body,note:'changed'})).status,409);
 const view=await api.GET(new Request(origin+`/api/po-cart-jobs?view=manager&companyId=a&orderId=${f.j.inputs.snapshot.id}`));assert.equal(view.status,200);const manager=await view.json();assert.equal(manager.job.state,'ready');assert.equal(manager.job.reconciliation.decision.action,'acceptVerifiedCart');
 for(const key of ['credential_id','worker_id','observation_json','receipt_json','fingerprint','profile','secretHash'])assert.ok(!JSON.stringify(manager).includes(key));
}finally{f.sql.close();delete globalThis.__reconcileAPI;}
console.log('PASS: reconciliation manager API anonymous/company/role/CSRF/default-off/strict schema isolation, private minimal receipts and lost-response replay.');
