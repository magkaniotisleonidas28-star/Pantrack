import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workerFixture,workerOrigin} from './helpers/po-cart-worker.mjs';
import {snapshot,cancel} from './helpers/po-cart-jobs.mjs';
const f=await workerFixture();
const op=(action,j,extra={})=>({action,jobId:j.id,operationId:randomUUID(),...extra});
async function denied(status,fn){const before=snapshot(f),r=await fn();assert.equal(r.status,status,await r.text());assert.equal(snapshot(f),before);}
const json=async r=>{assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('access-control-allow-origin'),null);return r.json();};
try{
  const q=await f.queued({notes:'PRIVATE PO NOTE'}),j=q.current.job,c=f.credential(),claim=op('claim',j);
  for(const bad of [null,{secret:'invalid'},f.credential({expiresAt:new Date(Date.now()-1).toISOString()})]){
    await denied(401,()=>f.request(bad));await denied(401,()=>f.request(bad,claim));
  }
  const revoked=f.credential();f.revoke(revoked);await denied(401,()=>f.request(revoked,null,j.id));
  for(const role of ['employee','manager','owner'])await denied(401,()=>f.request(null,claim,null,{cookie:'session='+role,'x-worker-id':c.workerId,'x-chatgpt-user-id':role}));
  for(const flag of ['PANTRACK_CART_PREVIEW','PANTRACK_CART_WORKER_TRANSPORT']){
    globalThis.__workerApi.env[flag]='disabled';await denied(404,()=>f.request(c));await denied(404,()=>f.request(c,claim));globalThis.__workerApi.env[flag]='enabled';
  }
  for(const host of ['http://localhost:5194','https://pantrack.example.invalid','http://192.0.2.1'])await denied(404,()=>f.request(c,claim,null,{},host));
  await denied(403,()=>f.request(c,claim,null,{origin:workerOrigin}));await denied(403,()=>f.request(c,null,j.id,{'sec-fetch-site':'same-origin'}));
  assert.equal((await f.api.OPTIONS()).status,403);
  for(const extra of [{workerId:c.workerId},{companyId:'a'},{accountId:'DEMO-CART'},{supplierId:j.supplierId},{operationId:'bad'},{action:'enqueue'},{fence:1}])await denied(400,()=>f.request(c,{...claim,...extra}));
  await denied(413,()=>f.request(c,{...claim,pad:'x'.repeat(32768)}));
  await denied(400,()=>f.api.GET(new Request(workerOrigin+'/api/internal/po-cart-worker?jobId=a&jobId=b',{headers:{authorization:'Bearer '+c.secret}})));
  for(const wrong of [f.credential({companyId:'b'}),f.credential({accountId:'OTHER'}),f.credential({supplierId:'OTHER'})]){
    assert.equal((await json(await f.request(wrong))).current,null);
    await denied(404,()=>f.request(wrong,null,j.id));await denied(404,()=>f.request(wrong,claim));
  }
  const candidate=await json(await f.request(c));assert.equal(candidate.current.job.id,j.id);
  const text=JSON.stringify(candidate);for(const absent of ['PRIVATE PO NOTE','snapshot','requestedBy','credential','secret','memberships','events','authorizationId'])assert.ok(!text.includes(absent),absent);
  assert.deepEqual(Object.keys(candidate.current).sort(),['attempts','capMinor','currency','job','lines','ownership','results','valid'].sort());
  // Revocation is injected immediately before the committing batch, after application checks.
  // Status also uses batches, so detect the batch containing the operation receipt insert.
  const original=f.db.batch.bind(f.db);let beforeCommit=null;
  f.db.batch=async statements=>{if(beforeCommit&&statements.some(s=>s.query.startsWith('INSERT INTO po_cart_job_operations'))){const fn=beforeCommit;beforeCommit=null;fn();}return original(statements);};
  // Transaction-time expiry and identity-version changes fence commits too.
  for(const change of ['expiry','version']){
    const cred=f.credential();
    beforeCommit=()=>change==='version'?f.sql.prepare('UPDATE po_cart_worker_identities SET version=version+1 WHERE id=?').run(cred.workerId):
      f.sql.function('strftime',{varargs:true},()=>new Date(Date.now()+7200000).toISOString());
    await denied(401,()=>f.request(cred,op('claim',j)));
    f.sql.function('strftime',{varargs:true},()=>new Date().toISOString());
  }
  beforeCommit=()=>f.revoke(c);await denied(401,()=>f.request(c,claim));assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_job_operations').get().n,1);
  const active=f.credential({workerId:c.workerId});
  const first=await json(await f.request(active,claim));assert.equal(first.current.job.state,'preparing');
  const fence=first.receipt.fence,begin=op('beginAttempt',j,{fence,lineId:j.inputs.preflight.lines[0].lineId});
  const duplicate=await Promise.all([f.request(active,begin),f.request(active,begin)]);
  const acknowledgements=await Promise.all(duplicate.map(json));assert.equal(acknowledgements.filter(r=>r.providerCallAllowed).length,1);
  const begun=acknowledgements.find(r=>r.providerCallAllowed);assert.equal(begun.providerCallAllowed,true);
  assert.equal((await json(await f.request(active,begin))).providerCallAllowed,false);
  const rotated=f.credential({workerId:active.workerId});f.revoke(active);
  await denied(401,()=>f.request(active,begin));await denied(401,()=>f.request(active,null,j.id));
  const replay=await json(await f.request(rotated,begin));assert.equal(replay.providerCallAllowed,false);assert.deepEqual(replay.receipt,begun.receipt);
  const competing=f.credential();await denied(409,()=>f.request(competing,claim));
  await denied(409,()=>f.request(competing,op('heartbeat',j,{fence})));
  for(const wrong of [f.credential({companyId:'b'}),f.credential({accountId:'OTHER'})])await denied(404,()=>f.request(wrong,begin));
  const result=op('recordResult',j,{fence,attemptId:begun.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]});
  beforeCommit=()=>f.revoke(rotated);await denied(401,()=>f.request(rotated,result));assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_results').get().n,0);
  const next=f.credential({workerId:rotated.workerId});f.db.loseAcknowledgment=true;
  const ready=await json(await f.request(next,result));assert.equal(ready.current.job.state,'ready');assert.deepEqual(await json(await f.request(next,result)),ready);
  await denied(409,()=>f.request(next,op('heartbeat',j,{fence})));
  await f.jobs().cancel(cancel({...j,revision:ready.current.job.revision}));
  await denied(409,()=>f.request(next,op('recordResult',j,{...result,operationId:randomUUID()})));
  assert.equal((await json(await f.request(next,begin))).current.job.state,'canceled');
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{f.sql.close();delete globalThis.__workerApi;}
console.log('PASS: worker HTTP gates, credentials, scope/privacy, rotation/replay, transaction-time revocation/expiry/version, cancellation and unchanged reservations.');
