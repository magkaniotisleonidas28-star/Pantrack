import {requestBrowserSchema,closeBrowserSchema,resumeBrowserSchema} from '@/lib/po-cart-browser-session-contract';
import {acceptVerifiedCartSchema,abandonVerifiedCartSchema} from '@/lib/po-cart-reconciliation-contract';
import {z} from 'zod';
import type {ManagerCartView} from '@/lib/po-cart-manager-contract';
import {authorizeCartSchema,cancelCartAuthorizationSchema} from '@/lib/po-cart-authorization-contract';
import {enqueueCartJobSchema,cancelCartJobSchema} from '@/lib/po-cart-job-contract';

const pendingSchema=z.discriminatedUnion('endpoint',[
  z.object({endpoint:z.literal('po-cart-authorizations'),body:z.union([authorizeCartSchema,cancelCartAuthorizationSchema])}).strict(),
  z.object({endpoint:z.literal('po-cart-jobs'),body:z.union([enqueueCartJobSchema,cancelCartJobSchema,requestBrowserSchema,closeBrowserSchema,resumeBrowserSchema,acceptVerifiedCartSchema,abandonVerifiedCartSchema])}).strict(),
]);
export type PendingCartIntent=z.infer<typeof pendingSchema>;
export const intentKey=(actor:string,company:string,order:string)=>'pantrack-cart-intent:'+JSON.stringify([actor,company,order]);
export function readIntent(storage:Pick<Storage,'getItem'>,key:string):PendingCartIntent|null{
  const value=storage.getItem(key);if(!value)return null;
  const parsed=pendingSchema.safeParse(JSON.parse(value));if(!parsed.success)throw Error('Saved preparation request is invalid. Review local browser storage before continuing.');
  return parsed.data;
}
export class ManagerCartError extends Error{constructor(message:string,public definitive=false,public status=0){super(message);}}
export async function managerStatus(companyId:string,orderId:string):Promise<ManagerCartView>{
  const r=await fetch(`/api/po-cart-jobs?view=manager&companyId=${encodeURIComponent(companyId)}&orderId=${encodeURIComponent(orderId)}`,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await r.json() as ManagerCartView&{error?:string};if(!r.ok)throw new ManagerCartError(data.error??'Could not read preparation status.',false,r.status);return data;
}
export async function sendCartIntent(intent:PendingCartIntent){
  const r=await fetch('/api/'+intent.endpoint+'?view=manager',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(intent.body),signal:AbortSignal.timeout(15000)});
  const data=await r.json() as {error?:string;uncertain?:boolean;receipt?:{operationId:string;action:string}};if(!r.ok)throw new ManagerCartError(data.error??'Could not save preparation request.',
    [400,404,409].includes(r.status)&&data.uncertain!==true,r.status);
  if(data.receipt?.operationId!==intent.body.operationId||data.receipt?.action!==intent.body.action)throw new ManagerCartError('Save acknowledgment was incomplete. Retry the same request.');
}
