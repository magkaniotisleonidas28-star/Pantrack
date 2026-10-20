import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {auditCredentials} from '../scripts/po-cart-worker/credential-audit.mjs';
import {workerFixture,workerOrigin} from './helpers/po-cart-worker.mjs';

const f=await workerFixture(),httpChecks=[],sqlChecks=[],httpModes=new Map();
const rawError='PRIVATE SQL/HTTP failure with credential details';
const row=c=>f.sql.prepare('SELECT * FROM po_cart_worker_credentials WHERE id=?').get(c.credentialId);
const events=c=>f.sql.prepare('SELECT * FROM po_cart_worker_credential_events WHERE credential_id=? ORDER BY id').all(c.credentialId);
const state=c=>({row:row(c),events:events(c)});
const server=createServer(async(req,res)=>{
 const secret=req.headers.authorization?.slice('Bearer '.length);
 httpChecks.push(secret);
 if(httpModes.get(secret)==='disconnect'){req.socket.destroy();return;}
 if(httpModes.has(secret)){res.writeHead(httpModes.get(secret));res.end();return;}
 try{
  // Forward the actual bearer header to the existing worker authorization route.
  const response=await f.api.GET(new Request(workerOrigin+req.url,{headers:req.headers}));
  res.writeHead(response.status);res.end(await response.text());
 }catch{res.writeHead(500);res.end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const execute=sql=>{sqlChecks.push(sql);f.sql.exec(sql);return true;};
async function audit(credentials,extra={}){
 const sqlBefore=sqlChecks.length,httpBefore=httpChecks.length;
 const report=await auditCredentials({credentials,execute,origin,...extra});
 assert.equal(sqlChecks.length-sqlBefore,credentials.length);
 assert.deepEqual(httpChecks.slice(httpBefore),credentials.map(c=>c.secret));
 assert.deepEqual(Object.keys(report).sort(),['count','passed','results']);
 for(const result of report.results)assert.deepEqual(Object.keys(result).sort(),['credentialId','revoked','status']);
 for(const privateText of [rawError,...f.issuedCredentials.map(c=>c.secret),...credentials.map(c=>c.secret)])assert.ok(!JSON.stringify(report).includes(privateText));
 assert.ok(sqlChecks.slice(sqlBefore).every(sql=>!credentials.some(c=>sql.includes(c.secret))));
 return report;
}
try{
 const already=f.credential();f.revoke(already);const prior=state(already);
 // The historical cleanup SQL fails even when COALESCE preserves the timestamp.
 assert.throws(()=>f.sql.exec(`UPDATE po_cart_worker_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,'2099-01-01T00:00:00.000Z') WHERE id='${already.credentialId}' AND worker_id='${already.workerId}';`),/Worker credentials only permit revocation/);
 assert.deepEqual(state(already),prior);

 const active=f.credential(),sameWorker=f.credential({workerId:active.workerId}),unrelated=f.credential({companyId:'b'});
 const untouched=[sameWorker,unrelated].map(state);
 const missing={credentialId:'captured-but-not-inserted',workerId:'uninserted-worker',secret:'fictional-missing-secret'};
 const batch=[already,active,missing];
 const first=await audit(batch,{now:()=> '2026-10-15T05:00:00.000Z'});
 assert.equal(first.passed,true);assert.equal(first.count,3);
 assert.ok(first.results.every(r=>r.revoked&&r.status===401));
 assert.equal(row(active).revoked_at,'2026-10-15T05:00:00.000Z');
 assert.equal(events(active).filter(e=>e.kind==='revoked').length,1);
 assert.equal(row(missing),undefined);assert.deepEqual(events(missing),[]);
 const once=batch.map(state);
 const repeated=await audit(batch,{now:()=> '2099-01-01T00:00:00.000Z'});
 assert.deepEqual(repeated,first);assert.deepEqual(batch.map(state),once);assert.deepEqual(state(already),prior);
 assert.deepEqual([sameWorker,unrelated].map(state),untouched);

 // Both captured IDs must match. A mismatched worker leaves an active credential
 // untouched and its real HTTP 200 prevents a false successful audit.
 const mismatched={...sameWorker,workerId:unrelated.workerId};
 const mismatch=await audit([mismatched]);assert.equal(mismatch.passed,false);
 assert.deepEqual(mismatch.results,[{credentialId:sameWorker.credentialId,revoked:true,status:200}]);
 assert.deepEqual(state(sameWorker),untouched[0]);
 // SQL literals remain scoped even for captured identifiers containing quotes.
 const quoted=f.credential({workerId:"worker'quoted"});assert.equal((await audit([quoted])).passed,true);
 assert.deepEqual([sameWorker,unrelated].map(state),untouched);

 for(const failure of ['sql-throw','sql-false','http-throw','http-disconnect',200,500]){
  const target=f.credential(),after=f.credential();
  const needsSqlFailure=String(failure).startsWith('sql-');
  // A 401 alone never hides an unsuccessful SQL command, even for a revoked row.
  if(needsSqlFailure)f.revoke(target);
  if(failure==='http-disconnect')httpModes.set(target.secret,'disconnect');
  if(typeof failure==='number')httpModes.set(target.secret,failure);
  const report=await audit([target,after],{
   execute:sql=>{
    sqlChecks.push(sql);
    if(sql.includes(target.credentialId)&&needsSqlFailure){if(failure==='sql-throw')throw Error(rawError);return false;}
    f.sql.exec(sql);return true;
   },
   request:async(url,options)=>{
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted,false);
    if(options.headers.authorization==='Bearer '+target.secret&&failure==='http-throw'){httpChecks.push(target.secret);throw Error(rawError);}
    return fetch(url,options);
   }
  });
  assert.equal(report.passed,false);
  assert.deepEqual(report.results[0],{credentialId:target.credentialId,revoked:!needsSqlFailure,status:needsSqlFailure?401:typeof failure==='number'?failure:null});
  assert.deepEqual(report.results[1],{credentialId:after.credentialId,revoked:true,status:401});
  assert.equal(row(after).status,'revoked');assert.equal(events(after).filter(e=>e.kind==='revoked').length,1);
 }
 // Mixed failures do not short-circuit either dependency or later rows.
 const sqlFailed=f.credential(),httpFailed=f.credential(),httpWrong=f.credential(),last=f.credential();
 httpModes.set(httpFailed.secret,'disconnect');httpModes.set(httpWrong.secret,403);
 const mixed=await audit([sqlFailed,missing,httpFailed,already,httpWrong,last],{execute:sql=>{
  sqlChecks.push(sql);if(sql.includes(sqlFailed.credentialId))throw Error(rawError);f.sql.exec(sql);return true;
 }});
 assert.equal(mixed.passed,false);
 assert.deepEqual(mixed.results.map(r=>[r.revoked,r.status]),[[false,200],[true,401],[true,null],[true,401],[true,403],[true,401]]);
 assert.equal(row(sqlFailed).status,'active');assert.equal(row(last).status,'revoked');
 assert.deepEqual(state(already),prior);assert.deepEqual([sameWorker,unrelated].map(state),untouched);
 assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log('PASS: real migrated credential triggers reject old cleanup; repeated active/terminal/partial cleanup, exact ID/worker scope, independent SQL/HTTP failures, mixed batches and private reports; loopback HTTP only, no browsers.');
}finally{
 server.closeAllConnections();await new Promise(ok=>server.close(ok));f.sql.close();delete globalThis.__workerApi;
}
