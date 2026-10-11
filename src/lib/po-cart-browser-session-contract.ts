import {z} from 'zod';
import {cartObservationSchema} from './po-cart-browser-contract';
import {cartJobQuerySchema} from './po-cart-job-contract';
const revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),id=z.string().trim().min(1).max(200);
export const requestBrowserSchema=cartJobQuerySchema.extend({action:z.literal('requestBrowser'),expectedRevision:revision,
 operationId:z.string().uuid(),purpose:z.enum(['sign_in','inspect'])}).strict();
export const closeBrowserSchema=cartJobQuerySchema.extend({action:z.literal('closeBrowser'),expectedRevision:revision,
 operationId:z.string().uuid(),sessionId:z.string().uuid(),expectedSessionRevision:revision}).strict();
export const resumeBrowserSchema=closeBrowserSchema.extend({action:z.literal('resume')}).strict();
const worker=z.object({sessionId:z.string().uuid(),operationId:z.string().uuid()}).strict(),fenced=worker.extend({fence:revision}).strict();
export const sessionWorkerSchema=z.discriminatedUnion('action',[
 worker.extend({action:z.literal('claim')}).strict(),worker.extend({action:z.literal('expire')}).strict(),
 fenced.extend({action:z.literal('heartbeat')}).strict(),
 fenced.extend({action:z.literal('opened'),cart:cartObservationSchema.nullable()}).strict(),
 fenced.extend({action:z.literal('complete'),cart:cartObservationSchema.nullable()}).strict(),
 fenced.extend({action:z.literal('fail'),reason:z.enum(['browser_closed','connection_lost','shutdown','verification_failed','profile_busy'])}).strict(),
]);
export const sessionQuerySchema=z.object({sessionId:id.optional()}).strict();
export type SessionRow={company_id:string;id:string;job_id:string;supplier_id:string;account_id:string;purpose:'sign_in'|'inspect';requested_by:string;
 revision:number;state:'requested'|'opening'|'open'|'closing'|'closed'|'failed'|'expired';fence:number;worker_id:string|null;lease_until:string|null;
 expires_at:string;created_at:string;updated_at:string;closed_at:string|null;reason:string};
export type SessionReceipt={operationId:string;jobId:string;sessionId:string;revision:number;action:string;at:string};
export const activeBrowserStates=['requested','opening','open','closing'];
export async function browserSessionSummary(db:D1Database,companyId:string,jobId:string){
 const row=await db.prepare('SELECT * FROM po_cart_browser_sessions WHERE company_id=? AND job_id=? ORDER BY rowid DESC LIMIT 1').bind(companyId,jobId).first<SessionRow>();
 if(!row)return null;
 const observations=await db.prepare('SELECT phase,verified,reason,at FROM po_cart_browser_observations WHERE company_id=? AND session_id=? ORDER BY phase').bind(companyId,row.id).all<{phase:string;verified:number;reason:string;at:string}>();
 return {id:row.id,revision:row.revision,purpose:row.purpose,state:row.state,expiresAt:row.expires_at,
 leaseUntil:row.lease_until,closedAt:row.closed_at,reason:row.reason,active:activeBrowserStates.includes(row.state),
 verification:observations.results.map(o=>({...o,verified:o.verified===1}))};
}
