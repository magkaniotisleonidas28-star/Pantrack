import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
mkdirSync('.sites-runtime',{recursive:true});await build({stdin:{contents:['purchase-order-archive-client','purchase-order-document-archive-contract','purchase-order-export-contract','document-byte-digest'].map(n=>`export * from './src/lib/${n}.ts';`).join(''),resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/archive-client-core.mjs'});
const core=await import('../.sites-runtime/archive-client-core.mjs'),bytes=new TextEncoder().encode('%PDF-1.7 fixture'),artifact=core.captureArchiveArtifact({contract:'pantrack.document-archive.v1',id:crypto.randomUUID(),companyId:'a',actorId:'manager',format:'pdf',template:core.archiveTemplate('draft','pdf'),
  label:core.PURCHASE_ORDER_EXPORT_LABEL,sha256:await core.documentByteDigest(bytes),size:bytes.length,source:{kind:'draft',fingerprint:'a'.repeat(64),records:[{id:'draft-1',revision:1,status:'draft'}]},requestedAt:'2026-10-26T12:00:00.000Z',issuedAt:'2026-10-26T12:00:01.000Z',retention:'retain-until-explicit-policy'});
const selection={companyId:'a',source:{kind:'draft',orderId:'draft-1',revision:1}},deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const headers=()=>({'content-type':'application/pdf','x-pantrack-document-size':String(bytes.length),'x-pantrack-document-id':artifact.id,'x-pantrack-document-sha256':artifact.sha256});
function fixture(overrides={},selected=selection,store=new Map()){
  const states=[],calls=[],downloads=[],storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  const dependencies={storage,uuid:()=>crypto.randomUUID(),saved:()=>{},download:(...args)=>downloads.push(args),fetch:async(url,options)=>{
    calls.push({url,options});if(options.method==='POST'){assert.equal(store.size,1,'Persist before HTTP dispatch');return Response.json({artifact});}
    return url.includes('view=metadata')?Response.json({artifact,viewerId:'manager'}):new Response(bytes,{headers:headers()});
  },...overrides};
  const client=new core.PurchaseOrderArchiveClient(selected,'manager',dependencies,s=>states.push(s));return {client,states,calls,downloads,store,dependencies};
}
const saved=fixture();await saved.client.save('pdf');assert.equal(saved.states.at(-1).phase,'success');assert.equal(saved.store.size,0);assert.equal(saved.calls[0].options.headers['X-Pantrack-Archive-Viewer'],'manager');await saved.client.download(artifact);assert.equal(saved.downloads.length,1);assert.deepEqual(saved.downloads[0][0],bytes);saved.client.dispose();
let sent=[];const first=fixture({fetch:async(url,options)=>{sent.push(JSON.parse(options.body));throw Error('PRIVATE_LOST_REPLY');}});await first.client.save('pdf');assert.equal(first.states.at(-1).pending,true);first.client.dispose();
const restored=fixture({fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({artifact});}},{companyId:'a',source:{...selection.source,revision:2}},first.store);await restored.client.retry();assert.deepEqual(sent[0],sent[1]);assert.equal(sent[1].source.revision,1);assert.equal(restored.store.size,0);restored.client.dispose();
const pending=deferred(),concurrent=fixture({fetch:async()=>pending.promise});const start=concurrent.client.save('pdf');await concurrent.client.save('xlsx');await concurrent.client.retry();assert.equal(concurrent.store.size,1);concurrent.client.cancel();assert.match(concurrent.states.at(-1).message,/may still complete/);pending.resolve(Response.json({artifact}));await start;assert.equal(concurrent.states.at(-1).pending,true);concurrent.client.dispose();
for(const code of ['forbidden','busy','held','integrity','conflict','__proto__']){
  const f=fixture({fetch:async()=>Response.json({code},{status:code==='forbidden'?403:409})});await f.client.save('pdf');assert.equal(f.states.at(-1).pending,true);assert.equal(typeof f.states.at(-1).message,'string');assert.ok(!f.states.at(-1).message.includes('PRIVATE'));f.client.dispose();
}
const changed=fixture({fetch:async()=>Response.json({code:'source_changed'},{status:409})});await changed.client.save('pdf');assert.equal(changed.states.at(-1).reload,true);assert.equal(changed.states.at(-1).pending,false);assert.equal(changed.store.size,0);changed.client.dispose();
for(const [status,message] of [[413,/Narrow the filters/],[403,/Owner or manager/],[409,/matching history changed/],[404,/No export is available/]]){
  const historyCalls=[],f=fixture({fetch:async(url,options)=>{historyCalls.push(options.method);return Response.json({error:'PRIVATE_PROVIDER_DETAIL'},{status});}},{companyId:'a',source:{kind:'history',filters:{q:'',supplier:''}}});
  await f.client.save('pdf');assert.match(f.states.at(-1).message,message);assert.equal(f.states.at(-1).phase,'held');assert.equal(f.states.at(-1).pending,false);assert.equal(f.store.size,0);assert.deepEqual(historyCalls,['GET']);f.client.dispose();
}
const recoveryStore=new Map(),recovery=fixture({storage:{getItem:k=>recoveryStore.get(k)??null,setItem:(k,v)=>recoveryStore.set(k,v),removeItem:()=>{throw Error('PRIVATE_REMOVE_FAILED');}},fetch:async()=>Response.json({code:'source_changed'},{status:409})});await recovery.client.save('pdf');assert.equal(recovery.states.at(-1).pending,true);assert.equal(recovery.states.at(-1).retryable,false);recovery.client.cancel();assert.match(recovery.states.at(-1).message,/recovery information is unavailable/);recovery.client.dispose();
const blocked=fixture({storage:{getItem:()=>null,setItem:()=>{throw Error('PRIVATE_STORAGE');},removeItem:()=>{}}});await blocked.client.save('pdf');assert.equal(blocked.calls.length,0);assert.equal(blocked.states.at(-1).phase,'error');blocked.client.dispose();
const malformedStore=new Map([[first.client.storageKey,'not JSON']]),malformed=fixture({},selection,malformedStore);await malformed.client.save('pdf');assert.equal(malformed.calls.length,0);assert.equal(malformed.states.at(-1).phase,'held');malformed.client.dispose();
const switchedStore=new Map([[first.client.storageKey,JSON.stringify({...sent[0],companyId:'b'})]]),switched=fixture({},selection,switchedStore);await switched.client.retry();assert.equal(switched.calls.length,0);assert.equal(switched.states.at(-1).phase,'held');switched.client.dispose();
for(const mode of ['denied','session','record']){
  const f=fixture({fetch:async url=>!url.includes('view=metadata')?new Response(bytes,{headers:headers()}):mode==='denied'?Response.json({},{status:403}):Response.json({artifact:mode==='record'?{...artifact,issuedAt:'2026-10-26T12:00:02.000Z'}:artifact,viewerId:mode==='session'?'owner':'manager'})});
  await f.client.download(artifact);assert.equal(f.downloads.length,0);assert.equal(f.states.at(-1).phase,'held');f.client.dispose();
}
const delayed=deferred();let canceled=0;const stale=fixture({fetch:async()=>delayed.promise}),waiting=stale.client.download(artifact);stale.client.cancel();delayed.resolve(new Response(new ReadableStream({cancel(){canceled++;}},{highWaterMark:0}),{headers:headers()}));await waiting;assert.equal(canceled,1);assert.equal(stale.downloads.length,0);stale.client.dispose();
const check=deferred(),checking=deferred(),late=fixture({fetch:async url=>{if(url.includes('view=metadata')){checking.resolve();return check.promise;}return new Response(bytes,{headers:headers()});}}),reading=late.client.download(artifact);await checking.promise;late.client.dispose();const lastState=late.states.length;check.resolve(Response.json({artifact,viewerId:'manager'}));await reading;assert.equal(late.states.length,lastState);assert.equal(late.downloads.length,0);
for(const mode of ['headers','overflow','short','corrupt','read-error']){
  let pulls=0,cancels=0,sent=false;const body=new ReadableStream({pull(controller){pulls++;if(sent){controller.close();return;}if(mode==='read-error')throw Error('PRIVATE_STREAM');let value=new Uint8Array(bytes);
    if(mode==='overflow')value=new Uint8Array(bytes.length+1);if(mode==='short')value=value.subarray(0,value.length-1);if(mode==='corrupt')value[0]^=1;controller.enqueue(value);sent=true;},cancel(){cancels++;}},{highWaterMark:0});
  const response=new Response(body,{headers:{...headers(),...(mode==='headers'?{'x-pantrack-document-size':'1'}:{})}});
  await assert.rejects(core.readSavedDocument(response,artifact));assert.equal(body.locked,false);if(mode==='headers'){assert.equal(pulls,0);assert.equal(cancels,1);}if(mode==='overflow')assert.equal(cancels,1);
}
console.log('PASS: persistent exact-request retries, reload/revision recovery, storage refusal before dispatch, busy/stop/dispose races, session/role recheck, immutable metadata/hash validation and bounded real response streams with cancellation and released locks.');
