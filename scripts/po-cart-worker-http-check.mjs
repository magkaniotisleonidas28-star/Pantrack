// Served local D1 acceptance. Start pnpm dev:cart-worker first.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
import {readPrivate} from './po-cart-worker/private-files.mjs';
const origin='http://127.0.0.1:5181',root='.sites-runtime/po-cart-workers/served-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'}),cookie=signed.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Start pnpm dev:cart-worker first.');
async function request(path,body){const r=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});
  const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
async function execute(sql){const file=root+'/fixture.sql';writeFileSync(file,sql,{mode:0o600});
  try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',
    '.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',file],{encoding:'utf8'});
    assert.equal(r.status,0,'Local D1 fixture setup failed.');}finally{unlinkSync(file);}}
const quote=value=>`'${String(value).replaceAll("'","''")}'`,companyId=randomUUID();
await request('/api/companies',{action:'create',id:companyId,name:'Fictional worker HTTP acceptance'});
const initial=await request('/api/inventory?companyId='+companyId);
const supplier={id:'cart-demo-supplier',name:'Fictional cart',email:'orders@example.invalid',accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'};
const connection={companyId,id:'worker-http-connection',version:1,supplierId:supplier.id,accountId:supplier.accountId,locationId:supplier.locationId,mode:'fictional',status:'active',paused:false};
await execute(`INSERT INTO po_cart_connections VALUES(${quote(companyId)},${quote(connection.id)},1,${quote(JSON.stringify(connection))});\nINSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES(${quote(companyId)},1,50000,100000);`);
const {order}=await request('/api/purchase-orders',{action:'create',companyId,operationId:randomUUID(),source:'manual',supplier,capMinor:'15000',notes:'PRIVATE WORKER FIXTURE NOTE',
  lines:[{kind:'non_stock',sku:'DEMO-COFFEE',description:'Practice coffee',unitLabel:'case',packs:'2',estimatedUnitMinor:'100'}]});
const reviewed=await request('/api/purchase-orders',{action:'review',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:randomUUID(),acknowledgeWarnings:true});
const permission=await request('/api/po-cart-authorizations',{action:'authorize',companyId,orderId:order.snapshot.id,expectedRevision:reviewed.order.revision,operationId:randomUUID()});
const queued=await request('/api/po-cart-jobs',{action:'enqueue',companyId,authorizationId:permission.current.authorization.id,expectedRevision:1,operationId:randomUUID()});
const files=[root+'/one.json',root+'/two.json'];for(const file of files)await fixtureCredential({execute,file,companyId});
const url=origin+'/api/internal/po-cart-worker';assert.equal((await fetch(url,{headers:{cookie}})).status,401);
const workers=files.map((file,i)=>new Promise((ok,fail)=>{
  const p=spawn(process.execPath,['scripts/po-cart-worker.mjs','--credential',file,'--journal',root+`/journal-${i}.json`,'--origin',origin,'--once'],{stdio:['ignore','pipe','pipe'],env:Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
  let output='';p.stdout.on('data',b=>{output+=b;});p.stderr.on('data',b=>{output+=b;});p.on('error',fail);p.on('exit',code=>ok({code,output}));
}));
const results=await Promise.all(workers);assert.ok(results.some(r=>r.code===0));
const finished=await request(`/api/po-cart-jobs?companyId=${companyId}&jobId=${queued.current.job.id}`);
assert.equal(finished.job.state,'ready');assert.equal(finished.attempts.length,1);assert.equal(finished.results.length,1);
assert.deepEqual(finished.authorization.reservation,permission.current.reservation);
assert.deepEqual(await request('/api/inventory?companyId='+companyId),initial);
assert.equal([0,1].flatMap(i=>readPrivate(root+`/journal-${i}.json`).calls).length,1);
const old=readPrivate(files[0]);for(const r of results)for(const file of files)assert.ok(!r.output.includes(readPrivate(file).secret));
const read=await fetch(url+'?jobId='+finished.job.id,{headers:{authorization:'Bearer '+old.secret}});assert.equal(read.status,200);
const projection=await read.text();assert.ok(!projection.includes('PRIVATE WORKER FIXTURE NOTE'));assert.ok(!projection.includes(old.secret));
await fixtureCredential({execute,file:files[0],action:'rotate'});
assert.equal((await fetch(url,{headers:{authorization:'Bearer '+old.secret}})).status,401);
const rotated=readPrivate(files[0]);assert.equal(rotated.workerId,old.workerId);
assert.equal((await fetch(url+'?jobId='+finished.job.id,{headers:{authorization:'Bearer '+rotated.secret}})).status,200);
await fixtureCredential({execute,file:files[0],action:'revoke'});
assert.equal((await fetch(url+'?jobId='+finished.job.id,{headers:{authorization:'Bearer '+rotated.secret}})).status,401);
await fixtureCredential({execute,file:files[1],action:'revoke'});
console.log('PASS: served local D1, two HTTP-only workers, one attempt/result/call, private projection, rotation/revocation and unchanged stock/incoming.');
