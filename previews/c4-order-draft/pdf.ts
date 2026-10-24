import {PDFDocument, PageSizes, rgb, type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {buildSupplierOrderDraft, draftEstimateDisplay, draftStockDisplay, FICTIONAL_DRAFT_LABEL,
  type SupplierOrderDraft} from '../../src/lib/supplier-order-draft';

/** Local fictional snapshot export only. This does not authenticate or re-read durable sources. */
export async function serializeSupplierDraftPdf(draft: SupplierOrderDraft, fontBytes: Uint8Array): Promise<Uint8Array> {
  // Take and validate the complete immutable projection before the first asynchronous operation.
  const snapshot = buildSupplierOrderDraft(draft.lines.map(line => line.handoff), draft.group.companyId);
  if (JSON.stringify(snapshot) !== JSON.stringify(draft)) {
    throw new Error('Draft changed. Review its source again before exporting.');
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, {subset: true});
  const characters = new Set(font.getCharacterSet());
  const ink = rgb(0.12, 0.22, 0.17), muted = rgb(0.29, 0.36, 0.32), warning = rgb(0.48, 0.22, 0.08);
  const [width, height] = PageSizes.Letter, margin = 48, available = width - margin * 2;
  let page: PDFPage, y = 0, continuation: string | null = null;
  pdf.setTitle(FICTIONAL_DRAFT_LABEL);
  pdf.setSubject('Immutable fictional proposal snapshot; estimates only. No order or inventory change.');
  pdf.setCreator('Pantrack local draft preview');
  pdf.setLanguage('en');

  function newPage(): void {
    page = pdf.addPage(PageSizes.Letter);
    page.drawText('PANTRACK / DRAFT REVIEW', {x: margin, y: height - 48, size: 10, font, color: muted});
    page.drawText('Supplier draft', {x: margin, y: height - 75, size: 20, font, color: ink});
    page.drawText(FICTIONAL_DRAFT_LABEL, {x: margin, y: height - 96, size: 11, font, color: warning});
    page.drawLine({start: {x: margin, y: height - 108}, end: {x: width - margin, y: height - 108},
      thickness: 0.7, color: rgb(0.76, 0.81, 0.77)});
    y = height - 130;
  }
  // Show controls/directional overrides literally, rather than hiding or executing their layout effects.
  function visible(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu,
      c => c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
  function wrap(value: string, size: number): string[] {
    const result: string[] = [];
    let line = '';
    for (const c of visible(value)) {
      if (!characters.has(c.codePointAt(0)!)) {
        throw new Error('This draft contains characters the PDF font cannot display. Use the text or CSV export.');
      }
      if (font.widthOfTextAtSize(line + c, size) > available) {
        const space = line.lastIndexOf(' ');
        if (space > 0) {result.push(line.slice(0, space)); line = line.slice(space + 1);}
        else {result.push(line); line = '';}
      }
      line += c;
    }
    result.push(line);
    return result;
  }
  function paragraph(value: string, size = 10, color = ink): void {
    for (const line of wrap(value, size)) {
      if (y < 78) {
        newPage();
        if (continuation) {page.drawText(continuation, {x: margin, y, size: 10, font, color: muted}); y -= 20;}
      }
      page.drawText(line, {x: margin, y, size, font, color});
      y -= size + 4;
    }
  }
  function heading(value: string): void {
    if (y < 135) newPage();
    else y -= 10;
    paragraph(value, 12);
    y -= 4;
  }
  newPage();
  paragraph(`Company: ${snapshot.group.companyId}`);
  paragraph(`Supplier: ${snapshot.group.supplierId}`);
  paragraph(`Account: ${snapshot.group.accountId}`);
  paragraph(`Location: ${snapshot.group.locationId}`);
  for (const [index, {handoff: h, stockQuantity}] of snapshot.lines.entries()) {
    const title = `Item ${index + 1}: ${h.productId}`;
    const rows: [string, number, typeof ink][] = [
      [`Supplier SKU: ${h.supplier.sku}`, 10, ink],
      [`Proposal: ${h.proposalId} | revision ${h.revision}`, 10, ink],
      [`Source contract: ${h.contract} | status: ${h.status}`, 9, muted],
      [`Requested quantity: ${h.packs} whole packs`, 10, ink],
      [`Per pack: ${draftStockDisplay(h.stockUnitsPerPack)}`, 10, ink],
      [`Stock quantity: ${draftStockDisplay(stockQuantity)}`, 10, ink],
      [`Exact ${h.stockUnitsPerPack.dimension} minor units: ${h.stockUnitsPerPack.minor} per pack; ${stockQuantity.minor} total`, 9, muted],
      [`Estimated line price: ${draftEstimateDisplay(h.estimatedLineTotal)}`, 10, ink],
      [`Warnings: ${h.warnings.length ? h.warnings.join(', ') : 'None'}`, 9, warning],
      [`Review reasons: ${h.reviewReasons.length ? h.reviewReasons.join(', ') : 'None'}`, 9, warning],
      [`Edit reason: ${h.editReason ?? 'None'}`, 9, muted],
      [`Sales source: ${h.salesReadiness.source} | ${h.salesReadiness.status}`, 9, muted],
    ];
    const blockHeight = 14 + wrap(title, 12).length * 16 + rows.reduce((sum, [value, size]) => sum + wrap(value, size).length * (size + 4), 0);
    // Keep an ordinary item together. Oversized items wrap across pages with an explicit continuation.
    if (blockHeight <= height - 208 && y - blockHeight < 78) newPage();
    continuation = `Item ${index + 1} (continued)`;
    heading(title);
    rows.forEach(([value, size, color]) => paragraph(value, size, color));
  }
  continuation = null;
  heading('Review before any separate ordering');
  snapshot.warnings.forEach(value => paragraph(value, 10, warning));
  paragraph('No supplier submission, approval, reservation or inventory change is recorded.', 10, warning);
  const pages = pdf.getPages();
  for (const [index, item] of pages.entries()) {
    item.drawText('Estimates only / no order recorded', {x: margin, y: 43, size: 9, font, color: muted});
    const number = `Page ${index + 1} of ${pages.length}`;
    item.drawText(number, {x: width - margin - font.widthOfTextAtSize(number, 9), y: 43, size: 9, font, color: muted});
  }
  return pdf.save();
}
