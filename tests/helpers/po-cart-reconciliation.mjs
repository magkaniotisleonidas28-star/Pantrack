import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {workerFixture} from './po-cart-worker.mjs';
import {enqueue} from './po-cart-jobs.mjs';
await build({stdin:{contents:"export {D1PoCartBrowserSessions} from './src/lib/d1-po-cart-browser-sessions';export {D1PoCartReconciliation} from './src/lib/d1-po-cart-reconciliation';export {authenticateCartWorker} from './src/lib/po-cart-worker-transport';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/reconciliation-core-tests.mjs'});
export const {D1PoCartBrowserSessions,D1PoCartReconciliation,authenticateCartWorker}=await import('../../.sites-runtime/reconciliation-core-tests.mjs');
export const existing={sku:'EXISTING',unitLabel:'box',packs:'1',unitMinor:'350'};
export async function reconciliationFixture({attempt=true,baseline=true,result='uncertain',stock=false,baselineCart=[existing],credentialTtl=3600000}={}){
 const f=await workerFixture();let now=Date.now();f.options.clock={now:()=>new Date(now)};
 const lines=stock?[await f.stock('milk')]:undefined;
 const a=await f.authorized(lines?{lines}:{}),q=await f.jobs().enqueue({...enqueue(a),browser:{layout:'rows',scenario:'normal'}}),j=q.current.job,c=f.credential({consumerKind:'local_browser',expiresAt:new Date(Date.now()+credentialTtl).toISOString()});
 const access=()=>authenticateCartWorker(f.db,'Bearer '+c.secret,f.options.clock);
 const worker=async()=>new D1PoCartBrowserSessions(f.db,{...f.options,identity:async()=>null,workerAccess:await access()});
 const manager=()=>new D1PoCartBrowserSessions(f.db,f.options),reconcile=()=>new D1PoCartReconciliation(f.db,f.options);
 const current=()=>f.jobs().get({companyId:'a',jobId:j.id});
 const mutation=async(action,extra={})=>{const r=await f.request(c,{action,jobId:j.id,operationId:randomUUID(),...extra});assert.equal(r.status,200,await r.clone().text());return r.json();};
 const claim=await mutation('claim'),fence=claim.receipt.fence;
 if(baseline)await mutation('recordBaseline',{fence,cart:baselineCart});
 if(attempt){const b=await mutation('beginAttempt',{fence,lineId:j.inputs.preflight.lines[0].lineId});await mutation('recordResult',{fence,attemptId:b.receipt.attemptId,outcome:result,observation:result==='verified'?j.inputs.preflight.lines[0]:null});}
 else await mutation('hold',{fence,reason:'verification_failed'});
 const full=[...baselineCart,...j.inputs.preflight.lines.map(({sku,unitLabel,packs,unitMinor})=>({sku,unitLabel,packs,unitMinor}))];
 const w=async(action,fields)=>(await worker()).worker({action,operationId:randomUUID(),...fields});
 async function open(cart=full){const status=await current();const r=await manager().requestBrowser({action:'requestBrowser',companyId:'a',jobId:j.id,expectedRevision:status.job.revision,operationId:randomUUID(),purpose:'inspect'}),sessionId=r.receipt.sessionId;
  const claim=await w('claim',{sessionId}),fence=claim.current.session.fence;await w('opened',{sessionId,fence,cart});return {sessionId,fence};}
 async function close(s,cart=full){const status=await current(),session=(await(await worker()).getWorker(s.sessionId)).session;
  await manager().closeBrowser({action:'closeBrowser',companyId:'a',jobId:j.id,expectedRevision:status.job.revision,sessionId:s.sessionId,expectedSessionRevision:session.revision,operationId:randomUUID()});return w('complete',{...s,cart});}
 async function body(s,action='acceptVerifiedCart'){const status=await current(),session=(await(await worker()).getWorker(s.sessionId)).session;
  return {action,companyId:'a',jobId:j.id,expectedRevision:status.job.revision,expectedAuthorizationRevision:status.authorization.authorization.revision,sessionId:s.sessionId,expectedSessionRevision:session.revision,operationId:randomUUID(),note:'Manager inspected fictional cart.'};}
 let beforeDecision=null,loseDecision=false;const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{if(statements.some(s=>s.query.startsWith('INSERT INTO po_cart_reconciliations'))){if(beforeDecision){f.db.beforeBatch=beforeDecision;beforeDecision=null;}if(loseDecision){f.db.loseAcknowledgment=true;loseDecision=false;}}return batch(statements);};
 return {...f,c,j,full,manager,reconcile,worker,current,mutation,w,open,close,body,advance:ms=>{now+=ms;},beforeDecision:fn=>{beforeDecision=fn;},loseDecision:()=>{loseDecision=true;}};
}
