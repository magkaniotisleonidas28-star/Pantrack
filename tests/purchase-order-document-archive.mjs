import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {writeFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {archiveFixture,openArchiveContext,core} from './helpers/document-archive.mjs';
import {readXlsx,lineRecords} from './helpers/xlsx-reader.mjs';
const failure=(promise,code)=>assert.rejects(promise,error=>error instanceof core.DocumentArchiveError&&error.code===code&&!error.message.includes('PRIVATE_'));
const barrier=()=>{let resolve;return {promise:new Promise(ok=>{resolve=ok;}),resolve};};
let f=await archiveFixture();
try{
  const command=(format='pdf',order=f.order)=>({companyId:'a',operationId:crypto.randomUUID(),format,source:{kind:'draft',orderId:order.snapshot.id,revision:order.revision}});
  const request=command(),before=f.business();
  f.objects.hooks.beforePut=async(key,bytes)=>{
    const row=f.sql.prepare('SELECT * FROM archive_contract_intents WHERE operation_id=?').get(request.operationId),manifest=JSON.parse(row.manifest);
    assert.equal(row.state,'prepared');assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(manifest.size,bytes.byteLength);
    assert.equal(await core.archiveObjectKey(manifest),key);assert.ok(f.sql.prepare('SELECT 1 FROM archive_contract_observations WHERE document_id=?').get(row.id));
  };
  const artifact=await f.service().save(request),bytes=(await f.service().read({companyId:'a',id:artifact.id})).bytes;
  assert.equal(artifact.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(artifact.template,'pantrack.saved-draft.pdf.v1');assert.equal(artifact.label,'Draft — no order placed.');
  assert.equal(artifact.retention,'retain-until-explicit-policy');assert.ok(Object.isFrozen(artifact.source.records[0]));assert.equal(artifact.source.records[0].revision,1);
  assert.ok(!JSON.stringify(artifact).includes('private-objects'));assert.ok(!JSON.stringify(artifact).includes('http'));
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isEvalSupported:false}),pdf=await task.promise;let text='';
  try{for(let n=1;n<=pdf.numPages;n++)text+=(await(await pdf.getPage(n)).getTextContent()).items.filter(i=>'str' in i).map(i=>i.str).join('\n');assert.equal(await pdf.getJSActions(),null);assert.equal(await pdf.getAttachments(),null);}finally{await task.destroy();}
  assert.ok(text.includes(f.order.snapshot.number));assert.ok(text.includes('Unavailable'));
  writeFileSync(join(f.folder,'archived-draft.pdf'),bytes);writeFileSync(join(f.folder,'artifact.json'),JSON.stringify(artifact,null,2));
  const renders=f.stats.renders,puts=f.objects.puts;assert.deepEqual(await f.service().save(request),artifact);assert.equal(f.stats.renders,renders);assert.equal(f.objects.puts,puts);
  await failure(f.service().save({...request,format:'xlsx'}),'conflict');
  const history=await new core.D1PurchaseOrderHistoryExports(f.db,{identity:async()=>f.state.user}).get({companyId:'a'});
  const historyRequest={companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'history',filters:history.filters,fingerprint:history.fingerprint}};
  const historyArtifact=await f.service().save(historyRequest),historyRead=await f.service().read({companyId:'a',id:historyArtifact.id});
  const rows=lineRecords(readXlsx(historyRead.bytes));assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r['PO ID'])).size,2);assert.ok(rows.some(r=>r['Draft status']==='canceled'));
  assert.equal(historyArtifact.source.fingerprint,history.fingerprint);assert.equal(historyArtifact.label,'Draft history — no purchase evidence.');writeFileSync(join(f.folder,'archived-history.xlsx'),historyRead.bytes);
  // Both source kinds retain both native formats using the existing trusted renderers.
  for(const item of [{...command('xlsx')},{...historyRequest,operationId:crypto.randomUUID(),format:'pdf'}]){
    const saved=await f.service().save(item),read=await f.service().read({companyId:'a',id:saved.id});assert.equal(saved.sha256,createHash('sha256').update(read.bytes).digest('hex'));
    assert.equal(saved.template,core.archiveTemplate(item.source.kind,item.format));
  }
  assert.equal(f.business(),before,'Archiving writes its journal/object copy, never PO/stock/financial business rows.');
  const initialIO={puts:f.objects.puts,reads:f.objects.reads};
  for(const user of [null,'employee','b-manager']){f.state.user=user;await failure(f.service().save(command()),'forbidden');await failure(f.service().read({companyId:'a',id:artifact.id}),'forbidden');}
  f.state.user='manager';await failure(f.service().read({companyId:'b',id:artifact.id}),'forbidden');f.state.user='b-manager';await failure(f.service().read({companyId:'b',id:artifact.id}),'missing');
  assert.deepEqual({puts:f.objects.puts,reads:f.objects.reads},initialIO);f.state.user='owner';assert.equal((await f.service().read({companyId:'a',id:artifact.id})).artifact.actorId,'manager');await failure(f.service().save(request),'conflict');f.state.user='manager';
  for(const input of [{...request,format:'csv'},{...request,actorId:'owner'},{...request,bytes:[1]},{...request,key:'../../file'},
    {...request,source:{...request.source,snapshot:{}}},{...request,source:{kind:'history',filters:{}}},{...request,operationId:''}])await failure(f.service().save(input),'invalid_request');
  await failure(f.service({identity:async()=>{throw Error('PRIVATE_AUTH');}}).save(command()),'storage_unavailable');
  await failure(f.service({journal:{...f.journal,begin:async()=>{throw Error('PRIVATE_JOURNAL');}}}).save(command()),'storage_unavailable');
  assert.throws(()=>f.sql.prepare("UPDATE archive_contract_intents SET artifact='{}' WHERE id=?").run(artifact.id),/immutable archive identity/);
  assert.throws(()=>f.sql.prepare('DELETE FROM archive_contract_intents WHERE id=?').run(artifact.id),/retain archive intent/);
  const {issuedAt,...manifest}=artifact,key=await core.archiveObjectKey(manifest),otherKey=await core.archiveObjectKey({...manifest,companyId:'../a/b?x'});
  assert.notEqual(key,otherKey);assert.match(otherKey,/^pantrack-documents\/v1\/[a-f0-9]{64}\//);assert.ok(!otherKey.includes('..'));
  // Archived bytes survive changes/cancellation; reads and completed replays never reload/re-render a PO.
  f.state.at='2026-10-03T12:00:00.000Z';let changed=await f.drafts.edit(f.edit(f.order));await f.drafts.cancel({action:'cancel',companyId:'a',operationId:crypto.randomUUID(),orderId:changed.snapshot.id,expectedRevision:changed.revision,reason:'Retain archived draft'});
  const noRender=f.service({sources:{load:async()=>{throw Error('Current source must not be read.');}},render:async()=>{throw Error('Historical archive must not be rendered.');}});
  assert.deepEqual((await noRender.read({companyId:'a',id:artifact.id})).bytes,bytes);assert.deepEqual(await noRender.save(request),artifact);
  // Integrity checks persist observations before refusing bytes, and never repair by overwriting.
  const damaged=new Uint8Array(bytes);damaged[damaged.length-10]^=1;await writeFile(f.objects.path(key),damaged);
  const putsBeforeCorruption=f.objects.puts;await failure(f.service().read({companyId:'a',id:artifact.id}),'integrity');await failure(f.service().save(request),'integrity');assert.equal(f.objects.puts,putsBeforeCorruption);
  const last=JSON.parse(f.sql.prepare('SELECT payload FROM archive_contract_observations WHERE document_id=? ORDER BY id DESC LIMIT 1').get(artifact.id).payload);assert.notEqual(last.sha256,artifact.sha256);assert.equal(f.journal.row(artifact.id).state,'ready');
  await writeFile(f.objects.path(key),bytes);f.objects.hooks.afterRead=async()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");await failure(f.service().read({companyId:'a',id:artifact.id}),'forbidden');f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.objects.hooks.afterRead=async()=>{f.state.user=null;};await failure(f.service().read({companyId:'a',id:artifact.id}),'forbidden');f.state.user='manager';
  // Unknown writes are recovered by a new process from durable metadata and exact stored bytes.
  const recoverOrder=await f.drafts.create(f.create()),recoverRequest=command('xlsx',recoverOrder);f.objects.hooks.afterPut=async()=>{throw Error('PRIVATE_PROVIDER_WRITE_ACK');};
  await failure(f.service().save(recoverRequest),'held');const held=f.sql.prepare('SELECT * FROM archive_contract_intents WHERE operation_id=?').get(recoverRequest.operationId);assert.equal(held.state,'held');assert.equal(held.artifact,null);assert.ok(held.manifest);
  const recoverManifest=JSON.parse(held.manifest);assert.ok(f.sql.prepare("SELECT 1 FROM archive_contract_observations WHERE document_id=? AND payload LIKE '%write_unknown%'").get(held.id));
  const {databasePath,objectRoot,state}=f;f.close();
  const script=join(f.folder,'recover.mjs');writeFileSync(script,`import {openArchiveContext} from ${JSON.stringify(pathToFileURL(resolve('tests/helpers/document-archive.mjs')).href)};\nconst f=openArchiveContext(process.argv[2],process.argv[3],JSON.parse(process.argv[5]));\ntry{const artifact=await f.service({render:async()=>{throw Error('Recovery must not render.');}}).save(JSON.parse(process.argv[4]));process.stdout.write(JSON.stringify({artifact,puts:f.objects.puts,renders:f.stats.renders}));}finally{f.close();}\n`);
  const recovered=spawnSync(process.execPath,[script,databasePath,objectRoot,JSON.stringify(recoverRequest),JSON.stringify(state)],{encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(recovered.status,0,recovered.stderr);const recoveredResult=JSON.parse(recovered.stdout);assert.equal(recoveredResult.puts,0);assert.equal(recoveredResult.renders,0);assert.equal(recoveredResult.artifact.sha256,recoverManifest.sha256);
  f={...f,...openArchiveContext(databasePath,objectRoot,state)};assert.deepEqual(await f.service().save(recoverRequest),recoveredResult.artifact);
  // A missing object after a prepared/unknown write stays held; retry never creates a second object.
  const missingOrder=await f.drafts.create(f.create()),missingRequest=command('xlsx',missingOrder);f.objects.hooks.beforePut=async()=>{throw Error('PRIVATE_WRITE_BEFORE_ACK');};await failure(f.service().save(missingRequest),'held');const missingPuts=f.objects.puts,missingRenders=f.stats.renders;await failure(f.service().save(missingRequest),'held');assert.equal(f.objects.puts,missingPuts);assert.equal(f.stats.renders,missingRenders);
  for(const output of [new Uint8Array(),new Uint8Array([1,2,3]),new Uint8Array(core.DOCUMENT_ARCHIVE_MAX_BYTES+1)]){
    const req=command('xlsx',recoverOrder),count=f.objects.puts;await failure(f.service({render:async()=>output}).save(req),'generation_failed');assert.equal(f.objects.puts,count);
    const row=f.sql.prepare('SELECT id FROM archive_contract_intents WHERE operation_id=?').get(req.operationId);assert.ok(f.sql.prepare("SELECT 1 FROM archive_contract_observations WHERE document_id=? AND payload LIKE '%generation%'").get(row.id));
  }
  // Simultaneous requests and expired attempts cannot publish twice or overwrite the current owner.
  const slowStarted=barrier(),slowRelease=barrier(),concurrent=command('xlsx',recoverOrder),slow=f.service({render:async(...args)=>{const bytes=await f.dependencies.render(...args);slowStarted.resolve();await slowRelease.promise;return bytes;}});
  const pending=slow.save(concurrent);await slowStarted.promise;await failure(f.service().save(concurrent),'busy');f.state.at=new Date(Date.parse(f.state.at)+core.DOCUMENT_ARCHIVE_LEASE_MS+1).toISOString();
  const replacement=await f.service().save(concurrent),ownedPuts=f.objects.puts;slowRelease.resolve();await failure(pending,'fenced');assert.equal(f.objects.puts,ownedPuts);assert.deepEqual(await f.service().save(concurrent),replacement);
  // Source/membership changes at each commit boundary are checked against the actual database.
  for(const phase of ['prepare','publish'])for(const change of ['role','source']){
    const order=await f.drafts.create(f.create()),req=command('xlsx',order),count=f.objects.puts;
    f.journal.hooks[phase]=async()=>{if(change==='role')f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");else await f.drafts.edit(f.edit(order));};
    await failure(f.service().save(req),change==='role'?'forbidden':'source_changed');const row=f.sql.prepare('SELECT * FROM archive_contract_intents WHERE operation_id=?').get(req.operationId);assert.equal(row.artifact,null);assert.equal(row.state,'held');assert.equal(f.objects.puts,count+(phase==='publish'?1:0));
    f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");await failure(f.service().read({companyId:'a',id:row.id}),'missing');
  }
  // New matching history records invalidate publication even when every previously selected revision is unchanged.
  const latestHistory=await new core.D1PurchaseOrderHistoryExports(f.db,{identity:async()=>f.state.user}).get({companyId:'a'});
  const historyRace={companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'history',filters:latestHistory.filters,fingerprint:latestHistory.fingerprint}};
  f.journal.hooks.publish=async()=>{await f.drafts.create(f.create());};await failure(f.service().save(historyRace),'source_changed');
  assert.equal(f.sql.prepare('SELECT artifact FROM archive_contract_intents WHERE operation_id=?').get(historyRace.operationId).artifact,null);
  // Capture caller input and renderer bytes before asynchronous dependency hooks can change them.
  const capturedOrder=await f.drafts.create(f.create()),mutable=command('xlsx',capturedOrder),original=structuredClone(mutable);
  const started=barrier(),release=barrier();const saving=f.service({identity:async()=>{started.resolve();await release.promise;return 'manager';}}).save(mutable);
  await started.promise;mutable.companyId='b';mutable.source.orderId='wrong';release.resolve();const captured=await saving;
  assert.equal(captured.companyId,original.companyId);assert.equal(captured.source.records[0].id,original.source.orderId);
  let rendererBytes;const nativeRender=f.dependencies.render;
  f.journal.hooks.observe=async()=>{rendererBytes.fill(0);};
  const copied=await f.service({render:async(...args)=>{assert.ok(Object.isFrozen(args[0].proof.records[0]));rendererBytes=await nativeRender(...args);return rendererBytes;}}).save(command('xlsx',capturedOrder));
  assert.equal((await f.service().read({companyId:'a',id:copied.id})).artifact.sha256,copied.sha256);
  assert.equal(await f.objects.putIfAbsent(await core.archiveObjectKey(copied),new Uint8Array([1,2,3])),'exists');
  assert.equal((await f.service().read({companyId:'a',id:copied.id})).artifact.sha256,copied.sha256);
  // Provider size/read failures and audit failures fail closed before returning or publishing bytes.
  f.objects.hooks.afterRead=async(_key,result)=>{result.size++;};await failure(f.service().read({companyId:'a',id:copied.id}),'integrity');
  f.objects.hooks.afterRead=async(_key,result)=>{result.size=core.DOCUMENT_ARCHIVE_MAX_BYTES+1;result.bytes=null;};await failure(f.service().read({companyId:'a',id:copied.id}),'integrity');
  f.objects.hooks.beforeRead=async()=>{throw Error('PRIVATE_READ');};await failure(f.service().read({companyId:'a',id:copied.id}),'storage_unavailable');
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM archive_contract_observations WHERE document_id=? ORDER BY id DESC LIMIT 1').get(copied.id).payload).kind,'read_unknown');
  f.journal.hooks.observeRead=async()=>{throw Error('PRIVATE_AUDIT_READ');};await failure(f.service().read({companyId:'a',id:copied.id}),'storage_unavailable');
  f.journal.hooks.observe=async()=>{throw Error('PRIVATE_AUDIT_WRITE');};const noAudit=command('xlsx',capturedOrder),beforeAudit=f.objects.puts;
  await failure(f.service().save(noAudit),'storage_unavailable');assert.equal(f.objects.puts,beforeAudit);assert.equal(f.sql.prepare('SELECT artifact FROM archive_contract_intents WHERE operation_id=?').get(noAudit.operationId).artifact,null);
  const finalKey=await core.archiveObjectKey(recoveredResult.artifact);await unlink(f.objects.path(finalKey));await failure(f.service().read({companyId:'a',id:recoveredResult.artifact.id}),'held');
  assert.ok(!JSON.stringify(f.sql.prepare('SELECT payload FROM archive_contract_observations').all()).includes('PRIVATE_'));
}finally{try{f.close();}catch{}}
console.log('PASS: private immutable archive lifecycle with real source readers/serializers, file-backed SQLite and create-only files, both native formats/source kinds, tenant/role/session/source races, durable intent/observations, exact historical retrieval, tamper/size holds, cross-process unknown-write recovery, permanent replay and lease fencing.');
