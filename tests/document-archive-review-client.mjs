import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
mkdirSync('.sites-runtime',{recursive:true});await build({entryPoints:['src/lib/document-archive-review-client.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/archive-review-client.mjs'});
const {DocumentArchiveReviewClient}=await import('../.sites-runtime/archive-review-client.mjs');
const item={id:crypto.randomUUID(),companyId:'a',format:'pdf',source:{kind:'draft',orderId:'draft-1',revision:1},requestedAt:'2026-10-31T12:00:00.000Z',updatedAt:'2026-10-31T12:00:00.000Z',status:'held',reason:'held',issued:false,lastCheckedAt:null};
const selection={companyId:'a',kind:'draft',orderId:'draft-1'},page={viewerId:'manager',items:[item],hasMore:false},detail={viewerId:'manager',item,events:[],hasMore:false};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(fetcher=async url=>Response.json(url.includes('review-detail')?detail:page),viewer='manager'){
  const states=[],calls=[],client=new DocumentArchiveReviewClient(selection,viewer,{fetch:async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');return fetcher(url,options);}},state=>states.push(state));
  return {client,states,calls};
}
const valid=fixture();await valid.client.list();await valid.client.detail(item.id,20);assert.equal(valid.states.at(-1).detail.item.id,item.id);assert.equal(valid.states.at(-1).eventOffset,20);valid.client.closeDetail();assert.equal(valid.states.at(-1).detail,null);valid.client.dispose();
for(const mode of ['denied','server','viewer','company','source','malformed']){
  let failing=false;const f=fixture(async()=>!failing?Response.json(page):mode==='denied'?Response.json({error:'PRIVATE'},{status:403}):mode==='server'?Response.json({error:'PRIVATE'},{status:503}):Response.json(mode==='viewer'?{...page,viewerId:'owner'}:mode==='company'?{...page,items:[{...item,companyId:'b'}]}:mode==='source'?{...page,items:[{...item,source:{...item.source,orderId:'another'}}]}:{items:'PRIVATE'}));
  await f.client.list();assert.equal(f.states.at(-1).page.items.length,1);failing=true;await f.client.list();assert.equal(f.states.at(-1).page,null);assert.equal(f.states.at(-1).detail,null);assert.ok(!f.states.at(-1).message.includes('PRIVATE'));f.client.dispose();
}
const first=deferred(),f=fixture(async(url)=>url.includes('offset=20')?first.promise:Response.json(page));await f.client.list();const loading=f.client.list(20);assert.equal(f.states.at(-1).offset,0);f.client.cancel();assert.equal(f.calls.at(-1).options.signal.aborted,true);first.resolve(Response.json(page));await loading;assert.equal(f.states.at(-1).offset,0);assert.equal(f.states.at(-1).loading,false);f.client.dispose();
const late=deferred(),stale=fixture(async()=>late.promise),waiting=stale.client.list();stale.client.dispose();const emitted=stale.states.length;let canceled=0;
late.resolve(new Response(new ReadableStream({cancel(){canceled++;}},{highWaterMark:0})));await waiting;assert.equal(stale.states.length,emitted);assert.equal(canceled,1);
const parseWait=deferred(),parseStarted=deferred(),parse=fixture(async()=>new Response(new ReadableStream({async pull(controller){parseStarted.resolve();await parseWait.promise;controller.enqueue(new TextEncoder().encode(JSON.stringify(page)));controller.close();}},{highWaterMark:0}),{headers:{'content-type':'application/json'}}));
const reading=parse.client.list();await parseStarted.promise;parse.client.dispose();const count=parse.states.length;parseWait.resolve();await reading;assert.equal(parse.states.length,count);
const wrong=fixture(async()=>Response.json({...detail,item:{...item,id:crypto.randomUUID()}}));await wrong.client.detail(item.id);assert.equal(wrong.states.at(-1).detail,null);wrong.client.dispose();
const initial=fixture(undefined,'');await initial.client.list();assert.equal(initial.states.at(-1).page.viewerId,'manager');initial.client.dispose();
console.log('PASS: actual review controller GET lifecycle, scope/viewer binding, private-data clearing, cancellation/disposal, aborted streams and stable page offsets.');
