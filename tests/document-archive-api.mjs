import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';
import {readXlsx,lineRecords} from './helpers/xlsx-reader.mjs';
const require=createRequire(import.meta.url),{Miniflare}=createRequire(require.resolve('wrangler'))('miniflare');
mkdirSync('.sites-runtime/archive-api',{recursive:true});const folder=mkdtempSync(resolve('.sites-runtime/archive-api/run-'));
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response(null)}}',compatibilityDate:'2026-05-15',
  d1Databases:{DB:'00000000-0000-4000-8000-000000000001'},r2Buckets:{DOCUMENT_ARCHIVE:'fictional-documents'}});
const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('DOCUMENT_ARCHIVE');let user='manager',puts=0,gets=0,afterPut=null,afterGet=null;
const state={db,env:{PANTRACK_DOCUMENT_ARCHIVE_PREVIEW:'enabled',DOCUMENT_ARCHIVE:{put:async(...args)=>{puts++;const result=await bucket.put(...args);const hook=afterPut;afterPut=null;if(hook)await hook();return result;},
  get:async(...args)=>{gets++;const result=await bucket.get(...args);const hook=afterGet;afterGet=null;if(hook)await hook();return result;}},
  ASSETS:{fetch:async request=>{assert.equal(request.url,'http://app.test/fonts/NotoSans-Regular.ttf');assert.equal([...request.headers].length,0);return new Response(readFileSync('public/fonts/NotoSans-Regular.ttf'));}}},get user(){return user;}};
globalThis.__archiveApi=state;
await build({stdin:{contents:"export {GET,POST} from './src/app/api/purchase-order-documents/route.ts';"+['d1-purchase-order-drafts','d1-purchase-order-history-exports','purchase-order-archive-client','purchase-order-document-archive-contract','document-byte-digest'].map(n=>`export * from './src/lib/${n}.ts';`).join(''),resolveDir:process.cwd()},
  bundle:true,packages:'external',platform:'node',format:'esm',outfile:folder+'/core.mjs',plugins:[{name:'archive-api-fixture',setup(b){
    b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth))$/},args=>({path:args.path,namespace:'archive-api'}));
    b.onLoad({filter:/.*/,namespace:'archive-api'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__archiveApi.env;':
      args.path==='@/db/raw'?'export const database=()=>globalThis.__archiveApi.db;':args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__archiveApi.user?{userId:globalThis.__archiveApi.user}:null;':
      'export const csrf=req=>req.headers.get("origin")==="http://app.test"&&req.headers.get("content-type")==="application/json";export const audit=()=>{throw Error("Unexpected non-archive audit");};',loader:'js'}));
  }}]});
