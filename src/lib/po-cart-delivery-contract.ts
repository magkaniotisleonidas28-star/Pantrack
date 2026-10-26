import {z} from 'zod';
import type {PreparationPreflight} from './po-cart-preparation-contract';
import type {OrderReceiptLine} from './inventory-management-contract';

// Delivery receiving for confirmed fictional supplier orders. Staff count blind (no expected
// amounts or prices); an owner or manager approves what enters stock through A's receipt port.
const id=z.string().trim().min(1).max(200);
const packs=z.string().regex(/^(0|[1-9][0-9]{0,3})$/,'Enter whole packs.');
export const countDeliverySchema=z.object({
  action:z.literal('count'),companyId:id,confirmationId:id,operationId:z.string().uuid(),deliveredAt:z.string().max(40),
  lines:z.array(z.object({lineId:id,receivedPacks:packs,damagedPacks:packs}).strict()).min(1).max(250),note:z.string().trim().max(1000),
}).strict();
export const approveDeliverySchema=z.object({
  action:z.literal('approve'),companyId:id,deliveryId:id,operationId:z.string().uuid(),
  lines:z.array(z.object({lineId:id,acceptPacks:packs,excessPacks:packs,releaseRest:z.boolean()}).strict()).min(1).max(250),note:z.string().trim().max(1000),
}).strict();
export const recountDeliverySchema=z.object({
  action:z.literal('recount'),companyId:id,deliveryId:id,operationId:z.string().uuid(),note:z.string().trim().min(1,'Say what should be recounted.').max(1000),
}).strict();
// Closing marks whatever is still expected as not arriving; the reason is required only then.
export const closeOrderSchema=z.object({
  action:z.literal('close'),companyId:id,confirmationId:id,operationId:z.string().uuid(),note:z.string().trim().max(1000),
}).strict();
export const staffDeliveriesQuerySchema=z.object({companyId:id,view:z.literal('staff')}).strict();
export const managerDeliveriesQuerySchema=z.object({companyId:id,view:z.literal('manager'),jobId:id}).strict();
export type CountDelivery=z.infer<typeof countDeliverySchema>;
export type ApproveDelivery=z.infer<typeof approveDeliverySchema>;
export type DeliveryState='counted'|'approved'|'recount';
export type CountedLine=Readonly<{lineId:string;receivedPacks:string;damagedPacks:string}>;
export type DecidedLine=Readonly<{lineId:string;kind:ReceivableKind;acceptPacks:string;excessPacks:string;releasePacks:string}>;
export type DeliveryReceipt=Readonly<{operationId:string;deliveryId:string;state:DeliveryState;at:string}>;
export type ClosureKind='complete'|'closed_short';
export type ClosureReceipt=Readonly<{operationId:string;confirmationId:string;kind:ClosureKind;at:string}>;
export class PoCartDeliveryError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'conflict'|'storage_failure',message:string){
    super(message);this.name='PoCartDeliveryError';
  }
}
export function deliveryFail(code:PoCartDeliveryError['code'],message:string):never {throw new PoCartDeliveryError(code,message);}

export type ReceivableKind='stock'|'non_stock'|'extra';
/** One line that can arrive: a confirmed order line with packs, or a substituted/extra item. */
export type Receivable=Readonly<{lineId:string;kind:ReceivableKind;sku:string;description:string;unitLabel:string;confirmedPacks:bigint;
  productId:string|null;minorPerPack:bigint|null}>;
