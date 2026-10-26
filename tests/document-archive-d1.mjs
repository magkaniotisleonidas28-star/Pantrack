import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {d1ArchiveFixture,reopenArchiveD1,core} from './helpers/document-archive-d1.mjs';
const failure=(promise,code)=>assert.rejects(promise,e=>e instanceof core.DocumentArchiveError&&e.code===code&&!e.message.includes('PRIVATE_'));
const barrier=()=>{let resolve;return {promise:new Promise(ok=>{resolve=ok;}),resolve};};
let f=await d1ArchiveFixture();
try{
  const request=(format='xlsx',order=f.order)=>({companyId:'a',operationId:crypto.randomUUID(),format,source:{kind:'draft',orderId:order.snapshot.id,revision:order.revision}});
  const original=request('pdf'),before=f.business();const artifact=await f.service().save(original),read=await f.service().read({companyId:'a',id:artifact.id});
  assert.equal(artifact.sha256,createHash('sha256').update(read.bytes).digest('hex'));assert.equal(f.business(),before);
  const renders=f.stats.renders,puts=f.objects.puts;assert.deepEqual(await f.service().save(original),artifact);assert.equal(f.stats.renders,renders);assert.equal(f.objects.puts,puts);
  await failure(f.service().save({...original,format:'xlsx'}),'conflict');
  for(const user of [null,'employee','b-manager']){f.state.user=user;await failure(f.service().save(request()),'forbidden');await failure(f.service().read({companyId:'a',id:artifact.id}),'forbidden');}
  f.state.user='manager';await failure(f.service().read({companyId:'b',id:artifact.id}),'forbidden');f.state.user='b-manager';await failure(f.service().read({companyId:'b',id:artifact.id}),'missing');
  f.state.user='owner';assert.equal((await f.service().read({companyId:'a',id:artifact.id})).artifact.actorId,'manager');await failure(f.service().save(original),'conflict');f.state.user='manager';
  for(const statement of ["UPDATE document_archive_intents SET artifact_json='{}'",'DELETE FROM document_archive_intents',
    "UPDATE document_archive_leases SET token='changed'",'DELETE FROM document_archive_leases',"UPDATE document_archive_observations SET payload_json='{}'",'DELETE FROM document_archive_observations'])assert.throws(()=>f.sql.exec(statement));
  assert.throws(()=>f.sql.prepare("UPDATE purchase_order_draft_revisions SET snapshot_json='{}' WHERE company_id='a'").run());
  assert.throws(()=>f.sql.prepare("UPDATE purchase_order_draft_events SET actor='owner' WHERE company_id='a'").run());
  assert.throws(()=>f.sql.prepare("UPDATE purchase_order_drafts SET created_at='2026-10-02T12:00:00.000Z' WHERE company_id='a'").run());
  // The actual guarded batch sees changes made after the source pre-read.
  for(const phase of ['prepare','publish'])for(const change of ['role','source']){
    const order=await f.drafts.create(f.create()),command=request('xlsx',order),count=f.objects.puts;
    f.hooks[phase]=async()=>{if(change==='role')f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");else await f.drafts.edit(f.edit(order));};
    await failure(f.service().save(command),change==='role'?'forbidden':'source_changed');const row=f.intent(command.operationId);assert.equal(row.artifact_json,null);assert.equal(row.state,'held');assert.equal(f.objects.puts,count+(phase==='publish'?1:0));
    assert.ok(f.sql.prepare("SELECT 1 FROM document_archive_observations WHERE document_id=? AND json_extract(payload_json,'$.kind')='source_check'").get(row.id));
    f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");await failure(f.service().read({companyId:'a',id:row.id}),'missing');
  }
  const allHistory=await new core.D1PurchaseOrderHistoryExports(f.db,{identity:async()=>f.state.user}).get({companyId:'a'});
  assert.equal((await f.service().save({companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'history',filters:allHistory.filters,fingerprint:allHistory.fingerprint}})).source.records.length,allHistory.records.length);
  const history=await new core.D1PurchaseOrderHistoryExports(f.db,{identity:async()=>f.state.user}).get({companyId:'a',filters:{product:'bags'}});
  const historyRequest={companyId:'a',operationId:crypto.randomUUID(),format:'xlsx',source:{kind:'history',filters:history.filters,fingerprint:history.fingerprint}};
  f.hooks.publish=async()=>{await f.drafts.create(f.create());};await failure(f.service().save(historyRequest),'source_changed');assert.equal(f.intent(historyRequest.operationId).artifact_json,null);
  const stable=await new core.D1PurchaseOrderHistoryExports(f.db,{identity:async()=>f.state.user}).get({companyId:'a',filters:{product:'bags',q:'PO-',status:'draft',supplier:'fictional',from:'2026-10-01',to:'2026-10-02',timeZone:'UTC'}});
  const filtered={...historyRequest,operationId:crypto.randomUUID(),source:{kind:'history',filters:stable.filters,fingerprint:stable.fingerprint}};
  f.hooks.publish=async()=>{await f.drafts.create(f.create({lines:[{kind:'non_stock',description:'Unrelated',sku:'OTHER',unitLabel:'case',packs:'2',estimatedUnitMinor:null}]}));};assert.equal((await f.service().save(filtered)).source.fingerprint,stable.fingerprint);
  // Completed historical reads do not require the source to remain exportable.
  const changed=await f.drafts.edit(f.edit(f.order));await f.drafts.cancel({action:'cancel',companyId:'a',orderId:changed.snapshot.id,expectedRevision:changed.revision,operationId:crypto.randomUUID(),reason:'Keep archive'});
  const noRender=f.service({sources:{load:async()=>{throw Error('Do not read source');}},render:async()=>{throw Error('Do not rerender');}});
  assert.deepEqual((await noRender.read({companyId:'a',id:artifact.id})).bytes,read.bytes);assert.deepEqual(await noRender.save(original),artifact);
  f.objects.hooks.afterRead=async()=>{f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");};await failure(f.service().read({companyId:'a',id:artifact.id}),'forbidden');f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  // A lease that expires after the pre-read must still refuse at the actual SQL mutation.
  for(const phase of ['prepare','publish']){
    const order=await f.drafts.create(f.create()),command=request('xlsx',order),puts=f.objects.puts;
    f.hooks[phase]=async()=>{f.state.at=new Date(Date.parse(f.state.at)+core.DOCUMENT_ARCHIVE_LEASE_MS+1).toISOString();};
    await failure(f.service().save(command),'fenced');assert.equal(f.intent(command.operationId).artifact_json,null);
    assert.equal(f.objects.puts,puts+(phase==='publish'?1:0));
  }
  const failureOrder=await f.drafts.create(f.create()),auditRequest=request('xlsx',failureOrder),beforeAudit=f.objects.puts;
  f.hooks.observe=async()=>{throw Error('PRIVATE_AUDIT_FAILURE');};await failure(f.service().save(auditRequest),'storage_unavailable');
  assert.equal(f.intent(auditRequest.operationId).state,'held');assert.equal(f.objects.puts,beforeAudit);
  const unknown=request('xlsx',failureOrder);f.objects.hooks.beforePut=async()=>{throw Error('PRIVATE_MISSING_OBJECT');};await failure(f.service().save(unknown),'held');
  const missingPuts=f.objects.puts,missingRenders=f.stats.renders;await failure(f.service().save(unknown),'held');assert.equal(f.objects.puts,missingPuts);assert.equal(f.stats.renders,missingRenders);
  // A correct object alone does not authorize publication with another observation identity.
  const wrongEvidence=request('xlsx',failureOrder),wrongId=crypto.randomUUID(),journal=f.journal;
  const substituted=new Proxy(journal,{get(target,key){if(key==='publish')return claim=>target.publish(claim,wrongId);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await failure(f.service({journal:substituted}).save(wrongEvidence),'integrity');const wrongRow=f.intent(wrongEvidence.operationId);assert.equal(wrongRow.artifact_json,null);
  assert.ok(f.sql.prepare("SELECT 1 FROM document_archive_observations WHERE document_id=? AND json_extract(payload_json,'$.observationId')=?").get(wrongRow.id,wrongId));
  // Lost D1 acknowledgments are reconciled from a unique write ID, not meta.changes.
  const recoveredOrder=await f.drafts.create(f.create()),d1Lost=request('xlsx',recoveredOrder);f.db.loseAcknowledgment=true;const d1Artifact=await f.service().save(d1Lost);assert.equal(f.intent(d1Lost.operationId).state,'ready');
  for(const phase of ['prepare','publish']){const command=request('xlsx',recoveredOrder);f.hooks[phase]=async()=>{f.db.loseAcknowledgment=true;};assert.equal((await f.service().save(command)).id,f.intent(command.operationId).id);}
  // Write succeeds but response is lost: a different Node process reopens real D1-shaped SQLite/files.
  const lost=request('xlsx',recoveredOrder);f.objects.hooks.afterPut=async()=>{throw Error('PRIVATE_WRITE_ACK');};await failure(f.service().save(lost),'held');const held=f.intent(lost.operationId),heldManifest=JSON.parse(held.manifest_json);assert.equal(held.artifact_json,null);
  const {databasePath,objectRoot,state,folder}=f;f.close();const childPath=join(folder,'recover-d1.mjs');
  writeFileSync(childPath,`import {reopenArchiveD1} from ${JSON.stringify(pathToFileURL(resolve('tests/helpers/document-archive-d1.mjs')).href)};\nconst f=reopenArchiveD1(process.argv[2],process.argv[3],JSON.parse(process.argv[5]));try{const artifact=await f.service({render:async()=>{throw Error('Do not render recovery');}}).save(JSON.parse(process.argv[4]));process.stdout.write(JSON.stringify({artifact,puts:f.objects.puts,renders:f.stats.renders}));}finally{f.close();}\n`);
  const child=spawnSync(process.execPath,[childPath,databasePath,objectRoot,JSON.stringify(lost),JSON.stringify(state)],{encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(child.status,0,child.stderr);const restored=JSON.parse(child.stdout);assert.equal(restored.puts,0);assert.equal(restored.renders,0);assert.equal(restored.artifact.sha256,heldManifest.sha256);
  f={...f,...reopenArchiveD1(databasePath,objectRoot,state)};assert.deepEqual(await f.service().save(lost),restored.artifact);
  const key=await core.archiveObjectKey(restored.artifact),bytes=(await f.service().read({companyId:'a',id:restored.artifact.id})).bytes,damaged=new Uint8Array(bytes);damaged[damaged.length-1]^=1;
  await writeFile(f.objects.path(key),damaged);await failure(f.service().read({companyId:'a',id:restored.artifact.id}),'integrity');assert.notEqual(JSON.parse(f.sql.prepare("SELECT payload_json FROM document_archive_observations WHERE document_id=? AND json_extract(payload_json,'$.kind')='object' ORDER BY rowid DESC LIMIT 1").get(restored.artifact.id).payload_json).sha256,restored.artifact.sha256);
  const started=barrier(),release=barrier(),slowRequest=request('xlsx',recoveredOrder),slow=f.service({render:async(...args)=>{const b=await f.dependencies.render(...args);started.resolve();await release.promise;return b;}});
  const pending=slow.save(slowRequest);await started.promise;await failure(f.service().save(slowRequest),'busy');f.state.at=new Date(Date.parse(f.state.at)+core.DOCUMENT_ARCHIVE_LEASE_MS+1).toISOString();const replacement=await f.service().save(slowRequest),owned=f.objects.puts;release.resolve();await failure(pending,'fenced');assert.equal(f.objects.puts,owned);assert.deepEqual(await f.service().save(slowRequest),replacement);
  assert.ok(f.metrics.maximumBindings<=100);assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(!JSON.stringify(f.sql.prepare('SELECT payload_json FROM document_archive_observations').all()).includes('PRIVATE_'));
}finally{try{f.close();}catch{}}
console.log('PASS: real D1 journal lifecycle, immutable SQLite floor, source/role races at batch commit, exact history membership, all criteria, historical reads, lost D1/object acknowledgments, cross-process recovery, private errors, durable observations, replay and fencing.');