const core=await import(pathToFileURL(folder+'/core.mjs').href);
const request=async(path,body,headers={})=>{
  const response=await core[body?'POST':'GET'](new Request('http://app.test/api/purchase-order-documents'+path,body?{method:'POST',headers:{origin:'http://app.test','content-type':'application/json','X-Pantrack-Archive-Viewer':user??'',...headers},body:JSON.stringify(body)}:{headers}));
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');return response;
};
const save=body=>request('',body),list=(kind='draft',offset=0,companyId='a')=>request('?'+new URLSearchParams({companyId,view:'list',kind,offset:String(offset),...(kind==='draft'?{orderId:order.snapshot.id}:{})}));
let order;
try{
  for(const e of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)await db.batch(unstable_splitSqlQuery(readFileSync(`drizzle/${e.tag}.sql`,'utf8')).map(sql=>db.prepare(sql)));
  await db.batch([db.prepare("INSERT INTO companies VALUES('a','Fictional archive API a','2026-10-01'),('b','Fictional archive API b','2026-10-01')"),
    db.prepare("INSERT INTO memberships VALUES('manager','a','manager'),('owner','a','owner'),('employee','a','employee'),('b-manager','b','manager')")]);
  const drafts=new core.D1PurchaseOrderDrafts(db,{identity:async()=>user,salesPolicy:{syncEnabled:false,maxLagMs:600000}});
  const input=()=>({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'manual',capMinor:'10000',notes:'Saved document API fixture',
    supplier:{id:'fictional',name:'Fictional Supply',email:'orders@example.invalid',accountId:'account',locationId:'location',deliveryAddress:'Fictional address'},
    lines:[{kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:'125'}]});
  order=await drafts.create(input());const command=(format='xlsx')=>({companyId:'a',operationId:crypto.randomUUID(),format,source:{kind:'draft',orderId:order.snapshot.id,revision:order.revision}});
  const latest=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.at(-1),tables=Object.keys(JSON.parse(readFileSync(`drizzle/meta/${String(latest.idx).padStart(4,'0')}_snapshot.json`,'utf8')).tables).filter(n=>!n.startsWith('document_archive_')).sort();
  const business=async()=>JSON.stringify((await db.batch(tables.map(n=>db.prepare(`SELECT * FROM "${n}"`)))).map(r=>r.results)),before=await business();
  const io={puts,gets};for(const who of [null,'employee','b-manager']){user=who;for(const response of [await save(command()),await list(),await request('?companyId=a&id='+crypto.randomUUID())])assert.equal(response.status,who?403:401);}
  user='manager';assert.equal((await save(command())).status,200); // First valid copy.
  assert.equal((await request('',command(),{'X-Pantrack-Archive-Viewer':'owner'})).status,403);assert.equal(puts,io.puts+1);
  for(const extra of [{bytes:[1]},{actorId:'owner'},{role:'owner'},{key:'private'},{url:'https://example.invalid'}])assert.equal((await save({...command(),...extra})).status,400);
  assert.equal((await request('?companyId=a&view=list&kind=draft&orderId='+order.snapshot.id+'&offset=-1')).status,400);
  assert.equal((await request('?companyId=a&view=list&kind=draft&orderId='+order.snapshot.id+'&offset=9007199254740992')).status,400);
  assert.equal((await (await list('draft',10020)).json()).artifacts.length,0);
  assert.equal((await request('?companyId=a&companyId=b&view=list&kind=history')).status,400);
  assert.equal((await request('',command(),{origin:'https://outside.invalid'})).status,403);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW='disabled';assert.equal((await list()).status,404);assert.equal((await save(command())).status,404);state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW='enabled';
  const artifacts=[];
  for(const format of ['pdf','xlsx']){const selected=command(format),response=await save(selected);assert.equal(response.status,200);const artifact=(await response.json()).artifact;artifacts.push(artifact);
    const read=await request('?'+new URLSearchParams({companyId:'a',id:artifact.id}));assert.equal(read.status,200);assert.equal(read.headers.get('content-type'),core.archiveMediaType(format));assert.equal(read.headers.get('content-length'),String(artifact.size));assert.equal(read.headers.get('x-pantrack-document-size'),String(artifact.size));
    const bytes=new Uint8Array(await read.arrayBuffer());assert.equal(await core.documentByteDigest(bytes),artifact.sha256);if(format==='xlsx')assert.equal(lineRecords(readXlsx(bytes)).length,1);else assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-');
    const previous=puts;assert.deepEqual((await (await save(selected)).json()).artifact,artifact);assert.equal(puts,previous);
  }
  const history=await new core.D1PurchaseOrderHistoryExports(db,{identity:async()=>user}).get({companyId:'a'});
  for(const format of ['pdf','xlsx'])assert.equal((await save({companyId:'a',operationId:crypto.randomUUID(),format,source:{kind:'history',filters:history.filters,fingerprint:history.fingerprint}})).status,200);
  assert.equal((await (await list('history')).json()).artifacts.length,2);assert.equal(await business(),before);
  for(let n=0;n<19;n++)assert.equal((await save(command())).status,200);
  const first=await (await list()).json(),second=await (await list('draft',20)).json();assert.equal(first.artifacts.length,20);assert.equal(first.hasMore,true);assert.equal(second.artifacts.length,2);assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.artifacts,...second.artifacts].map(a=>a.id)).size,22);assert.deepEqual((await (await list()).json()).artifacts.map(a=>a.id),first.artifacts.map(a=>a.id));
  const target=artifacts[1],targetUrl='?'+new URLSearchParams({companyId:'a',id:target.id});
  user='owner';assert.equal((await (await request(targetUrl+'&view=metadata')).json()).artifact.actorId,'manager');user='b-manager';assert.equal((await request(targetUrl.replace('companyId=a','companyId=b'))).status,404);assert.equal((await (await list('history',0,'b')).json()).artifacts.length,0);user='manager';
  afterGet=async()=>db.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();assert.equal((await request(targetUrl)).status,403);await db.prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'").run();
  const lost=command();afterPut=async()=>{throw Error('PRIVATE_LOST_WRITE_RESPONSE');};assert.equal((await save(lost)).status,409);const writes=puts,recovered=await save(lost);assert.equal(recovered.status,200);assert.equal(puts,writes);
  // Exercise the actual client lifecycle against these native resources, losing an HTTP response after commit.
  const stored=new Map(),storage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};let lostReply=true,posted=[],downloaded=0;
  const deps={storage,uuid:()=>crypto.randomUUID(),saved:()=>{},download:()=>downloaded++,fetch:async(url,options={})=>{
    if(options.method==='POST'){posted.push(JSON.parse(options.body));const response=await request('',JSON.parse(options.body),options.headers);if(lostReply){lostReply=false;throw Error('PRIVATE_LOST_HTTP_RESPONSE');}return response;}
    return request(url.slice(url.indexOf('?')));
  }};
  const states=[],selection={companyId:'a',source:{kind:'draft',orderId:order.snapshot.id,revision:order.revision}},client=new core.PurchaseOrderArchiveClient(selection,'manager',deps,s=>states.push(s));
  const beforeClient=puts;await client.save('xlsx');assert.equal(states.at(-1).pending,true);assert.equal(stored.size,1);client.dispose();
  const restarted=new core.PurchaseOrderArchiveClient(selection,'manager',deps,s=>states.push(s));await restarted.retry();assert.deepEqual(posted[0],posted[1]);assert.equal(puts,beforeClient+1);assert.equal(stored.size,0);assert.equal(states.at(-1).phase,'success');
  await restarted.download(target);assert.equal(downloaded,1);restarted.dispose();
  const edited=await drafts.edit({...input(),action:'edit',orderId:order.snapshot.id,expectedRevision:order.revision,reason:'Later edit',notes:'Edited source'});
  await drafts.cancel({action:'cancel',companyId:'a',operationId:crypto.randomUUID(),orderId:order.snapshot.id,expectedRevision:edited.revision,reason:'Later cancellation'});
  assert.equal((await request(targetUrl)).status,200);assert.ok((await (await list('draft',20)).json()).artifacts.some(a=>a.id===target.id));
  const row=await db.prepare('SELECT manifest_json FROM document_archive_intents WHERE id=?').bind(target.id).first(),key=await core.archiveObjectKey(JSON.parse(row.manifest_json));await bucket.put(key,new Uint8Array(target.size));
  const corrupt=await request(targetUrl);assert.equal(corrupt.status,409);assert.equal((await corrupt.json()).code,'integrity');
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
}finally{await mf.dispose();delete globalThis.__archiveApi;}
console.log('PASS: actual guarded archive API with native D1/R2, both sources/formats, private headers, CSRF/viewer/tenant/role checks, bounded issued-only paging, durable recovery, actual client lost-response restart, historical reads and corruption holds.');
