import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';
const require=createRequire(import.meta.url),{Miniflare}=createRequire(require.resolve('wrangler'))('miniflare');
mkdirSync('.sites-runtime/archive-d1-runtime',{recursive:true});const folder=mkdtempSync(resolve('.sites-runtime/archive-d1-runtime/run-'));
await build({stdin:{contents:['d1-document-archive-journal','d1-purchase-order-drafts','purchase-order-document-archive',
  'purchase-order-document-archive-contract','purchase-order-document-archive-sources','d1-purchase-order-history-exports',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:folder+'/core.mjs'});
const core=await import(pathToFileURL(folder+'/core.mjs').href);
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries,objects=new Map();
const options={modules:true,script:'export default {fetch(){return new Response("private local archive fixture")}}',compatibilityDate:'2026-05-15',
  compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'00000000-0000-4000-8000-000000000001'},d1Persist:folder+'/d1'};
let mf=new Miniflare(options),db=await mf.getD1Database('DB'),user='manager',at='2026-10-02T12:00:00.000Z',beforePublish=null;
const clock={now:()=>new Date(at)},identity=async()=>user;
const wrap=()=>{const tracked=new WeakMap();
  const statement=(raw,sql)=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...values)=>statement(target.bind(...values),sql);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});tracked.set(proxy,{raw,sql});return proxy;};
  return {prepare:query=>statement(db.prepare(query),query),batch:async statements=>{
    if(beforePublish&&tracked.get(statements[0])?.sql.includes('SET artifact_json=')){const fn=beforePublish;beforePublish=null;await fn();}
    await db.prepare('UPDATE document_archive_test_clock SET at=?').bind(at).run();
    return db.batch(statements.map(s=>tracked.get(s)?.raw??s));}};};
const privateObjects={putIfAbsent:async(key,bytes)=>{if(objects.has(key))return 'exists';objects.set(key,new Uint8Array(bytes));return 'created';},
  read:async(key,max)=>{const bytes=objects.get(key);return bytes?{size:bytes.byteLength,bytes:bytes.byteLength>max?null:new Uint8Array(bytes)}:null;}};
const service=()=>new core.PurchaseOrderDocumentArchive({identity,clock,journal:new core.D1DocumentArchiveJournal(wrap(),{clock:{...clock,sqlNow:'(SELECT at FROM document_archive_test_clock)'}}),objects:privateObjects,
  sources:new core.D1DocumentArchiveSources(db),render:(...args)=>core.renderDocumentArchive(...args,async()=>new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf')))});
const failure=(promise,code)=>assert.rejects(promise,e=>e instanceof core.DocumentArchiveError&&e.code===code);
try{
  for(const e of entries)await db.batch(unstable_splitSqlQuery(readFileSync(`drizzle/${e.tag}.sql`,'utf8')).map(sql=>db.prepare(sql)));
  assert.equal((await db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('document_archive_intents','document_archive_leases','document_archive_observations')").first()).n,3);
  await db.batch([db.prepare("INSERT INTO companies VALUES('a','Fictional runtime a','2026-10-01'),('b','Fictional runtime b','2026-10-01')"),
    db.prepare("INSERT INTO memberships VALUES('manager','a','manager'),('owner','a','owner'),('employee','a','employee'),('b-manager','b','manager')")]);
  await db.prepare('CREATE TABLE document_archive_test_clock(at TEXT NOT NULL)').run();await db.prepare('INSERT INTO document_archive_test_clock VALUES(?)').bind(at).run();
  const drafts=new core.D1PurchaseOrderDrafts(db,{identity,clock,salesPolicy:{syncEnabled:false,maxLagMs:600000}});
  const input=()=>({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'manual',capMinor:'10000',notes:'Runtime fixture',
    supplier:{id:'fake',name:'Fictional Café Supply',email:'orders@example.invalid',accountId:'fixture',locationId:'fixture',deliveryAddress:'Fictional address'},
    lines:[{kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:'125'}]});
  const order=await drafts.create(input()),request={companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'draft',orderId:order.snapshot.id,revision:order.revision}};
  const artifact=await service().save(request),bytes=(await service().read({companyId:'a',id:artifact.id})).bytes;assert.equal(bytes.byteLength,artifact.size);assert.deepEqual(await service().save(request),artifact);
  for(const who of [null,'employee','b-manager']){user=who;await failure(service().save({...request,operationId:crypto.randomUUID()}),'forbidden');await failure(service().read({companyId:'a',id:artifact.id}),'forbidden');}user='manager';
  const history=await new core.D1PurchaseOrderHistoryExports(db,{identity}).get({companyId:'a',filters:{product:'bags'}});
  const historyRequest={companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'history',filters:history.filters,fingerprint:history.fingerprint}};
  const historyArtifact=await service().save(historyRequest);assert.equal(historyArtifact.source.records.length,1);
  // The production default uses native database time, without the injected SQL clock.
  const productionClockService=new core.PurchaseOrderDocumentArchive({identity,journal:new core.D1DocumentArchiveJournal(db),objects:privateObjects,
    sources:new core.D1DocumentArchiveSources(db),render:(...args)=>core.renderDocumentArchive(...args,async()=>new Uint8Array())});
  const nativeClockArtifact=await productionClockService.save({...request,operationId:crypto.randomUUID()});
  assert.ok(Math.abs(Date.now()-Date.parse(nativeClockArtifact.issuedAt))<10000);
  // Commit-time permission changes are evaluated by the actual D1 SQL, not the earlier pre-read.
  beforePublish=async()=>{await db.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();};
  await failure(service().save({...request,operationId:crypto.randomUUID()}),'forbidden');await db.prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'").run();
  beforePublish=async()=>{at=new Date(Date.parse(at)+core.DOCUMENT_ARCHIVE_LEASE_MS+1).toISOString();};
  const expired={...request,operationId:crypto.randomUUID()};await failure(service().save(expired),'fenced');
  assert.equal((await db.prepare('SELECT artifact_json FROM document_archive_intents WHERE company_id=? AND operation_id=?').bind('a',expired.operationId).first()).artifact_json,null);
  await assert.rejects(db.prepare("UPDATE document_archive_intents SET artifact_json='{}' WHERE company_id='a' AND id=?").bind(artifact.id).run());
  await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB');
  assert.deepEqual(await service().save(request),artifact);assert.deepEqual((await service().read({companyId:'a',id:artifact.id})).bytes,bytes);
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
}finally{await mf.dispose();}
console.log('PASS: actual local workerd D1 binding applies Wrangler-split schema, saves/reads/replays native files, enforces company/roles/immutable metadata and retains issued identity across runtime restart. Object port is a local injected map; no R2 or hosted acceptance.');
