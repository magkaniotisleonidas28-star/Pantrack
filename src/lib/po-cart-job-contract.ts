import {z} from 'zod';
import {browserConfigSchema,cartObservationSchema,browserHoldReasonSchema,type BrowserConfig,type BrowserEvidence} from './po-cart-browser-contract';
import type {CartAuthorizationPayload,CartAuthorizationStatus} from './po-cart-authorization-contract';
import type {PreparationPreflight} from './po-cart-preparation-contract';

const id=z.string().trim().min(1).max(200),revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const enqueueCartJobSchema=z.object({action:z.literal('enqueue'),companyId:id,authorizationId:id,
  expectedRevision:revision,operationId:z.string().uuid(),browser:browserConfigSchema.optional()}).strict();
export const cartJobQuerySchema=z.object({companyId:id,jobId:id}).strict();
export const managerCartQuerySchema=z.object({view:z.literal('manager'),companyId:id,orderId:id}).strict();
export const cancelCartJobSchema=cartJobQuerySchema.extend({action:z.literal('cancel'),expectedRevision:revision,
  operationId:z.string().uuid(),reason:z.string().trim().min(1).max(1000)}).strict();
export const workerCartJobSchema=cartJobQuerySchema.extend({operationId:z.string().uuid()}).strict();
export const fencedCartJobSchema=workerCartJobSchema.extend({fence:revision}).strict();
export const beginCartAttemptSchema=fencedCartJobSchema.extend({lineId:id}).strict();
export const cartResultSchema=fencedCartJobSchema.extend({attemptId:z.string().uuid(),
  outcome:z.enum(['verified','uncertain','rejected']),observation:z.unknown()}).strict();
export const browserCartEvidenceSchema=fencedCartJobSchema.extend({cart:cartObservationSchema}).strict();
export const browserCartHoldSchema=fencedCartJobSchema.extend({reason:browserHoldReasonSchema}).strict();
export const CART_LEASE_MS=60_000;
export class PoCartJobError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'conflict'|'source_changed'|'storage_failure',message:string){
    super(message);this.name='PoCartJobError';
  }
}
export function cartJobFail(code:PoCartJobError['code'],message:string):never{throw new PoCartJobError(code,message);}
export type CartJobState='queued'|'preparing'|'review_needed'|'ready'|'canceled';
export type CartJob=Readonly<{companyId:string;id:string;authorizationId:string;authorizationRevision:number;
  browser:BrowserConfig|null;inputs:CartAuthorizationPayload;supplierId:string;accountId:string;requestedBy:string;revision:number;state:CartJobState;
  purchaseState:'not_confirmed';deliveryState:'outstanding';createdAt:string;updatedAt:string}>;
export type CartJobOwner=Readonly<{jobId:string|null;fence:number;workerId:string|null;leaseUntil:string|null}>;
export type CartLineIntent=PreparationPreflight['lines'][number];
export type CartAttempt=Readonly<{id:string;lineId:string;workerId:string;fence:number;intent:CartLineIntent;at:string}>;
export type CartResult=Readonly<{attemptId:string;outcome:'verified'|'uncertain'|'rejected';observation:unknown;at:string}>;
export type CartJobStatus=Readonly<{job:CartJob;valid:boolean;reason:string|null;ownership:CartJobOwner|null;
  browserEvidence:readonly BrowserEvidence[];authorization:CartAuthorizationStatus;attempts:readonly CartAttempt[];results:readonly CartResult[];
  events:readonly {revision:number;kind:string;actor:string;reason:string;at:string}[]}>;
export type CartJobReceipt=Readonly<{operationId:string;jobId:string;revision:number;action:string;actor:string;at:string;
  fence?:number;attemptId?:string}>;
export type CartJobMutation=Readonly<{receipt:CartJobReceipt;current:CartJobStatus}>;
/** Ephemeral internal decision, never a stored receipt or transport capability. */
export type CartAttemptGrant=CartJobMutation&Readonly<{providerCallAllowed:boolean}>;
