import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {exportFixture} from './helpers/purchase-order-export.mjs';
const f=await exportFixture();globalThis.__poExportApi=f.state;
try{
  await build({entryPoints:['src/app/api/purchase-order-exports/route.ts'],bundle:true,platform:'node',format:'esm',
    outfile:'.sites-runtime/purchase-order-export-api-tests.mjs',plugins:[{name:'export-http',setup(b){
      b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth))$/},args=>({path:args.path,namespace:'export-http'}));
      b.onLoad({filter:/.*/,namespace:'export-http'},args=>({contents:
        args.path==='cloudflare:workers'?'export const env=globalThis.__poExportApi.env;':
        args.path==='@/db/raw'?'export const database=()=>globalThis.__poExportApi.db;':
        args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>{if(globalThis.__poExportApi.identityUnavailable)throw Error("PRIVATE_AUTH_DETAIL");return globalThis.__poExportApi.user?{userId:globalThis.__poExportApi.user}:null;};':
        'export const csrf=()=>false;export const audit=()=>({run:async()=>{throw Error("GET must not write an audit");}});',loader:'js'}));
    }}]});
  const api=await import('../.sites-runtime/purchase-order-export-api-tests.mjs');
  assert.deepEqual(Object.keys(api),['GET'],'This endpoint exposes no mutation method.');
  const order=await f.drafts.create(f.create({lines:[{...f.nonStock,estimatedUnitMinor:'100'},
    {...f.nonStock,sku:'UNKNOWN',description:'Price unavailable',packs:'1'}]}));
  const path=`/api/purchase-order-exports?companyId=a&orderId=${order.snapshot.id}&revision=1`;
  const get=(url=path)=>api.GET(new Request('http://127.0.0.1:5198'+url));
  const check=async(response,status)=>{
    assert.equal(response.status,status);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('pragma'),'no-cache');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    if(status!==200){const text=await response.text();
      for(const forbidden of ['estimatedLineMinor','capMinor','snapshot_json','orders@example.invalid','PRIVATE_AUTH_DETAIL','PRIVATE_DATABASE_DETAIL'])assert.ok(!text.includes(forbidden));}
  };
  let before=f.allTables();
  for(const [user,status] of [[null,401],['employee',403],['b-manager',403]]){
    f.state.user=user;await check(await get(),status);
  }
  f.state.user='manager';await check(await get(path.replace('companyId=a','companyId=b')),403);
  f.state.user='b-manager';await check(await get(path.replace('companyId=a','companyId=b')),404);
  f.state.user='manager';
  f.state.env.PANTRACK_PO_DRAFT_PREVIEW='disabled';await check(await get(),404);delete f.state.env.PANTRACK_PO_DRAFT_PREVIEW;
  await check(await get(),404);f.state.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';
  assert.equal(f.allTables(),before);
  for(const revision of ['','0','01','1.0','1.5','1e0','-1','Infinity','9007199254740992']){
    await check(await get(path.replace('revision=1','revision='+revision)),400);
  }
  for(const url of [path.replace('&revision=1',''),path+'&revision=1',path+'&companyId=b',path+'&snapshot=client-value',
    path.replace(/orderId=[^&]+/,'orderId='),path+'&extra='+('x'.repeat(2200))])await check(await get(url),400);
  await check(await get(path.replace('revision=1','revision=999')),409);
  await check(await get(path.replace(/orderId=[^&]+/,'orderId=missing')),404);
  for(const user of ['manager','owner']){
    f.state.user=user;const response=await get();await check(response,200);const exported=(await response.json()).export;
    assert.equal(exported.revision,1);assert.equal(exported.draft.companyId,'a');
    assert.equal(exported.draft.lines[0].estimatedLineMinor,'200');assert.equal(exported.draft.lines[1].estimatedLineMinor,null);
    assert.equal(exported.draft.pricesComplete,false);assert.equal(exported.draft.knownSubtotalMinor,'200');
  }
  assert.equal(f.allTables(),before);f.state.user='manager';
  f.state.beforeExportRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
  await check(await get(),403);
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.state.beforeExportRead=()=>f.drafts.edit(f.edit(order));await check(await get(),409);
  const current=await f.drafts.get('a',order.snapshot.id);await check(await get(path.replace('revision=1','revision='+current.revision)),200);
  f.state.beforeExportRead=()=>{throw Error('PRIVATE_DATABASE_DETAIL');};
  await check(await get(path.replace('revision=1','revision='+current.revision)),503);
  f.state.identityUnavailable=true;await check(await get(),503);f.state.identityUnavailable=false;

  // Exercise the actual route and authorization wrapper over loopback HTTP, with injected identity only.
  const server=createServer(async(req,res)=>{
    const response=await api.GET(new Request('http://127.0.0.1'+req.url));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{
    before=f.allTables();const url=`http://127.0.0.1:${server.address().port}${path.replace('revision=1','revision='+current.revision)}`;
    await check(await fetch(url),200);f.state.user=null;await check(await fetch(url),401);f.state.user='employee';await check(await fetch(url),403);
    assert.equal(f.allTables(),before);
  }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
}finally{f.sql.close();delete globalThis.__poExportApi;}
console.log('PASS: saved-export HTTP anonymous/company/role/default-off guards, canonical pinned revisions, concurrent revocation/edit refusal, private errors/no-store headers, zero writes and actual loopback transport.');
