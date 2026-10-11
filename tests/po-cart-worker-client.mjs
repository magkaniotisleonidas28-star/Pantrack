import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,rmSync,statSync} from 'node:fs';
import {FakeCartWorker} from '../scripts/po-cart-worker/client.mjs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';
const root='.sites-runtime/po-cart-workers/client-'+randomUUID();mkdirSync(root,{recursive:true,mode:0o700});
const credentialFile=root+'/credential.json',journalFile=root+'/journal.json';
writePrivate(credentialFile,{workerId:'client-fixture',secret:randomBytes(32).toString('base64url')});
try{
  let sends=[];
  const client=new FakeCartWorker({credentialFile,journalFile,fetchImpl:async(url,req)=>{sends.push(JSON.parse(req.body));throw Error('network error');}});
  try{await assert.rejects(client.mutate('claim',{jobId:'job'}),e=>e.status===503);
    assert.equal(sends.length,4);assert.equal(new Set(sends.map(s=>s.operationId)).size,1);
    assert.deepEqual(readPrivate(journalFile).pending,sends[0]);assert.throws(()=>new FakeCartWorker({credentialFile,journalFile}));
  }finally{client.close();}
  sends=[];
  const restarted=new FakeCartWorker({credentialFile,journalFile,fetchImpl:async(url,req)=>{
    const body=JSON.parse(req.body);sends.push(body);return Response.json({receipt:{operationId:body.operationId,jobId:body.jobId,action:body.action},current:{job:{id:'job'}}});}});
  try{await restarted.recoverJournal();assert.equal(sends.length,1);assert.equal(readPrivate(journalFile).pending,null);}finally{restarted.close();}
  for(const origin of ['https://127.0.0.1','http://localhost','http://192.0.2.1','http://127.0.0.1@evil.invalid','http://127.0.0.1/path'])assert.throws(()=>new FakeCartWorker({origin,credentialFile,journalFile}));
  if(process.platform!=='win32')for(const file of [credentialFile,journalFile])assert.equal(statSync(file).mode&0o777,0o600);
}finally{rmSync(root,{recursive:true,force:true});}
console.log('PASS: bounded three retries preserve durable UUIDs, restart replays pending operations, journal locking and private files; loopback-only HTTP.');
