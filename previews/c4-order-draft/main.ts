import {buildSupplierOrderDraft, draftStockDisplay, draftEstimateDisplay,
  serializeSupplierDraftText, serializeSupplierDraftCsv, type SupplierOrderDraft} from '../../src/lib/supplier-order-draft';
import {FICTIONAL_COMPANY, fictionalDraftExamples} from './fixtures';
import {serializeSupplierDraftPdf} from './pdf';
import pdfFont from './assets/NotoSans-Regular.ttf';

function element<T = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing preview element: ${id}`);
  return found as unknown as T;
}
const example = element<HTMLSelectElement>('example');
const copy = element<HTMLButtonElement>('copy'), download = element<HTMLButtonElement>('download');
const pdfDownload = element<HTMLButtonElement>('download-pdf');
const status = element('status'), error = element('error'), content = element('draft');
const text = element<HTMLTextAreaElement>('text-export'), textPanel = element<HTMLDetailsElement>('text-panel');
let current: SupplierOrderDraft | null = null;
let generation = 0;
function node(tag: string, value: string, className = ''): HTMLElement {
  const item = document.createElement(tag); item.textContent = value; item.className = className; return item;
}
function facts(rows: [string, string][]): HTMLElement {
  const list = document.createElement('dl');
  rows.forEach(([key, value]) => {list.appendChild(node('dt', key)); list.appendChild(node('dd', value));});
  return list;
}
function clear(): void {
  generation++; current = null; content.replaceChildren(); text.value = '';
  copy.disabled = true; download.disabled = true; textPanel.hidden = true; textPanel.open = false;
  pdfDownload.disabled = true; pdfDownload.textContent = 'Download PDF'; pdfDownload.removeAttribute('aria-busy');
  error.hidden = true; error.textContent = ''; status.textContent = '';
}
function review(): void {
  clear();
  try {
    const examples = fictionalDraftExamples();
    current = buildSupplierOrderDraft(examples[example.value as keyof typeof examples], FICTIONAL_COMPANY);
    const refs = node('div', '', 'references');
    refs.appendChild(facts(Object.entries(current.group).map(([key, value]) => [key.replace('Id', ''), value])));
    const lines = node('div', '', 'lines');
    for (const {handoff: h, stockQuantity} of current.lines) {
      const card = node('article', '');
      card.appendChild(node('h2', h.productId)); card.appendChild(facts([
        ['Supplier SKU', h.supplier.sku], ['Proposal', `${h.proposalId} · revision ${h.revision}`],
        ['Whole packs', h.packs], ['Per pack', draftStockDisplay(h.stockUnitsPerPack)],
        ['Stock quantity', draftStockDisplay(stockQuantity)],
        ['Estimated line price', draftEstimateDisplay(h.estimatedLineTotal)],
      ]));
      const warnings = document.createElement('ul');
      h.warnings.forEach(warning => warnings.appendChild(node('li', warning.replace(/_/g, ' '))));
      card.appendChild(warnings); lines.appendChild(card);
    }
    const notes = node('aside', '', 'warnings'); notes.appendChild(node('h2', 'Review warnings'));
    current.warnings.forEach(warning => notes.appendChild(node('p', warning)));
    content.appendChild(refs); content.appendChild(lines); content.appendChild(notes); text.value = serializeSupplierDraftText(current);
    copy.disabled = false; download.disabled = false; textPanel.hidden = false;
    pdfDownload.disabled = false;
    status.textContent = 'Fictional draft ready for review. Exporting records no order or stock change.';
  } catch {
    error.textContent = 'Draft unavailable: the source is invalid, changed, canceled, duplicated or outside the selected company/supplier/account/location. Review the source before exporting.';
    error.hidden = false;
  }
}
example.addEventListener('change', () => {clear(); status.textContent = 'Select Review example to inspect this source.';});
element('review').addEventListener('click', review);
element('reset').addEventListener('click', () => {example.value = 'normal'; review(); status.textContent = 'Reset to the normal fictional draft.';});
copy.addEventListener('click', async () => {
  if (!current) return;
  const requestGeneration = generation;
  try {
    await navigator.clipboard.writeText(serializeSupplierDraftText(current));
    if (requestGeneration === generation) status.textContent = 'Fictional draft copied. No order recorded.';
  } catch {
    if (requestGeneration !== generation) return;
    textPanel.open = true; text.focus(); text.select();
    status.textContent = 'Clipboard access unavailable. Copy the selected draft text manually.';
  }
});
download.addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([serializeSupplierDraftCsv(current)], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = 'pantrack-fictional-review-draft.csv';
  document.body.appendChild(link); link.click(); document.body.removeChild(link); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Fictional CSV downloaded. Prices remain estimates; no order recorded.';
});
pdfDownload.addEventListener('click', async () => {
  if (!current || pdfDownload.disabled) return;
  const requestGeneration = generation;
  pdfDownload.disabled = true; pdfDownload.textContent = 'Preparing PDF…'; pdfDownload.setAttribute('aria-busy', 'true');
  error.hidden = true; error.textContent = '';
  status.textContent = 'Preparing the fictional draft PDF…';
  try {
    const bytes = await serializeSupplierDraftPdf(current, pdfFont);
    if (requestGeneration !== generation) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: 'application/pdf'}));
    const link = document.createElement('a'); link.href = url; link.download = 'pantrack-fictional-review-draft.pdf';
    document.body.appendChild(link);
    try {link.click();} finally {link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);}
    status.textContent = 'Fictional PDF downloaded. Prices remain estimates; no order recorded.';
  } catch (failure) {
    if (requestGeneration !== generation) return;
    error.textContent = failure instanceof Error ? `PDF unavailable: ${failure.message}` : 'PDF unavailable. Try again or use the text or CSV export.';
    error.hidden = false; status.textContent = '';
  } finally {
    if (requestGeneration === generation) {
      pdfDownload.disabled = current === null; pdfDownload.textContent = 'Download PDF'; pdfDownload.removeAttribute('aria-busy');
    }
  }
});
review();
