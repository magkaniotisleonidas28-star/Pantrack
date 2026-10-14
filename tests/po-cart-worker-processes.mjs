import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,rmSync,existsSync} from 'node:fs';
import {workerFixture} from './helpers/po-cart-worker.mjs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';
import {fixtureCredential} from '../scripts/po-cart-worker/credentials.mjs';
import {tables} from './helpers/po-cart-authorizations.mjs';
import {cancel} from './helpers/po-cart-jobs.mjs';
const root='.sites-runtime/po-cart-workers/acceptance-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
let f,server,origin,hook=async()=>{},children=[];
async function start(){
  f=await workerFixture();
  server=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const part of req)chunks.push(part);const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):null;
      if(await hook({phase:'before',body,req,res})===false)return;
      const r=await f.api[req.method](new Request(origin+req.url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})}));
      if(await hook({phase:'after',body,req,res,response:r})===false)return;
      res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
    }catch{res.writeHead(503,{'cache-control':'private, no-store'});res.end('{}');}
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));origin='http://127.0.0.1:'+server.address().port;
}
async function stop(){for(const p of children)if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');children=[];
  server.closeAllConnections();await new Promise(ok=>server.close(ok));f.sql.close();hook=async()=>{};}
function launch(name,{delay=0}={}){
  const credentialFile=`${root}/${name}-credential.json`,journalFile=`${root}/${name}-journal.json`;
  if(!existsSync(credentialFile))writePrivate(credentialFile,f.credential());
  const p=spawn(process.execPath,['--import',new URL('./helpers/po-cart-worker-process-observer.mjs',import.meta.url).href,'scripts/po-cart-worker.mjs','--credential',credentialFile,'--journal',journalFile,'--origin',origin,'--once','--fake-delay-ms',String(delay)],{stdio:['ignore','pipe','pipe','ipc'],env:Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
  const marker={calls:0};p.on('message',message=>{if(message?.type==='journal-saved')marker.calls=message.calls;});
  let output='';p.stdout.on('data',b=>{output+=b;});p.stderr.on('data',b=>{output+=b;});
  const done=new Promise(ok=>p.on('exit',(code,signal)=>ok({code,signal,output})));p.workerOutput=()=>output;children.push(p);return {p,done,journalFile,credentialFile,marker};
}
async function until(check){
  // Allow Windows process startup and the worker's ten-second HTTP timeout.
  // Wait for the durable marker itself; an exited worker fails immediately.
  const worker=children.at(-1),end=Date.now()+20000;
  while(!check()){
    if(worker.exitCode!==null||worker.signalCode!==null)throw Error('Worker exited before the acceptance marker: '+worker.workerOutput());
    if(Date.now()>end)throw Error('Acceptance condition timed out: '+worker.workerOutput());
    await pause(10);
  }
}
const effects=()=>tables(f.sql,['inventory','inventory_balances_exact','inventory_events_exact','po_cart_commitments','po_cart_reservations']);
try{
  await start();
  const q=await f.queued(),initial=effects();let dropped=false;
  hook=async({phase,body,res})=>{
    if(phase==='after'&&body?.action==='claim')await pause(50);
    if(phase==='after'&&body?.action==='recordResult'&&!dropped){dropped=true;res.destroy();return false;}
  };
  const workers=[launch('race-one'),launch('race-two')],results=await Promise.all(workers.map(w=>w.done));
  assert.ok(results.some(r=>r.code===0));assert.ok(results.every(r=>!r.output.includes('Bearer')));
  const calls=workers.flatMap(w=>readPrivate(w.journalFile).calls);assert.equal(calls.length,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_attempts').get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_results').get().n,1);assert.equal(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'ready');assert.equal(effects(),initial);
  assert.equal(dropped,true);await stop();

  // A committed begin whose HTTP acknowledgement is lost never grants another fake call.
  await start();await f.queued();const lostInitial=effects();let lost=false;
  hook=async({phase,body,res})=>{if(phase==='after'&&body?.action==='beginAttempt'&&!lost){lost=true;res.destroy();return false;}};
  const lostWorker=launch('lost-begin');assert.equal((await lostWorker.done).code,0);
  assert.equal(readPrivate(lostWorker.journalFile).calls.length,0);assert.equal(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'review_needed');
  assert.equal(f.sql.prepare('SELECT outcome FROM po_cart_results').get().outcome,'uncertain');assert.equal(effects(),lostInitial);await stop();

  // Restart with an unacknowledged claim uses its original UUID and can safely attempt once.
  await start();const before=await f.queued(),cred=f.credential();
  writePrivate(`${root}/restart-before-credential.json`,cred);
  const body={action:'claim',jobId:before.current.job.id,operationId:randomUUID()};assert.equal((await f.request(cred,body)).status,200);
  writePrivate(`${root}/restart-before-journal.json`,{version:1,workerId:cred.workerId,pending:body,jobId:null,attempt:null,calls:[]});
  const restarted=launch('restart-before');assert.equal((await restarted.done).code,0);assert.equal(readPrivate(restarted.journalFile).calls.length,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM po_cart_job_operations WHERE json_extract(receipt_json,'$.action')='claim'").get().n,1);await stop();

  // Kill after attempted-write and fake-call marker, before the provider outcome is known.
  await start();await f.queued();const unknownInitial=effects(),crash=launch('crash-unknown',{delay:30000});
  await until(()=>crash.marker.calls===1);crash.p.kill('SIGKILL');await crash.done;
  const resumed=launch('crash-unknown');assert.equal((await resumed.done).code,0);assert.equal(readPrivate(resumed.journalFile).calls.length,1);
  assert.equal(f.sql.prepare('SELECT outcome FROM po_cart_results').get().outcome,'uncertain');assert.equal(effects(),unknownInitial);await stop();

  // Kill after known fake outcome is journaled but before recordResult is accepted; restart publishes it once.
  await start();await f.queued();let blocked=false;
  hook=async({phase,body,res})=>{if(phase==='before'&&body?.action==='recordResult'&&!blocked){blocked=true;res.destroy();return false;}};
  const known=launch('crash-known');await until(()=>blocked);known.p.kill('SIGKILL');await known.done;hook=async()=>{};
  const knownRestart=launch('crash-known');assert.equal((await knownRestart.done).code,0);
  assert.equal(readPrivate(knownRestart.journalFile).calls.length,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_results').get().n,1);
  assert.equal(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'ready');await stop();

  // Expired, never-attempted leases recover through another worker; attempted expiry retains holds.
  for(const attempted of [false,true]){
    await start();const queued=await f.queued(),j=queued.current.job,claimed=await f.worker('expired-worker').claim({companyId:'a',jobId:j.id,operationId:randomUUID()});
    if(attempted)await f.worker('expired-worker').beginAttempt({companyId:'a',jobId:j.id,operationId:randomUUID(),fence:claimed.receipt.fence,lineId:j.inputs.preflight.lines[0].lineId});
    const held=effects(),recovery=launch('expired-'+attempted);assert.equal((await recovery.done).code,0);
    assert.equal(readPrivate(recovery.journalFile).calls.length,attempted?0:1);
    assert.equal(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,attempted?'review_needed':'ready');assert.equal(effects(),held);await stop();
  }

  // Cancellation while the fake provider is pending fences a late publication.
  await start();const canceled=await f.queued(),late=launch('late',{delay:200});
  await until(()=>late.marker.calls===1);
  const current=await f.jobs().get({companyId:'a',jobId:canceled.current.job.id});await f.jobs().cancel(cancel(current.job));await late.done;
  assert.equal(f.sql.prepare('SELECT state FROM po_cart_jobs').get().state,'canceled');assert.equal(f.sql.prepare('SELECT count(*) n FROM po_cart_results').get().n,0);
  assert.equal(f.sql.prepare('SELECT state FROM po_cart_reservations').get().state,'reserved');await stop();

  // Production timing: a long fake operation renews the 60-second lease at 20 seconds.
  await start();await f.queued();const beating=launch('heartbeat',{delay:21000});assert.equal((await beating.done).code,0);
  assert.ok(f.sql.prepare("SELECT count(*) n FROM po_cart_job_operations WHERE json_extract(receipt_json,'$.action')='heartbeat'").get().n>=1);
  assert.equal(readPrivate(beating.journalFile).calls.length,1);await stop();

  // Exercise actual private fixture issue/rotate/revoke without ever passing raw secrets to SQL.
  await start();const file=`${root}/fixture.json`,execute=async sql=>{f.sql.exec('BEGIN');try{f.sql.exec(sql);f.sql.exec('COMMIT');}catch(e){f.sql.exec('ROLLBACK');throw e;}};
  await fixtureCredential({execute,file,companyId:'a'});const old=readPrivate(file);assert.equal((await f.request(old)).status,200);
  await fixtureCredential({execute,file,action:'rotate'});const rotated=readPrivate(file);assert.equal(rotated.workerId,old.workerId);
  assert.equal((await f.request(old)).status,401);assert.equal((await f.request(rotated)).status,200);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM po_cart_worker_credential_events WHERE kind='rotated'").get().n,1);
  await fixtureCredential({execute,file,action:'revoke'});assert.equal((await f.request(rotated)).status,401);await stop();
}finally{if(server?.listening)await stop();rmSync(root,{recursive:true,force:true});delete globalThis.__workerApi;}
console.log('PASS: separate HTTP-only processes, competing claims, delayed/lost replies, bounded replay, crash/restart, expired leases, canceled late results and private credential lifecycle.');
