import {z} from 'zod';
import {poFail,poId} from './purchase-order-contract';

export const purchaseOrderHistoryFilters=z.object({
  q:z.string().trim().max(200).default(''),supplier:z.string().trim().max(200).default(''),
  status:z.enum(['draft','reviewed','canceled']).optional(),
}).strict();
export type PurchaseOrderHistoryFilters=z.infer<typeof purchaseOrderHistoryFilters>;
export const purchaseOrderHistoryRequest=z.object({companyId:poId,
  offset:z.number().int().min(0).max(1_000_000).default(0),filters:purchaseOrderHistoryFilters.default({}),
}).strict();

export function purchaseOrderHistoryQuery(params:URLSearchParams){
  const keys=[...params.keys()],offset=params.get('offset')??'0';
  if(keys.length!==new Set(keys).size||keys.some(key=>!['companyId','offset','q','supplier','status'].includes(key))||
    !/^(0|[1-9]\d{0,6})$/.test(offset))poFail('invalid_request','Check the history search, status, supplier and page.');
  const parsed=purchaseOrderHistoryRequest.safeParse({companyId:params.get('companyId'),offset:Number(offset),filters:{
    q:params.get('q')??'',supplier:params.get('supplier')??'',...(params.has('status')?{status:params.get('status')}:{})}});
  if(!parsed.success)poFail('invalid_request','Check the history search, status, supplier and page.');
  return parsed.data;
}

export function purchaseOrderHistorySearch(filters:PurchaseOrderHistoryFilters,offset=0):string{
  const params=new URLSearchParams({offset:String(offset)});
  if(filters.q)params.set('q',filters.q);if(filters.supplier)params.set('supplier',filters.supplier);
  if(filters.status)params.set('status',filters.status);
  return '&'+params;
}
