import {SALES_EVENT_CONTRACT,type SalesEventDraftV1,type SalesSourceBinding} from '@/lib/sales-ingestion';

type CloverCollection<T>={elements:T[]};
type CloverModification={id:string;modifier?:{id:string}};
type CloverLine={id:string;item?:{id:string};unitQty?:number|null;modifications?:CloverCollection<CloverModification>};
export type CloverOrder={id:string;createdTime:number;modifiedTime:number;paymentState?:string;state?:string;deletedTime?:number;lineItems?:CloverCollection<CloverLine>;payments?:CloverCollection<{id:string;createdTime?:number;clientCreatedTime?:number}>};

export function cloverSource(companyId:string,environment:string,merchantId:string):SalesSourceBinding{
 return {kind:'native',provider:'clover',environment,connectionId:`clover:${companyId}`,merchantId,locationId:merchantId};
}

function timestamp(value:number|undefined,label:string){
 if(!Number.isSafeInteger(value)||!value||value<0||value>Date.now()+300_000)throw new Error(`Clover ${label} is missing or invalid.`);
 return new Date(value).toISOString();
}

export function normalizeCloverOrder(order:CloverOrder,startedAt:number):SalesEventDraftV1|null{
 if(!order||typeof order.id!=='string'||!order.id||!Number.isSafeInteger(order.modifiedTime)||order.modifiedTime<=0||!Number.isSafeInteger(order.createdTime)||order.createdTime<=0)throw new Error('Clover order identity or revision is invalid.');
 if(order.createdTime<startedAt)return null;
 const paymentState=order.paymentState?.toUpperCase()||'OPEN';
 const paid=paymentState==='PAID';
 const refunded=paymentState==='REFUNDED'||paymentState==='PARTIALLY_REFUNDED';
 const canceled=Boolean(order.deletedTime)||order.state?.toUpperCase()==='CANCELED';
 if(!paid&&!refunded&&!canceled)return null;
 if(!order.lineItems||!Array.isArray(order.lineItems.elements)||order.lineItems.elements.length>=100)throw new Error('Clover order lines are incomplete or too large.');
 const lines=order.lineItems.elements.map(line=>{
  if(!line.id||!line.item?.id||line.unitQty!=null&&line.unitQty!==1000)throw new Error('Clover line item identity or quantity needs review.');
  const modifications=line.modifications?.elements??[];
  if(!Array.isArray(modifications)||modifications.length>=100)throw new Error('Clover modifiers are incomplete or too large.');
  return {externalLineId:line.id,externalItemId:line.item.id,quantity:'1',modifiers:modifications.map(mod=>{
   if(!mod.id||!mod.modifier?.id)throw new Error('Clover modifier identity needs review.');
   return {externalModifierLineId:mod.id,externalModifierId:mod.modifier.id,quantity:'1'};
  })};
 });
 const paymentTimes=order.payments?.elements?.map(value=>value.createdTime??value.clientCreatedTime).filter((value):value is number=>typeof value==='number')??[];
 const hasPaymentTime=!paid||paymentTimes.length>0;
 const occurredAt=paid&&hasPaymentTime?timestamp(Math.max(...paymentTimes),'payment time'):timestamp(order.modifiedTime,'modification time');
 const eventType=refunded?'refund':canceled?'cancellation':'sale';
 const draft:SalesEventDraftV1={schemaVersion:SALES_EVENT_CONTRACT,externalEventId:`${order.id}:${order.modifiedTime}`,externalOrderId:order.id,revision:order.modifiedTime,eventType,orderStatus:refunded?(paymentState==='REFUNDED'?'refunded':'partially_refunded'):canceled?'canceled':'completed',preparationStatus:paid?'fulfilled':canceled?'not_started':'unknown',occurredAt,timeQuality:hasPaymentTime?'provider':'inferred',lines};
 // Hash only the consumption-relevant projection. Never retain Clover's customer,
 // note, tender, or payment objects in the sales event store.
 draft.sourcePayload={...draft};
 return draft;
}
