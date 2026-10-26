import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {exportFixture} from './helpers/purchase-order-export.mjs';
const f=await exportFixture();let beforeRead=null,reads=0;
const db={prepare:sql=>{
  const history=sql.includes('WITH allowed AS');
  function wrap(statement){return new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values)=>wrap(target.bind(...values));
    if(key==='all'&&history)return async(...args)=>{reads++;const hook=beforeRead;beforeRead=null;if(hook)await hook();return target.all(...args);};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}
  return wrap(f.db.prepare(sql));
}};
f.state.db=db;globalThis.__poHistory=f.state;
try{
  await build({stdin:{contents:"export * from './src/lib/d1-purchase-order-history.ts';export * from './src/lib/purchase-order-history-contract.ts';export {GET} from './src/app/api/purchase-orders/route.ts';",resolveDir:process.cwd()},
    bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/purchase-order-history-tests.mjs',plugins:[{name:'history-http',setup(b){
      b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth|a8-review-source))$/},args=>({path:args.path,namespace:'history-http'}));
      b.onLoad({filter:/.*/,namespace:'history-http'},args=>({contents:
        args.path==='cloudflare:workers'?'export const env=globalThis.__poHistory.env;':
        args.path==='@/db/raw'?'export const database=()=>globalThis.__poHistory.db;':
        args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>{if(globalThis.__poHistory.unavailable)throw Error("PRIVATE_AUTH");return globalThis.__poHistory.user?{userId:globalThis.__poHistory.user}:null;};':
        args.path==='@/lib/auth'?'export const csrf=()=>false;export const audit=()=>({run:async()=>{throw Error("History must not audit a mutation");}});':
        'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
    }}]});
  const core=await import('../.sites-runtime/purchase-order-history-tests.mjs'),reader=new core.D1PurchaseOrderHistory(db,{identity:async()=>f.state.user});
  const alpha={...f.supplier,id:'alpha-id',name:'Alpha Café %_ Supply'},beta={...f.supplier,id:'beta-id',name:'Beta Supplies'};
  const orders=[];
  for(let n=0;n<27;n++){
    let order=await f.drafts.create(f.create({supplier:alpha}));
    if(n<3)order=await f.drafts.review({action:'review',companyId:'a',orderId:order.snapshot.id,expectedRevision:1,operationId:crypto.randomUUID(),acknowledgeWarnings:true});
    if(n>=3&&n<5)order=await f.drafts.cancel({action:'cancel',companyId:'a',orderId:order.snapshot.id,expectedRevision:1,operationId:crypto.randomUUID(),reason:'Fictional history fixture'});
    orders.push(order);
  }
  for(let n=0;n<5;n++)orders.push(await f.drafts.create(f.create({supplier:beta})));
  const quoted=await f.drafts.create(f.create({supplier:{...f.supplier,id:'literal',name:"Quote ' OR 1=1--"}}));orders.push(quoted);
  let renamed=await f.drafts.create(f.create({supplier:{...f.supplier,id:'renamed',name:'Old supplier name'}}));
  renamed=await f.drafts.edit(f.edit(renamed,{supplier:{...f.supplier,id:'renamed',name:'New supplier name'}}));orders.push(renamed);
  assert.equal((await f.drafts.get('a',renamed.snapshot.id,1)).snapshot.supplier.name,'Old supplier name');
  f.state.user='b-manager';const foreign=await f.drafts.create(f.create({companyId:'b',supplier:alpha,notes:'PRIVATE_OTHER_COMPANY'}));f.state.user='manager';
  const list=(filters={},offset=0,companyId='a')=>reader.list({companyId,offset,filters});
  const sorted=orders.slice().sort((a,b)=>a.snapshot.id<b.snapshot.id?1:-1);
  const before=f.allTables(),oldFetch=globalThis.fetch;let providers=0;globalThis.fetch=()=>{providers++;throw Error('No provider in history.');};
  try{
    const start=reads,first=await list(),second=await list({},20),empty=await list({},1_000_000);
    assert.equal(reads,start+3,'One membership/data statement per page, including an empty offset.');
    assert.deepEqual([...first.orders,...second.orders].map(row=>row.id),sorted.map(order=>order.snapshot.id));
    assert.equal(first.orders.length,20);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.deepEqual(empty,{orders:[],hasMore:false});
    const alphaFirst=await list({supplier:'ALPHA-ID'}),alphaNext=await list({supplier:'alpha café'},20);
    assert.equal(alphaFirst.orders.length,20);assert.equal(alphaFirst.hasMore,true);assert.equal(alphaNext.orders.length,7);
    assert.equal(new Set([...alphaFirst.orders,...alphaNext.orders].map(row=>row.id)).size,27);
    assert.equal((await list({supplier:'Alpha',status:'reviewed'})).orders.length,3);
    assert.equal((await list({supplier:'Alpha',status:'canceled'})).orders.length,2);
    assert.equal((await list({q:'beta',supplier:'alpha'})).orders.length,0);
    assert.deepEqual((await list({q:quoted.snapshot.number.toLowerCase()})).orders.map(row=>row.id),[quoted.snapshot.id]);
    assert.deepEqual((await list({q:"' OR 1=1--"})).orders.map(row=>row.id),[quoted.snapshot.id]);
    assert.equal((await list({q:'%_'})).orders.length,20);assert.equal((await list({q:'no%_match'})).orders.length,0);
    assert.equal((await list({supplier:'Old supplier name'})).orders.length,0);
    assert.deepEqual((await list({supplier:' New supplier name '})).orders.map(row=>row.id),[renamed.snapshot.id]);
    assert.deepEqual(await f.drafts.list('a',0,{supplier:'beta'}),await list({supplier:'beta'}));
    for(const user of [null,'employee','b-manager']){f.state.user=user;await assert.rejects(list(),error=>error.code==='forbidden');}
    f.state.user='owner';assert.equal((await list()).orders.length,20);
    f.state.user='manager';await assert.rejects(list({},0,'b'),error=>error.code==='forbidden');
    f.state.user='b-manager';assert.deepEqual((await list({q:'Alpha'},0,'b')).orders.map(row=>row.id),[foreign.snapshot.id]);f.state.user='manager';
    for(const value of [{companyId:'a',offset:-1},{companyId:'a',offset:1.5},{companyId:'a',offset:1_000_001},
      {companyId:'a',filters:{q:'x'.repeat(201)}},{companyId:'a',filters:{status:'approved'}},{companyId:'a',filters:{companyId:'b'}}]){
      await assert.rejects(reader.list(value),error=>error.code==='invalid_request');
    }
    assert.equal(providers,0);assert.equal(f.allTables(),before);
  }finally{globalThis.fetch=oldFetch;}
  beforeRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
  await assert.rejects(list({q:'no-match'}),error=>error.code==='forbidden');
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");

  const get=(query='')=>core.GET(new Request('http://127.0.0.1:5198/api/purchase-orders?companyId=a'+query));
  const check=async(query,status)=>{const response=await get(query);assert.equal(response.status,status,query);assert.equal(response.headers.get('cache-control'),'private, no-store');return response;};
  for(const [user,status] of [[null,401],['employee',403],['b-manager',403]]){f.state.user=user;await check('&q=Alpha',status);}f.state.user='manager';
  f.state.env.PANTRACK_PO_DRAFT_PREVIEW='disabled';await check('&q=Alpha',404);f.state.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';
  let response=await check('&supplier=Alpha&status=reviewed',200);assert.equal((await response.json()).orders.length,3);
  response=await check('&q=beta',200);assert.equal((await response.json()).orders.length,5);
  response=await check('&q=missing',200);assert.deepEqual(await response.json(),{orders:[],hasMore:false});
  for(const query of ['&offset=01','&offset=1e2','&offset=-1','&offset=1.2','&offset=1000001','&status=approved','&status=',
    '&q=x&q=y','&supplier=x&supplier=y','&companyId=b','&status=draft&status=reviewed','&offset=0&offset=20','&unknown=x',
    '&view=choices&q=x','&orderId='+quoted.snapshot.id+'&q=x','&q='+('x'.repeat(201)), '&supplier='+('x'.repeat(201)), '&q='+('x'.repeat(9000))])await check(query,400);
  await check('&view=choices',200);await check('&orderId='+quoted.snapshot.id,200);
  beforeRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");await check('&supplier=Alpha',403);
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  beforeRead=()=>{throw Error('PRIVATE_SQL_DETAIL');};response=await check('&q=Alpha',503);
  const failed=await response.json();assert.equal(failed.uncertain,undefined);assert.ok(!JSON.stringify(failed).includes('PRIVATE_'));
  f.state.unavailable=true;await check('&q=Alpha',503);f.state.unavailable=false;assert.equal(f.allTables(),before);
  const server=createServer(async(req,res)=>{const response=await core.GET(new Request('http://127.0.0.1'+req.url));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/purchase-orders?companyId=a&supplier=Beta&status=draft`);
    assert.equal(response.status,200);assert.equal((await response.json()).orders.length,5);
  }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  assert.equal(f.allTables(),before);
}finally{f.sql.close();delete globalThis.__poHistory;}
console.log('PASS: company-bound single-read current history, combined literal filters, before-pagination matching, deterministic pages/empty offsets, role races, strict HTTP inputs, private read errors and zero writes/providers.');
