import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {exportFixture,core} from './helpers/purchase-order-export.mjs';
import {readXlsx,lineRecords,descendants} from './helpers/xlsx-reader.mjs';

const output='.sites-runtime/purchase-order-documents-test';mkdirSync(output,{recursive:true});
await build({stdin:{contents:"export * from './src/lib/purchase-order-documents.ts'; export * from './src/lib/purchase-order-export-contract.ts';",resolveDir:process.cwd()},
  bundle:true,packages:'external',platform:'node',format:'esm',outfile:`${output}/module.mjs`});
const {serializePurchaseOrderPdf:pdf,serializePurchaseOrderXlsx:xlsx,capturePurchaseOrderExport:capture}=await import(`../${output}/module.mjs`);
const font=readFileSync('previews/c4-order-draft/assets/NotoSans-Regular.ttf');
const compact=text=>text.replace(/\s/gu,'');
async function inspectPdf(bytes,saved){
  assert.equal(Buffer.from(bytes.subarray(0,5)).toString(),'%PDF-');
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isEvalSupported:false});
  const document=await task.promise,pages=[];
  try{
    assert.equal((await document.getMetadata()).info.Title,saved.label);
    assert.equal(await document.getJSActions(),null);assert.equal(await document.getAttachments(),null);
    for(let n=1;n<=document.numPages;n++){
      const page=await document.getPage(n),content=await page.getTextContent({disableNormalization:true});
      const items=content.items.filter(item=>'str' in item&&item.str.trim()),text=items.map(item=>item.str).join('\n');
      assert.ok(text.includes(saved.label));assert.ok(text.includes(`PO ${saved.draft.number} | revision ${saved.revision}`));
      assert.ok(text.includes(`Page ${n} of ${document.numPages}`));assert.deepEqual(await page.getAnnotations(),[]);
      for(const item of items){
        assert.ok(item.transform[4]>=47&&item.transform[4]+item.width<=565,`PDF horizontal bounds: ${item.str}`);
        assert.ok(item.transform[5]>=42&&item.transform[5]<=745,`PDF vertical bounds: ${item.str}`);
      }
      pages.push(text);
    }
    return pages;
  }finally{await task.destroy();}
}
function inspectWorkbook(bytes,saved){
  const workbook=readXlsx(bytes),rows=lineRecords(workbook);
  assert.deepEqual(workbook.sheets.map(sheet=>sheet.name),['Draft','Lines']);
  for(const sheet of workbook.sheets){assert.equal(sheet.cells.get('A1').value,saved.label);assert.equal(descendants(sheet.document,'pane')[0].attributes.ySplit,'5');}
  assert.equal(descendants(workbook.sheets[1].document,'pane')[0].attributes.xSplit,'2');
  assert.ok(descendants(workbook.sheets[1].document,'autoFilter')[0]);
  const styles=descendants(workbook.documents.get('xl/styles.xml'),'cellXfs')[0].children;
  for(const sheet of workbook.sheets)for(const [address,cell] of sheet.cells){
    if(Number(address.match(/\d+$/)[0])>5)assert.equal(styles[cell.style].attributes.numFmtId,'49');
  }
  assert.equal(rows.length,saved.draft.lines.length);
  for(const [index,row] of rows.entries()){
    const line=saved.draft.lines[index];assert.equal(row['Line ID'],line.id);assert.equal(row.Kind,line.kind);
    assert.equal(row.Company,saved.draft.companyId);assert.equal(row['PO number'],saved.draft.number);assert.equal(row['PO ID'],saved.draft.id);
    assert.equal(row['Saved revision'],String(saved.revision));assert.equal(row['Supplier SKU'],line.sku);
    assert.equal(row.Description,line.description);assert.equal(row['Whole packs'],line.packs);
    assert.equal(row['Exact minor units total'],line.stockQuantity?.minor??'Not applicable');
    assert.equal(row['Estimated line minor units'],line.estimatedLineMinor??'Unavailable');
    assert.deepEqual(JSON.parse(row['Draft warnings']),saved.draft.warnings);
    assert.deepEqual(JSON.parse(row['Export limitations']),saved.limitations);
  }
  const summary=Object.fromEntries([...workbook.sheets[0].cells].filter(([key])=>/^A\d+$/.test(key)&&Number(key.slice(1))>5)
    .map(([key,cell])=>[cell.value,workbook.sheets[0].cells.get('B'+key.slice(1))?.value]));
  assert.equal(summary['Known subtotal minor units'],saved.draft.knownSubtotalMinor);
  assert.equal(summary['Cap minor units'],saved.draft.capMinor);return {rows,summary};
}
const f=await exportFixture();
try{
  await f.source({productId:'beans'});
  const stock={kind:'stock',productId:'beans',expectedConfigId:'config-beans',expectedConfigVersion:1,
    sku:'=1+1 & "BEANS"',description:'Café beans, house',packs:'2',estimatedUnitMinor:'125'};
  const order=await f.drafts.create(f.create({notes:'Delivery note: side entrance',lines:[stock,
    {...f.nonStock,sku:'BAGS',packs:'3',estimatedUnitMinor:'100'},{...f.nonStock,sku:'UNKNOWN',packs:'1'}]}));
  const manual=await f.exports.get(f.select(order));
  const reviewed=await f.drafts.review({action:'review',companyId:'a',orderId:order.snapshot.id,expectedRevision:1,
    operationId:crypto.randomUUID(),acknowledgeWarnings:true});
  const review=await f.exports.get(f.select(reviewed));
  const v1=await f.source({productId:'v1'}),v2=await f.source({productId:'v2',clover:true});
  const proposalOrder=await f.drafts.create(f.create({source:'proposals',lines:undefined,proposals:[v1,v2].map(h=>({id:h.proposalId,revision:h.revision}))}));
  const proposals=await f.exports.get(f.select(proposalOrder));
  const registry=new core.D1PurchasingSuppliers(f.db,{identity:async()=>f.state.user,clock:f.options.clock});
  const supplier=await registry.saveProfile({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Document fixture',
    supplierId:'registered',expectedVersion:0,profile:{name:'Saved supplier',email:null,telephone:'PRIVATE_PHONE',paymentTerms:'PRIVATE_TERMS',minimumOrderMinor:null,
      deliveryFeeMinor:null,orderingInstructions:'PRIVATE_INSTRUCTIONS',notes:'PRIVATE_NOTES',emailAcceptance:{status:'unknown',note:''},
      accounts:[{id:'account',reference:'Account label',status:'active'}],locations:[{id:'location',accountId:'account',reference:'Location label',address:'123 Fictional Street',status:'active'}]}});
  const mapping=await registry.saveMapping({action:'save_mapping',companyId:'a',operationId:crypto.randomUUID(),reason:'Six-unit supplier pack',
    mappingId:'six-unit',expectedVersion:0,supplierId:supplier.id,expectedSupplierVersion:1,accountId:'account',locationId:'location',productId:'beans',
    expectedConfigId:'config-beans',expectedConfigVersion:1,sku:'SUPPLIER-SIX',description:'Saved six-unit pack',unitLabel:'case',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:'250'});
  const registryOrder=await f.drafts.create({action:'create',source:'registry',companyId:'a',operationId:crypto.randomUUID(),
    supplierRef:{id:supplier.id,version:1,accountId:'account',locationId:'location'},capMinor:'10000',notes:'Saved registry note',
    lines:[{kind:'stock',mappingId:mapping.id,mappingVersion:1,packs:'2'},f.nonStock]});
  const registered=await f.exports.get(f.select(registryOrder));
  f.sql.prepare("INSERT INTO products(owner,id,data) VALUES('a','large','{}')").run();
  f.sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
    VALUES('a','large','each',1,'curated','count','each','1','1','manager',?)`).run(manual.draft.createdAt);
  f.sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,effective_from,created_by,created_at)
    VALUES('a','large','large-config',1,'active','each',1,'case','9007199254740993',?,'manager',?)`).run(manual.draft.createdAt,manual.draft.createdAt);
  const largeOrder=await f.drafts.create(f.create({lines:[{...stock,productId:'large',expectedConfigId:'large-config',packs:'3'}]}));
  const large=await f.exports.get(f.select(largeOrder));
  const manyOrder=await f.drafts.create(f.create({lines:Array.from({length:50},(_,n)=>({...f.nonStock,sku:`ITEM-${n}`,description:`Item ${n} `+'long '.repeat(25),packs:'1',estimatedUnitMinor:'0'}))}));
  const many=await f.exports.get(f.select(manyOrder));
  const fixtures={manual,review,proposals,registered,large,many},before=f.allTables(),sourceBefore=JSON.stringify(fixtures),oldFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=()=>{calls++;throw Error('Document generation cannot contact providers.');};
  try{
    for(const [name,saved] of Object.entries(fixtures)){
      const pdfBytes=await pdf(saved,font),xlsxBytes=await xlsx(saved);
      writeFileSync(`${output}/${name}.pdf`,pdfBytes);writeFileSync(`${output}/${name}.xlsx`,xlsxBytes);
      writeFileSync(`${output}/${name}.json`,JSON.stringify(saved,null,2));
      const pages=await inspectPdf(pdfBytes,saved),text=compact(pages.join('\n')),{rows,summary}=inspectWorkbook(xlsxBytes,saved);
      for(const value of [saved.draft.id,saved.draft.supplier.name,saved.draft.knownSubtotalMinor,...saved.limitations]){
        // Money is rendered with an explicit USD scale; raw minor units are also in the summary.
        assert.ok(text.includes(compact(value)),`Missing ${name} PDF field: ${value}`);
      }
      assert.ok(!pages.join('\n').includes('PRIVATE_'));assert.ok(!JSON.stringify(rows).includes('PRIVATE_'));
      if(name==='manual'){
        assert.equal(rows[1].Product,'Not applicable');assert.equal(rows[1]['Stock quantity'],'Not applicable (non-stock item)');
        assert.equal(rows[2]['Estimated line minor units'],'Unavailable');assert.equal(rows[0]['Supplier SKU'],stock.sku);
        assert.ok(text.includes('Unavailable'));assert.equal(summary['Price completeness'],'Incomplete — unavailable estimates excluded');
        assert.equal(summary['Spending cap'],'USD 100.00');
      }
      if(name==='review'){assert.equal(summary['Reviewed content revision'],'1');assert.equal(summary.Reviewer,'manager');}
      if(name==='proposals')assert.deepEqual(rows.map(row=>row['Proposal contract']),[v1.contract,v2.contract]);
      if(name==='registered'){assert.equal(rows[0]['Exact minor units total'],'12');assert.equal(summary['Saved supplier version'],'1');assert.equal(summary['Stable account ID'],'account');}
      if(name==='large'){assert.equal(rows[0]['Exact minor units total'],'27021597764222979');assert.ok(text.includes('27021597764222979'));}
      if(name==='many'){assert.ok(pages.length>1);assert.equal(rows.length,50);assert.equal(rows[0]['Estimated line minor units'],'0');assert.ok(pages.join('\n').includes('Item 50:'));}
    }
    const mutable=structuredClone(manual),fontInput=new Uint8Array(font);
    const pendingPdf=pdf(mutable,fontInput),pendingXlsx=xlsx(mutable);mutable.draft.lines[0].sku='CHANGED-AFTER-START';fontInput.fill(0);
    assert.equal(inspectWorkbook(await pendingXlsx,manual).rows[0]['Supplier SKU'],stock.sku);
    assert.ok(compact((await inspectPdf(await pendingPdf,manual)).join('\n')).includes(compact(stock.sku)));
    assert.equal(f.allTables(),before);assert.equal(JSON.stringify(fixtures),sourceBefore);assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
  for(const mutate of [s=>{s.label='Order approved';},s=>{s.limitations=[];},s=>{s.status='canceled';},
    s=>{s.draft.lines[0].stockQuantity.minor='1';},s=>{s.draft.lines.push(s.draft.lines[0]);},
    s=>{s.draft.knownSubtotalMinor='0';},s=>{s.review={contentRevision:1,actor:'manager',at:s.draft.createdAt};}]){
    const invalid=structuredClone(manual);mutate(invalid);assert.throws(()=>capture(invalid),error=>error.code==='storage_failure');
    await assert.rejects(pdf(invalid,font));await assert.rejects(xlsx(invalid));
  }
  const ambiguous=structuredClone(registered);delete ambiguous.supplierReference;assert.throws(()=>capture(ambiguous));
  const invalidReview=structuredClone(review);invalidReview.review.contentRevision=2;assert.throws(()=>capture(invalidReview));
  const unsupported=structuredClone(manual);unsupported.draft.lines[0].sku='茶';await assert.rejects(pdf(unsupported,font),/font cannot display/);
  for(const sku of ['_x005F_','Bad\ud800']){
    const invalid=structuredClone(manual);invalid.draft.lines[0].sku=sku;await assert.rejects(xlsx(invalid),/escape marker|invalid Unicode/);
  }
  const oversized=structuredClone(manual);oversized.draft.warnings=Array.from({length:30},()=> 'W'.repeat(1400));
  await assert.rejects(xlsx(oversized),/Excel cell limit/);await assert.rejects(pdf(manual,new Uint8Array()));
  const controlled=structuredClone(manual);controlled.draft.lines[0].sku='_x000D_ & <tag>\n\u202e';
  const controlledRows=lineRecords(readXlsx(await xlsx(controlled)));
  assert.equal(controlledRows[0]['Supplier SKU'],'_x000D_ & <tag>\\n\\u202e');
  assert.equal(f.allTables(),before);
}finally{f.sql.close();}
console.log('PASS: saved manual/non-stock/proposal/registry/reviewed PDF/XLSX artifacts, exact large/zero/missing values, independent readers, 50 lines, immutable asynchronous capture, explicit refusal and zero provider/database effects.');
