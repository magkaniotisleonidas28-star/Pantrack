// Run against pnpm dev:cart only. Explicit fictional configuration in its isolated local D1.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,unlinkSync} from 'node:fs';
const origin='http://127.0.0.1:5181';
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'}),cookie=signed.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie,'Start pnpm dev:cart first.');
async function request(path,body,expected=200){
  const response=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));
  assert.match(response.headers.get('cache-control'),/no-store/);return data;
}
const companyId=crypto.randomUUID();await request('/api/companies',{action:'create',id:companyId,name:'Fictional durable authorization HTTP check'});
const supplier={id:'cart-demo-supplier',name:'Fictional cart supplier',email:'orders@example.invalid',accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'};
const before=await request(`/api/inventory?companyId=${companyId}`);
async function reviewed(){
  const input={action:'create',companyId,source:'manual',operationId:crypto.randomUUID(),supplier,capMinor:'40000',notes:'Fictional authorization HTTP test',
    lines:[{kind:'non_stock',sku:'DEMO-COFFEE',description:'Practice item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]};
  const {order}=await request('/api/purchase-orders',input);
  return (await request('/api/purchase-orders',{action:'review',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:crypto.randomUUID(),acknowledgeWarnings:true})).order;
}
const orders=await Promise.all([reviewed(),reviewed(),reviewed()]);
const commands=orders.map(order=>({action:'authorize',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:crypto.randomUUID()}));
assert.equal((await fetch(origin+`/api/po-cart-authorizations?companyId=${companyId}&orderId=${commands[0].orderId}`)).status,401);
await request('/api/po-cart-authorizations',commands[0],409); // no connection or policy
const connection={companyId,id:'fictional-http-connection',version:1,supplierId:supplier.id,accountId:supplier.accountId,locationId:supplier.locationId,
  mode:'fictional',status:'active',paused:false};
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const fixturePath=`.sites-runtime/cart-http-${companyId}.sql`;
try{
  writeFileSync(fixturePath,`INSERT INTO po_cart_connections VALUES(${quote(companyId)},${quote(connection.id)},1,${quote(JSON.stringify(connection))});\n`+
    `INSERT INTO po_cart_budget_policies VALUES(${quote(companyId)},1,50000,100000);\n`,{mode:0o600});
  const configured=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local',
    '--config','.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',fixturePath],{encoding:'utf8'});
  if(configured.error)throw configured.error;assert.equal(configured.status,0,configured.stderr);
}finally{unlinkSync(fixturePath);}
const [first,retry]=await Promise.all([request('/api/po-cart-authorizations',commands[0]),request('/api/po-cart-authorizations',commands[0])]);
assert.deepEqual(first,retry);assert.equal(first.current.valid,true);
const a=first.current.authorization;
await request('/api/po-cart-authorizations',{...commands[0],operationId:crypto.randomUUID()},409);
const budgetRace=await Promise.all(commands.slice(1).map(async command=>{
  const response=await fetch(origin+'/api/po-cart-authorizations',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(command)});
  return {status:response.status,data:await response.json()};
}));
assert.deepEqual(budgetRace.map(r=>r.status).sort(),[200,409]);
const cancel={action:'cancel',companyId,authorizationId:a.id,expectedRevision:a.revision,operationId:crypto.randomUUID(),reason:'Safe fictional cancellation'};
const released=await request('/api/po-cart-authorizations',cancel);assert.equal(released.current.reservation.state,'released');
assert.deepEqual(await request('/api/po-cart-authorizations',cancel),released);
const old=await request('/api/po-cart-authorizations',commands[0]);assert.deepEqual(old.receipt,first.receipt);assert.equal(old.current.authorization.status,'canceled');assert.equal(old.current.valid,false);
assert.equal((await request(`/api/po-cart-authorizations?companyId=${companyId}&orderId=${a.orderId}`)).authorization.status,'canceled');
assert.deepEqual(await request(`/api/inventory?companyId=${companyId}`),before);
console.log('PASS: served local D1 authorization configuration, atomic PO replay and exposure races, canceled old receipt, persisted status and zero stock/incoming effects.');
