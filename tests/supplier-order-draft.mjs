import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';

mkdirSync('.sites-runtime', {recursive:true});
await build({stdin:{contents:"export * from './src/lib/supplier-order-draft.ts'; export * from './previews/c4-order-draft/fixtures.ts';", resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/supplier-order-draft-test.mjs'});
const {buildSupplierOrderDraft: draft, serializeSupplierDraftText: text, serializeSupplierDraftCsv: csv,
  draftStockDisplay, draftEstimateDisplay, fictionalDraftExamples, FICTIONAL_COMPANY, FICTIONAL_DRAFT_LABEL} = await import('../.sites-runtime/supplier-order-draft-test.mjs');
const examples = fictionalDraftExamples(), normal = draft(examples.normal, FICTIONAL_COMPANY);
assert.equal(normal.label, FICTIONAL_DRAFT_LABEL);
assert.deepEqual(normal.lines.map(l=>l.handoff.packs), ['3','3','3']);
for (const line of normal.lines) {
  const source = examples.normal.find(h=>h.proposalId===line.handoff.proposalId);
  assert.deepEqual(line.handoff,source, 'The entire immutable handoff, including revision, SKU, quantity, conversions and estimates, is preserved.');
  assert.equal(line.stockQuantity.minor,(BigInt(source.packs)*BigInt(source.stockUnitsPerPack.minor)).toString());
  assert.ok(Object.isFrozen(line.handoff.supplier) && Object.isFrozen(line.stockQuantity));
}
assert.equal(draftStockDisplay({dimension:'mass',minor:'6803885550'}),'6803.88555 g');
assert.equal(draftStockDisplay({dimension:'volume',minor:'1'}),'0.000001 mL');
assert.equal(draftStockDisplay({dimension:'count',minor:'9007199254740993'}),'9007199254740993 each');
assert.equal(draftEstimateDisplay({currency:'USD',minor:'1'}),'USD 0.01 (estimate)');
assert.equal(draftEstimateDisplay({currency:'JPY',minor:'100'}),'JPY 100 minor units (estimate)');
assert.equal(draftEstimateDisplay(null),'Unavailable');
assert.equal(csv(normal),csv(draft([...examples.normal].reverse(),FICTIONAL_COMPANY)));
assert.equal(text(normal),text(draft(structuredClone(examples.normal),FICTIONAL_COMPANY)));
const mutable=structuredClone(examples.normal), cloned=draft(mutable,FICTIONAL_COMPANY);
mutable[0].supplier.sku='changed'; assert.notEqual(cloned.lines.find(l=>l.handoff.productId==='Oat milk').handoff.supplier.sku,'changed');
const missing=draft(examples.missing,FICTIONAL_COMPANY);
assert.ok(text(missing).includes('Estimated line price: Unavailable'));
assert.ok(csv(missing).includes('"Unavailable","Unavailable","Unavailable"'));
assert.ok(!text(missing).includes('USD 0.00'));
const h=examples.normal[0];
for (const values of [[],Array(51).fill(h),examples.invalid,[h,h],
  [h,{...h,proposalId:'other'}], [h,{...h,productId:'other'}],
  [{...h,packs:'0'}],[{...h,packs:'1.5'}],[{...h,packs:'03'}],[{...h,packs:'-1'}],
  [{...h,status:'canceled'}],[{...h,status:'unknown'}],[{...h,companyId:'foreign'}],
  [{...h,supplierSubmissionAllowed:true}],[{...h,stockUnitsPerPack:{dimension:'volume',minor:'0'}}],
  ...['supplierId','accountId','locationId'].map(key=>[h,{...examples.normal[1],supplier:{...examples.normal[1].supplier,[key]:'foreign'}}]),
]) assert.throws(()=>draft(values,FICTIONAL_COMPANY),e=>e.code==='invalid_request');
assert.throws(()=>draft([h],''));
assert.throws(()=>draft([h],'foreign'));

// Independent CSV reader exercises escaped quotes, commas, Unicode and embedded newlines.
function rows(value) {
  const result=[];let row=[],cell='',quoted=false;
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(c==='"'){if(quoted&&value[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&c===','){row.push(cell);cell='';}
    else if(!quoted&&c==='\r'&&value[i+1]==='\n'){row.push(cell);result.push(row);row=[];cell='';i++;}
    else cell+=c;
  }
  assert.equal(quoted,false);assert.deepEqual(row,[]);return result;
}
const parsed=rows(csv(normal)),headers=parsed[0];
assert.equal(parsed.length,4);
assert.equal(parsed[1][headers.indexOf('product')],'Café beans, "house"');
for(const line of parsed.slice(1))assert.equal(line.length,headers.length);
for(const prefix of ['=1+1','+SUM(1,2)','-2+1','@SUM(1,2)','  =1+1','\t=1+1','\r\n+1','\tplain']){
  const tricky={...h,supplier:{...h.supplier,sku:prefix},editReason:prefix+' reviewed',editedBy:'fictional-manager'};
  const output=rows(csv(draft([tricky],FICTIONAL_COMPANY)))[1];
  assert.equal(output[headers.indexOf('sku')],"'"+prefix);
  assert.equal(output[headers.indexOf('edit_reason')],"'"+prefix+' reviewed');
}
const multiline={...h,supplier:{...h.supplier,sku:'Café, "beans"\nsecond line'}};
assert.equal(rows(csv(draft([multiline],FICTIONAL_COMPANY)))[1][headers.indexOf('sku')],multiline.supplier.sku);

// Real v1/v2 producer output and full DB snapshots demonstrate exports have no durable side effects.
const f=await fixture(),v1=await f.source(),v2=await f.source({clover:true});
const tables=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const snapshot=()=>JSON.stringify(tables.map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name.replace(/"/g,'""')}"`).all()]));
const before=snapshot(),sourceBefore=JSON.stringify([v1,v2]);
const oldFetch=globalThis.fetch;let calls=0;
globalThis.fetch=()=>{calls++;throw Error('Exports must not contact any provider.');};
try {
  const output=draft([v1,v2],'a');
  assert.equal(output.lines[1].handoff.contract,'pantrack.replenishment-handoff.v2');
  for(let i=0;i<3;i++){text(output);csv(output);}
  assert.equal(calls,0);assert.equal(snapshot(),before);assert.equal(JSON.stringify([v1,v2]),sourceBefore);
} finally {globalThis.fetch=oldFetch;f.sql.close();}
// Exact integers beyond JS number precision remain exact, including the aggregate stock quantity.
const large={...h,packs:'999999999',limitPacks:{capacity:null,shelfLife:null,maximum:null},stockUnitsPerPack:{dimension:'volume',minor:'999999999999999999999999999999'}};
const largeDraft=draft([large],FICTIONAL_COMPANY);
assert.equal(largeDraft.lines[0].stockQuantity.minor,'999999998999999999999999999999000000001');
console.log('PASS: immutable v1/v2 drafts, exact quantities, deterministic exports, source/group isolation, missing prices, Unicode/CSV/formula escaping and unchanged database/source snapshots.');
