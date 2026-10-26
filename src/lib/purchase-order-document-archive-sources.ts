import {D1PurchaseOrderExports} from './d1-purchase-order-exports';
import {D1PurchaseOrderHistoryExports} from './d1-purchase-order-history-exports';
import {capturePurchaseOrderExport} from './purchase-order-export-contract';
import {verifyPurchaseOrderHistoryExport,historyExportFingerprint} from './purchase-order-history-export-contract';
import {archiveFail,archiveTemplate,type DocumentArchiveRequest,type DocumentArchiveManifest} from './purchase-order-document-archive-contract';
import {frozenCopy} from './supplier-simulation-contract';

export class D1DocumentArchiveSources{
  constructor(private readonly db:D1Database){}
  async load(request:DocumentArchiveRequest,actorId:string):Promise<unknown>{
    const identity=async()=>actorId,source=request.source;
    return source.kind==='draft'?new D1PurchaseOrderExports(this.db,{identity}).get({companyId:request.companyId,orderId:source.orderId,revision:source.revision}):
      new D1PurchaseOrderHistoryExports(this.db,{identity}).get({companyId:request.companyId,filters:source.filters,expected:source.fingerprint});
  }
}
export async function captureArchiveSource(request:DocumentArchiveRequest,value:unknown){
  if(request.source.kind==='draft'){
    const snapshot=capturePurchaseOrderExport(value);
    if(snapshot.draft.companyId!==request.companyId||snapshot.draft.id!==request.source.orderId||snapshot.revision!==request.source.revision)archiveFail('source_changed');
    return frozenCopy({kind:'draft' as const,snapshot,proof:{kind:'draft' as const,fingerprint:await historyExportFingerprint(snapshot),
      records:[{id:snapshot.draft.id,revision:snapshot.revision,status:snapshot.status}]},label:snapshot.label});
  }
  const snapshot=await verifyPurchaseOrderHistoryExport(value);
  if(snapshot.companyId!==request.companyId||snapshot.fingerprint!==request.source.fingerprint||JSON.stringify(snapshot.filters)!==JSON.stringify(request.source.filters))archiveFail('source_changed');
  return frozenCopy({kind:'history' as const,snapshot,proof:{kind:'history' as const,fingerprint:snapshot.fingerprint,
    records:snapshot.records.map(r=>({id:r.draft.id,revision:r.revision,status:r.status}))},label:snapshot.label});
}
export type CapturedArchiveSource=Awaited<ReturnType<typeof captureArchiveSource>>;
/** Reuse the existing trusted serializers; source snapshots and font bytes are captured by them. */
export async function renderDocumentArchive(source:CapturedArchiveSource,format:DocumentArchiveRequest['format'],template:DocumentArchiveManifest['template'],font:()=>Promise<Uint8Array>){
  if(template!==archiveTemplate(source.kind,format))archiveFail('generation_failed');
  if(source.kind==='draft'){
    const documents=await import('./purchase-order-documents');
    return format==='pdf'?documents.serializePurchaseOrderPdf(source.snapshot,await font()):documents.serializePurchaseOrderXlsx(source.snapshot);
  }
  const documents=await import('./purchase-order-history-documents');
  return format==='pdf'?documents.serializePurchaseOrderHistoryPdf(source.snapshot,await font()):documents.serializePurchaseOrderHistoryXlsx(source.snapshot);
}
