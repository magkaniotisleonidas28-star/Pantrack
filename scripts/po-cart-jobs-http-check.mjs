// Fictional local manager API only. Internal workers have no HTTP transport in this slice.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,unlinkSync} from 'node:fs';
const origin='http://127.0.0.1:5181';
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'}),cookie=signed.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie,'Start pnpm dev:cart first.');
async function request(path,body,expected=200){
  const response=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));assert.match(response.headers.get('cache-control'),/no-store/);return data;
}
const companyId=crypto.randomUUID();await request('/api/companies',{action:'create',id:companyId,name:'Fictional durable cart job HTTP check'});
const before=await request(`/api/inventory?companyId=${companyId}`);
const supplier={id:'cart-demo-supplier',name:'Fictional supplier',email:'orders@example.invalid',accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'};
const connection={companyId,id:'fictional-http-job-connection',version:1,supplierId:supplier.id,accountId:supplier.accountId,locationId:supplier.locationId,mode:'fictional',status:'active',paused:false};
const quote=value=>`'${String(value).replaceAll("'","''")}'`,fixturePath=`.sites-runtime/cart-job-http-${companyId}.sql`;
try{
  writeFileSync(fixturePath,`INSERT INTO po_cart_connections VALUES(${quote(companyId)},${quote(connection.id)},1,${quote(JSON.stringify(connection))});\n`+
    `INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES(${quote(companyId)},1,50000,100000);\n`,{mode:0o600});
  const configured=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',
    '.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',fixturePath],{encoding:'utf8'});
  if(configured.error)throw configured.error;assert.equal(configured.status,0,configured.stderr);
}finally{unlinkSync(fixturePath);}
const {order}=await request('/api/purchase-orders',{action:'create',companyId,operationId:crypto.randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'Fictional durable job',
  lines:[{kind:'non_stock',sku:'DEMO-COFFEE',description:'Practice coffee',unitLabel:'case',packs:'2',estimatedUnitMinor:'100'}]});
const {order:reviewed}=await request('/api/purchase-orders',{action:'review',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:crypto.randomUUID(),acknowledgeWarnings:true});
const permission=await request('/api/po-cart-authorizations',{action:'authorize',companyId,orderId:order.snapshot.id,expectedRevision:reviewed.revision,operationId:crypto.randomUUID()});
const input={action:'enqueue',companyId,authorizationId:permission.current.authorization.id,expectedRevision:1,operationId:crypto.randomUUID()};
assert.equal((await fetch(origin+`/api/po-cart-jobs?companyId=${companyId}&jobId=unknown`)).status,401);
const [first,retry]=await Promise.all([request('/api/po-cart-jobs',input),request('/api/po-cart-jobs',input)]);assert.deepEqual(first,retry);
const j=first.current.job;assert.equal(j.state,'queued');assert.equal(first.current.valid,true);
assert.deepEqual(first.current.authorization.reservation,permission.current.reservation);
assert.equal(first.current.authorization.authorization.startedAt,null);
await request('/api/po-cart-jobs',{...input,operationId:crypto.randomUUID()},409);
await request('/api/po-cart-jobs',{action:'claim',companyId,jobId:j.id,operationId:crypto.randomUUID()},400);
assert.deepEqual(await request(`/api/po-cart-jobs?companyId=${companyId}&jobId=${j.id}`),first.current);
const cancel={action:'cancel',companyId,jobId:j.id,expectedRevision:j.revision,operationId:crypto.randomUUID(),reason:'Safe fictional cancellation'};
const done=await request('/api/po-cart-jobs',cancel);assert.equal(done.current.job.state,'canceled');assert.equal(done.current.ownership.jobId,null);
assert.equal(done.current.authorization.reservation.state,'released');assert.deepEqual(await request('/api/po-cart-jobs',cancel),done);
const old=await request('/api/po-cart-jobs',input);assert.deepEqual(old.receipt,first.receipt);assert.equal(old.current.valid,false);assert.equal(old.current.job.state,'canceled');
assert.deepEqual(await request(`/api/inventory?companyId=${companyId}`),before);
console.log('PASS: served local D1 job enqueue/status/cancel, concurrent replay, authorization reservation reuse, no worker HTTP actions and unchanged stock/incoming.');
