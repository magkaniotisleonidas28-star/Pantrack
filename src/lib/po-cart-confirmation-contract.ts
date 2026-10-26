import {z} from 'zod';
import type {PreparationPreflight} from './po-cart-preparation-contract';
import type {OrderIncomingLine} from './inventory-management-contract';

// Manager-entered supplier purchase confirmation for a ready fictional cart. Typed details only;
// a checkout or ready cart alone is never confirmation.
const id=z.string().trim().min(1).max(200);
const minor=z.string().regex(/^(0|[1-9][0-9]{0,9})$/,'Enter whole cents.');
const packs=z.string().regex(/^(0|[1-9][0-9]{0,3})$/,'Enter whole packs.');
export const chargeKinds=['delivery','tax','fuel','other'] as const;
export const recordConfirmationSchema=z.object({
  action:z.literal('record'),companyId:id,jobId:id,expectedJobRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  operationId:z.string().uuid(),supplierReference:z.string().trim().min(1).max(100),
  // The refinement also runs after a failed pattern, so it must not throw on malformed input.
  expectedDelivery:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const t=Date.parse(v+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;},'Enter a real date.'),
  lines:z.array(z.object({lineId:id,packs,unitMinor:minor}).strict()).max(200),
  extras:z.array(z.object({sku:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(200),
    packs:packs.refine(v=>v!=='0','Extra items need at least one pack.'),unitMinor:minor}).strict()).max(50),
  charges:z.array(z.object({kind:z.enum(chargeKinds),description:z.string().trim().max(200),amountMinor:minor}).strict()).max(20),
  note:z.string().trim().max(1000),
}).strict();
export const confirmationQuerySchema=z.object({companyId:id,jobId:id}).strict();
export type RecordConfirmation=z.infer<typeof recordConfirmationSchema>;
export type ConfirmedLine=Readonly<{lineId:string;kind:'stock'|'non_stock';sku:string;description:string;unitLabel:string;
  authorizedPacks:string;packs:string;estimateUnitMinor:string;unitMinor:string;lineMinor:string;packsChanged:boolean;priceChanged:boolean}>;
export type ConfirmationState='confirmed'|'needs_owner_review';
export type ConfirmationReceipt=Readonly<{operationId:string;confirmationId:string;jobId:string;state:ConfirmationState;at:string}>;
export class PoCartConfirmationError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'conflict'|'storage_failure',message:string){
    super(message);this.name='PoCartConfirmationError';
  }
}
export function confirmationFail(code:PoCartConfirmationError['code'],message:string):never {throw new PoCartConfirmationError(code,message);}

/**
 * Accounts for every authorized line exactly once. Stock lines with confirmed packs become
 * order-linked incoming at the frozen pack conversion; extra (substituted or added) items cost
 * money but add no stock until mapped and reviewed.
 */
export function computeConfirmation(preflight:PreparationPreflight,input:RecordConfirmation){
  const given=new Map(input.lines.map(l=>[l.lineId,l]));
  if(given.size!==input.lines.length||given.size!==preflight.lines.length||preflight.lines.some(l=>!given.has(l.lineId)))
    confirmationFail('invalid_request','Account for every authorized line once; enter 0 packs for anything the supplier did not confirm.');
  const lines:ConfirmedLine[]=preflight.lines.map(l=>{const c=given.get(l.lineId)!;return {lineId:l.lineId,kind:l.kind,sku:l.sku,description:l.description,
    unitLabel:l.unitLabel,authorizedPacks:l.packs,packs:c.packs,estimateUnitMinor:l.unitMinor,unitMinor:c.unitMinor,
    lineMinor:String(BigInt(c.packs)*BigInt(c.unitMinor)),packsChanged:BigInt(c.packs)!==BigInt(l.packs),priceChanged:BigInt(c.unitMinor)!==BigInt(l.unitMinor)};});
  const extras=input.extras.map(e=>({...e,lineMinor:String(BigInt(e.packs)*BigInt(e.unitMinor))}));
  const sum=(values:string[])=>values.reduce((total,v)=>total+BigInt(v),BigInt(0));
  const itemSubtotal=sum([...lines.map(l=>l.lineMinor),...extras.map(e=>e.lineMinor)]),charges=sum(input.charges.map(c=>c.amountMinor));
  const total=itemSubtotal+charges,cap=BigInt(preflight.capMinor);
  if(total>BigInt(100_000_000_000))confirmationFail('invalid_request','The confirmed total is too large.');
  const incoming:OrderIncomingLine[]=preflight.lines.flatMap(l=>{const confirmedPacks=BigInt(given.get(l.lineId)!.packs);
    if(l.kind!=='stock'||confirmedPacks===BigInt(0))return [];
    if(!l.productId||!l.configId||!l.stockUnitsPerPack)confirmationFail('conflict','A stock line is missing its frozen inventory conversion.');
    return [{lineId:l.lineId,productId:l.productId,configId:l.configId,dimension:l.stockUnitsPerPack.dimension,
      quantityMinor:String(BigInt(l.stockUnitsPerPack.minor)*confirmedPacks)}];});
  const state:ConfirmationState=total<=cap?'confirmed':'needs_owner_review';
  return {lines,extras,charges:input.charges,itemSubtotalMinor:Number(itemSubtotal),chargesMinor:Number(charges),totalMinor:Number(total),
    capMinor:Number(cap),state,incoming};
}
