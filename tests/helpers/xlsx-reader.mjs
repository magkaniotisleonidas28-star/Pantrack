import assert from 'node:assert/strict';
import {unzipSync, strFromU8} from 'fflate';
import {SaxesParser} from 'saxes';

// Small independent OOXML inspector for generated exports, not a general spreadsheet importer.
function xml(source) {
  const parser = new SaxesParser(), stack = [];
  let root;
  parser.on('opentag', tag => {
    const node = {name: tag.name, attributes: tag.attributes, children: [], text: ''};
    if (stack.length) stack.at(-1).children.push(node); else root = node;
    stack.push(node);
  });
  parser.on('text', text => {if (stack.length) stack.at(-1).text += text;});
  parser.on('closetag', () => stack.pop());
  parser.write(source).close();
  return root;
}
export function descendants(node, name) {
  return [...(node.name === name ? [node] : []), ...node.children.flatMap(child => descendants(child, name))];
}
const text = node => node.text + node.children.map(text).join('');
export function readXlsx(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString(), 'PK', 'Native zipped XLSX, not renamed CSV.');
  const zip = unzipSync(bytes), documents = new Map();
  for (const [name, value] of Object.entries(zip)) {
    assert.ok(!/vba|externalLinks|embeddings|calcChain/i.test(name), `Unexpected active/external part: ${name}`);
    if (name.endsWith('.xml') || name.endsWith('.rels')) documents.set(name, xml(strFromU8(value)));
  }
  assert.ok(documents.has('[Content_Types].xml'));
  for (const node of documents.values()) {
    assert.equal(descendants(node, 'f').length, 0, 'No formulas.');
    assert.equal(descendants(node, 'hyperlink').length, 0, 'No clickable links.');
    assert.ok(descendants(node, 'Relationship').every(item => item.attributes.TargetMode !== 'External'));
  }
  const strings = descendants(documents.get('xl/sharedStrings.xml'), 'si').map(node =>
    text(node).replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
  const sheets = descendants(documents.get('xl/workbook.xml'), 'sheet').map((sheet, index) => {
    const document = documents.get(`xl/worksheets/sheet${index + 1}.xml`), cells = new Map();
    for (const cell of descendants(document, 'c')) {
      const value = cell.children.find(child => child.name === 'v');
      if (!value) continue;
      assert.equal(cell.attributes.t, 's', `Populated cells must be literal strings: ${cell.attributes.r}`);
      cells.set(cell.attributes.r, {value: strings[Number(value.text)], style: Number(cell.attributes.s ?? 0)});
    }
    return {name: sheet.attributes.name, document, cells};
  });
  return {documents, sheets};
}
export function lineRecords(workbook) {
  const {cells, document} = workbook.sheets.find(sheet => sheet.name === 'Lines');
  const headers = [...cells].filter(([address]) => /^[A-Z]+5$/.test(address));
  return descendants(document, 'row').filter(row => Number(row.attributes.r) > 5).map(row =>
    Object.fromEntries(headers.map(([address, cell]) => [cell.value, cells.get(address.replace(/5$/, row.attributes.r))?.value])));
}
