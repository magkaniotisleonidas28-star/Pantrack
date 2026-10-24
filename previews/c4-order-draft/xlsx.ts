import {buildSupplierOrderDraft, draftEstimateDisplay, draftStockDisplay, FICTIONAL_DRAFT_LABEL,
  type SupplierOrderDraft} from '../../src/lib/supplier-order-draft';

/** A local fictional snapshot, not an authenticated or current-database export. */
export async function serializeSupplierDraftXlsx(draft: SupplierOrderDraft): Promise<Uint8Array> {
  const snapshot = buildSupplierOrderDraft(draft.lines.map(line => line.handoff), draft.group.companyId);
  if (JSON.stringify(snapshot) !== JSON.stringify(draft)) {
    throw new Error('Draft changed. Review its source again before exporting.');
  }
  function literal(value: string): string {
    // Some spreadsheet readers erase this reserved marker even after standard OOXML escaping.
    // Refuse an ambiguous export rather than issuing an identifier that a reader could change.
    if (/x005f_/i.test(value)) throw new Error('A draft field contains an unsupported Excel escape marker. Use the text or CSV export.');
    for (const character of value) {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) throw new Error('The draft contains invalid Unicode text. Use the text or CSV export.');
    }
    // Show controls/directional overrides visibly; ExcelJS would otherwise discard some controls.
    const visible = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ufffe\uffff]/gu,
      c => c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    // Escape literal OOXML escape sequences, so a SKU like _x000D_ survives Excel decoding.
    const encoded = visible.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`);
    if (encoded.length > 32767) throw new Error('A draft field exceeds the Excel cell limit. Use the text or CSV export.');
    return encoded;
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
  ].map(literal));
  const summary = [
    ['Company', g.companyId], ['Supplier', g.supplierId], ['Account', g.accountId], ['Location', g.locationId],
    ['Source', 'Immutable fictional proposal snapshot'], ['Line count', String(lines.length)],
    ...snapshot.warnings.map(value => ['Review warning', value]),
    ['Ordering status', 'No supplier submission, approval, reservation or inventory change is recorded.'],
    ['Spreadsheet editing', 'Editing this file does not update Pantrack. Expand long cells to read every note.'],
  ].map(row => row.map(literal));
  // Snapshot/field validation precedes the asynchronous, on-demand library load.
  const {default: ExcelJS} = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pantrack local draft preview';
  workbook.title = FICTIONAL_DRAFT_LABEL;
  workbook.subject = 'Immutable fictional proposal snapshot; estimates only. No order or inventory change.';
  function sheet(name: string, fields: [string, number][], rows: string[][]): void {
    const worksheet = workbook.addWorksheet(name, {views: [{state: 'frozen', xSplit: name === 'Lines' ? 2 : 0, ySplit: 5}],
      pageSetup: {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0},
      headerFooter: {oddHeader: '&LFictional review draft - not an order.', oddFooter: '&LEstimates only / no order recorded&RPage &P of &N'}});
    worksheet.columns = fields.map(([, width]) => ({width}));
    const span = Math.min(fields.length, 6);
    for (const [index, value] of [FICTIONAL_DRAFT_LABEL, 'Prices are estimates; supplier details and delivery remain unverified.',
      'Values are text to preserve exact quantities and identifiers. Expand long cells to read every note.'].entries()) {
      worksheet.mergeCells(index + 1, 1, index + 1, span);
      const row = worksheet.getRow(index + 1);
      row.getCell(1).value = value;
      row.getCell(1).font = {name: 'Calibri', size: index === 0 ? 14 : 11, bold: index === 0, color: {argb: 'FF244F3B'}};
      row.getCell(1).alignment = {vertical: 'middle', wrapText: true};
      row.height = index === 0 ? 32 : 38;
    }
    worksheet.getRow(5).values = fields.map(([title]) => title);
    worksheet.getRow(5).height = 36;
    worksheet.getRow(5).eachCell(cell => {
      cell.font = {name: 'Calibri', size: 11, bold: true, color: {argb: 'FFFFFFFF'}};
      cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF244F3B'}};
      cell.alignment = {vertical: 'middle', wrapText: true};
    });
    rows.forEach((values, index) => {
      const row = worksheet.addRow(values);
      row.height = Math.min(120, Math.max(44, ...values.map((value, i) => Math.ceil(value.length / fields[i][1]) * 16)));
      row.eachCell(cell => {
        // Assigning a string, rather than a formula/hyperlink object, keeps untrusted values literal.
        cell.numFmt = '@'; cell.font = {name: 'Calibri', size: 11, color: {argb: 'FF20372D'}};
        cell.alignment = {vertical: 'top', wrapText: true};
        if (index % 2 === 0) cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFF4F6F1'}};
      });
    });
    if (name === 'Lines') worksheet.autoFilter = `A5:${worksheet.getCell(worksheet.rowCount, fields.length).address}`;
  }
  sheet('Draft', [['Field', 26], ['Value', 100]], summary);
  sheet('Lines', columns, lines);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
