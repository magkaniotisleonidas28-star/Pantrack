import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {historyFixture,core} from './helpers/purchase-order-history-export.mjs';
import {readXlsx,lineRecords,descendants} from './helpers/xlsx-reader.mjs';
const f=await historyFixture(),output='.sites-runtime/purchase-order-history-documents-test';mkdirSync(output,{recursive:true});
try{
  for(let n=0;n<27;n++){
    let order=await f.drafts.create(f.create({notes:`History fixture ${n}`,lines:[
      {...f.nonStock,sku:'=1+1 & "BAGS"',packs:'3',estimatedUnitMinor:n%2?'0':null},
    ]}));
    if(n===0)order=await f.review(order);if(n===1)await f.cancel(order);
  }
  const saved=await f.history.get({companyId:'a',filters:{supplier:'FAKE'}}),before=f.allTables(),source=JSON.stringify(saved);
  const mutable=structuredClone(saved),font=new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf'));
  const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('No providers during export.');};
  let pdf,xlsx;
  try{
    const pendingPdf=core.serializePurchaseOrderHistoryPdf(mutable,font),pendingXlsx=core.serializePurchaseOrderHistoryXlsx(mutable);
    mutable.records[0].draft.notes='CHANGED_AFTER_CAPTURE';font.fill(0);
    [pdf,xlsx]=await Promise.all([pendingPdf,pendingXlsx]);assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;}
  writeFileSync(output+'/history.pdf',pdf);writeFileSync(output+'/history.xlsx',xlsx);writeFileSync(output+'/history.json',JSON.stringify(saved,null,2));
  const book=readXlsx(xlsx),lines=lineRecords(book),orders=book.sheets[0];assert.deepEqual(book.sheets.map(s=>s.name),['Orders','Lines']);
  const headers=[...orders.cells].filter(([address])=>/^[A-Z]+5$/.test(address));
  const rows=descendants(orders.document,'row').filter(row=>Number(row.attributes.r)>5).map(row=>Object.fromEntries(headers.map(([address,cell])=>[cell.value,orders.cells.get(address.replace(/5$/,row.attributes.r))?.value])));
  assert.equal(rows.length,27);assert.equal(lines.length,27);
  for(const [i,record] of saved.records.entries()){
    const row=rows[i],line=lines[i];assert.equal(row['PO ID'],record.draft.id);assert.equal(row.Status,record.status);
    assert.equal(row['Created at'],record.createdAt);assert.equal(row['Saved revision'],String(record.revision));
    assert.equal(row['Snapshot fingerprint'],saved.fingerprint);assert.equal(row['Supplier filter'],'FAKE');
    assert.equal(row['Known subtotal minor units'],'0');assert.equal(row.Company,'a');
    assert.equal(row['Reviewed content revision'],record.review?'1':'Not applicable');
    assert.deepEqual(JSON.parse(row.Warnings),record.draft.warnings);assert.deepEqual(JSON.parse(row['Export limitations']),saved.limitations);
    assert.equal(line['PO ID'],record.draft.id);assert.equal(line['Draft status'],record.status);assert.equal(line['Supplier SKU'],'=1+1 & "BAGS"');
    assert.equal(line['Estimated line minor units'],record.draft.lines[0].estimatedLineMinor??'Unavailable');
  }
  for(const sheet of book.sheets){assert.equal(sheet.cells.get('A1').value,saved.label);const pane=descendants(sheet.document,'pane')[0];
    assert.equal(pane.attributes.xSplit,'2');assert.equal(pane.attributes.ySplit,'5');assert.ok(descendants(sheet.document,'autoFilter')[0]);}
  const task=getDocument({data:new Uint8Array(pdf),useSystemFonts:false,isEvalSupported:false}),document=await task.promise,texts=[];
  try{
    assert.ok(document.numPages>1);assert.equal((await document.getMetadata()).info.Title,saved.label);
    assert.equal(await document.getJSActions(),null);assert.equal(await document.getAttachments(),null);
    for(let n=1;n<=document.numPages;n++){
      const page=await document.getPage(n),content=await page.getTextContent({disableNormalization:true});
      const items=content.items.filter(item=>'str' in item&&item.str.trim()),text=items.map(item=>item.str).join('\n');texts.push(text);
      assert.ok(text.includes(saved.label));assert.ok(text.includes('History snapshot '+saved.fingerprint.slice(0,16)));
      assert.ok(text.includes(`Page ${n} of ${document.numPages}`));assert.deepEqual(await page.getAnnotations(),[]);
      for(const item of items){assert.ok(item.transform[4]>=47&&item.transform[4]+item.width<=565,`Horizontal bounds: ${item.str}`);
        assert.ok(item.transform[5]>=42&&item.transform[5]<=745,`Vertical bounds: ${item.str}`);}
    }
  }finally{await task.destroy();}
  const text=texts.join('\n').replace(/\s/gu,'');
  for(const record of saved.records){for(const value of [record.draft.id,record.draft.number,record.status,...record.draft.warnings])assert.ok(text.includes(value.replace(/\s/gu,'')),value);}
  assert.ok(text.includes(saved.fingerprint));assert.ok(!text.includes('CHANGED_AFTER_CAPTURE'));assert.equal(JSON.stringify(saved),source);assert.equal(f.allTables(),before);
  for(const mutate of [s=>{s.records[0].draft.notes='tampered';},s=>{s.records.pop();}]){
    const bad=structuredClone(saved);mutate(bad);await assert.rejects(core.serializePurchaseOrderHistoryXlsx(bad),e=>e.code==='source_invalid');
    await assert.rejects(core.serializePurchaseOrderHistoryPdf(bad,readFileSync('public/fonts/NotoSans-Regular.ttf')),e=>e.code==='source_invalid');
  }
}finally{f.sql.close();}
console.log('PASS: native all-pages PDF/Orders+Lines XLSX from 27 real saved records, current/reviewed/canceled labels, exact unknown/zero estimates, warnings, filter/fingerprint provenance, literal formula text, independent readers/layout bounds, pre-await capture, no providers/writes and tampered-source refusal.');
