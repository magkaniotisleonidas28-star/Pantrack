import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workerFixture,workerOrigin} from './helpers/po-cart-worker.mjs';
import {snapshot} from './helpers/po-cart-jobs.mjs';
import {tables} from './helpers/po-cart-authorizations.mjs';
for(const action of ['claim','heartbeat','beginAttempt','recordResult','recoverExpired']){
  const f=await workerFixture();
  try{
    const stock=await f.stock('guard-stock'),queued=await f.queued({lines:[stock]}),j=queued.current.job,c=f.credential();
    let body={action,jobId:j.id,operationId:randomUUID()},claim;
    if(action==='recoverExpired')claim=await f.worker(c.workerId).claim({companyId:'a',jobId:j.id,operationId:randomUUID()});
    else if(action!=='claim')claim=await (await f.request(c,{action:'claim',jobId:j.id,operationId:randomUUID()})).json();
    if(['heartbeat','beginAttempt','recordResult'].includes(action))body.fence=claim.receipt.fence;
    if(action==='beginAttempt')body.lineId=j.inputs.preflight.lines[0].lineId;
    if(action==='recordResult'){
      const begin=await (await f.request(c,{action:'beginAttempt',jobId:j.id,fence:body.fence,lineId:j.inputs.preflight.lines[0].lineId,operationId:randomUUID()})).json();
      body={...body,attemptId:begin.receipt.attemptId,outcome:'verified',observation:j.inputs.preflight.lines[0]};
    }
    for(const wrong of [f.credential({companyId:'b'}),f.credential({accountId:'other'})]){
      const prior=snapshot(f);assert.equal((await f.request(wrong,body)).status,404);assert.equal(snapshot(f),prior);
    }
    const prior=snapshot(f),inventory=tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact']);
    const batch=f.db.batch.bind(f.db);let injected=false;
    f.db.batch=async statements=>{
      if(!injected&&statements.some(s=>s.query.startsWith('INSERT INTO po_cart_job_operations'))){injected=true;f.revoke(c);}
      return batch(statements);
    };
    const response=await f.request(c,body);assert.equal(response.status,401,action);assert.equal(injected,true);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(snapshot(f),prior,action+' rolls back all purchasing writes');assert.equal(tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact']),inventory);
    assert.equal((await f.request(c,body)).status,401);assert.equal((await f.request(c,null,j.id)).status,401);
    assert.equal(f.sql.prepare('SELECT state FROM po_cart_reservations').get().state,'reserved');
    // Streaming byte limit catches UTF-8 bodies even without Content-Length.
    const active=f.credential(),bytes=new TextEncoder().encode(JSON.stringify({pad:'é'.repeat(17000)}));
    const request=new Request(workerOrigin+'/api/internal/po-cart-worker',{method:'POST',duplex:'half',headers:{authorization:'Bearer '+active.secret,'content-type':'application/json'},
      body:new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,20000));controller.enqueue(bytes.slice(20000));controller.close();}})});
    assert.equal((await f.api.POST(request)).status,413);
  }finally{f.sql.close();delete globalThis.__workerApi;}
}
console.log('PASS: every HTTP mutation rolls back on commit-time revocation, isolates wrong-company/account scopes and preserves actual stock/incoming/quantity/budget holds; streaming byte limit.');
