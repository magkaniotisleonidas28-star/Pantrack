import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readPrivate,writePrivate,journalLock} from './private-files.mjs';
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
export class WorkerHttpError extends Error {constructor(status){super('Worker HTTP operation failed.');this.status=status;}}
export class FakeCartWorker {
  constructor({origin='http://127.0.0.1:5181',credentialFile,journalFile,fetchImpl=fetch,fakeDelayMs=0,timeoutMs=10000}){
    const url=new URL(origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Loopback HTTP origin required.');
    this.url=url.origin+'/api/internal/po-cart-worker';this.credentialFile=credentialFile;this.journalFile=journalFile;
    this.fetch=fetchImpl;this.fakeDelayMs=fakeDelayMs;this.timeoutMs=timeoutMs;
    this.release=journalLock(journalFile);
    try{this.state=existsSync(journalFile)?readPrivate(journalFile):{version:1,pending:null,jobId:null,attempt:null,calls:[]};
      if(this.state.version!==1)throw Error('Unsupported worker journal.');
      const identity=readPrivate(credentialFile).workerId;
      if(this.state.workerId&&this.state.workerId!==identity)throw Error('Journal belongs to another worker.');
      this.state.workerId=identity;this.save();}catch(e){this.release();throw e;}
    this.queue=Promise.resolve();
  }
  save(){writePrivate(this.journalFile,this.state);}
  close(){this.release();}
  async http(method,body,jobId){
    for(let retry=0;retry<=3;retry++){
      try{
        const credential=readPrivate(this.credentialFile);
        if(credential.workerId!==this.state.workerId)throw new WorkerHttpError(401);
        const response=await this.fetch(this.url+(jobId?'?'+(this.queryKey??'jobId')+'='+encodeURIComponent(jobId):''),{method,redirect:'error',
          headers:{authorization:'Bearer '+credential.secret,...(body?{'content-type':'application/json'}:{})},
          ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(this.timeoutMs)});
        if(!response.ok)throw new WorkerHttpError(response.status);
        const data=await response.json();return {data,retried:retry>0};
      }catch(e){
        if(e instanceof WorkerHttpError&&e.status!==429&&e.status<500)throw e;
        if(retry===3)throw new WorkerHttpError(503);await sleep(50*2**retry);
      }
    }
    throw new WorkerHttpError(503);
  }
  /** @param {()=>Promise<any>} fn @returns {Promise<any>} */
  serialized(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
  mutate(action,fields={},resume=false){return this.serialized(async()=>{
    if(!resume){if(this.state.pending)throw Error('Pending operation must be recovered first.');
      this.state.pending={action,...fields,operationId:randomUUID()};this.save();}
    const body=this.state.pending;
    if(!body)throw Error('No pending operation.');
    const {data,retried}=await this.http('POST',body);
    if(data.receipt?.operationId!==body.operationId||data.receipt?.jobId!==body.jobId||data.receipt?.action!==body.action
      ||data.current?.job.id!==body.jobId)throw Error('Mismatched worker acknowledgement.');
    // Save recovery state before clearing the operation. A persisted begin grant is never reused.
    if(body.action==='claim'){this.state.jobId=body.jobId;}
    if(body.action==='beginAttempt'){
      this.state.attempt={jobId:body.jobId,lineId:body.lineId,fence:body.fence,attemptId:data.receipt.attemptId,outcome:null};
      if(resume||retried)data.providerCallAllowed=false;
    }
    if(body.action==='recordBaseline')this.state.baseline={jobId:body.jobId,cart:body.cart};
    if(body.action==='recordResult')this.state.attempt=null;
    this.state.pending=null;this.save();return data;
  });}
  owns(current,fence){const o=current?.ownership;return current?.valid&&current.job.state==='preparing'&&o?.jobId===current.job.id
    &&o.workerId===this.state.workerId&&o.fence===fence&&Date.parse(o.leaseUntil)>Date.now();}
  async recoverJournal(){
    if(this.state.pending){try{await this.mutate(null,{},true);}catch(e){if(e.status!==409&&e.status!==404)throw e;
      // Permanent rejection is safe to forget as an HTTP operation; attempted work remains held by the server.
      this.state.pending=null;this.save();}}
    const a=this.state.attempt;
    if(a){
      const {data}=await this.http('GET',null,a.jobId),current=data.current;
      if(current.results.some(r=>r.attemptId===a.attemptId)){this.state.attempt=null;this.save();return;}
      if(this.owns(current,a.fence))await this.mutate('recordResult',{jobId:a.jobId,fence:a.fence,attemptId:a.attemptId,
        outcome:a.outcome?'verified':'uncertain',observation:a.outcome??null});
      // Lost ownership keeps the unresolved attempt and known outcome in the private journal.
    }
  }
  async process(current){
    const jobId=current.job.id;
    if(current.job.state==='preparing'&&Date.parse(current.ownership?.leaseUntil)<=Date.now()){
      current=(await this.mutate('recoverExpired',{jobId})).current;
    }
    if(current.job.state==='queued')current=(await this.mutate('claim',{jobId})).current;
    const fence=current.ownership?.fence;
    if(!this.owns(current,fence))return;
    let heartbeatFailure=null;
    const heartbeat=setInterval(()=>{void this.mutate('heartbeat',{jobId,fence}).catch(e=>{heartbeatFailure=e;});},20000);
    try{
      for(const line of current.lines){
        if(heartbeatFailure)throw heartbeatFailure;
        const attempt=current.attempts.find(a=>a.lineId===line.lineId);
        if(attempt){
          if(current.results.some(r=>r.attemptId===attempt.id&&r.outcome==='verified'))continue;
          if(this.owns(current,fence))await this.mutate('recordResult',{jobId,fence,attemptId:attempt.id,outcome:'uncertain',observation:null});
          return;
        }
        const begun=await this.mutate('beginAttempt',{jobId,fence,lineId:line.lineId});
        if(!begun.providerCallAllowed||begun.receipt.fence!==fence||!begun.receipt.attemptId||!this.owns(begun.current,fence)){
          await this.recoverJournal();return;
        }
        // Fake provider only: durable marker before effect, known result before HTTP result publication.
        // A crash anywhere between these saves leaves an unknown attempted write, never another call.
        this.state.calls.push({jobId,lineId:line.lineId,attemptId:begun.receipt.attemptId});this.save();
        if(this.fakeDelayMs)await sleep(this.fakeDelayMs);
        this.state.attempt.outcome=line;this.save();
        if(heartbeatFailure)throw heartbeatFailure;
        current=(await this.mutate('recordResult',{jobId,fence,attemptId:begun.receipt.attemptId,outcome:'verified',observation:line})).current;
      }
    }finally{clearInterval(heartbeat);await this.queue;}
  }
  async tick(){
    await this.recoverJournal();
    let current=null;
    if(this.state.jobId){const {data}=await this.http('GET',null,this.state.jobId);current=data.current;}
    if(!current||!['queued','preparing'].includes(current.job.state)){
      this.state.jobId=null;this.save();current=(await this.http('GET')).data.current;
    }
    if(current)await this.process(current);
  }
}
