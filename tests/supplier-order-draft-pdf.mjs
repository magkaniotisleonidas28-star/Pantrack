import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {fixture} from './helpers/supplier-simulation.mjs';

const output = '.sites-runtime/supplier-order-draft-pdf-test';
mkdirSync(output, {recursive: true});
await build({stdin: {contents: "export * from './previews/c4-order-draft/pdf.ts'; export * from './src/lib/supplier-order-draft.ts'; export * from './previews/c4-order-draft/fixtures.ts';", resolveDir: process.cwd()},
  bundle: true, platform: 'node', format: 'esm', outfile: `${output}/module.mjs`});
const {serializeSupplierDraftPdf: pdf, buildSupplierOrderDraft: draft, fictionalDraftExamples, FICTIONAL_COMPANY,
  FICTIONAL_DRAFT_LABEL} = await import(`../${output}/module.mjs`);
const font = readFileSync('previews/c4-order-draft/assets/NotoSans-Regular.ttf');
const examples = fictionalDraftExamples();

// A separate PDF reader validates what a reader can extract, including page bounds and fonts.
async function inspect(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const task = getDocument({data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false});
  const document = await task.promise, pages = [];
  try {
    assert.equal((await document.getMetadata()).info.Title, FICTIONAL_DRAFT_LABEL);
    assert.equal(await document.getJSActions(), null);
    assert.equal(await document.getAttachments(), null);
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent({disableNormalization: true});
      const items = content.items.filter(item => 'str' in item && item.str.trim());
      const text = items.map(item => item.str).join('\n');
      assert.ok(text.includes(FICTIONAL_DRAFT_LABEL));
      assert.ok(text.includes(`Page ${n} of ${document.numPages}`));
      assert.ok(text.includes('Estimates only / no order recorded'));
      assert.deepEqual(await page.getAnnotations(), []);
      for (const item of items) {
        assert.ok(item.transform[4] >= 47 && item.transform[4] + item.width <= 565, `Text outside horizontal margins: ${item.str}`);
        assert.ok(item.transform[5] >= 42 && item.transform[5] <= 745, `Text outside vertical margins: ${item.str}`);
      }
      pages.push(text);
    }
    return pages;
  } finally {await task.destroy();}
}
const normal = draft(examples.normal, FICTIONAL_COMPANY), before = JSON.stringify(normal);
const bytes = await pdf(normal, font), normalPages = await inspect(bytes), normalText = normalPages.join('\n');
writeFileSync(`${output}/normal.pdf`, bytes);
for (const expected of [FICTIONAL_COMPANY, 'Fictional Orchard Supply', 'DEMO-ACCOUNT', 'Fictional NYC stockroom',
  'Café beans, "house"', 'DEMO-Café beans, "house"', 'revision 2', '3 whole packs', '2267.96185 g',
  '6803.88555 g', '18000 mL', '1500 each', 'USD 127.50 (estimate)', 'USD 73.50 (estimate)', 'USD 54.00 (estimate)',
  'review_required', ...normal.warnings]) {
  assert.ok(normalText.replace(/\s/gu, '').includes(expected.replace(/\s/gu, '')), `Missing PDF value: ${expected}`);
}
assert.equal(JSON.stringify(normal), before);
for (const [index, {handoff}] of normal.lines.entries()) {
  assert.ok(normalPages.some(page => page.includes(`Item ${index + 1}: ${handoff.productId}`) &&
    page.includes(`Supplier SKU: ${handoff.supplier.sku}`) && page.includes(`Sales source: ${handoff.salesReadiness.source}`)), 'Ordinary item details stay together.');
}
for (const page of normalPages) assert.equal((page.match(/Item \d+:/g) ?? []).length, (page.match(/Sales source:/g) ?? []).length);
const mutable = structuredClone(normal), pending = pdf(mutable, font);
mutable.lines[0].handoff.supplier.sku = 'CHANGED-WHILE-EXPORTING';
const capturedText = (await inspect(await pending)).join('\n');
assert.ok(!capturedText.includes('CHANGED-WHILE-EXPORTING'));
assert.ok(capturedText.includes(normal.lines[0].handoff.supplier.sku));
const missingBytes = await pdf(draft(examples.missing, FICTIONAL_COMPANY), font);
writeFileSync(`${output}/missing.pdf`, missingBytes);
const missingText = (await inspect(missingBytes)).join('\n');
assert.ok(missingText.includes('Estimated line price: Unavailable'));
assert.ok(missingText.includes('price_unavailable'));
assert.ok(!missingText.includes('USD 0.00'));
const h = examples.normal[0];
const large = {...h, packs: '999999999', limitPacks: {capacity: null, shelfLife: null, maximum: null},
  stockUnitsPerPack: {dimension: 'volume', minor: '999999999999999999999999999999'},
  estimatedLineTotal: {currency: 'JPY', minor: '9007199254740993'},
  estimatedProposalTotal: {currency: 'JPY', minor: '9007199254740993'}};
