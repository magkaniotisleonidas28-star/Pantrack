import assert from 'node:assert/strict';
const origin='http://127.0.0.1:5181';
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'}),cookie=signed.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Start pnpm dev:cart');
async function request(path,body,expected=200){const r=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;}
const companyId=crypto.randomUUID();await request('/api/companies',{action:'create',id:companyId,name:'Fictional cart HTTP acceptance'});
const before=await request(`/api/inventory?companyId=${companyId}`);
const input={action:'create',companyId,operationId:crypto.randomUUID(),source:'manual',supplier:{id:'cart-demo-supplier',name:'Fictional cart supplier',email:'orders@example.invalid',accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'},capMinor:'50000',notes:'Fictional HTTP acceptance',lines:[{kind:'non_stock',sku:'DEMO-COFFEE',description:'House coffee beans',unitLabel:'case of 6 × 1 lb',packs:'2',estimatedUnitMinor:'5400'}]};
const {order}=await request('/api/purchase-orders',input);const reviewed=(await request('/api/purchase-orders',{action:'review',companyId,orderId:order.snapshot.id,expectedRevision:1,operationId:crypto.randomUUID(),acknowledgeWarnings:true})).order;
const path=`/api/cart-preview?companyId=${companyId}&orderId=${order.snapshot.id}`;
assert.equal((await fetch(origin+path)).status,401);
await request(`/api/cart-preview?companyId=${crypto.randomUUID()}&orderId=${order.snapshot.id}`,undefined,403);
const start={action:'start',companyId,orderId:order.snapshot.id,expectedRevision:reviewed.revision,operationId:crypto.randomUUID(),layout:'rows',scenario:'normal'};
assert.equal((await fetch(origin+'/api/cart-preview',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify(start)})).status,403);
await request('/api/cart-preview',{...start,actor:'owner'},400);
const [a,b]=await Promise.all([request('/api/cart-preview',start),request('/api/cart-preview',start)]);assert.equal(a.job.id,b.job.id);
await request('/api/cart-preview',{...start,scenario:'unavailable'},409);
await request('/api/cart-preview',{...start,operationId:crypto.randomUUID()},409);
const jobPath=`/api/cart-preview?companyId=${companyId}&jobId=${a.job.id}`;
let job;for(let n=0;n<80;n++){job=(await request(jobPath)).job;if(job.state!=='preparing')break;await new Promise(ok=>setTimeout(ok,250));}
assert.equal(job.state,'ready',job.message);assert.equal((await request(path)).job.id,job.id,'Reopen recovers job without browser storage');
await request('/api/cart-preview',{action:'inspect',companyId,jobId:job.id});
await request('/api/purchase-orders',{...input,action:'edit',orderId:order.snapshot.id,expectedRevision:reviewed.revision,operationId:crypto.randomUUID(),reason:'Verify source invalidation',notes:'Changed after cart preparation'});
assert.equal((await request(jobPath)).job.state,'needs_review');
await request('/api/cart-preview',start,409);
await request('/api/cart-preview',{action:'resume',companyId,jobId:job.id},409);
await request('/api/cart-preview',{action:'cancel',companyId,jobId:job.id});
assert.deepEqual(await request(`/api/inventory?companyId=${companyId}`),before);
console.log('PASS: served cart API authentication/tenant/CSRF/strict input, concurrent replay, cart lock, same-session inspect, reopen recovery, draft invalidation and unchanged inventory.');
