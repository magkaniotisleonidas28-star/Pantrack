import {z} from 'zod';
import {cartStartSchema,verifyCart,type CartEntry} from './cart-preview-contract';
import type {PreparationPreflight} from './po-cart-preparation-contract';
export const browserConfigSchema=cartStartSchema.pick({layout:true,scenario:true}).strict();
export type BrowserConfig=z.infer<typeof browserConfigSchema>;
export const cartObservationSchema=z.array(z.object({sku:z.string().min(1).max(200),unitLabel:z.string().min(1).max(200),
 packs:z.string().regex(/^[1-9]\d{0,8}$/),unitMinor:z.string().regex(/^(0|[1-9]\d{0,11})$/)}).strict()).max(100);
export const browserHoldReasonSchema=z.enum(['sign_in_required','changed_product','uncertain_write','verification_failed','session_unavailable']);
export type BrowserEvidence={kind:'baseline'|'final';observation:CartEntry[];verified:boolean;reason:string;at:string};
export function checkBrowserCart(kind:'baseline'|'final',cart:CartEntry[],preflight:PreparationPreflight,baseline:CartEntry[]=[]){
 if(new Set(cart.map(e=>e.sku)).size!==cart.length)return 'duplicate_sku';
 if(kind==='baseline')return cart.some(e=>preflight.lines.some(l=>l.sku===e.sku))?'requested_sku_present':'verified';
 try{if(verifyCart(baseline,[...preflight.lines],cart,preflight.lines.map(l=>l.sku)).length!==preflight.lines.length)return 'incomplete_cart';}
 catch{return 'cart_mismatch';}
 // The cap bounds the complete cart, including preserved unrelated items.
 if(cart.reduce((n,e)=>n+BigInt(e.packs)*BigInt(e.unitMinor),BigInt(0))>BigInt(preflight.capMinor))return 'cap_exceeded';
 return 'verified';
}
