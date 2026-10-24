import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';
import {readXlsx, lineRecords, descendants} from './helpers/xlsx-reader.mjs';

const output = '.sites-runtime/supplier-order-draft-xlsx-test';
mkdirSync(output, {recursive: true});
await build({stdin: {contents: "export * from './previews/c4-order-draft/xlsx.ts'; export * from './src/lib/supplier-order-draft.ts'; export * from './previews/c4-order-draft/fixtures.ts';", resolveDir: process.cwd()},
  bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: `${output}/module.mjs`});
const {serializeSupplierDraftXlsx: xlsx, buildSupplierOrderDraft: draft, fictionalDraftExamples, FICTIONAL_COMPANY,
  FICTIONAL_DRAFT_LABEL} = await import(`../${output}/module.mjs`);
const examples = fictionalDraftExamples(), normal = draft(examples.normal, FICTIONAL_COMPANY), before = JSON.stringify(normal);
const bytes = await xlsx(normal), workbook = readXlsx(bytes), records = lineRecords(workbook);
writeFileSync(`${output}/normal.xlsx`, bytes);
assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ['Draft', 'Lines']);
for (const sheet of workbook.sheets) {
  assert.equal(sheet.cells.get('A1').value, FICTIONAL_DRAFT_LABEL);
  assert.equal(descendants(sheet.document, 'pane')[0].attributes.ySplit, '5');
  assert.ok(sheet.cells.get('A3').value.includes('Values are text'));
}
const linesSheet = workbook.sheets[1];
assert.equal(descendants(linesSheet.document, 'pane')[0].attributes.xSplit, '2');
assert.equal(descendants(linesSheet.document, 'autoFilter')[0].attributes.ref, 'A5:Z8');
assert.equal(records.length, 3);
assert.deepEqual(records.map(row => row.Product), ['Café beans, "house"', 'Oat milk', 'Paper cups']);
assert.deepEqual(records.map(row => row['Whole packs']), ['3', '3', '3']);
assert.deepEqual(records.map(row => row['Stock quantity']), ['6803.88555 g', '18000 mL', '1500 each']);
assert.deepEqual(records.map(row => row['Estimated line price']), ['USD 127.50 (estimate)', 'USD 73.50 (estimate)', 'USD 54.00 (estimate)']);
assert.equal(records[0]['Per pack'], '2267.96185 g');
assert.equal(records[0]['Exact minor units per pack'], '2267961850');
assert.equal(records[0]['Exact minor units total'], '6803885550');
const styles = descendants(workbook.documents.get('xl/styles.xml'), 'cellXfs')[0].children;
for (const [index, record] of records.entries()) {
  const source = normal.lines[index].handoff;
  assert.equal(record.Company, FICTIONAL_COMPANY);
  assert.equal(record.Supplier, 'Fictional Orchard Supply');
  assert.equal(record.Account, 'DEMO-ACCOUNT');
  assert.equal(record.Location, 'Fictional NYC stockroom');
  assert.equal(record.Revision, '2');
  assert.equal(record['Source status'], source.status);
  assert.equal(record.Proposal, source.proposalId);
  assert.equal(record['Supplier SKU'], source.supplier.sku);
  assert.equal(record['Source contract'], source.contract);
  assert.deepEqual(JSON.parse(record['Source warnings']), source.warnings);
  assert.deepEqual(JSON.parse(record['Review reasons']), source.reviewReasons);
  assert.deepEqual(JSON.parse(record['Draft warnings']), normal.warnings);
  assert.equal(record['Draft label'], FICTIONAL_DRAFT_LABEL);
}
for (const [address, cell] of linesSheet.cells) {
  if (Number(address.match(/\d+$/)[0]) > 5) assert.equal(styles[cell.style].attributes.numFmtId, '49', 'Text format preserves precision on open.');
}
assert.equal(JSON.stringify(normal), before);
assert.deepEqual(lineRecords(readXlsx(await xlsx(draft([...examples.normal].reverse(), FICTIONAL_COMPANY)))), records);
const mutable = structuredClone(normal), pending = xlsx(mutable);
mutable.lines[0].handoff.supplier.sku = 'CHANGED-WHILE-EXPORTING';
assert.equal(lineRecords(readXlsx(await pending))[0]['Supplier SKU'], normal.lines[0].handoff.supplier.sku);
const missingBytes = await xlsx(draft(examples.missing, FICTIONAL_COMPANY));
writeFileSync(`${output}/missing.xlsx`, missingBytes);
const missing = lineRecords(readXlsx(missingBytes)).find(row => row.Product === 'Paper cups');
for (const key of ['Estimated line price', 'Estimate currency', 'Estimated line minor units']) assert.equal(missing[key], 'Unavailable');
assert.ok(missing['Source warnings'].includes('price_unavailable'));
const h = examples.normal[0];
const large = {...h, packs: '999999999', limitPacks: {capacity: null, shelfLife: null, maximum: null},
  stockUnitsPerPack: {dimension: 'volume', minor: '999999999999999999999999999999'},
  estimatedLineTotal: {currency: 'JPY', minor: '9007199254740993'}, estimatedProposalTotal: {currency: 'JPY', minor: '9007199254740993'}};
