import {z} from 'zod';
import type {PurchaseOrderView} from './purchase-order-contract';

export const cartStartSchema=z.object({action:z.literal('start'),companyId:z.string().min(1).max(200),
  orderId:z.string().min(1).max(200),expectedRevision:z.number().int().positive(),operationId:z.string().uuid(),
  layout:z.enum(['rows','compact']),scenario:z.enum(['normal','unavailable','price_changed','wrong_pack','ambiguous','lost_response','login_expired','malicious'])}).strict();
export type CartStart= z.infer<typeof cartStartSchema>;
export type CartLine={sku:string;description:string;unitLabel:string;packs:string;unitMinor:string};
export type CartEntry={sku:string;unitLabel:string;packs:string;unitMinor:string};
export type CartState='preparing'|'awaiting_login'|'needs_review'|'ready'|'failed'|'canceled';
export type CartJobView={id:string;orderId:string;revision:number;state:CartState;mode:'offline'|'ai';
  message:string;lines:Array<CartLine&{verified:boolean}>;startedAt:string;updatedAt:string;elapsedMs:number;interventions:number;layout:CartStart['layout'];scenario:CartStart['scenario']};
export function cartLines(order:PurchaseOrderView):CartLine[]{
  if(order.status!=='reviewed')throw Error('Review the current draft before preparing a cart.');
  if(order.snapshot.supplier.id!=='cart-demo-supplier'||order.snapshot.supplier.accountId!=='DEMO-CART'||order.snapshot.supplier.locationId!=='DEMO-CAFE')throw Error('Use the fictional cart supplier/account/location in this preview.');
  const lines=order.snapshot.lines.map(l=>{
    const price=l.estimatedUnitMinor??(l.estimatedLineMinor!==null&&BigInt(l.estimatedLineMinor)%BigInt(l.packs)===BigInt(0)?String(BigInt(l.estimatedLineMinor)/BigInt(l.packs)):null);
    if(price===null)throw Error('Every demo line needs a reviewed price estimate.');
    return {sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,unitMinor:price};
  });
  if(new Set(lines.map(l=>l.sku)).size!==lines.length)throw Error('Duplicate supplier SKUs need review.');
  return lines;
}
export function exactEntry(a:CartEntry,b:CartEntry){return a.sku===b.sku&&a.unitLabel===b.unitLabel&&a.packs===b.packs&&a.unitMinor===b.unitMinor;}
export function verifyCart(baseline:CartEntry[],lines:CartLine[],current:CartEntry[],attempted:string[]){
  if(new Set(current.map(e=>e.sku)).size!==current.length)throw Error('Duplicate cart SKU needs review.');
  for(const e of baseline)if(!current.some(c=>exactEntry(c,e)))throw Error('An existing cart item changed. Review the cart.');
  for(const e of current){
    if(baseline.some(b=>exactEntry(b,e)))continue;
    const line=lines.find(l=>l.sku===e.sku);
    if(!line||!attempted.includes(e.sku)||!exactEntry(e,line))throw Error('Unexpected cart contents. Review before resuming.');
  }
  return lines.filter(l=>current.some(e=>exactEntry(e,l))).map(l=>l.sku);
}
