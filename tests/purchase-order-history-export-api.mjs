import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {historyFixture} from './helpers/purchase-order-history-export.mjs';
const f=await historyFixture();globalThis.__historyApi=f.state;
try{
  await build({entryPoints:['src/app/api/purchase-order-history-exports/route.ts'],bundle:true,platform:'node',format:'esm',
    outfile:'.sites-runtime/purchase-order-history-export-api-tests.mjs',plugins:[{name:'history-http',setup(b){
      b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth))$/},args=>({path:args.path,namespace:'history-http'}));
      b.onLoad({filter:/.*/,namespace:'history-http'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__historyApi.env;':
        args.path==='@/db/raw'?'export const database=()=>globalThis.__historyApi.db;':
        args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>{if(globalThis.__historyApi.identityUnavailable)throw Error("PRIVATE_AUTH_DETAIL");return globalThis.__historyApi.user?{userId:globalThis.__historyApi.user}:null;};':
        'export const csrf=()=>false;export const audit=()=>({run:async()=>{throw Error("Read must not audit/write");}});',loader:'js'}));
    }}]});
  const api=await import('../.sites-runtime/purchase-order-history-export-api-tests.mjs');assert.deepEqual(Object.keys(api),['GET']);
  const order=await f.drafts.create(f.create()),path='/api/purchase-order-history-exports?companyId=a';
  const get=(url=path)=>api.GET(new Request('http://127.0.0.1'+url));
  const check=async(response,status)=>{assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('pragma'),'no-cache');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    if(status!==200)assert.ok(!/PRIVATE_|snapshot_json|capMinor|estimatedLineMinor|orders@example/.test(await response.text()));};
  let before=f.allTables();
  for(const [user,status] of [[null,401],['employee',403],['b-manager',403]]){f.state.user=user;await check(await get(),status);}
  f.state.user='manager';await check(await get(path.replace('=a','=b')),403);
  for(const flag of ['disabled',undefined]){f.state.env.PANTRACK_PO_DRAFT_PREVIEW=flag;await check(await get(),404);}
  f.state.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';
  for(const tail of ['&offset=0','&q=x&q=y','&companyId=b','&status=sent','&expected=bad','&extra='+('x'.repeat(9000))])await check(await get(path+tail),400);
  await check(await get(path+'&q=missing'),404);
  for(const user of ['owner','manager']){f.state.user=user;const response=await get();await check(response,200);assert.equal((await response.json()).history.orderCount,1);}
  const saved=(await(await get()).json()).history;assert.equal(f.allTables(),before);
  f.state.beforeHistoryRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");await check(await get(),403);
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.state.beforeHistoryRead=()=>f.drafts.edit(f.edit(order));await check(await get(path+'&expected='+saved.fingerprint),409);
  f.state.beforeHistoryRead=()=>{throw Error('PRIVATE_DATABASE_DETAIL');};await check(await get(),503);
  f.state.identityUnavailable=true;await check(await get(),503);f.state.identityUnavailable=false;
  const server=createServer(async(req,res)=>{const response=await api.GET(new Request('http://127.0.0.1'+req.url));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{before=f.allTables();const url=`http://127.0.0.1:${server.address().port}${path}`;await check(await fetch(url),200);
    f.state.user=null;await check(await fetch(url),401);f.state.user='employee';await check(await fetch(url),403);assert.equal(f.allTables(),before);
  }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  f.state.user='manager';for(let n=0;n<100;n++)await f.drafts.create(f.create());
  before=f.allTables();await check(await get(),413);assert.equal(f.allTables(),before);
  assert.equal(f.state.lastHistoryRows.length,1);assert.equal(f.state.lastHistoryRows[0].snapshot_json,null);
}finally{f.sql.close();delete globalThis.__historyApi;}
console.log('PASS: real history HTTP authorization wrapper, anonymous/wrong-company/role/default-off guards, strict all-pages query, concurrent edits/revocation, private/no-store errors, loopback transport and zero writes.');
