import {z} from 'zod';
import {poId} from './purchase-order-contract';
import {capturePurchaseOrderHistoryRecord,type PurchaseOrderHistoryRecord} from './purchase-order-export-contract';
import {purchaseOrderHistoryFilters,purchaseOrderHistoryFilterQuery,PURCHASE_ORDER_HISTORY_FILTER_KEYS} from './purchase-order-history-contract';
import {historyDateBounds} from './purchase-order-history-dates';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';

export const HISTORY_EXPORT_MAX_ORDERS=100,HISTORY_EXPORT_MAX_LINES=1000,HISTORY_EXPORT_MAX_BYTES=2_000_000;
export const HISTORY_EXPORT_LABEL='Draft history — no purchase evidence.';
export const HISTORY_EXPORT_LIMITATIONS=[
  'Current saved draft revisions only; historical revisions, supplier confirmations, deliveries and final charges are not included.',
  'Prices are estimates; unavailable prices and unconfirmed fees are excluded. Canceled records are history, not planned purchases.',
  'This export records no purchase approval, order placement, stock reservation or inventory change.',
  'Stock, mappings and sales readiness have not been revalidated.',
] as const;
export class PurchaseOrderHistoryExportError extends Error{
  constructor(readonly code:'invalid_request'|'forbidden'|'empty'|'changed'|'too_large'|'source_invalid'|'storage_failure',message:string){super(message);}
}
export function historyExportFail(code:PurchaseOrderHistoryExportError['code'],message:string):never{throw new PurchaseOrderHistoryExportError(code,message);}
export const purchaseOrderHistoryExportRequest=z.object({companyId:poId,filters:purchaseOrderHistoryFilters.default({}),
  expected:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type PurchaseOrderHistoryExportRequest=z.infer<typeof purchaseOrderHistoryExportRequest>;
const fields={contract:z.literal('pantrack.purchase-order-history-export.v1'),label:z.literal(HISTORY_EXPORT_LABEL),companyId:poId,
  filters:purchaseOrderHistoryFilters,records:z.array(z.unknown()).min(1).max(HISTORY_EXPORT_MAX_ORDERS),
  orderCount:z.number().int().positive().max(HISTORY_EXPORT_MAX_ORDERS),lineCount:z.number().int().positive().max(HISTORY_EXPORT_MAX_LINES),
  limitations:z.tuple([z.literal(HISTORY_EXPORT_LIMITATIONS[0]),z.literal(HISTORY_EXPORT_LIMITATIONS[1]),
    z.literal(HISTORY_EXPORT_LIMITATIONS[2]),z.literal(HISTORY_EXPORT_LIMITATIONS[3])])};
const schema=z.object({...fields,fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const coreSchema=z.object(fields).strict();
const normalized=(value:unknown)=>JSON.parse(JSON.stringify(value)) as unknown;
export async function historyExportFingerprint(value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(canonicalJson(normalized(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function captureCore(value:unknown){
  const parsed=coreSchema.safeParse(value);if(!parsed.success)historyExportFail('source_invalid','The saved history cannot be exported. Refresh the results and review the drafts.');
  let records:PurchaseOrderHistoryRecord[];
  try{records=parsed.data.records.map(capturePurchaseOrderHistoryRecord);}catch{historyExportFail('source_invalid','A saved draft cannot be exported. Refresh the results and review its details.');}
  const core={...parsed.data,records};
  const dates=historyDateBounds(core.filters),product=core.filters.product;
  // Match SQLite lower()/instr(): fold ASCII only and treat wildcard characters literally.
  const lower=(text:string)=>text.replace(/[A-Z]/g,char=>char.toLowerCase());
  const includes=(text:string,query:string)=>lower(text).includes(lower(query));
  if(core.orderCount!==records.length||core.lineCount!==records.reduce((sum,record)=>sum+record.draft.lines.length,0)||
    records.some(({draft,status,createdAt})=>draft.companyId!==core.companyId||
      dates.start&&Date.parse(createdAt)<Date.parse(dates.start)||dates.before&&Date.parse(createdAt)>=Date.parse(dates.before)||
      core.filters.status&&status!==core.filters.status||
      product&&!draft.lines.some(line=>[line.productId??'',line.sku,line.description].some(text=>includes(text,product)))||
      core.filters.q&&!includes(draft.number,core.filters.q)&&!includes(draft.supplier.name,core.filters.q)||
      core.filters.supplier&&!includes(draft.supplier.id,core.filters.supplier)&&!includes(draft.supplier.name,core.filters.supplier))||
    new Set(records.map(record=>record.draft.id)).size!==records.length){
    historyExportFail('source_invalid','The saved history does not match this export. Refresh the results.');
  }
  for(let n=1;n<records.length;n++){
    const a=records[n-1],b=records[n];if(a.createdAt<b.createdAt||a.createdAt===b.createdAt&&a.draft.id<b.draft.id)historyExportFail('source_invalid','History ordering changed. Refresh the results.');
  }
  if(new TextEncoder().encode(JSON.stringify(core)).length>HISTORY_EXPORT_MAX_BYTES)historyExportFail('too_large','This history export is too large. Narrow the filters and try again.');
  return frozenCopy(core);
}
export function capturePurchaseOrderHistoryExport(value:unknown){
  const parsed=schema.safeParse(value);if(!parsed.success)historyExportFail('source_invalid','The saved history export is invalid. Refresh the results.');
  const {fingerprint,...core}=parsed.data;return frozenCopy({...captureCore(core),fingerprint});
}
export type PurchaseOrderHistoryExportSnapshot=ReturnType<typeof capturePurchaseOrderHistoryExport>;
export async function verifyPurchaseOrderHistoryExport(value:unknown):Promise<PurchaseOrderHistoryExportSnapshot>{
  const snapshot=capturePurchaseOrderHistoryExport(value),{fingerprint,...core}=snapshot;
  if(await historyExportFingerprint(core)!==fingerprint)historyExportFail('source_invalid','The history snapshot changed. Refresh the results.');
  return snapshot;
}
export async function buildPurchaseOrderHistoryExport(companyId:string,filters:z.infer<typeof purchaseOrderHistoryFilters>,records:PurchaseOrderHistoryRecord[]){
  const core=captureCore({contract:'pantrack.purchase-order-history-export.v1',label:HISTORY_EXPORT_LABEL,companyId,filters,records,
    orderCount:records.length,lineCount:records.reduce((sum,record)=>sum+record.draft.lines.length,0),limitations:HISTORY_EXPORT_LIMITATIONS});
  return frozenCopy({...core,fingerprint:await historyExportFingerprint(core)});
}
export function purchaseOrderHistoryExportQuery(params:URLSearchParams){
  const keys=[...params.keys()];if(keys.length!==new Set(keys).size||keys.some(key=>!['companyId',...PURCHASE_ORDER_HISTORY_FILTER_KEYS,'expected'].includes(key)))historyExportFail('invalid_request','Choose history filters without a page or offset.');
  const parsed=purchaseOrderHistoryExportRequest.safeParse({companyId:params.get('companyId'),filters:purchaseOrderHistoryFilterQuery(params),
    ...(params.has('expected')?{expected:params.get('expected')}:{})});
  if(!parsed.success)historyExportFail('invalid_request','Check the history export filters.');return parsed.data;
}
