import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {exportFixture} from './helpers/purchase-order-export.mjs';
import {readXlsx,lineRecords} from './helpers/xlsx-reader.mjs';
await build({entryPoints:['src/lib/purchase-order-download.ts'],bundle:true,packages:'external',platform:'node',format:'esm',
  outfile:'.sites-runtime/purchase-order-download-tests.mjs'});
const {PurchaseOrderDownloader,browserPurchaseOrderDownloads:browser}=await import('../.sites-runtime/purchase-order-download-tests.mjs');
const f=await exportFixture(),deferred=()=>{let resolve;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};};
try{
  const order=await f.drafts.create(f.create({lines:[{...f.nonStock,estimatedUnitMinor:'100'}, {...f.nonStock,sku:'MISSING'}]}));
  const selection=f.select(order),saved=await f.exports.get(selection);
  function setup(overrides={}){
    const states=[],files=[],requests=[];
    const dependencies={fetch:async(url,options)=>{
      requests.push({url,options});assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');
      assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      const params=new URL(url,'http://127.0.0.1').searchParams;
      assert.deepEqual([...params.keys()],['companyId','orderId','revision']);
      if(!f.state.user)return Response.json({error:'PRIVATE_IDENTITY'}, {status:401});
      try{return Response.json({export:await f.exports.get({companyId:params.get('companyId'),orderId:params.get('orderId'),revision:Number(params.get('revision'))})});}
      catch(error){return Response.json({error:'PRIVATE_DATABASE'}, {status:error.code==='forbidden'?403:error.code==='conflict'?409:503});}
    },generate:async()=>new Uint8Array([1,2,3]),download:(...args)=>files.push(args),...overrides};
    return {states,files,requests,dependencies,controller:new PurchaseOrderDownloader(dependencies,state=>states.push(state))};
  }
  let before=f.allTables();
  for(const [user,phase] of [[null,'held'],['employee','held'],['b-manager','held']]){
    f.state.user=user;const t=setup();await t.controller.start(selection,'xlsx');assert.equal(t.states.at(-1).phase,phase);assert.equal(t.files.length,0);
    assert.ok(!JSON.stringify(t.states).includes('PRIVATE_'));t.controller.dispose();
  }
  f.state.user='manager';
  for(const user of ['manager','owner']){
    f.state.user=user;const t=setup();await t.controller.start(selection,'xlsx');
    assert.equal(t.requests.length,2);assert.equal(t.files.length,1);assert.match(t.files[0][1],/-r1-draft\.xlsx$/);
    assert.equal(t.files[0][2],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(t.states.at(-1).phase,'success');t.controller.dispose();
  }
  f.state.user='manager';assert.equal(f.allTables(),before);

  // Actual serializers plus the actual Blob/link/URL lifecycle through the controller.
  const original={fetch:globalThis.fetch,document:globalThis.document,timeout:globalThis.setTimeout,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  const urls=new Set(),timers=[],clicks=[],removed=[];let fontRequests=0,failClick=true;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/fonts/NotoSans-Regular.ttf');assert.equal(options.credentials,'same-origin');fontRequests++;
    return new Response(new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf')));};
  URL.createObjectURL=blob=>{assert.ok(blob instanceof Blob);const url='blob:fixture-'+urls.size;urls.add(url);return url;};
  URL.revokeObjectURL=url=>{assert.ok(urls.delete(url));};
  globalThis.document={body:{appendChild:link=>{assert.equal(link.hidden,true);}},createElement:tag=>{assert.equal(tag,'a');return {
    click(){if(failClick)throw Error('PRIVATE_BLOB_FAILURE');clicks.push({href:this.href,filename:this.download});},remove(){removed.push(this.href);}};}};
  globalThis.setTimeout=callback=>{timers.push(callback);return 1;};
  try{
    const t=setup({generate:browser.generate,download:browser.download});await t.controller.start(selection,'xlsx');
    assert.equal(t.states.at(-1).phase,'error');assert.equal(timers.length,1);assert.equal(removed.length,1);assert.equal(fontRequests,0);
    timers.shift()();assert.equal(urls.size,0);failClick=false;
    await t.controller.start(selection,'xlsx');assert.equal(t.states.at(-1).phase,'success');timers.shift()();assert.equal(urls.size,0);
    await t.controller.start(selection,'pdf');assert.equal(t.states.at(-1).phase,'success');timers.shift()();assert.equal(urls.size,0);
    assert.equal(clicks.length,2);assert.match(clicks[0].filename,/\.xlsx$/);assert.match(clicks[1].filename,/\.pdf$/);assert.equal(fontRequests,1);
    const makeElement=globalThis.document.createElement;
    globalThis.document.createElement=()=>{throw Error('PRIVATE_ELEMENT_FAILURE');};
    await t.controller.start(selection,'xlsx');assert.equal(t.states.at(-1).phase,'error');timers.shift()();assert.equal(urls.size,0);
    globalThis.document.createElement=makeElement;
    t.controller.dispose();assert.equal(f.allTables(),before);
    const bytes=await browser.generate('xlsx',saved,new AbortController().signal);
    assert.equal(lineRecords(readXlsx(bytes))[1]['Estimated line minor units'],'Unavailable');
  }finally{globalThis.fetch=original.fetch;globalThis.document=original.document;globalThis.setTimeout=original.timeout;URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;}

  const started=deferred(),release=deferred();let generations=0;
  const t=setup({generate:async()=>{generations++;started.resolve();return release.promise;}});
  const first=t.controller.start(selection,'pdf');await started.promise;await t.controller.start(selection,'xlsx');
  assert.equal(generations,1);assert.equal(t.requests.length,1);t.controller.cancel();assert.ok(t.requests[0].options.signal.aborted);
  const next=t.controller.start(selection,'xlsx');release.resolve(new Uint8Array([1]));await Promise.all([first,next]);
  assert.equal(t.files.length,1);assert.match(t.files[0][1],/\.xlsx$/);assert.equal(t.states.at(-1).phase,'success');t.controller.dispose();

  const disposeStarted=deferred(),disposeRelease=deferred(),disposed=setup({generate:async()=>{disposeStarted.resolve();return disposeRelease.promise;}});
  const disposing=disposed.controller.start(selection,'xlsx');await disposeStarted.promise;disposed.controller.dispose();const count=disposed.states.length;
  disposeRelease.resolve(new Uint8Array([1]));await disposing;await disposed.controller.start(selection,'pdf');
  assert.equal(disposed.files.length,0);assert.equal(disposed.states.length,count);

  // Actual membership/edit/cancel writes during generation must be observed by the second read.
  for(const change of ['membership','edit','cancel']){
    const current=await f.drafts.create(f.create()),pick=f.select(current);
    const race=setup({generate:async()=>{
      if(change==='membership')f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
      if(change==='edit')await f.drafts.edit(f.edit(current));
      if(change==='cancel')await f.drafts.cancel({action:'cancel',companyId:'a',orderId:pick.orderId,expectedRevision:1,operationId:crypto.randomUUID(),reason:'End export fixture'});
      return new Uint8Array([1]);
    }});
    await race.controller.start(pick,'xlsx');assert.equal(race.states.at(-1).phase,'held');assert.equal(race.files.length,0);
    if(change!=='membership')assert.equal(race.states.at(-1).reload,true);
    f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");race.controller.dispose();
  }
  before=f.allTables();
  for(const status of [404,409,503]){
    const denied=setup({fetch:async()=>Response.json({error:'PRIVATE_INTERNAL'}, {status})});await denied.controller.start(selection,'xlsx');
    assert.equal(denied.files.length,0);assert.equal(denied.states.at(-1).reload,true);assert.ok(!JSON.stringify(denied.states).includes('PRIVATE_'));denied.controller.dispose();
  }
  for(const invalid of [{...saved,revision:9},{...saved,draft:{...saved.draft,companyId:'b'}},{...saved,limitations:[]}]){
    const wrong=setup({fetch:async()=>Response.json({export:invalid})});await wrong.controller.start(selection,'xlsx');assert.equal(wrong.states.at(-1).phase,'held');assert.equal(wrong.files.length,0);wrong.controller.dispose();
  }
  const network=setup({fetch:async()=>{throw Error('PRIVATE_FETCH');}});await network.controller.start(selection,'pdf');assert.equal(network.states.at(-1).phase,'error');assert.equal(network.files.length,0);network.controller.dispose();
  for(const message of ['font cannot display','Excel cell limit','unsupported Excel escape marker','Dynamic module unavailable']){
    const failure=setup({generate:async()=>{throw Error(message);}});await failure.controller.start(selection,'xlsx');assert.equal(failure.states.at(-1).phase,'error');assert.equal(failure.files.length,0);failure.controller.dispose();
  }
  assert.equal(f.allTables(),before);
  assert.equal(readFileSync('public/fonts/NotoSans-Regular.ttf').equals(readFileSync('previews/c4-order-draft/assets/NotoSans-Regular.ttf')),true);
  assert.equal(readFileSync('public/fonts/OFL-NotoSans.txt').equals(readFileSync('previews/c4-order-draft/assets/OFL.txt')),true);
}finally{f.sql.close();}
console.log('PASS: real saved-source download lifecycle, both authorization reads, revocation/edit/cancel refusal, concurrent/canceled/disposed jobs, retry, actual Blob/link/URL cleanup, exact serializers and licensed font copies.');
