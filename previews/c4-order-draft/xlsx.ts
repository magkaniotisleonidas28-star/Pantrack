import {buildSupplierOrderDraft, draftEstimateDisplay, draftStockDisplay, FICTIONAL_DRAFT_LABEL,
  type SupplierOrderDraft} from '../../src/lib/supplier-order-draft';

import {serializeDraftDocumentXlsx} from '../../src/lib/draft-document-xlsx';

/** A local fictional snapshot, not an authenticated or current-database export. */
export async function serializeSupplierDraftXlsx(draft: SupplierOrderDraft): Promise<Uint8Array> {
  const snapshot = buildSupplierOrderDraft(draft.lines.map(line => line.handoff), draft.group.companyId);
  if (JSON.stringify(snapshot) !== JSON.stringify(draft)) {
    throw new Error('Draft changed. Review its source again before exporting.');
  }
  const columns: [string, number][] = [
    ['Product', 28], ['Supplier SKU', 28], ['Whole packs', 16], ['Per pack', 22], ['Stock quantity', 24],
    ['Estimated line price', 30], ['Source warnings', 48], ['Review reasons', 34], ['Edit reason', 36],
    ['Proposal', 36], ['Revision', 16], ['Source status', 22], ['Source contract', 40], ['Stock dimension', 18],
    ['Exact minor units per pack', 38], ['Exact minor units total', 44], ['Estimate currency', 20],
    ['Estimated line minor units', 36], ['Company', 30], ['Supplier', 30], ['Account', 26], ['Location', 30],
    ['Sales source', 24], ['Sales status', 18], ['Draft label', 48], ['Draft warnings', 64],
  ];
  const g = snapshot.group;
  const lines = snapshot.lines.map(({handoff: h, stockQuantity}) => [
    h.productId, h.supplier.sku, h.packs, draftStockDisplay(h.stockUnitsPerPack), draftStockDisplay(stockQuantity),
    draftEstimateDisplay(h.estimatedLineTotal), JSON.stringify(h.warnings), JSON.stringify(h.reviewReasons),
    h.editReason ?? 'None', h.proposalId, String(h.revision), h.status, h.contract, h.stockUnitsPerPack.dimension,
    h.stockUnitsPerPack.minor, stockQuantity.minor, h.estimatedLineTotal?.currency ?? 'Unavailable',
    h.estimatedLineTotal?.minor ?? 'Unavailable', g.companyId, g.supplierId, g.accountId, g.locationId,
    h.salesReadiness.source, h.salesReadiness.status, snapshot.label, JSON.stringify(snapshot.warnings),
  ]);
  const summary: [string,string][] = [
    ['Company', g.companyId], ['Supplier', g.supplierId], ['Account', g.accountId], ['Location', g.locationId],
    ['Source', 'Immutable fictional proposal snapshot'], ['Line count', String(lines.length)],
    ...snapshot.warnings.map((value):[string,string] => ['Review warning', value]),
    ['Ordering status', 'No supplier submission, approval, reservation or inventory change is recorded.'],
    ['Spreadsheet editing', 'Editing this file does not update Pantrack. Expand long cells to read every note.'],
  ];
  return serializeDraftDocumentXlsx({label:FICTIONAL_DRAFT_LABEL,printLabel:'Fictional review draft - not an order.',
    creator:'Pantrack local draft preview',subject:'Immutable fictional proposal snapshot; estimates only. No order or inventory change.',
    columns,lines,summary});
}
