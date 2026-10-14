import {z} from 'zod';
import {closeBrowserSchema} from './po-cart-browser-session-contract';
import {cartObservationSchema,checkBrowserCart} from './po-cart-browser-contract';
import {canonicalJson} from './supplier-simulation-contract';
import type {CartJobStatus} from './po-cart-job-contract';

const decision=closeBrowserSchema.omit({action:true}).extend({
 expectedAuthorizationRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),note:z.string().trim().min(1).max(500),
});
export const acceptVerifiedCartSchema=decision.extend({action:z.literal('acceptVerifiedCart')}).strict();
export const abandonVerifiedCartSchema=decision.extend({action:z.literal('abandonVerifiedCart')}).strict();
export const reconcileCartSchema=z.discriminatedUnion('action',[acceptVerifiedCartSchema,abandonVerifiedCartSchema]);
export const reconciliationFreshMs=300000;
export function inspectCart(j:CartJobStatus,observation:unknown){
 const parsed=cartObservationSchema.safeParse(observation),baseline=j.browserEvidence.find(e=>e.kind==='baseline'&&e.verified)?.observation;
 if(!parsed.success)return {baselineVerified:false,finalVerified:false,baselineReason:'cart_unreadable',finalReason:'cart_unreadable'};
 if(!baseline)return {baselineVerified:false,finalVerified:false,baselineReason:'baseline_missing',finalReason:'baseline_missing'};
 const cart=parsed.data,duplicate=new Set(cart.map(e=>e.sku)).size!==cart.length;
 const sort=(entries:typeof cart)=>[...entries].sort((a,b)=>a.sku.localeCompare(b.sku));
 const baselineReason=duplicate?'duplicate_sku':canonicalJson(sort(cart))===canonicalJson(sort(baseline))?'verified':'baseline_changed';
 const finalReason=checkBrowserCart('final',cart,j.job.inputs.preflight,baseline);
 return {baselineVerified:baselineReason==='verified',finalVerified:finalReason==='verified',baselineReason,finalReason};
}
export type ReconciliationReceipt={operationId:string;jobId:string;revision:number;action:'acceptVerifiedCart'|'abandonVerifiedCart';at:string};
export async function reconciliationSummary(db:D1Database,company:string,job:string,now:string){
 const evidence=await db.prepare(`SELECT e.session_id,e.job_revision,e.authorization_revision,e.session_revision,e.baseline_verified,e.final_verified,e.baseline_reason,e.final_reason,e.at,
  (s.state='closed' AND s.revision=e.session_revision AND j.revision=e.job_revision AND a.revision=e.authorization_revision AND a.released_at IS NULL
   AND o.job_id=j.id AND o.fence=e.fence AND o.worker_id IS NULL AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>?
   AND i.status='active' AND i.version=e.identity_version AND c.identity_version=i.version
   AND NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions n WHERE n.company_id=s.company_id AND n.supplier_id=s.supplier_id AND n.account_id=s.account_id AND (n.rowid>s.rowid OR n.state IN ('requested','opening','open','closing')))
   AND NOT EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=e.company_id AND r.session_id=e.session_id)) AS current
  FROM po_cart_reconciliation_evidence e JOIN po_cart_browser_sessions s ON s.company_id=e.company_id AND s.id=e.session_id
  JOIN po_cart_jobs j ON j.company_id=e.company_id AND j.id=e.job_id JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
  LEFT JOIN po_cart_owners o ON o.company_id=j.company_id AND o.supplier_id=j.supplier_id AND o.account_id=j.account_id
  JOIN po_cart_worker_credentials c ON c.id=e.credential_id JOIN po_cart_worker_identities i ON i.id=c.worker_id
  WHERE e.company_id=? AND e.job_id=? ORDER BY s.rowid DESC LIMIT 1`).bind(now,company,job).first<{
   session_id:string;job_revision:number;authorization_revision:number;session_revision:number;baseline_verified:number;final_verified:number;baseline_reason:string;final_reason:string;at:string;current:number}>();
 const decision=await db.prepare('SELECT action,at,session_id AS sessionId FROM po_cart_reconciliations WHERE company_id=? AND job_id=? ORDER BY rowid DESC LIMIT 1').bind(company,job).first<{action:string;at:string;sessionId:string}>();
 return {evidence:evidence?{sessionId:evidence.session_id,baselineVerified:evidence.baseline_verified===1,finalVerified:evidence.final_verified===1,
  baselineReason:evidence.baseline_reason,finalReason:evidence.final_reason,at:evidence.at,expiresAt:new Date(Date.parse(evidence.at)+reconciliationFreshMs).toISOString(),
  current:!!evidence.current&&Date.parse(evidence.at)<=Date.parse(now)&&Date.parse(evidence.at)+reconciliationFreshMs>Date.parse(now)}:null,decision};
}
