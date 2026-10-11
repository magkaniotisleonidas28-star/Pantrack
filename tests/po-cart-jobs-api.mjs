import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {jobFixture,enqueue,cancel,snapshot} from './helpers/po-cart-jobs.mjs';

const f=await jobFixture();
globalThis.__cartJobApi={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled'}};
await build({entryPoints:['src/app/api/po-cart-jobs/route.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-jobs-api.mjs',plugins:[{name:'cart-job-http',setup(b){
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|a8-review-source))$/},a=>({path:a.path,namespace:'job-http'}));
    b.onLoad({filter:/.*/,namespace:'job-http'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__cartJobApi.env;':
      a.path==='@/db/raw'?'export const database=()=>globalThis.__cartJobApi.db;':
      a.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__cartJobApi.user?{userId:globalThis.__cartJobApi.user}:null;':
      'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
  }}]});
const api=await import('../.sites-runtime/po-cart-jobs-api.mjs'),origin='http://127.0.0.1:5181';
const post=(body,headers={},host=origin,query='')=>api.POST(new Request(host+'/api/po-cart-jobs'+query,{method:'POST',
  headers:{origin:host,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
const get=(companyId,jobId,host=origin,extra='')=>api.GET(new Request(`${host}/api/po-cart-jobs?companyId=${companyId}&jobId=${jobId}${extra}`));
const manager=(companyId,orderId,extra='')=>api.GET(new Request(`${origin}/api/po-cart-jobs?view=manager&companyId=${companyId}&orderId=${orderId}${extra}`));
async function denied(status,fn){const before=snapshot(f),r=await fn();assert.equal(r.status,status,await r.text());assert.equal(snapshot(f),before);}
try{
  const a=await f.authorized(),input={...enqueue(a),browser:{layout:'rows',scenario:'normal'}};
  for(const user of [null,'employee','b-manager','revoked']){
    globalThis.__cartJobApi.user=user;await denied(user?403:401,()=>post(input));await denied(user?403:401,()=>get('a','unknown'));await denied(user?403:401,()=>manager('a',a.orderId));
  }
  globalThis.__cartJobApi.user='manager';await denied(403,()=>post({...input,companyId:'b'}));await denied(403,()=>get('b','unknown'));
  await denied(403,()=>manager('b',a.orderId));await denied(404,()=>manager('a','unknown'));
  globalThis.__cartJobApi.user='b-manager';await denied(404,()=>manager('b',a.orderId));globalThis.__cartJobApi.user='manager';
  await denied(400,()=>manager('a',a.orderId,'&jobId=unknown'));await denied(400,()=>manager('a',a.orderId,'&actor=owner'));
  const initial=await (await manager('a',a.orderId)).json();assert.equal(initial.mode,'preview');assert.equal(initial.job,null);assert.equal(initial.authorization.id,a.id);
  globalThis.__cartJobApi.env.PANTRACK_CART_BROWSER_LOCAL='enabled';
  globalThis.__cartJobApi.env.PANTRACK_CART_PREVIEW='disabled';await denied(404,()=>post(input));await denied(404,()=>get('a','unknown'));
  globalThis.__cartJobApi.env.PANTRACK_CART_PREVIEW='enabled';
  for(const host of ['http://localhost:5181','https://pantrack.example.invalid','http://192.0.2.1']){
    await denied(404,()=>post(input,{},host));await denied(404,()=>get('a','unknown',host));
  }
  for(const headers of [{origin:''},{origin:'https://evil.example'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'}])await denied(403,()=>post(input,headers));
  for(const extra of [{actor:'owner'},{workerId:'one'},{fence:1},{inputs:{}},{capMinor:'1'},{expectedRevision:0},{operationId:'bad'},
    {browser:{layout:'bad',scenario:'normal'}},{browser:{layout:'rows',scenario:'normal',token:'private'}},{action:'recordBaseline'},{action:'finalizeCart'},{action:'hold'},{action:'claim'},{action:'heartbeat'},{action:'beginAttempt'},{action:'recordResult'},{action:'recoverExpired'}])await denied(400,()=>post({...input,...extra}));
  await denied(404,()=>get('a','unknown'));await denied(400,()=>get('a','unknown',origin,'&actor=owner'));
  f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");
  await denied(403,()=>post(input));assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_jobs').get().n,0);
  f.sql.exec("INSERT INTO memberships VALUES('manager','a','manager')");
  f.db.loseAcknowledgment=true;const first=await post(input);assert.equal(first.status,200);assert.match(first.headers.get('cache-control'),/private, no-store/);
  const saved=await first.json(),j=saved.current.job;assert.equal(j.state,'queued');assert.deepEqual(await (await post(input)).json(),saved);
  assert.deepEqual(await (await get('a',j.id)).json(),saved.current);
  const minimal=await (await post(input,{},origin,'?view=manager')).json();assert.deepEqual(Object.keys(minimal),['receipt']);
  assert.deepEqual(Object.keys(minimal.receipt).sort(),['action','at','jobId','operationId','revision']);assert.equal(minimal.receipt.operationId,input.operationId);
  const projected=await manager('a',a.orderId),view=await projected.json();assert.match(projected.headers.get('cache-control'),/private, no-store/);
  assert.equal(view.mode,'durable');assert.equal(view.job.id,j.id);assert.equal(view.authorization.reservation.state,'reserved');
  assert.deepEqual(Object.keys(view).sort(),['actorId','authorization','job','mode']);
  assert.ok(!JSON.stringify(view).match(/observation|ownership|workerId|inputs|token|cookie|profile|sessionUrl|supplierId|accountId/));
  await denied(409,()=>post({...input,operationId:randomUUID()}));globalThis.__cartJobApi.user='owner';await denied(409,()=>post(input));
  assert.equal((await get('a',j.id)).status,200);globalThis.__cartJobApi.user='manager';
  globalThis.__cartJobApi.user='b-manager';await denied(404,()=>get('b',j.id));globalThis.__cartJobApi.user='manager';
  const c=cancel(j);
  for(const user of [null,'employee','b-manager','revoked']){globalThis.__cartJobApi.user=user;await denied(user?403:401,()=>post(c));}
  globalThis.__cartJobApi.user='manager';
  await denied(403,()=>post(c,{origin:'https://evil.example'}));await denied(400,()=>post({...c,reason:''}));await denied(400,()=>post({...c,actor:'owner'}));
  await denied(409,()=>post({...c,expectedRevision:999}));
  f.db.beforeBatch=()=>f.sql.exec("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'");await denied(403,()=>post(c));
  await denied(403,()=>get('a',j.id));f.sql.exec("INSERT INTO memberships VALUES('manager','a','manager')");
  const done=await post(c);assert.equal(done.status,200);const canceled=await done.json();assert.equal(canceled.current.authorization.reservation.state,'released');
  assert.equal(canceled.current.ownership.jobId,null);assert.deepEqual(await (await post(c)).json(),canceled);
  const stopped=await (await manager('a',a.orderId)).json();assert.equal(stopped.job.state,'canceled');assert.equal(stopped.authorization.reservation.state,'released');
  const historical=await (await post(input)).json();assert.deepEqual(historical.receipt,saved.receipt);assert.equal(historical.current.valid,false);
  assert.equal(historical.current.job.state,'canceled');await denied(409,()=>post({...c,reason:'Different reason'}));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM security_audit').get().n,0);
}finally{f.sql.close();delete globalThis.__cartJobApi;}
console.log('PASS: job API identity/company/role/revocation, actual CSRF, loopback gate, strict manager-only intent, lost response and permanent replay beside current status.');
