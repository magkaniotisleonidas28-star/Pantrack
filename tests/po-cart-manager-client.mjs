import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
await build({entryPoints:['src/components/workspace/durable-cart-client.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/cart-manager-client.mjs'});
const {intentKey,readIntent,sendCartIntent}=await import('../.sites-runtime/cart-manager-client.mjs');
const memory=new Map(),storage={getItem:k=>memory.get(k)??null};
const key=intentKey('manager','a','po');assert.notEqual(key,intentKey('other','a','po'));assert.notEqual(key,intentKey('manager','b','po'));
const intent={endpoint:'po-cart-jobs',body:{action:'enqueue',companyId:'a',authorizationId:'auth',expectedRevision:1,operationId:randomUUID(),browser:{layout:'compact',scenario:'malicious'}}};
memory.set(key,JSON.stringify(intent));assert.deepEqual(readIntent(storage,key),intent);assert.equal(readIntent(storage,intentKey('other','a','po')),null);
let calls=[],lost=true;
globalThis.fetch=async(url,options)=>{calls.push({url,...options});if(lost){lost=false;throw Error('Lost response');}return Response.json({receipt:{operationId:intent.body.operationId,action:'enqueue'}});};
await assert.rejects(()=>sendCartIntent(intent));await sendCartIntent(readIntent(storage,key));assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].redirect,'error');
for(const status of [400,404,409,401,403,503]){
  globalThis.fetch=async()=>Response.json({error:'Blocked'},{status});await assert.rejects(()=>sendCartIntent(intent),e=>e.definitive===[400,404,409].includes(status));
}
globalThis.fetch=async()=>Response.json({receipt:{operationId:randomUUID(),action:'enqueue'}});await assert.rejects(()=>sendCartIntent(intent),e=>!e.definitive);
memory.set(key,JSON.stringify({...intent,body:{...intent.body,token:'secret'}}));assert.throws(()=>readIntent(storage,key));
for(const action of ['acceptVerifiedCart','abandonVerifiedCart']){
 const decision={endpoint:'po-cart-jobs',body:{action,companyId:'a',jobId:'job',expectedRevision:4,expectedAuthorizationRevision:2,sessionId:randomUUID(),expectedSessionRevision:7,operationId:randomUUID(),note:'Fictional review note'}};
 memory.set(key,JSON.stringify(decision));assert.deepEqual(readIntent(storage,key),decision);let lost=true;const sent=[];
 globalThis.fetch=async(url,options)=>{sent.push(options.body);if(lost){lost=false;throw Error('lost decision response');}return Response.json({receipt:{operationId:decision.body.operationId,action}});};
 await assert.rejects(sendCartIntent(decision));await sendCartIntent(readIntent(storage,key));assert.deepEqual(JSON.parse(sent[0]),JSON.parse(sent[1]));
 memory.set(key,JSON.stringify({...decision,body:{...decision.body,note:''}}));assert.throws(()=>readIntent(storage,key));
}
console.log('PASS: manager intent recovery is actor/company/order scoped, strict and UUID preserving; uncertain acknowledgments cannot create replacement requests.');