type ConfirmedLineJson={lineId:string;kind:'stock'|'non_stock';sku:string;description:string;unitLabel:string;packs:string};
type ExtraJson={sku:string;description:string;packs:string};
export function receivables(preflight:PreparationPreflight,linesJson:string,extrasJson:string):Receivable[]{
  const frozen=new Map(preflight.lines.map(l=>[l.lineId,l]));
  const lines=(JSON.parse(linesJson) as ConfirmedLineJson[]).filter(l=>BigInt(l.packs)>BigInt(0)).map(l=>{
    const f=frozen.get(l.lineId);
    if(l.kind==='stock'&&(!f?.productId||!f.stockUnitsPerPack))deliveryFail('conflict','A stock line is missing its frozen inventory conversion.');
    return {lineId:l.lineId,kind:l.kind,sku:l.sku,description:l.description,unitLabel:l.unitLabel,confirmedPacks:BigInt(l.packs),
      productId:l.kind==='stock'?f!.productId:null,minorPerPack:l.kind==='stock'?BigInt(f!.stockUnitsPerPack!.minor):null};
  });
  const extras=(JSON.parse(extrasJson) as ExtraJson[]).map((x,i)=>({lineId:`extra-${i+1}`,kind:'extra' as const,sku:x.sku,description:x.description,
    unitLabel:'pack',confirmedPacks:BigInt(x.packs),productId:null,minorPerPack:null}));
  return [...lines,...extras];
}
/** Per-line totals from approved decisions, in packs. Owed is what may still arrive. */
export function progress(items:readonly Receivable[],approved:readonly (readonly DecidedLine[])[]){
  return items.map(item=>{
    const mine=approved.flat().filter(d=>d.lineId===item.lineId),sum=(pick:(d:DecidedLine)=>string)=>mine.reduce((t,d)=>t+BigInt(pick(d)),BigInt(0));
    const accepted=sum(d=>d.acceptPacks),released=sum(d=>d.releasePacks),excess=sum(d=>d.excessPacks);
    return {item,accepted,released,excess,owed:item.confirmedPacks-accepted-released};
  });
}
/** Staff count the lines that still owe something; every one of them is answered once. */
export function checkCount(open:readonly Receivable[],input:CountDelivery):CountedLine[]{
  const given=new Map(input.lines.map(l=>[l.lineId,l]));
  if(given.size!==input.lines.length||given.size!==open.length||open.some(l=>!given.has(l.lineId)))
    deliveryFail('invalid_request','Count every listed item once; enter 0 for anything that did not arrive.');
  const lines=open.map(l=>{const c=given.get(l.lineId)!;return {lineId:l.lineId,receivedPacks:c.receivedPacks,damagedPacks:c.damagedPacks};});
  if(lines.some(l=>BigInt(l.damagedPacks)>BigInt(l.receivedPacks)))deliveryFail('invalid_request','Damaged packs are part of the packs received, so they cannot be more.');
  if(lines.every(l=>l.receivedPacks==='0'))deliveryFail('invalid_request','Enter at least one pack that arrived.');
  return lines;
}
/**
 * The manager's decision for each counted line. Good packs (received minus damaged) can be accepted
 * up to what the order still owes; any good packs beyond that are excess, only once the line is fully
 * accepted. A shortfall stays expected unless the manager marks the rest as won't arrive.
 */
export function decide(items:readonly ReturnType<typeof progress>[number][],counted:readonly CountedLine[],input:ApproveDelivery){
  const given=new Map(input.lines.map(l=>[l.lineId,l]));
  if(given.size!==input.lines.length||given.size!==counted.length||counted.some(l=>!given.has(l.lineId)))
    deliveryFail('invalid_request','Decide every counted item once.');
  const decided:DecidedLine[]=counted.map(c=>{
    const p=items.find(i=>i.item.lineId===c.lineId);if(!p)deliveryFail('conflict','A counted item is no longer on this order.');
    const d=given.get(c.lineId)!,good=BigInt(c.receivedPacks)-BigInt(c.damagedPacks),accept=BigInt(d.acceptPacks),excess=BigInt(d.excessPacks);
    if(accept>p.owed)deliveryFail('invalid_request',`${p.item.description}: accept at most the ${p.owed} packs still expected.`);
    if(accept+excess>good)deliveryFail('invalid_request',`${p.item.description}: accept at most the ${good} good packs counted.`);
    if(excess>BigInt(0)&&(accept!==p.owed||d.releaseRest))deliveryFail('invalid_request',`${p.item.description}: extra packs are only possible once everything expected is accepted.`);
    return {lineId:c.lineId,kind:p.item.kind,acceptPacks:d.acceptPacks,excessPacks:d.excessPacks,releasePacks:String(d.releaseRest?p.owed-accept:BigInt(0))};
  });
  const receipt:OrderReceiptLine[]=decided.flatMap(d=>{
    const item=items.find(i=>i.item.lineId===d.lineId)!.item;
    if(item.kind!=='stock'||(d.acceptPacks==='0'&&d.excessPacks==='0'&&d.releasePacks==='0'))return [];
    const per=item.minorPerPack!;
    return [{lineId:d.lineId,acceptedMinor:String(BigInt(d.acceptPacks)*per),releasedMinor:String(BigInt(d.releasePacks)*per),excessMinor:String(BigInt(d.excessPacks)*per)}];
  });
  return {decided,receipt};
}
