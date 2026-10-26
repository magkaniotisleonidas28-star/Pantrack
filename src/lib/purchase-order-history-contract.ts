import {z} from 'zod';
import {poFail,poId} from './purchase-order-contract';
import {HISTORY_DATE_TIME_ZONES,validHistoryDate} from './purchase-order-history-dates';

export const PURCHASE_ORDER_HISTORY_FILTER_KEYS=['q','supplier','status','product','from','to','timeZone'] as const;
const date=z.string().refine(validHistoryDate,'Choose a real date between 1900-01-01 and 9998-12-31.');
export const purchaseOrderHistoryFilters=z.object({
  q:z.string().trim().max(200).default(''),supplier:z.string().trim().max(200).default(''),
  status:z.enum(['draft','reviewed','canceled']).optional(),
  product:z.string().trim().max(200).optional().transform(value=>value||undefined),
  from:date.optional(),to:date.optional(),timeZone:z.enum(HISTORY_DATE_TIME_ZONES).optional(),
}).strict().superRefine((value,ctx)=>{
  if(!!(value.from||value.to)!==!!value.timeZone)ctx.addIssue({code:'custom',path:['timeZone'],message:'Choose a time zone when filtering by date.'});
  if(value.from&&value.to&&value.from>value.to)ctx.addIssue({code:'custom',path:['to'],message:'The To date must be on or after the From date.'});
});
export type PurchaseOrderHistoryFilters=z.infer<typeof purchaseOrderHistoryFilters>;
export const purchaseOrderHistoryRequest=z.object({companyId:poId,
  offset:z.number().int().min(0).max(1_000_000).default(0),filters:purchaseOrderHistoryFilters.default({}),
}).strict();

export function purchaseOrderHistoryQuery(params:URLSearchParams){
  const keys=[...params.keys()],offset=params.get('offset')??'0';
  if(keys.length!==new Set(keys).size||keys.some(key=>!['companyId','offset',...PURCHASE_ORDER_HISTORY_FILTER_KEYS].includes(key))||
    !/^(0|[1-9]\d{0,6})$/.test(offset))poFail('invalid_request','Check the history search, status, supplier and page.');
  const parsed=purchaseOrderHistoryRequest.safeParse({companyId:params.get('companyId'),offset:Number(offset),filters:purchaseOrderHistoryFilterQuery(params)});
  if(!parsed.success)poFail('invalid_request','Check the history search, status, supplier, product, dates, time zone and page.');
  return parsed.data;
}

export function purchaseOrderHistorySearch(filters:PurchaseOrderHistoryFilters,offset=0):string{
  const params=new URLSearchParams({offset:String(offset)});purchaseOrderHistoryFilterParams(filters).forEach((value,key)=>params.set(key,value));
  return '&'+params;
}
/** Raw known fields only; callers enforce allowed/unique keys and validate the shared schema. */
export function purchaseOrderHistoryFilterQuery(params:URLSearchParams){
  return Object.fromEntries(PURCHASE_ORDER_HISTORY_FILTER_KEYS.filter(key=>params.has(key)).map(key=>[key,params.get(key)]));
}
export function purchaseOrderHistoryFilterParams(filters:PurchaseOrderHistoryFilters):URLSearchParams{
  const params=new URLSearchParams();for(const key of PURCHASE_ORDER_HISTORY_FILTER_KEYS){const value=filters[key];if(value)params.set(key,value);}return params;
}
