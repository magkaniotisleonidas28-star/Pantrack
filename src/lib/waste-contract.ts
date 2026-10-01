import {z} from 'zod';
import type {WasteReason} from './inventory-management-contract';

export const WASTE_REASONS: ReadonlyArray<{id:WasteReason;label:string}> = [
  {id:'end_of_day',label:'End of day / unsold'},
  {id:'spilled',label:'Spilled'},
  {id:'spoiled',label:'Spoiled / expired'},
  {id:'preparation_error',label:'Preparation error'},
  {id:'other',label:'Other'},
];
const identity=z.string().trim().min(1).max(200);
const amount=z.string().max(128).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
export const wasteSubmission=z.object({
  companyId:identity,productId:identity,operationId:z.string().uuid(),
  expectedVersion:z.number().int().nonnegative().safe(),amount,unitId:identity,
  effectiveAt:z.string().min(20).max(35),
  reason:z.enum(['end_of_day','spilled','spoiled','preparation_error','other']),
  note:z.string().trim().max(300),
}).strict();
export type WasteSubmission=z.infer<typeof wasteSubmission>;
export const shortcut=z.object({label:z.string().trim().min(1).max(40),amount,unitId:identity}).strict();
export type WasteShortcut=z.infer<typeof shortcut>;
export const shortcutSubmission=z.object({
  companyId:identity,productId:identity,configId:identity,
  operationId:z.string().uuid(),expectedRevision:z.number().int().nonnegative().safe(),
  shortcuts:z.array(shortcut).max(6),
}).strict();
export type ShortcutSubmission=z.infer<typeof shortcutSubmission>;
export type WasteItem={
  productId:string;name:string;configId:string;version:number;
  unitId:string;unitLabel:string;shortcuts:WasteShortcut[];shortcutRevision:number;
};
export type WasteOptions={enabled:true;items:WasteItem[];serverNow:string};
export type WasteReceipt={operationId:string;productId:string;amount:string;unitId:string;reason:WasteReason;effectiveAt:string};
