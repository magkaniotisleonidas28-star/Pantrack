import {z} from 'zod';
import {preparationRequestSchema, type PreparationPreflight} from './po-cart-preparation-contract';
import type {PurchaseOrderSnapshot} from './purchase-order-contract';
import type {SpendingWindow} from './po-cart-spending-limits-contract';

const id=z.string().trim().min(1).max(200);
export const authorizeCartSchema=preparationRequestSchema.extend({action:z.literal('authorize')}).strict();
export const cartAuthorizationQuerySchema=z.object({companyId:id,orderId:id}).strict();
export const cancelCartAuthorizationSchema=z.object({action:z.literal('cancel'),companyId:id,authorizationId:id,
  expectedRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),operationId:z.string().uuid(),
  reason:z.string().trim().min(1).max(1000)}).strict();
export const startCartPreparationSchema=cancelCartAuthorizationSchema.omit({reason:true}).extend({action:z.literal('start')}).strict();
export type CartAuthorizationCommand=z.infer<typeof cancelCartAuthorizationSchema>|z.infer<typeof startCartPreparationSchema>;
// Fictional test policies keep the original shape; owner-set policies add day/month limits.
export type CartBudgetPolicy=Readonly<{version:number;perOrderMinor:number;outstandingMinor:number;perDayMinor?:number;perMonthMinor?:number|null}>;
export type CartAuthorizationPayload=Readonly<{preflight:PreparationPreflight;snapshot:PurchaseOrderSnapshot;policy:CartBudgetPolicy;window?:SpendingWindow}>;
export type CartAuthorization=Readonly<{
  companyId:string;id:string;orderId:string;generation:number;revision:number;status:'authorized'|'invalidated'|'canceled';
  createdAt:string;startedAt:string|null;releasedAt:string|null;inputs:CartAuthorizationPayload;
}>;
export type CartAuthorizationReceipt=Readonly<{
  operationId:string;authorizationId:string;revision:number;action:'authorize'|'cancel'|'start';actor:string;at:string;
}>;
export type CartAuthorizationStatus=Readonly<{
  authorization:CartAuthorization|null;valid:boolean;reason:string|null;
  reservation:Readonly<{totalMinor:number;state:'reserved'|'released'}>|null;
  commitments:readonly Readonly<{productId:string;proposalId:string|null;quantity:{dimension:string;minor:string};active:boolean}>[];
  events:readonly Readonly<{revision:number;kind:string;actor:string;reason:string;at:string}>[];
}>;
export type CartAuthorizationResult=Readonly<{receipt:CartAuthorizationReceipt;current:CartAuthorizationStatus}>;
export class PoCartAuthorizationError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'source_changed'|'conflict'|'policy_missing'|'limit_exceeded'|'storage_failure',message:string) {
    super(message);this.name='PoCartAuthorizationError';
  }
}
export function cartAuthorizationFail(code:PoCartAuthorizationError['code'],message:string):never {
  throw new PoCartAuthorizationError(code,message);
}
