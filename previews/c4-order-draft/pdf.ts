import {serializeDraftDocumentPdf} from '../../src/lib/draft-document-pdf';
import {buildSupplierOrderDraft, draftEstimateDisplay, draftStockDisplay, FICTIONAL_DRAFT_LABEL,
  type SupplierOrderDraft} from '../../src/lib/supplier-order-draft';

/** Local fictional snapshot only; authentication and current-database reads are separate. */
export async function serializeSupplierDraftPdf(draft:SupplierOrderDraft,fontBytes:Uint8Array):Promise<Uint8Array>{
  const snapshot=buildSupplierOrderDraft(draft.lines.map(line=>line.handoff),draft.group.companyId);
  if(JSON.stringify(snapshot)!==JSON.stringify(draft))throw new Error('Draft changed. Review its source again before exporting.');
  const g=snapshot.group;
  return serializeDraftDocumentPdf({label:FICTIONAL_DRAFT_LABEL,title:'Supplier draft',
    subject:'Immutable fictional proposal snapshot; estimates only. No order or inventory change.',creator:'Pantrack local draft preview',
    context:[`Company: ${g.companyId}`,`Supplier: ${g.supplierId}`,`Account: ${g.accountId}`,`Location: ${g.locationId}`],
    items:snapshot.lines.map(({handoff:h,stockQuantity},index)=>({title:`Item ${index+1}: ${h.productId}`,rows:[
      {text:`Supplier SKU: ${h.supplier.sku}`},
      {text:`Proposal: ${h.proposalId} | revision ${h.revision}`},
      {text:`Source contract: ${h.contract} | status: ${h.status}`,size:9,tone:'muted'},
      {text:`Requested quantity: ${h.packs} whole packs`},
      {text:`Per pack: ${draftStockDisplay(h.stockUnitsPerPack)}`},
      {text:`Stock quantity: ${draftStockDisplay(stockQuantity)}`},
      {text:`Exact ${h.stockUnitsPerPack.dimension} minor units: ${h.stockUnitsPerPack.minor} per pack; ${stockQuantity.minor} total`,size:9,tone:'muted'},
      {text:`Estimated line price: ${draftEstimateDisplay(h.estimatedLineTotal)}`},
      {text:`Warnings: ${h.warnings.length?h.warnings.join(', '):'None'}`,size:9,tone:'warning'},
      {text:`Review reasons: ${h.reviewReasons.length?h.reviewReasons.join(', '):'None'}`,size:9,tone:'warning'},
      {text:`Edit reason: ${h.editReason??'None'}`,size:9,tone:'muted'},
      {text:`Sales source: ${h.salesReadiness.source} | ${h.salesReadiness.status}`,size:9,tone:'muted'},
    ]})),warnings:snapshot.warnings,closing:'No supplier submission, approval, reservation or inventory change is recorded.'},fontBytes);
}
