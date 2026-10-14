import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
// Requires pnpm dev:purchase-orders: isolated fictional localhost only.
const origin='http://127.0.0.1:5179';
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=signed.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Local fixture sign-in');
async function call(path,body){const response=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
const companyId=crypto.randomUUID();await call('/api/companies',{action:'create',id:companyId,name:'Fictional draft review acceptance'});
const path=`/api/purchase-orders?companyId=${companyId}`,inventory=await call(`/api/inventory?companyId=${companyId}`);
const input={action:'create',companyId,operationId:crypto.randomUUID(),source:'manual',supplier:{id:'fictional',name:'Fictional review supplier',email:'orders@example.invalid',accountId:'DEMO',locationId:'Practice cafe',deliveryAddress:'123 Example Street'},
  capMinor:'10000',notes:'Fictional review only',lines:[{kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:null}]};
const first=(await call(path,input)).order;
const edit={...input,action:'edit',orderId:first.snapshot.id,expectedRevision:1,operationId:crypto.randomUUID(),reason:'Correct pack count',lines:[{...input.lines[0],packs:'3'}]};
const changed=(await call(path,edit)).order;assert.equal(changed.revision,2);assert.deepEqual((await call(path,edit)).order,changed);
const review={action:'review',companyId,orderId:first.snapshot.id,expectedRevision:2,operationId:crypto.randomUUID(),acknowledgeWarnings:true};
const reviewed=(await call(path,review)).order;assert.equal(reviewed.status,'reviewed');assert.equal(reviewed.review.contentRevision,2);
assert.deepEqual((await call(path,review)).order,reviewed);
const again=(await call(path,{...edit,operationId:crypto.randomUUID(),expectedRevision:3,notes:'Manager correction after review'})).order;
assert.equal(again.status,'draft');assert.equal(again.review,undefined);assert.equal(again.revision,4);
assert.deepEqual((await call(`${path}&orderId=${first.snapshot.id}&revision=1`)).order,first);
assert.deepEqual((await call(`${path}&orderId=${first.snapshot.id}&revision=3`)).order,reviewed);
const stale=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({...edit,operationId:crypto.randomUUID()})});assert.equal(stale.status,409);
assert.equal((await fetch(origin+path)).status,401);
assert.equal((await fetch(origin+`/api/purchase-orders?companyId=${crypto.randomUUID()}`,{headers:{cookie}})).status,403);
assert.deepEqual(await call(`/api/inventory?companyId=${companyId}`),inventory);
writeFileSync('.sites-runtime/po-review-http-fixture.json',JSON.stringify({companyId,orderId:first.snapshot.id}));
console.log('PASS: served isolated local D1 create/edit/review/invalidation, exact replay, immutable historical reads, stale revision and company guards, unchanged inventory.');