const largeBytes = await xlsx(draft([large], FICTIONAL_COMPANY)), largeRecord = lineRecords(readXlsx(largeBytes))[0];
writeFileSync(`${output}/large.xlsx`, largeBytes);
assert.equal(largeRecord['Exact minor units total'], '999999998999999999999999999999000000001');
assert.equal(largeRecord['Stock quantity'], '999999998999999999999999999999000.000001 mL');
assert.equal(largeRecord['Estimated line minor units'], '9007199254740993');
assert.equal(largeRecord['Estimated line price'], 'JPY 9007199254740993 minor units (estimate)');
for (const value of ['=1+1', '+SUM(A1:A3)', '-2+1', '@SUM(A1:A3)', '  =1+1', '=HYPERLINK("https://example.test","click")',
  '00000000000000000001', '_x000D_ _x0041_ _x00df_', 'Καφές Café Жито 茶 😀', 'Café, "beans" & <tag>']) {
  const record = lineRecords(readXlsx(await xlsx(draft([{...h, supplier: {...h.supplier, sku: value}}], FICTIONAL_COMPANY))))[0];
  assert.equal(record['Supplier SKU'], value);
}
const controlled = {...h, supplier: {...h.supplier, sku: 'SKU\n\t\r\u0000\u007f\u202e\uffff'}};
assert.equal(lineRecords(readXlsx(await xlsx(draft([controlled], FICTIONAL_COMPANY))))[0]['Supplier SKU'], 'SKU\\n\\t\\r\\u0000\\u007f\\u202e\\uffff');
const many = Array.from({length: 50}, (_, n) => ({...h, productId: `Product-${n}`, proposalId: `proposal-${n}`}));
const manyRecords = lineRecords(readXlsx(await xlsx(draft(many, FICTIONAL_COMPANY))));
assert.equal(manyRecords.length, 50);
assert.equal(new Set(manyRecords.map(row => row.Proposal)).size, 50);
const maximum = {...h, editReason: 'E'.repeat(32767), editedBy: 'fictional-manager'};
assert.equal(lineRecords(readXlsx(await xlsx(draft([maximum], FICTIONAL_COMPANY))))[0]['Edit reason'].length, 32767);
await assert.rejects(xlsx(draft([{...maximum, editReason: 'E'.repeat(32768)}], FICTIONAL_COMPANY)), /Excel cell limit/);
await assert.rejects(xlsx(draft([{...h, supplier: {...h.supplier, sku: 'Bad\ud800'}}], FICTIONAL_COMPANY)), /invalid Unicode/);
for (const sku of ['_x005F_', '_x005f_', 'SKU-x005F_']) {
  await assert.rejects(xlsx(draft([{...h, supplier: {...h.supplier, sku}}], FICTIONAL_COMPANY)), /unsupported Excel escape marker/);
}
await assert.rejects(xlsx({...normal, warnings: []}), /Draft changed/);
await assert.rejects(xlsx({...normal, lines: [{...normal.lines[0], stockQuantity: {dimension: 'count', minor: '1'}}, ...normal.lines.slice(1)]}), /Draft changed/);
await assert.rejects(xlsx({...normal, group: {...normal.group, companyId: 'foreign'}}));

const f = await fixture(), sources = [await f.source(), await f.source({clover: true})];
const tables = f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const snapshot = () => JSON.stringify(tables.map(({name}) => [name, f.sql.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all()]));
const databaseBefore = snapshot(), sourcesBefore = JSON.stringify(sources), oldFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = () => {calls++; throw Error('Workbook generation must not make network calls.');};
try {
  for (let n = 0; n < 2; n++) {
    const records = lineRecords(readXlsx(await xlsx(draft(sources, 'a'))));
    assert.deepEqual(new Set(records.map(row => row['Source contract'])), new Set(['pantrack.replenishment-handoff.v1', 'pantrack.replenishment-handoff.v2']));
  }
  assert.equal(calls, 0); assert.equal(snapshot(), databaseBefore); assert.equal(JSON.stringify(sources), sourcesBefore);
} finally {globalThis.fetch = oldFetch; f.sql.close();}
console.log('PASS: independently inspected native XLSX, exact text values, frozen/filterable headers, estimates, formula/Unicode/control escaping, 50 lines, explicit cell limits and unchanged v1/v2 sources/database with zero network calls.');
