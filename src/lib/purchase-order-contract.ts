import {z} from 'zod';
import type {ExactQuantity} from './inventory-consumption-contract';
import type {ProposalHandoff} from './replenishment-lifecycle';
import type {MappingProjection,SupplierVersion} from './purchasing-supplier-contract';

export const poId = z.string().trim().min(1).max(200);
const whole = z.string().regex(/^[1-9]\d{0,8}$/);
const minor = z.string().regex(/^(0|[1-9]\d{0,11})$/);
const note = z.string().trim().max(1000);
const common = {companyId: poId, operationId: poId,
  supplier: z.object({id: poId, name: poId, email: z.string().trim().email().max(254),
    accountId: poId, locationId: poId, deliveryAddress: z.string().trim().min(1).max(1000)}).strict(),
  capMinor: minor.refine(v => BigInt(v) > BigInt(0)), notes: note};
const stock = z.object({kind: z.literal('stock'), productId: poId,
  expectedConfigId: poId, expectedConfigVersion: z.number().int().positive(),
  sku: poId, description: poId, packs: whole, estimatedUnitMinor: minor.nullable()}).strict();
const nonStock = z.object({kind: z.literal('non_stock'), sku: poId,
  description: poId, unitLabel: poId, packs: whole, estimatedUnitMinor: minor.nullable()}).strict();
export const createPoSchema = z.discriminatedUnion('source', [
  z.object({...common, action: z.literal('create'), source: z.literal('manual'),
    lines: z.array(z.discriminatedUnion('kind',[stock,nonStock])).min(1).max(50)}).strict(),
  z.object({...common, action: z.literal('create'), source: z.literal('proposals'),
    proposals: z.array(z.object({id: poId, revision: z.number().int().positive()}).strict()).min(1).max(50)}).strict(),
  z.object({companyId:poId,operationId:poId,action:z.literal('create'),source:z.literal('registry'),
    supplierRef:z.object({id:poId,version:z.number().int().positive(),accountId:poId,locationId:poId}).strict(),
    capMinor:common.capMinor,notes:note,
    lines:z.array(z.discriminatedUnion('kind',[
      z.object({kind:z.literal('stock'),mappingId:poId,mappingVersion:z.number().int().positive(),packs:whole}).strict(),nonStock,
    ])).min(1).max(50)}).strict(),
]);
export const cancelPoSchema = z.object({action: z.literal('cancel'), companyId: poId,
  orderId: poId, operationId: poId, expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(4).max(500)}).strict();
const editFields = {action:z.literal('edit'),orderId:poId,expectedRevision:z.number().int().positive(),
  reason:z.string().trim().min(4).max(500)};
export const editPoSchema = z.discriminatedUnion('source',[
  createPoSchema.options[0].extend(editFields),
  z.object({...common,...editFields,source:z.literal('proposals')}).strict(),
  createPoSchema.options[2].extend(editFields),
]);
export const reviewPoSchema = z.object({action:z.literal('review'),companyId:poId,orderId:poId,operationId:poId,
  expectedRevision:z.number().int().positive(),acknowledgeWarnings:z.literal(true)}).strict();
export type CreatePoInput = z.infer<typeof createPoSchema>;
export type EditPoInput = z.infer<typeof editPoSchema>;
export type CancelPoInput = z.infer<typeof cancelPoSchema>;
export type PurchaseOrderLine = Readonly<{
  id: string; kind: 'stock' | 'non_stock'; productId: string | null;
  sku: string; description: string; unitLabel: string; packs: string;
  stockUnitsPerPack: ExactQuantity | null; stockQuantity: ExactQuantity | null;
  configId: string | null; configVersion: number | null;
  estimatedLineMinor: string | null; proposal: ProposalHandoff | null;
  mappingId?:string; mappingVersion?:number; estimatedUnitMinor?:string|null;
}>;
export type PurchaseOrderSnapshot = Readonly<{
  contract: 'pantrack.purchase-order-draft.v1'|'pantrack.purchase-order-draft.v2'; companyId: string; id: string; number: string;
  source: CreatePoInput['source']; supplier:{id:string;name:string;email:string|null;accountId:string;locationId:string;deliveryAddress:string}; currency: 'USD';
  capMinor: string; notes: string; lines: readonly PurchaseOrderLine[];
  knownSubtotalMinor: string; pricesComplete: boolean; warnings: readonly string[];
  createdBy: string; createdAt: string;
  registry?:Readonly<{profile:SupplierVersion;mappings:readonly MappingProjection[];group?:Readonly<{accountId:string;locationId:string}>}>;
}>;
export type PurchaseOrderView = Readonly<{
  snapshot: PurchaseOrderSnapshot; revision: number; status: 'draft' | 'reviewed' | 'canceled';
  review?:Readonly<{contentRevision:number;actor:string;at:string}>;
  events: readonly Readonly<{revision: number; kind: 'create' | 'edit' | 'review' | 'cancel'; actor: string; reason: string; at: string}>[];
}>;
export class PurchaseOrderError extends Error {
  constructor(public readonly code: 'invalid_request' | 'forbidden' | 'missing' | 'source_changed' | 'conflict' | 'storage_failure', message: string) {
    super(message); this.name = 'PurchaseOrderError';
  }
}
export function poFail(code: PurchaseOrderError['code'], message: string): never {throw new PurchaseOrderError(code,message);}
