import assert from 'node:assert/strict';
import {core,archiveTestKey} from './helpers/document-archive-r2.mjs';
const failure=(promise,code)=>assert.rejects(promise,e=>e instanceof core.DocumentArchiveError&&e.code===code&&!e.message.includes('PRIVATE_'));
const bytes=new Uint8Array([1,2,3,4]),key=await archiveTestKey(bytes);let puts=0,gets=0;
const bucket={put:async(k,value,options)=>{puts++;assert.equal(k,key);assert.deepEqual(value,bytes);assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});
  assert.equal(Buffer.from(options.sha256).toString('hex'),await core.documentByteDigest(bytes));assert.equal(options.httpMetadata.cacheControl,'private, no-store');
  assert.equal(options.httpMetadata.contentType,'application/pdf');assert.equal(options.httpMetadata.contentDisposition,'attachment');return {key:k,size:value.byteLength};},
  get:async()=>{gets++;return null;}};
const store=new core.R2DocumentArchiveObjects(bucket);
assert.equal(await store.putIfAbsent(key,bytes),'created');assert.equal(await store.read(key,1024),null);
for(const bad of ['../file','https://example.invalid/file','/a',key+'?secret',key.replace('pantrack-documents/v1','other'),key.replace('.pdf','.html'),key+'\0']){
  await failure(store.putIfAbsent(bad,bytes),'invalid_request');await failure(store.read(bad,1024),'invalid_request');
}
for(const bad of [NaN,Infinity,-1,0.5,core.DOCUMENT_ARCHIVE_MAX_BYTES+1])await failure(store.read(key,bad),'invalid_request');
for(const value of [new Uint8Array(),new Uint8Array(core.DOCUMENT_ARCHIVE_MAX_BYTES+1),null])await failure(store.putIfAbsent(key,value),'invalid_request');
await failure(store.putIfAbsent(key,new Uint8Array([9,8,7])),'integrity');assert.equal(puts,1);assert.equal(gets,1);
const original=new Uint8Array([0,1,2,3,4,0]),view=original.subarray(1,5),captured=store.putIfAbsent(key,view);original.fill(9);assert.equal(await captured,'created');
assert.equal(await new core.R2DocumentArchiveObjects({...bucket,put:async()=>null}).putIfAbsent(key,bytes),'exists');
for(const provider of [()=>{throw Error('PRIVATE_PUT');},()=>({key:'wrong',size:4}),()=>({key,size:5}),()=>undefined])await failure(new core.R2DocumentArchiveObjects({...bucket,put:provider}).putIfAbsent(key,bytes),'storage_unavailable');
await failure(new core.R2DocumentArchiveObjects({...bucket,get:async()=>{throw Error('PRIVATE_GET');}}).read(key,4),'storage_unavailable');
await failure(new core.R2DocumentArchiveObjects({...bucket,get:async()=>({size:4})}).read(key,4),'storage_unavailable');
// Actual streams prove bounded consumption, cancellation and lock release.
async function streamCase({size,chunks=[],limit=4,failAt=null,cancelFails=false}){
  let pulls=0,cancels=0,index=0;const body=new ReadableStream({pull(controller){pulls++;if(index===failAt)throw Error('PRIVATE_STREAM');
    if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close();},cancel(){cancels++;if(cancelFails)throw Error('PRIVATE_CANCEL');}},{highWaterMark:0});
  const obj={key,size,body,arrayBuffer:()=>{throw Error('Unbounded arrayBuffer is forbidden');}};
  const promise=new core.R2DocumentArchiveObjects({...bucket,get:async()=>obj}).read(key,limit);
  return {promise,body,stats:()=>({pulls,cancels})};
}
for(const size of [5,core.DOCUMENT_ARCHIVE_MAX_BYTES+1,-1,NaN,Infinity]){
  const c=await streamCase({size,chunks:[new Uint8Array(16)]});const result=await c.promise;
  assert.equal(result.bytes,null);assert.ok(Object.is(result.size,size));assert.deepEqual(c.stats(),{pulls:0,cancels:1});assert.equal(c.body.locked,false);
}
const exact=await streamCase({size:4,chunks:[bytes.subarray(0,2),bytes.subarray(2)]});assert.deepEqual((await exact.promise).bytes,bytes);assert.equal(exact.body.locked,false);
const short=await streamCase({size:4,chunks:[bytes.subarray(0,2)]});assert.equal((await short.promise).bytes.byteLength,2);assert.equal(short.body.locked,false);
const over=await streamCase({size:2,chunks:[new Uint8Array(3),new Uint8Array(100)]});assert.equal((await over.promise).bytes,null);assert.deepEqual(over.stats(),{pulls:1,cancels:1});assert.equal(over.body.locked,false);
const invalidChunk=await streamCase({size:4,chunks:['PRIVATE_BAD_CHUNK']});assert.equal((await invalidChunk.promise).bytes,null);assert.equal(invalidChunk.body.locked,false);
const broken=await streamCase({size:4,chunks:[bytes.subarray(0,1)],failAt:1});await failure(broken.promise,'storage_unavailable');assert.equal(broken.body.locked,false);
const cancelFailed=await streamCase({size:5,cancelFails:true});await failure(cancelFailed.promise,'storage_unavailable');assert.equal(cancelFailed.body.locked,false);
const empty=await streamCase({size:0,limit:0});assert.equal((await empty.promise).bytes.byteLength,0);assert.equal(empty.body.locked,false);
let misplacedCanceled=0;const misplacedBody=new ReadableStream({cancel(){misplacedCanceled++;}},{highWaterMark:0});
await failure(new core.R2DocumentArchiveObjects({...bucket,get:async()=>({key:'wrong',size:4,body:misplacedBody})}).read(key,4),'storage_unavailable');assert.equal(misplacedCanceled,1);assert.equal(misplacedBody.locked,false);
const maximum=new Uint8Array(core.DOCUMENT_ARCHIVE_MAX_BYTES),maximumKey=await archiveTestKey(maximum);
assert.equal(await new core.R2DocumentArchiveObjects({...bucket,put:async(k,value,options)=>{
  assert.equal(value.byteLength,core.DOCUMENT_ARCHIVE_MAX_BYTES);assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});return {key:k,size:value.byteLength};
}}).putIfAbsent(maximumKey,maximum),'created');
assert.equal(typeof store.delete,'undefined');assert.equal(typeof store.list,'undefined');
console.log('PASS: R2 port validates opaque identity/size/hash, captures caller bytes, uses conditional creation/checksum/private metadata, sanitizes errors and bounds/cancels real streams without leaking locks or partial documents.');
