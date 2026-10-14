import {z} from 'zod';
import {D1PoCartJobs,type CartWorkerAccess} from './d1-po-cart-jobs';
import {workerCartJobSchema,fencedCartJobSchema,beginCartAttemptSchema,cartResultSchema,browserCartEvidenceSchema,browserCartHoldSchema,
  type CartJobStatus,type CartJobMutation} from './po-cart-job-contract';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';

export class WorkerAuthenticationError extends Error {}
const base=workerCartJobSchema.omit({companyId:true});
export const workerRequestSchema=z.discriminatedUnion('action',[
  browserCartEvidenceSchema.omit({companyId:true}).extend({action:z.literal('recordBaseline')}).strict(),
  browserCartEvidenceSchema.omit({companyId:true}).extend({action:z.literal('verifyBaseline')}).strict(),
  browserCartEvidenceSchema.omit({companyId:true}).extend({action:z.literal('finalizeCart')}).strict(),
  browserCartHoldSchema.omit({companyId:true}).extend({action:z.literal('hold')}).strict(),
  base.extend({action:z.literal('claim')}).strict(),
  base.extend({action:z.literal('recoverExpired')}).strict(),
  fencedCartJobSchema.omit({companyId:true}).extend({action:z.literal('heartbeat')}).strict(),
  beginCartAttemptSchema.omit({companyId:true}).extend({action:z.literal('beginAttempt')}).strict(),
  cartResultSchema.omit({companyId:true}).extend({action:z.literal('recordResult')}).strict(),
]);
export const workerQuerySchema=z.object({jobId:z.string().trim().min(1).max(200).optional()}).strict();
export async function workerSecretHash(secret:string){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function authenticateCartWorker(db:D1Database,bearer:string|null,clock?:{now():Date}):Promise<CartWorkerAccess>{
  if(!bearer||!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer))throw new WorkerAuthenticationError();
  const hash=await workerSecretHash(bearer.slice(7));
  const row=await db.prepare(`SELECT i.consumer_kind,i.id,i.company_id,i.supplier_id,i.account_id,i.version,c.id AS credential_id
    FROM po_cart_worker_credentials c JOIN po_cart_worker_identities i ON i.id=c.worker_id WHERE c.secret_hash=?`)
    .bind(hash).first<{consumer_kind:'fake'|'local_browser';id:string;company_id:string;supplier_id:string;account_id:string;version:number;credential_id:string}>();
  if(!row)throw new WorkerAuthenticationError();
  const guard=()=>({sql:`EXISTS (SELECT 1 FROM po_cart_worker_credentials c JOIN po_cart_worker_identities i ON i.id=c.worker_id
    WHERE c.id=? AND c.secret_hash=? AND c.status='active' AND c.revoked_at IS NULL AND i.status='active'
    AND i.id=? AND i.version=? AND c.identity_version=i.version AND i.company_id=? AND i.supplier_id=? AND i.account_id=?
    AND i.consumer_kind=? AND c.expires_at>${clock?'?':"strftime('%Y-%m-%dT%H:%M:%fZ','now')"})`,
    args:[row.credential_id,hash,row.id,row.version,row.company_id,row.supplier_id,row.account_id,row.consumer_kind,...(clock?[clock.now().toISOString()]:[])]});
  const assertCurrent=async()=>{const g=guard();if(!await db.prepare(`SELECT 1 WHERE ${g.sql}`).bind(...g.args).first())throw new WorkerAuthenticationError();};
  await assertCurrent();
  return {consumerKind:row.consumer_kind,id:row.id,companyId:row.company_id,supplierId:row.supplier_id,accountId:row.account_id,credentialId:row.credential_id,identityVersion:row.version,guard,assertCurrent};
}
// Explicit allowlist: never serialize PO snapshots, manager identity, audit, credentials or arbitrary observations.
export function workerView(s:CartJobStatus){
  return {...(s.job.browser?{browser:s.job.browser,scope:{companyId:s.job.companyId,supplierId:s.job.supplierId,accountId:s.job.accountId},
    verification:s.browserEvidence.map(e=>({kind:e.kind,verified:e.verified,reason:e.reason,at:e.at}))}:{}),job:{id:s.job.id,revision:s.job.revision,state:s.job.state},valid:s.valid,
    ownership:s.ownership,lines:s.job.inputs.preflight.lines,currency:s.job.inputs.preflight.currency,
    capMinor:s.job.inputs.preflight.capMinor,
    attempts:s.attempts.map(a=>({id:a.id,lineId:a.lineId,workerId:a.workerId,fence:a.fence,at:a.at})),
    results:s.results.map(r=>({attemptId:r.attemptId,outcome:r.outcome,at:r.at}))};
}
export function workerMutationView(m:CartJobMutation&{providerCallAllowed?:boolean}){
  const {operationId,jobId,revision,action,at,fence,attemptId}=m.receipt;
  return {receipt:{operationId,jobId,revision,action,at,fence,attemptId},current:workerView(m.current),
    ...('providerCallAllowed' in m?{providerCallAllowed:m.providerCallAllowed===true}:{})};
}
export function cartWorkerService(db:D1Database,access:CartWorkerAccess,options:{clock?:{now():Date};salesPolicy?:CloverReviewPolicy}={}){
  return new D1PoCartJobs(db,{...options,identity:async()=>null,workerAccess:access});
}
