import {z} from 'zod';
import {poId, poFail} from './purchase-order-contract';
import {frozenCopy} from './supplier-simulation-contract';

export const purchaseOrderExportRequest = z.object({companyId:poId,orderId:poId,
  revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export type PurchaseOrderExportRequest = z.infer<typeof purchaseOrderExportRequest>;

const text = z.string().min(1).max(200);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const minor = z.string().max(80).regex(/^(0|[1-9]\d*)$/);
const quantity = z.object({dimension:z.enum(['count','mass','volume']),minor});
const reasons = z.array(z.string().max(2000)).max(100);
const line = z.object({id:text,kind:z.enum(['stock','non_stock']),productId:text.nullable(),sku:text,
  description:text,unitLabel:text,packs:z.string().regex(/^[1-9]\d{0,8}$/),
  stockUnitsPerPack:quantity.nullable(),stockQuantity:quantity.nullable(),configId:text.nullable(),
  configVersion:version.nullable(),estimatedUnitMinor:minor.nullable().optional(),estimatedLineMinor:minor.nullable(),
  mappingId:text.optional(),mappingVersion:version.optional(),
  proposal:z.object({contract:z.enum(['pantrack.replenishment-handoff.v1','pantrack.replenishment-handoff.v2']),
    companyId:text,productId:text,proposalId:text,revision:version,status:z.string().min(1).max(100),
    packs:z.string().regex(/^[1-9]\d{0,8}$/),stockUnitsPerPack:quantity,
    supplier:z.object({supplierId:text,accountId:text,locationId:text,sku:text}),
    warnings:reasons,reviewReasons:reasons,editReason:z.string().max(2000).nullable()}).nullable(),
});
// Only document fields and version references are selected; registry profile contents stay out.
const documentSchema = z.object({contract:z.enum(['pantrack.purchase-order-draft.v1','pantrack.purchase-order-draft.v2']),
  companyId:text,id:text,number:text,source:z.enum(['manual','proposals','registry']),currency:z.literal('USD'),
  supplier:z.object({id:text,name:text,email:z.string().email().max(254).nullable(),accountId:text,locationId:text,
    deliveryAddress:z.string().min(1).max(1000)}),
  capMinor:minor,notes:z.string().max(1000),createdAt:z.string().datetime(),lines:z.array(line).min(1).max(50),
  knownSubtotalMinor:minor,pricesComplete:z.boolean(),warnings:reasons});
const snapshotSchema = documentSchema.extend({
  registry:z.object({profile:z.object({companyId:text,id:text,version}),
    group:z.object({accountId:text,locationId:text}).optional()}).optional()});
export const PURCHASE_ORDER_EXPORT_LABEL = 'Draft — no order placed.';
export const PURCHASE_ORDER_EXPORT_LIMITATIONS = [
  'Saved draft revision only; current stock, supplier mappings and sales readiness have not been revalidated.',
  'Prices are estimates. The known subtotal excludes unavailable estimates and unconfirmed fees and delivery.',
  'Exporting records no supplier submission, purchase approval, reservation or inventory change.',
] as const;
const recordSchema=z.object({revision:version,status:z.enum(['draft','reviewed','canceled']),
  draft:documentSchema.strict(),supplierReference:z.object({id:text,version,accountId:text,locationId:text}).strict().optional(),
  review:z.object({contentRevision:version,actor:text,at:z.string().datetime()}).strict().optional()});
const historyRecordSchema=recordSchema.extend({createdAt:z.string().datetime()}).strict();
const exportSchema = recordSchema.extend({contract:z.literal('pantrack.purchase-order-export.v1'),
  label:z.literal(PURCHASE_ORDER_EXPORT_LABEL),status:z.enum(['draft','reviewed']),
  limitations:z.tuple([z.literal(PURCHASE_ORDER_EXPORT_LIMITATIONS[0]),
    z.literal(PURCHASE_ORDER_EXPORT_LIMITATIONS[1]),z.literal(PURCHASE_ORDER_EXPORT_LIMITATIONS[2])])}).strict();
const rowSchema = z.object({company_id:text,id:text,number:text,supplier_id:text,
  current_revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),current_status:z.enum(['draft','reviewed','canceled']),
  revision_status:z.enum(['draft','reviewed','canceled']),snapshot_json:z.string().max(1_000_000),
  event_kind:z.enum(['create','edit','review','cancel']),event_actor:text,event_at:z.string().datetime()});

const broken = ():never => poFail('storage_failure','The saved draft cannot be exported. Reload it before trying again.');

// Shared by the database projection and document capture; neither recomputes live sources.
function validateDocument(draft:z.infer<typeof documentSchema>):void {
  if(new Set(draft.lines.map(item=>item.id)).size!==draft.lines.length)return broken();
  for(const item of draft.lines){
    if(item.kind==='non_stock'){
      if(item.productId!==null||item.stockUnitsPerPack!==null||item.stockQuantity!==null||item.configId!==null||item.configVersion!==null||item.proposal!==null)return broken();
    }else if(!item.productId||!item.configId||!item.configVersion||!item.stockUnitsPerPack||!item.stockQuantity||
      item.stockUnitsPerPack.dimension!==item.stockQuantity.dimension||BigInt(item.stockUnitsPerPack.minor)<=0||
      BigInt(item.stockQuantity.minor)!==BigInt(item.packs)*BigInt(item.stockUnitsPerPack.minor))return broken();
    if((item.mappingId===undefined)!==(item.mappingVersion===undefined))return broken();
    if(draft.source==='proposals'){
      const p=item.proposal;
      if(!p||p.companyId!==draft.companyId||p.productId!==item.productId||p.packs!==item.packs||
        p.supplier.supplierId!==draft.supplier.id||p.supplier.accountId!==draft.supplier.accountId||
        p.supplier.locationId!==draft.supplier.locationId||p.supplier.sku!==item.sku||
        p.stockUnitsPerPack.dimension!==item.stockUnitsPerPack?.dimension||p.stockUnitsPerPack.minor!==item.stockUnitsPerPack.minor)return broken();
    }else if(item.proposal!==null)return broken();
    if(item.estimatedUnitMinor!==undefined&&item.estimatedLineMinor!==
      (item.estimatedUnitMinor===null?null:(BigInt(item.packs)*BigInt(item.estimatedUnitMinor)).toString()))return broken();
  }
  const subtotal=draft.lines.reduce((sum,item)=>sum+BigInt(item.estimatedLineMinor??'0'),BigInt(0));
  if(subtotal.toString()!==draft.knownSubtotalMinor||subtotal>BigInt(draft.capMinor)||BigInt(draft.capMinor)<=0||
    draft.pricesComplete!==draft.lines.every(item=>item.estimatedLineMinor!==null))return broken();
}

/** Validate/copy a previously authorized response before asynchronous document generation.
 * This is structural validation, not authentication, a signature or a fresh database read. */
export function capturePurchaseOrderExport(value:unknown) {
  const parsed=exportSchema.safeParse(value);
  if(!parsed.success)return broken();
  validateRecord(parsed.data);return frozenCopy(parsed.data);
}
function validateRecord(snapshot:z.infer<typeof recordSchema>):void{
  const {draft,supplierReference:reference}=snapshot;
  validateDocument(draft);
  if(draft.source==='registry'?(draft.contract!=='pantrack.purchase-order-draft.v2'||!reference||reference.id!==draft.supplier.id):reference!==undefined)return broken();
  if(snapshot.status==='reviewed'?(!snapshot.review||snapshot.review.contentRevision!==snapshot.revision-1):snapshot.review!==undefined)return broken();
}
export type PurchaseOrderExportSnapshot = ReturnType<typeof capturePurchaseOrderExport>;

/** History may describe canceled records; it never makes them eligible for individual draft export. */
export function capturePurchaseOrderHistoryRecord(value:unknown){
  const parsed=historyRecordSchema.safeParse(value);if(!parsed.success)return broken();
  validateRecord(parsed.data);return frozenCopy(parsed.data);
}
export type PurchaseOrderHistoryRecord=ReturnType<typeof capturePurchaseOrderHistoryRecord>;

function savedRecord(value:unknown,selection:PurchaseOrderExportRequest,allowCanceled:boolean){
  const result = rowSchema.safeParse(value);
  if(!result.success)return broken();
  const row=result.data;
  if(row.current_revision!==selection.revision||!allowCanceled&&row.current_status==='canceled') {
    poFail('conflict','The draft changed or was canceled. Reload it before exporting.');
  }
  let decoded:unknown;
  try{decoded=JSON.parse(row.snapshot_json);}catch{return broken();}
  const parsed=snapshotSchema.safeParse(decoded);
  if(!parsed.success)return broken();
  const draft=parsed.data;
  if(row.company_id!==selection.companyId||row.id!==selection.orderId||draft.companyId!==selection.companyId||
    draft.id!==row.id||draft.number!==row.number||draft.supplier.id!==row.supplier_id||row.revision_status!==row.current_status||
    (row.current_status==='reviewed'?row.event_kind!=='review'||row.current_revision<2:
      row.current_status==='canceled'?row.event_kind!=='cancel'||row.current_revision<2:!['create','edit'].includes(row.event_kind)))return broken();
  if(draft.source==='registry'&&(!draft.registry?.group||draft.registry.profile.companyId!==draft.companyId||draft.registry.profile.id!==draft.supplier.id||
    draft.contract!=='pantrack.purchase-order-draft.v2'))return broken();
  if(draft.source!=='registry'&&draft.registry!==undefined)return broken();
  const {registry,...document}=draft;
  return {revision:row.current_revision,status:row.current_status,draft:document,
    ...(registry?{supplierReference:{id:registry.profile.id,version:registry.profile.version,
      accountId:registry.group!.accountId,locationId:registry.group!.locationId}}:{}),
    ...(row.current_status==='reviewed'?{review:{contentRevision:row.current_revision-1,actor:row.event_actor,at:row.event_at}}:{})};
}
export function buildPurchaseOrderExport(value:unknown,selection:PurchaseOrderExportRequest):PurchaseOrderExportSnapshot{
  return capturePurchaseOrderExport({...savedRecord(value,selection,false),contract:'pantrack.purchase-order-export.v1',
    label:PURCHASE_ORDER_EXPORT_LABEL,limitations:PURCHASE_ORDER_EXPORT_LIMITATIONS});
}
export function buildPurchaseOrderHistoryRecord(value:unknown,companyId:string):PurchaseOrderHistoryRecord{
  const row=rowSchema.safeParse(value),header=z.object({header_created_at:z.string().datetime()}).safeParse(value);
  if(!row.success||!header.success)return broken();
  return capturePurchaseOrderHistoryRecord({...savedRecord(value,{companyId,orderId:row.data.id,revision:row.data.current_revision},true),
    createdAt:header.data.header_created_at});
}
