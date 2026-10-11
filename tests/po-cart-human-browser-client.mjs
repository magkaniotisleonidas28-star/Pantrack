import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {writePrivate,readPrivate} from '../scripts/po-cart-worker/private-files.mjs';
await build({entryPoints:['scripts/po-cart-worker/human-browser.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/human-client-tests.mjs',logLevel:'silent'});
const {HumanBrowserWorker}=await import('../.sites-runtime/human-client-tests.mjs');
for(const phase of ['opening','open','closed','pending_complete']){
 const root='.sites-runtime/po-cart-workers/human-client-'+randomUUID(),credentialFile=root+'/credential.json',journalFile=root+'/journal.json',sessionId=randomUUID(),workerId=randomUUID();
 writePrivate(credentialFile,{workerId,secret:'x'.repeat(43)});
 const complete=phase==='pending_complete',op=randomUUID();
 writePrivate(journalFile,{version:1,workerId,calls:[],pending:complete?{action:'complete',sessionId,fence:5,cart:[],operationId:op}:null,human:{sessionId,fence:5,phase:complete?'closed':phase,cart:[]}});
 const requests=[];let state=phase==='closed'||complete?'closing':'open';
 const fetchImpl=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;requests.push(body);
  if(body){if(body.action==='fail')state='failed';if(body.action==='complete')state='closed';return Response.json({receipt:{...body},current:{session:{id:sessionId,state}}});}
  return Response.json({current:url.includes('?')?{session:{id:sessionId,state}}:null});
 };
 let worker;
 try{
  worker=new HumanBrowserWorker({credentialFile,journalFile,fixtureFile:root+'/intentionally-missing.json',fetchImpl});await worker.tick();
  assert.equal(worker.activeSession,undefined);assert.deepEqual(readPrivate(journalFile).calls,[]);
  const writes=requests.filter(Boolean);assert.equal(writes.length,1);assert.equal(writes[0].action,phase==='opening'||phase==='open'?'fail':'complete');if(complete)assert.equal(writes[0].operationId,op);
 }finally{worker?.close();rmSync(root,{recursive:true,force:true});}
}
console.log('PASS: opening/open crash journals never relaunch a browser; known closed observations and pending completion replay without another browser call.');