const largeText = (await inspect(await pdf(draft([large], FICTIONAL_COMPANY), font))).join('');
assert.ok(largeText.includes('999999998999999999999999999999000000001'));
assert.ok(largeText.includes('999999998999999999999999999999000.000001 mL'));
assert.ok(largeText.includes('JPY 9007199254740993 minor units (estimate)'));
const tricky = {...h, productId: 'Καφές Café Жито', supplier: {...h.supplier, sku: 'Long-SKU-' + 'X'.repeat(160) + '\n\t(quoted) \\ end'},
  editReason: 'Keep exact packs\u202e', editedBy: 'fictional-manager'};
const trickyPages = await inspect(await pdf(draft([tricky], FICTIONAL_COMPANY), font));
const trickyText = trickyPages.join('').replace(/\s/gu, '');
assert.ok(trickyText.includes('ΚαφέςCaféЖито'));
assert.ok(trickyText.includes('X'.repeat(160) + '\\n\\t(quoted)\\end'));
assert.ok(trickyText.includes('Keepexactpacks\\u202e'));
const oversized = {...h, warnings: [...h.warnings, 'Long review note '.repeat(250) + 'END-REVIEW']};
const oversizedPages = await inspect(await pdf(draft([oversized], FICTIONAL_COMPANY), font));
assert.ok(oversizedPages.length > 1);
assert.ok(oversizedPages.slice(1).some(page => page.includes('Item 1 (continued)')));
assert.ok(oversizedPages.join('\n').includes('END-REVIEW'));
const many = Array.from({length: 50}, (_, n) => ({...h, productId: `Product-${n}`, proposalId: `proposal-${n}`}));
const manyBytes = await pdf(draft(many, FICTIONAL_COMPANY), font), manyPages = await inspect(manyBytes);
assert.ok(manyPages.length > 10);
const manyText = manyPages.join('\n');
assert.equal((manyText.match(/Requested quantity: 3 whole packs/g) ?? []).length, 50);
assert.ok(manyText.includes('Product-49'));
await assert.rejects(pdf(draft([{...h, productId: 'Unsupported 😀'}], FICTIONAL_COMPANY), font), /font cannot display/);
await assert.rejects(pdf(normal, new Uint8Array([1, 2, 3])));
await assert.rejects(pdf({...normal, lines: [{...normal.lines[0], stockQuantity: {dimension: 'count', minor: '1'}}, ...normal.lines.slice(1)]}, font), /Draft changed/);
await assert.rejects(pdf({...normal, group: {...normal.group, companyId: 'foreign'}}, font));
await assert.rejects(pdf({...normal, warnings: []}, font), /Draft changed/);

// Actual durable v1/v2 handoffs: generating PDFs leaves every DB table and input unchanged.
const f = await fixture(), sources = [await f.source(), await f.source({clover: true})];
const tables = f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const snapshot = () => JSON.stringify(tables.map(({name}) => [name, f.sql.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all()]));
const databaseBefore = snapshot(), sourcesBefore = JSON.stringify(sources), oldFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = () => {calls++; throw Error('PDF generation must not make network calls.');};
try {
  const durable = draft(sources, 'a');
  for (let n = 0; n < 2; n++) {
    const text = (await inspect(await pdf(durable, font))).join('\n');
    assert.ok(text.includes('pantrack.replenishment-handoff.v1'));
    assert.ok(text.includes('pantrack.replenishment-handoff.v2'));
  }
  assert.equal(calls, 0);
  assert.equal(snapshot(), databaseBefore);
  assert.equal(JSON.stringify(sources), sourcesBefore);
} finally {globalThis.fetch = oldFetch; f.sql.close();}
console.log(`PASS: independently read PDF values, Unicode, exact large quantities, missing estimates, ${manyPages.length}-page maximum batch, safe failures, no network or durable mutations.`);
