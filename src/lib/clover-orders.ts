import {SALES_EVENT_CONTRACT,type SalesEventDraftV1,type SalesSourceBinding} from '@/lib/sales-ingestion';

type CloverCollection<T>={elements:T[]};
type CloverModification={id:string;modifier?:{id:string}};
type CloverLine={id:string;item?:{id:string};unitQty?:number|null;modifications?:CloverCollection<CloverModification>};
export type CloverOrder={id:string;createdTime:number;modifiedTime:number;total?:number;paymentState?:string;state?:string;deletedTime?:number;lineItems?:CloverCollection<CloverLine>;payments?:CloverCollection<{id:string;createdTime?:number;clientCreatedTime?:number}>;refunds?:CloverCollection<{id:string;amount:number}>};

export function cloverSource(companyId:string,environment:string,merchantId:string):SalesSourceBinding{
 return {kind:'native',provider:'clover',environment,connectionId:`clover:${companyId}`,merchantId,locationId:merchantId};
}

function timestamp(value:number|undefined,label:string){
 if(!Number.isSafeInteger(value)||!value||value<0||value>Date.now()+300_000)throw new Error(`Clover ${label} is missing or invalid.`);
 return new Date(value).toISOString();
}

function orderLines(order:CloverOrder,allowMissing=false):SalesEventDraftV1['lines']{
 if(allowMissing&&order.lineItems===undefined)return [];
 if(!order.lineItems||!Array.isArray(order.lineItems.elements)||order.lineItems.elements.length>=100)throw new Error('Clover order lines are incomplete or too large.');
 return order.lineItems.elements.map(line=>{
  if(!line.id||!line.item?.id||line.unitQty!=null&&line.unitQty!==1000)throw new Error('Clover line item identity or quantity needs review.');
  const modifications=line.modifications?.elements??[];
  if(!Array.isArray(modifications)||modifications.length>=100)throw new Error('Clover modifiers are incomplete or too large.');
  return {externalLineId:line.id,externalItemId:line.item.id,quantity:'1',modifiers:modifications.map(mod=>{
   if(!mod.id||!mod.modifier?.id)throw new Error('Clover modifier identity needs review.');
   return {externalModifierLineId:mod.id,externalModifierId:mod.modifier.id,quantity:'1'};
  })};
 });
}

export function normalizeCloverOrder(order:CloverOrder,startedAt:number):SalesEventDraftV1|null{
 if(!order||typeof order.id!=='string'||!order.id||!Number.isSafeInteger(order.modifiedTime)||order.modifiedTime<=0||!Number.isSafeInteger(order.createdTime)||order.createdTime<=0)throw new Error('Clover order identity or revision is invalid.');
 if(order.createdTime<startedAt)return null;
 const paymentState=order.paymentState?.toUpperCase()||'OPEN';
 const paid=paymentState==='PAID';
 const refundEntries=order.refunds?.elements;
 if(refundEntries&&!Array.isArray(refundEntries))throw new Error('Clover refund expansion is incomplete.');
 let linkedRefundStatus:'refunded'|'partially_refunded'|null=null;
 if(refundEntries?.length){
  if(!Number.isSafeInteger(order.total)||Number(order.total)<=0||refundEntries.some(refund=>!refund.id||!Number.isSafeInteger(refund.amount)||refund.amount<=0)||new Set(refundEntries.map(refund=>refund.id)).size!==refundEntries.length)throw new Error('Clover refund details need review.');
  const refundedAmount=refundEntries.reduce((sum,refund)=>sum+refund.amount,0);
  if(!Number.isSafeInteger(refundedAmount)||refundedAmount>order.total!)throw new Error('Clover refund amount needs review.');
  linkedRefundStatus=refundedAmount===order.total?'refunded':'partially_refunded';
 }
 const refunded=Boolean(linkedRefundStatus)||paymentState==='REFUNDED'||paymentState==='PARTIALLY_REFUNDED'||paymentState==='CREDITED';
 const canceled=Boolean(order.deletedTime)||order.state?.toUpperCase()==='CANCELED';
 if(!paid&&!refunded&&!canceled)return null;
 const lines=orderLines(order);
 const paymentTimes=order.payments?.elements?.map(value=>value.createdTime??value.clientCreatedTime).filter((value):value is number=>typeof value==='number')??[];
 const hasPaymentTime=!paid||paymentTimes.length>0;
 const occurredAt=paid&&hasPaymentTime&&!linkedRefundStatus?timestamp(Math.max(...paymentTimes),'payment time'):timestamp(order.modifiedTime,'modification time');
 const eventType=refunded?'refund':canceled?'cancellation':'sale';
 // A linked refund can become visible after a detail response for this same
 // modifiedTime was already received as PAID. Keep that receipt immutable and
 // give the refund its own adjacent revision, so a later poll can reconcile it.
 if(linkedRefundStatus&&!Number.isSafeInteger(order.modifiedTime+1))throw new Error('Clover refund revision is invalid.');
 const revision=linkedRefundStatus?order.modifiedTime+1:order.modifiedTime;
 const externalEventId=linkedRefundStatus?`${order.id}:refund:${refundEntries!.map(refund=>refund.id).sort().join(',')}`:`${order.id}:${order.modifiedTime}`;
 const draft:SalesEventDraftV1={schemaVersion:SALES_EVENT_CONTRACT,externalEventId,externalOrderId:order.id,revision,eventType,orderStatus:linkedRefundStatus??(refunded?(paymentState==='PARTIALLY_REFUNDED'?'partially_refunded':'refunded'):canceled?'canceled':'completed'),preparationStatus:refunded?'unknown':paid?'fulfilled':canceled?'not_started':'unknown',occurredAt,timeQuality:refunded||hasPaymentTime?'provider':'inferred',lines};
 // Hash only the consumption-relevant projection. Never retain Clover's customer,
 // note, tender, or payment objects in the sales event store.
 draft.sourcePayload={...draft};
 return draft;
}

// This projection is valid only for an order returned by Clover's deletedTime
// filter. The list can omit deletedTime and lineItems while detail GET is 404.
export function normalizeCloverDeletedOrder(order:CloverOrder,startedAt:number):SalesEventDraftV1|null{
 if(!order||typeof order.id!=='string'||!order.id||!Number.isSafeInteger(order.modifiedTime)||order.modifiedTime<=0||!Number.isSafeInteger(order.createdTime)||order.createdTime<=0)throw new Error('Clover deleted order identity or revision is invalid.');
 if(order.createdTime<startedAt)return null;
 const draft:SalesEventDraftV1={schemaVersion:SALES_EVENT_CONTRACT,externalEventId:`${order.id}:${order.modifiedTime}`,externalOrderId:order.id,revision:order.modifiedTime,eventType:'cancellation',orderStatus:'canceled',preparationStatus:'unknown',occurredAt:timestamp(order.modifiedTime,'deletion modification time'),timeQuality:'provider',lines:orderLines(order,true)};
 draft.sourcePayload={...draft};
 return draft;
}
