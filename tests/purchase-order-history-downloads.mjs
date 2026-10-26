import assert from 'node:assert/strict';
import {historyFixture,core} from './helpers/purchase-order-history-export.mjs';
import {readXlsx,lineRecords} from './helpers/xlsx-reader.mjs';
const f=await historyFixture(),barrier=()=>{let resolve;return {promise:new Promise(ok=>{resolve=ok;}),resolve};};
try{
  const order=await f.drafts.create(f.create()),selection={companyId:'a',filters:{q:'',supplier:''}};
  function setup(overrides={}){
    const states=[],files=[],requests=[];
    const dependencies={fetch:async(url,options)=>{
      requests.push({url,options});assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');
      assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      const params=new URL(url,'http://127.0.0.1').searchParams;assert.ok(!params.has('offset'));assert.ok(!params.has('page'));
      if(!f.state.user)return Response.json({error:'PRIVATE_AUTH'}, {status:401});
      try{return Response.json({history:await f.history.get(core.purchaseOrderHistoryExportQuery(params))});}
      catch(error){return Response.json({error:'PRIVATE_STORAGE'}, {status:error.code==='forbidden'?403:error.code==='changed'?409:error.code==='too_large'?413:503});}
    },generate:async()=>new Uint8Array([1]),download:(...args)=>files.push(args),...overrides};
    return {states,files,requests,controller:new core.CheckedPurchaseOrderDownloader(dependencies,state=>states.push(state),core.purchaseOrderHistoryDownloadFlow)};
  }
  let before=f.allTables();
  for(const user of [null,'employee','b-manager']){f.state.user=user;const t=setup();await t.controller.start(selection,'xlsx');assert.equal(t.states.at(-1).phase,'held');assert.equal(t.files.length,0);t.controller.dispose();}
  for(const user of ['owner','manager']){f.state.user=user;const t=setup();await t.controller.start(selection,'pdf');assert.equal(t.files.length,1);assert.equal(t.requests.length,2);
    assert.match(t.files[0][1],/^pantrack-filtered-history-[0-9a-f]{12}\.pdf$/);assert.ok(new URL(t.requests[1].url,'http://localhost').searchParams.has('expected'));t.controller.dispose();}
  assert.equal(f.allTables(),before);
  // The history flow uses the real serializer and Blob/link/URL resource lifecycle.
  const original={document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL,timeout:globalThis.setTimeout};
  let blob,clicked=0,removed=0,timer;const urls=new Set();
  URL.createObjectURL=value=>{blob=value;urls.add('blob:history');return 'blob:history';};URL.revokeObjectURL=url=>assert.ok(urls.delete(url));
  globalThis.setTimeout=callback=>{timer=callback;return 1;};
  globalThis.document={body:{appendChild:link=>assert.equal(link.hidden,true)},createElement:tag=>{assert.equal(tag,'a');return {click(){clicked++;},remove(){removed++;}};}};
  try{const t=setup({generate:core.browserPurchaseOrderHistoryDownloads.generate,download:core.browserPurchaseOrderHistoryDownloads.download});
    await t.controller.start(selection,'xlsx');assert.equal(t.states.at(-1).phase,'success');assert.equal(clicked,1);assert.equal(removed,1);timer();assert.equal(urls.size,0);
    assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(lineRecords(readXlsx(new Uint8Array(await blob.arrayBuffer()))).length,1);t.controller.dispose();
  }finally{globalThis.document=original.document;URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;globalThis.setTimeout=original.timeout;}
  const started=barrier(),release=barrier(),t=setup({generate:async()=>{started.resolve();return release.promise;}});
  const pending=t.controller.start(selection,'pdf');await started.promise;await t.controller.start(selection,'xlsx');assert.equal(t.requests.length,1);
  t.controller.cancel();release.resolve(new Uint8Array([1]));await pending;assert.equal(t.files.length,0);assert.ok(t.requests[0].options.signal.aborted);
  await t.controller.start(selection,'xlsx');assert.equal(t.files.length,1);t.controller.dispose();
  const begun=barrier(),done=barrier(),disposed=setup({generate:async()=>{begun.resolve();return done.promise;}});
  const job=disposed.controller.start(selection,'xlsx');await begun.promise;disposed.controller.dispose();const count=disposed.states.length;done.resolve(new Uint8Array([1]));await job;
  assert.equal(disposed.files.length,0);assert.equal(disposed.states.length,count);
  for(const change of ['membership','edit','cancel','new-match']){
    const current=change==='edit'||change==='cancel'?await f.drafts.create(f.create()):order;
    const race=setup({generate:async()=>{
      if(change==='membership')f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
      if(change==='edit')await f.drafts.edit(f.edit(current));if(change==='cancel')await f.cancel(current);
      if(change==='new-match')await f.drafts.create(f.create());return new Uint8Array([1]);
    }});await race.controller.start(selection,'xlsx');assert.equal(race.files.length,0);assert.equal(race.states.at(-1).phase,'held');
    if(change!=='membership')assert.equal(race.states.at(-1).reload,true);
    f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");race.controller.dispose();
  }
  before=f.allTables();
  for(const [status,phase] of [[404,'held'],[409,'held'],[413,'held'],[503,'error']]){
    const refused=setup({fetch:async()=>Response.json({error:'PRIVATE_DETAIL'},{status})});await refused.controller.start(selection,'xlsx');
    assert.equal(refused.states.at(-1).phase,phase);assert.equal(refused.files.length,0);assert.ok(!JSON.stringify(refused.states).includes('PRIVATE_'));refused.controller.dispose();
  }
  const retry=setup({generate:async()=>{throw Error('PRIVATE_MODULE');}});await retry.controller.start(selection,'xlsx');assert.equal(retry.states.at(-1).phase,'error');assert.equal(retry.files.length,0);retry.controller.dispose();
  const snapshot=await f.history.get({companyId:'a'});
  const invalid=setup({fetch:async()=>Response.json({history:{...snapshot,fingerprint:'0'.repeat(64)}})});await invalid.controller.start(selection,'xlsx');assert.equal(invalid.states.at(-1).phase,'held');assert.equal(invalid.files.length,0);invalid.controller.dispose();
  assert.equal(f.allTables(),before);
}finally{f.sql.close();}
console.log('PASS: actual bulk download flow, both membership/snapshot reads, real native workbook and Blob/link/URL cleanup, cancel/dispose/duplicate suppression, edit/cancel/new-match/revocation refusal, size/error handling and no export writes.');
