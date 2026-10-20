import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {seedLocalBrowserJob} from './po-cart-worker/local-browser-fixture.mjs';
import {readPrivate} from './po-cart-worker/private-files.mjs';
import {fixtureCredential} from './po-cart-worker/credentials.mjs';
for(const [layout,scenario,drop] of [['rows','normal','recordBaseline'],['rows','malicious','recordResult'],['compact','normal','finalizeCart'],['compact','malicious',null],['rows','normal','beginAttempt'],['compact','login_expired',null],['rows','lost_response',null]]){
 const f=await seedLocalBrowserJob({layout,scenario});let dropped=false;
 // Forward actual authenticated requests to served D1; only drop one successful acknowledgement.
 const proxy=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):null;
  const r=await fetch(f.origin+req.url,{method:req.method,headers:{authorization:req.headers.authorization,...(raw?{'content-type':'application/json'}:{})},...(raw?{body:raw}:{}),redirect:'error'});
  const text=await r.text();if(r.ok&&body?.action===drop&&!dropped){dropped=true;res.destroy();return;}
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(text);
 }catch{res.writeHead(503);res.end('{}');}});
 await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+proxy.address().port;
 try{
  const workers=f.credentialFiles.map((file,i)=>new Promise((ok,fail)=>{
   const p=spawn(process.execPath,['scripts/po-cart-browser-worker.mjs','--credential',file,'--journal',f.root+`/journal-${i}.json`,'--fixture',f.fixtureFile,'--origin',origin,'--once'],{stdio:['ignore','pipe','pipe'],env:Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','PANTRACK_FULL_OFFLINE_GATE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
   let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',fail);p.on('exit',code=>ok({code,output}));
  }));
  const results=await Promise.all(workers),current=await f.request(`/api/po-cart-jobs?companyId=${f.companyId}&jobId=${f.jobId}`),session=f.readSession();
  const ready=['normal','malicious'].includes(scenario)&&drop!=='beginAttempt';assert.equal(current.job.state,ready?'ready':'review_needed',JSON.stringify(results));
  const calls=[0,1].flatMap(i=>readPrivate(f.root+`/journal-${i}.json`).calls);assert.equal(calls.length,ready?3:scenario==='lost_response'?1:0);
  assert.equal(session.entries.length,ready?4:scenario==='lost_response'?2:1);assert.deepEqual(current.authorization.reservation,f.reservation);
  assert.deepEqual(await f.request('/api/inventory?companyId='+f.companyId),f.inventory);
  if(drop)assert.equal(dropped,true);if(ready)assert.deepEqual(current.browserEvidence.map(e=>e.verified),[true,true]);
  for(const r of results){assert.ok(!r.output.includes(session.token));for(const file of f.credentialFiles)assert.ok(!r.output.includes(readPrivate(file).secret));}
  console.log(`PASS served D1 browser ${layout}/${scenario}${drop?' lost '+drop:''}: ${current.job.state}`);
 }finally{proxy.closeAllConnections();await new Promise(ok=>proxy.close(ok));for(const file of f.credentialFiles)await fixtureCredential({execute:f.execute,file,action:'revoke'});}
}
console.log('PASS: actual served D1, competing browser processes, exact carts, private sessions, safe holds and UUID-preserving lost-response replay.');
