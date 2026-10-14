import {D1PoCartJobs} from './d1-po-cart-jobs';
import {D1PoCartAuthorizations,type CartAuthorizationGuard} from './d1-po-cart-authorizations';
import {reconcileCartSchema,type ReconciliationReceipt} from './po-cart-reconciliation-contract';
import {cartJobFail as fail} from './po-cart-job-contract';
import {canonicalJson} from './supplier-simulation-contract';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";

/** Only explicit manager decisions may resolve held exposure; no browser write capability exists here. */
export class D1PoCartReconciliation {
 constructor(private db:D1Database,private options:{identity:()=>Promise<string|null>;clock?:{now():Date};salesPolicy?:CloverReviewPolicy}){}
 private async actor(company:string){const actor=await this.options.identity();if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(company,actor).first())fail('forbidden','Current owner or manager membership required.');return actor;}
 private async replay(company:string,operation:string,fingerprint:string){const row=await this.db.prepare('SELECT fingerprint,receipt_json FROM po_cart_reconciliations WHERE company_id=? AND operation_id=?').bind(company,operation).first<{fingerprint:string;receipt_json:string}>();
  if(!row)return null;if(row.fingerprint!==fingerprint)fail('conflict','Operation identity already used for another decision.');return {receipt:JSON.parse(row.receipt_json) as ReconciliationReceipt};}
 async decide(value:unknown){
  const parsed=reconcileCartSchema.safeParse(value);if(!parsed.success)fail('invalid_request','Invalid cart decision.');
  const i=parsed.data,actor=await this.actor(i.companyId),fp=canonicalJson({actor,input:i}),prior=await this.replay(i.companyId,i.operationId,fp);if(prior)return prior;
  const jobs=new D1PoCartJobs(this.db,this.options),j=await jobs.get({companyId:i.companyId,jobId:i.jobId}),a=j.authorization.authorization;
  if(!a||!j.job.browser||j.job.revision!==i.expectedRevision||a.revision!==i.expectedAuthorizationRevision||a.releasedAt!==null)fail('conflict','Preparation changed. Inspect again before deciding.');
  const guards:CartAuthorizationGuard[]=[{sql:MEMBER,args:[i.companyId,actor]}];
  const time=this.options.clock?'?':"strftime('%Y-%m-%dT%H:%M:%fZ','now')",timeArgs=this.options.clock?[this.options.clock.now().toISOString()]:[];
  guards.push({sql:`EXISTS (SELECT 1 FROM po_cart_reconciliation_evidence e JOIN po_cart_worker_credentials c ON c.id=e.credential_id WHERE e.company_id=? AND e.session_id=? AND e.at<=${time} AND e.at>strftime('%Y-%m-%dT%H:%M:%fZ',${time},'-5 minutes') AND c.expires_at>${time})`,args:[i.companyId,i.sessionId,...timeArgs,...timeArgs,...timeArgs]});
  if(i.action==='acceptVerifiedCart')guards.push(...(await new D1PoCartAuthorizations(this.db,this.options).guardedUse(i.companyId,a.id,j.job.requestedBy)).guards);
  // Evidence, credential, five-minute freshness, account ownership and terminal state are checked again by SQL inside this transaction.
  const evidence=await this.db.prepare('SELECT fence,session_revision FROM po_cart_reconciliation_evidence WHERE company_id=? AND session_id=? AND job_id=?').bind(i.companyId,i.sessionId,i.jobId).first<{fence:number;session_revision:number}>();
  if(!evidence||evidence.session_revision!==i.expectedSessionRevision)fail('conflict','Fresh closed inspection required.');
  const at=(this.options.clock?.now()??new Date()).toISOString(),r:ReconciliationReceipt={operationId:i.operationId,jobId:i.jobId,revision:j.job.revision+1,action:i.action,at};
  const insert=this.db.prepare('INSERT INTO po_cart_reconciliations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const values=[i.companyId,i.operationId,i.sessionId,i.jobId,a.id,j.job.revision,a.revision,evidence.fence,actor,i.action,i.note,at,fp,JSON.stringify(r)];
  const checks=guards.map(g=>this.db.prepare(`INSERT INTO po_cart_reconciliations SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,0 WHERE NOT (${g.sql})`).bind(...values,...g.args));
  try{
   if(await this.actor(i.companyId)!==actor)fail('forbidden','Session changed.');
   await this.db.batch([...checks,insert.bind(...values,1)]);
  }catch{
   await this.actor(i.companyId);const replay=await this.replay(i.companyId,i.operationId,fp);if(replay)return replay;
   fail('conflict','Cart decision rejected. Refresh and inspect again; commitments remain held until resolved.');
  }
  if(await this.actor(i.companyId)!==actor)fail('forbidden','Session changed.');return {receipt:r};
 }
}
