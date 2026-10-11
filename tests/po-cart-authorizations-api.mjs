import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {cartFixture,command,cancelCommand,tables,cartTables} from './helpers/po-cart-authorizations.mjs';

const f=await cartFixture();
globalThis.__cartAuthApi={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({entryPoints:['src/app/api/po-cart-authorizations/route.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-authorization-api.mjs',plugins:[{name:'cart-auth-http-dependencies',setup(b){
    // Keep the actual company wrapper and CSRF function. Only identity/database/environment are fixtures.
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|a8-review-source))$/},args=>({path:args.path,namespace:'cart-http'}));
    b.onLoad({filter:/.*/,namespace:'cart-http'},args=>({contents:
      args.path==='cloudflare:workers'?'export const env=globalThis.__cartAuthApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__cartAuthApi.db;':
      args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__cartAuthApi.user?{userId:globalThis.__cartAuthApi.user}:null;':
      'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-cart-authorization-api.mjs');
const origin='http://127.0.0.1:5181';
const post=(body,extra={},host=origin,query='')=>api.POST(new Request(host+'/api/po-cart-authorizations'+query,{method:'POST',
  headers:{origin:host,'content-type':'application/json',...extra},body:JSON.stringify(body)}));
const get=(companyId,orderId,host=origin,query='')=>api.GET(new Request(`${host}/api/po-cart-authorizations?companyId=${companyId}&orderId=${orderId}${query}`));
const state=()=>tables(f.sql,cartTables);
async function denied(code,fn){const before=state(),res=await fn();assert.equal(res.status,code,await res.text());assert.equal(state(),before);}
try{
  const order=await f.reviewed({lines:[await f.stock('http-stock')]}),input=command(order);
  for(const user of [null,'employee','b-manager','revoked']){
    globalThis.__cartAuthApi.user=user;
    await denied(user?403:401,()=>get('a',input.orderId));await denied(user?403:401,()=>post(input));
  }
  globalThis.__cartAuthApi.user='manager';
  await denied(403,()=>get('b',input.orderId));await denied(403,()=>post({...input,companyId:'b'}));
  globalThis.__cartAuthApi.user='b-manager';await denied(404,()=>get('b',input.orderId));globalThis.__cartAuthApi.user='manager';
  globalThis.__cartAuthApi.env.PANTRACK_CART_PREVIEW='disabled';
  await denied(404,()=>get('a',input.orderId));await denied(404,()=>post(input));
  globalThis.__cartAuthApi.env.PANTRACK_CART_PREVIEW='enabled';
  for(const host of ['https://pantrack.example.invalid','http://localhost:5181','http://192.0.2.1']){
    await denied(404,()=>get('a',input.orderId,host));await denied(404,()=>post(input,{},host));
  }
  for(const headers of [{origin:'https://evil.example'},{origin:''},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await denied(403,()=>post(input,headers));
  for(const extra of [{actor:'owner'},{capMinor:'99999'},{connection:{id:'forged'}},{lines:[]},{expectedRevision:0},
    {operationId:'not-a-uuid'},{action:'start'},{action:'send'},{action:'authorize',authorizationId:'forged'}])await denied(400,()=>post({...input,...extra}));
  await denied(400,()=>get('a',input.orderId,origin,'&actor=owner'));
  const none=await get('a',input.orderId);assert.equal(none.status,200);assert.equal((await none.json()).authorization,null);
  const [r1,r2]=await Promise.all([post(input),post(input)]);
  assert.equal(r1.status,200);assert.equal(r2.status,200);assert.match(r1.headers.get('cache-control'),/no-store/);
  const result=await r1.json();assert.deepEqual(await r2.json(),result);
  const minimal=await (await post(input,{},origin,'?view=manager')).json();assert.deepEqual(Object.keys(minimal),['receipt']);
  assert.deepEqual(Object.keys(minimal.receipt).sort(),['action','at','authorizationId','operationId','revision']);assert.equal(minimal.receipt.operationId,input.operationId);
  assert.equal(result.current.valid,true);assert.equal(result.current.reservation.totalMinor,15000);
  const a=result.current.authorization;
  assert.deepEqual(await (await get('a',input.orderId)).json(),result.current);
  await denied(409,()=>post({...input,operationId:randomUUID()}));
  globalThis.__cartAuthApi.user='owner';await denied(409,()=>post(input));
  assert.equal((await get('a',input.orderId)).status,200);globalThis.__cartAuthApi.user='manager';

  const cancel=cancelCommand(a);
  for(const user of [null,'employee','b-manager']){
    globalThis.__cartAuthApi.user=user;await denied(user?403:401,()=>post(cancel));
  }
  globalThis.__cartAuthApi.user='manager';
  for(const headers of [{origin:'https://evil.example'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await denied(403,()=>post(cancel,headers));
  await denied(400,()=>post({...cancel,reason:''}));await denied(400,()=>post({...cancel,capMinor:'0'}));
  await denied(409,()=>post({...cancel,expectedRevision:999}));
  f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
  await denied(403,()=>post(cancel));
  await denied(403,()=>get('a',input.orderId));
  globalThis.__cartAuthApi.user='owner';assert.equal((await (await get('a',input.orderId)).json()).valid,false);
  f.sql.exec("INSERT INTO memberships VALUES('manager','a','manager')");globalThis.__cartAuthApi.user='manager';
  const done=await post(cancel);assert.equal(done.status,200);
  const released=await done.json();assert.equal(released.current.authorization.status,'canceled');assert.equal(released.current.reservation.state,'released');
  assert.deepEqual(await (await post(cancel)).json(),released);
  const retry=await (await post(input)).json();assert.deepEqual(retry.receipt,result.receipt);assert.equal(retry.current.valid,false);
  assert.equal(retry.current.authorization.status,'canceled');await denied(409,()=>post({...cancel,reason:'Changed reason'}));

  const raceOrder=await f.reviewed(),raceInput=command(raceOrder);
  f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
  await denied(403,()=>post(raceInput));
  f.sql.exec("INSERT INTO memberships VALUES('manager','a','manager')");
  assert.equal((await post(raceInput)).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM security_audit').get().n,0,'Only transactionally saved cart audit is written');
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{f.sql.close();delete globalThis.__cartAuthApi;}
console.log('PASS: cart authorization HTTP identity/company/role/revocation, default-off loopback, actual CSRF/origin, strict intent, replay/current status and private responses.');
