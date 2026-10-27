import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';
import {core,archiveTestKey} from './helpers/document-archive-r2.mjs';
import {readXlsx,lineRecords} from './helpers/xlsx-reader.mjs';
const require=createRequire(import.meta.url),{Miniflare}=createRequire(require.resolve('wrangler'))('miniflare');
mkdirSync('.sites-runtime/archive-r2-runtime',{recursive:true});const folder=mkdtempSync(resolve('.sites-runtime/archive-r2-runtime/run-'));
await build({entryPoints:['tests/helpers/document-archive-r2-worker.ts'],bundle:true,platform:'browser',format:'esm',outfile:join(folder,'worker.mjs')});
const nonce=crypto.randomUUID(),options={modules:true,scriptPath:join(folder,'worker.mjs'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  bindings:{ARCHIVE_TEST_TOKEN:nonce},r2Buckets:{ARCHIVE:'pantrack-archive-fixture'},r2Persist:join(folder,'r2'),
  d1Databases:{DB:'00000000-0000-4000-8000-000000000001'},d1Persist:join(folder,'d1')};
let mf=new Miniflare(options),db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('ARCHIVE'),user='manager',hooks={},stats={puts:0,gets:0,renders:0};
const identity=async()=>user,at=new Date().toISOString(),clock={now:()=>new Date(at)},failure=(promise,code)=>assert.rejects(promise,e=>e instanceof core.DocumentArchiveError&&e.code===code&&!e.message.includes('PRIVATE_'));
const invoke=async(name,...args)=>{const hook=hooks[name];delete hooks[name];if(hook)await hook(...args);};
const provider=()=>({put:async(...args)=>{stats.puts++;await invoke('beforePut',...args);const result=await bucket.put(...args);await invoke('afterPut',...args);return result;},
  get:async(...args)=>{stats.gets++;await invoke('beforeGet',...args);const result=await bucket.get(...args);await invoke('afterGet',...args);return result;}});
const service=()=>new core.PurchaseOrderDocumentArchive({identity,clock,journal:new core.D1DocumentArchiveJournal(db),objects:new core.R2DocumentArchiveObjects(provider()),
  sources:new core.D1DocumentArchiveSources(db),render:async(...args)=>{stats.renders++;return core.renderDocumentArchive(...args,async()=>new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf')));}});
const worker=(path,init={})=>mf.dispatchFetch('http://localhost'+path,{...init,headers:{'x-archive-test-token':nonce,...init.headers}});
try{
  // This code runs inside the actual Worker, using the actual local R2 binding.
  assert.equal((await mf.dispatchFetch('http://localhost/read?key=anything&max=4')).status,403);
  const rawBytes=new Uint8Array([37,80,68,70,45,49,46,55]),rawKey=await archiveTestKey(rawBytes);
  const saves=await Promise.all(Array.from({length:12},()=>worker('/put?key='+encodeURIComponent(rawKey),{method:'POST',body:rawBytes})));
  for(const response of saves)assert.equal(response.status,200,await response.clone().text());
  const results=await Promise.all(saves.map(response=>response.json()));assert.equal(results.filter(r=>r.result==='created').length,1);assert.equal(results.filter(r=>r.result==='exists').length,11);
  const rawRead=await worker('/read?key='+encodeURIComponent(rawKey)+'&max=8');assert.equal(rawRead.status,200);assert.equal(rawRead.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await rawRead.arrayBuffer()),rawBytes);
  const limited=await worker('/read?key='+encodeURIComponent(rawKey)+'&max=4');assert.equal(limited.headers.get('x-fixture-body'),'held');assert.equal((await limited.arrayBuffer()).byteLength,0);
  const metadata=await bucket.head(rawKey);assert.equal(metadata.httpMetadata.contentType,'application/pdf');assert.equal(metadata.httpMetadata.cacheControl,'private, no-store');
  assert.equal(Buffer.from(metadata.checksums.sha256).toString('hex'),await core.documentByteDigest(rawBytes));
  const invalid=await worker('/put?key=..%2Fprivate',{method:'POST',body:rawBytes});assert.equal(invalid.status,409);assert.equal((await invalid.json()).code,'invalid_request');
  // The full archive lifecycle uses real D1 + R2, with native document renderers.
  for(const e of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)await db.batch(unstable_splitSqlQuery(readFileSync(`drizzle/${e.tag}.sql`,'utf8')).map(sql=>db.prepare(sql)));
  await db.batch([db.prepare("INSERT INTO companies VALUES('a','Fictional R2 a','2026-10-01'),('b','Fictional R2 b','2026-10-01')"),
    db.prepare("INSERT INTO memberships VALUES('manager','a','manager'),('owner','a','owner'),('employee','a','employee'),('b-manager','b','manager')")]);
  let drafts=new core.D1PurchaseOrderDrafts(db,{identity,clock,salesPolicy:{syncEnabled:false,maxLagMs:600000}});
  const input=()=>({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'manual',capMinor:'10000',notes:'Private R2 fixture',
    supplier:{id:'fixture',name:'Fictional Café Supply',email:'orders@example.invalid',accountId:'fixture',locationId:'fixture',deliveryAddress:'Fictional address'},
    lines:[{kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:'125'}]});
  const order=await drafts.create(input()),command=(format='xlsx')=>({companyId:'a',operationId:crypto.randomUUID(),format,source:{kind:'draft',orderId:order.snapshot.id,revision:order.revision}});
  const latest=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.at(-1);
  const businessTables=Object.keys(JSON.parse(readFileSync(`drizzle/meta/${String(latest.idx).padStart(4,'0')}_snapshot.json`,'utf8')).tables).filter(name=>!name.startsWith('document_archive_')).sort();
  const business=async()=>{const rows=await db.batch(businessTables.map(name=>db.prepare(`SELECT * FROM "${name}"`)));return JSON.stringify(rows.map((r,i)=>[businessTables[i],r.results]));},before=await business();
  const request=command(),pdfRequest=command('pdf');hooks.beforePut=async(key,bytes)=>{
    const row=await db.prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?').bind('a',request.operationId).first();
    assert.equal(row.state,'prepared');const manifest=JSON.parse(row.manifest_json);assert.equal(manifest.sha256,createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));assert.equal(await core.archiveObjectKey(manifest),key);
  };
  const artifact=await service().save(request),pdfArtifact=await service().save(pdfRequest),read=await service().read({companyId:'a',id:artifact.id}),pdf=await service().read({companyId:'a',id:pdfArtifact.id});
  assert.equal(artifact.sha256,createHash('sha256').update(read.bytes).digest('hex'));assert.equal(lineRecords(readXlsx(read.bytes)).length,1);assert.equal(new TextDecoder().decode(pdf.bytes.subarray(0,5)),'%PDF-');
  const history=await new core.D1PurchaseOrderHistoryExports(db,{identity}).get({companyId:'a'});
  for(const format of ['pdf','xlsx']){const saved=await service().save({companyId:'a',operationId:crypto.randomUUID(),format,source:{kind:'history',filters:history.filters,fingerprint:history.fingerprint}});
    const downloaded=await service().read({companyId:'a',id:saved.id});assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'),saved.sha256);}
  assert.equal(await business(),before);const io={puts:stats.puts,gets:stats.gets};
  for(const who of [null,'employee','b-manager']){user=who;await failure(service().save(command()),'forbidden');await failure(service().read({companyId:'a',id:artifact.id}),'forbidden');}
  user='manager';await failure(service().read({companyId:'b',id:artifact.id}),'forbidden');user='b-manager';await failure(service().read({companyId:'b',id:artifact.id}),'missing');
  assert.deepEqual({puts:stats.puts,gets:stats.gets},io);user='owner';assert.equal((await service().read({companyId:'a',id:artifact.id})).artifact.actorId,'manager');user='manager';
  const puts=stats.puts,renders=stats.renders;assert.deepEqual(await service().save(request),artifact);assert.equal(stats.puts,puts);assert.equal(stats.renders,renders);
  hooks.afterGet=async()=>{await db.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();};await failure(service().read({companyId:'a',id:artifact.id}),'forbidden');await db.prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'").run();
  hooks.afterGet=async()=>{user=null;};await failure(service().read({companyId:'a',id:artifact.id}),'forbidden');user='manager';
  hooks.beforeGet=async()=>{throw Error('PRIVATE_R2_GET_TIMEOUT');};await failure(service().read({companyId:'a',id:artifact.id}),'storage_unavailable');
  assert.equal(JSON.parse((await db.prepare('SELECT payload_json FROM document_archive_observations WHERE document_id=? ORDER BY rowid DESC LIMIT 1').bind(artifact.id).first()).payload_json).kind,'read_unknown');
  // A real object can exist even though its write response was lost.
  const lost=command();hooks.afterPut=async()=>{throw Error('PRIVATE_R2_PUT_TIMEOUT');};await failure(service().save(lost),'held');
  const held=await db.prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?').bind('a',lost.operationId).first();assert.equal(held.state,'held');assert.equal(held.artifact_json,null);assert.ok(held.manifest_json);
  await mf.dispose();
  const childPath=join(folder,'recover.mjs');writeFileSync(childPath,`import {createRequire} from 'node:module';import {core} from ${JSON.stringify(pathToFileURL(resolve('tests/helpers/document-archive-r2.mjs')).href)};\nconst require=createRequire(import.meta.url),{Miniflare}=createRequire(require.resolve('wrangler'))('miniflare'),mf=new Miniflare(JSON.parse(process.argv[2]));let puts=0,renders=0;try{const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('ARCHIVE');const service=new core.PurchaseOrderDocumentArchive({identity:async()=>'manager',journal:new core.D1DocumentArchiveJournal(db),objects:new core.R2DocumentArchiveObjects({get:(...a)=>bucket.get(...a),put:(...a)=>{puts++;return bucket.put(...a);}}),sources:new core.D1DocumentArchiveSources(db),render:async()=>{renders++;throw Error('Recovery must not render');}});const artifact=await service.save(JSON.parse(process.argv[3]));process.stdout.write(JSON.stringify({artifact,puts,renders}));}finally{await mf.dispose();}\n`);
  const recovered=spawnSync(process.execPath,[childPath,JSON.stringify(options),JSON.stringify(lost)],{encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(recovered.status,0,recovered.stderr);const result=JSON.parse(recovered.stdout);assert.equal(result.puts,0);assert.equal(result.renders,0);assert.equal(result.artifact.sha256,JSON.parse(held.manifest_json).sha256);
  mf=new Miniflare(options);db=await mf.getD1Database('DB');bucket=await mf.getR2Bucket('ARCHIVE');drafts=new core.D1PurchaseOrderDrafts(db,{identity,clock,salesPolicy:{syncEnabled:false,maxLagMs:600000}});
  assert.deepEqual(await service().save(lost),result.artifact);assert.deepEqual((await service().read({companyId:'a',id:artifact.id})).bytes,read.bytes);
  const missing=command();hooks.beforePut=async()=>{throw Error('PRIVATE_R2_PUT_BEFORE_WRITE');};await failure(service().save(missing),'held');const missingIO={puts:stats.puts,renders:stats.renders};await failure(service().save(missing),'held');assert.deepEqual({puts:stats.puts,renders:stats.renders},missingIO);
  const key=await core.archiveObjectKey(artifact),damaged=new Uint8Array(read.bytes);damaged[damaged.length-1]^=1;await bucket.put(key,damaged);await failure(service().read({companyId:'a',id:artifact.id}),'integrity');
  const last=JSON.parse((await db.prepare('SELECT payload_json FROM document_archive_observations WHERE document_id=? ORDER BY rowid DESC LIMIT 1').bind(artifact.id).first()).payload_json);assert.notEqual(last.sha256,artifact.sha256);
  const noRepair=stats.puts;await failure(service().save(request),'integrity');assert.equal(stats.puts,noRepair);
  await bucket.put(key,read.bytes.subarray(0,read.bytes.length-1));await failure(service().read({companyId:'a',id:artifact.id}),'integrity');
  const truncated=JSON.parse((await db.prepare('SELECT payload_json FROM document_archive_observations WHERE document_id=? ORDER BY rowid DESC LIMIT 1').bind(artifact.id).first()).payload_json);assert.equal(truncated.byteLength,read.bytes.length-1);await bucket.put(key,read.bytes);
  // Permission/source changes after a real R2 write leave a private held object, never an issued copy.
  for(const change of ['role','source']){
    const source=await drafts.create(input()),race={companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'draft',orderId:source.snapshot.id,revision:source.revision}};
    hooks.afterPut=async()=>{if(change==='role')await db.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();
      else await drafts.edit({...input(),action:'edit',orderId:source.snapshot.id,expectedRevision:source.revision,reason:'Changed during R2 save',notes:'Changed during R2 save'});};
    await failure(service().save(race),change==='role'?'forbidden':'source_changed');
    const row=await db.prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?').bind('a',race.operationId).first();assert.equal(row.artifact_json,null);assert.equal(row.state,'held');
    assert.ok(await bucket.head(await core.archiveObjectKey(JSON.parse(row.manifest_json))));
    await db.prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'").run();await failure(service().read({companyId:'a',id:row.id}),'missing');
  }
  const edit=await drafts.edit({...input(),action:'edit',orderId:order.snapshot.id,expectedRevision:order.revision,reason:'Archive must remain stable',notes:'Changed source'});
  await drafts.cancel({action:'cancel',companyId:'a',operationId:crypto.randomUUID(),orderId:edit.snapshot.id,expectedRevision:edit.revision,reason:'Keep archived history'});
  assert.deepEqual((await service().read({companyId:'a',id:artifact.id})).bytes,read.bytes);assert.deepEqual(await service().save(request),artifact);
  await bucket.delete(await core.archiveObjectKey(pdfArtifact));await failure(service().read({companyId:'a',id:pdfArtifact.id}),'held');
  const audit=(await db.prepare('SELECT payload_json FROM document_archive_observations').all()).results;assert.ok(!JSON.stringify(audit).includes('PRIVATE_'));
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
}finally{await mf.dispose();}
console.log('PASS: actual Worker R2 conditional races/checksums/private metadata and native D1+R2 archive lifecycle, both sources/formats, authorization/revocation, durable manifests/observations, business preservation, tamper/missing holds and cross-process lost-write recovery with no extra put/render. No hosted resources.');
