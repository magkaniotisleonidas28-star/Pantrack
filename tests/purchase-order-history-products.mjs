import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {historyFixture,core as exports} from './helpers/purchase-order-history-export.mjs';
import {readXlsx,lineRecords,descendants} from './helpers/xlsx-reader.mjs';
const f=await historyFixture(),output='.sites-runtime/purchase-order-history-product-tests';mkdirSync(output,{recursive:true});globalThis.__historyProducts=f.state;
try{
  await build({stdin:{contents:"export * from './src/lib/purchase-order-history-contract.ts';export * from './src/lib/d1-purchase-order-history.ts';export {GET as listGET} from './src/app/api/purchase-orders/route.ts';export {GET as exportGET} from './src/app/api/purchase-order-history-exports/route.ts';",resolveDir:process.cwd()},
    bundle:true,packages:'external',platform:'node',format:'esm',outfile:output+'/module.mjs',plugins:[{name:'product-http',setup(b){
      b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth|a8-review-source))$/},args=>({path:args.path,namespace:'product-http'}));
      b.onLoad({filter:/.*/,namespace:'product-http'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__historyProducts.env;':
        args.path==='@/db/raw'?'export const database=()=>globalThis.__historyProducts.db;':
        args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__historyProducts.user?{userId:globalThis.__historyProducts.user}:null;':
        args.path==='@/lib/auth'?'export const csrf=()=>false;export const audit=()=>({run:async()=>{throw Error("Read must not audit/write");}});':
        'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
    }}]});
  const core=await import('../'+output+'/module.mjs'),reader=new core.D1PurchaseOrderHistory(f.db,{identity:async()=>f.state.user});
  await f.source({productId:'coffee-id'});
  const stock={kind:'stock',productId:'coffee-id',expectedConfigId:'config-coffee-id',expectedConfigVersion:1,sku:'BEAN-SKU',description:'Café beans',packs:'2',estimatedUnitMinor:'100'};
  const sleeve={...f.nonStock,sku:'PAPER',description:'Paper sleeve',packs:'1',estimatedUnitMinor:'25'},orders=[];
  f.setTime('2026-11-01T12:00:00.000Z');
  for(let n=0;n<27;n++){
    const request=f.create({lines:[{...stock,sku:n===2?'OLD-ONLY-SKU':stock.sku},{...sleeve,description:n===0?'Beans shipping sleeve':sleeve.description}]}),originalId=crypto.randomUUID;
    // Keep the multi-match order at a fixed position to exercise the page boundary deterministically.
    if(n===0)crypto.randomUUID=()=>'ffffffff-ffff-4fff-8fff-ffffffffffff';
    try{orders.push(await f.drafts.create(request));}finally{crypto.randomUUID=originalId;}
  }
  await f.review(orders[0]);await f.cancel(orders[1]);
  await f.drafts.edit(f.edit(orders[2],{lines:[{...stock,sku:'NEW-ONLY-SKU'},sleeve]}));
  const nonStock=await f.drafts.create(f.create({supplier:{...f.supplier,id:'beta',name:'Beta Supply'},lines:[{...f.nonStock,sku:'LABELS',description:'Beans labels'}]}));
  const literal=await f.drafts.create(f.create({lines:[{...f.nonStock,sku:"=1+1 %_ ' OR 1=1--",description:'Tools only'}]}));
  await f.drafts.create(f.create({supplier:{...f.supplier,name:'Header beans only supplier'},notes:'NOTE_ONLY beans',lines:[sleeve]}));
  const handoff=await f.source({productId:'proposal-product'});
  const proposal=await f.drafts.create(f.create({source:'proposals',lines:undefined,proposals:[{id:handoff.proposalId,revision:handoff.revision}]}));
  const registry=new exports.D1PurchasingSuppliers(f.db,{identity:async()=>f.state.user,clock:f.options.clock});
  await registry.saveProfile({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Saved product filter fixture',supplierId:'registry-filter',expectedVersion:0,
    profile:{name:'Mapped supplier',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'PRIVATE_REGISTRY_NOTES',emailAcceptance:{status:'unknown',note:''},
      accounts:[{id:'account',reference:'Account',status:'active'}],locations:[{id:'location',accountId:'account',reference:'Location',address:'123 Fictional Street',status:'active'}]}});
  await registry.saveMapping({action:'save_mapping',companyId:'a',operationId:crypto.randomUUID(),reason:'Saved espresso mapping',mappingId:'mapping',expectedVersion:0,supplierId:'registry-filter',expectedSupplierVersion:1,
    accountId:'account',locationId:'location',productId:'coffee-id',expectedConfigId:'config-coffee-id',expectedConfigVersion:1,sku:'REG-FILTER',description:'Saved espresso pack',unitLabel:'case',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:'250'});
  const registered=await f.drafts.create({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'registry',supplierRef:{id:'registry-filter',version:1,accountId:'account',locationId:'location'},capMinor:'10000',notes:'',lines:[{kind:'stock',mappingId:'mapping',mappingVersion:1,packs:'1'}]});
  f.sql.prepare("UPDATE products SET data=? WHERE owner='a' AND id='coffee-id'").run(JSON.stringify({name:'CATALOG_RENAMED_ONLY'}));
  f.setTime('2026-12-01T12:00:00.000Z');await f.drafts.create(f.create({lines:[{...f.nonStock,description:'Beans in December'}]}));
  f.state.user='b-manager';await f.drafts.create(f.create({companyId:'b',lines:[{...f.nonStock,description:'PRIVATE_OTHER_COMPANY beans'}]}));f.state.user='manager';
  const filters={q:'',supplier:'',product:'beans',from:'2026-11-01',to:'2026-11-01',timeZone:'America/New_York'},before=f.allTables();
  const first=await reader.list({companyId:'a',filters}),second=await reader.list({companyId:'a',filters,offset:20}),saved=await f.history.get({companyId:'a',filters});
  const expected=[...orders.map(o=>o.snapshot.id),nonStock.snapshot.id].sort();
  const unexpected=saved.records.filter(r=>!expected.includes(r.draft.id)).map(r=>({source:r.draft.source,supplier:r.draft.supplier.name,lines:r.draft.lines.map(({productId,sku,description})=>({productId,sku,description}))}));
  assert.deepEqual(unexpected,[],'Only the intended saved line fields should match.');
  const listed=[...first.orders,...second.orders];
  assert.deepEqual(listed.filter(r=>!expected.includes(r.id)),[],'List rows must match export IDs.');
  assert.deepEqual(listed.filter((r,n)=>listed.findIndex(x=>x.id===r.id)!==n),[],'Pages must not repeat an order.');
  assert.equal(first.orders.length,20);assert.equal(first.hasMore,true);assert.equal(second.orders.length,8);assert.equal(second.hasMore,false);
  assert.deepEqual([...first.orders,...second.orders].map(r=>r.id).sort(),expected);assert.deepEqual(saved.records.map(r=>r.draft.id).sort(),expected);assert.equal(saved.orderCount,28);assert.equal(saved.lineCount,55);
  const sorted=expected.slice().reverse();
  for(const offset of [1,19,20,27,28,1_000_000]){
    const page=await reader.list({companyId:'a',filters,offset});assert.deepEqual(page.orders.map(r=>r.id),sorted.slice(offset,offset+20));assert.equal(page.hasMore,offset+20<sorted.length);
  }
  for(const product of ['  BEANS  ','BEAN-SKU','coffee-id','CAFé']){
    const found=await f.history.get({companyId:'a',filters:{product}});assert.ok(found.orderCount>=26);assert.ok(!JSON.stringify(found).includes('PRIVATE_'));
  }
  for(const product of ['%_',"' OR 1=1--",'=1+1'])assert.deepEqual((await f.history.get({companyId:'a',filters:{product}})).records.map(r=>r.draft.id),[literal.snapshot.id]);
  for(const product of ['OLD-ONLY-SKU','CATALOG_RENAMED_ONLY','NOTE_ONLY','CAFÉ','null','non_stock',"%') OR 1=1--"]){assert.deepEqual(await reader.list({companyId:'a',filters:{product}}),{orders:[],hasMore:false});await assert.rejects(f.history.get({companyId:'a',filters:{product}}),e=>e.code==='empty');}
  for(const [product,id] of [['NEW-ONLY-SKU',orders[2].snapshot.id],['proposal-product',proposal.snapshot.id],['REG-FILTER',registered.snapshot.id]])assert.deepEqual((await f.history.get({companyId:'a',filters:{product}})).records.map(r=>r.draft.id),[id]);
  assert.equal((await f.history.get({companyId:'a',filters:{...filters,status:'reviewed'}})).orderCount,1);assert.equal((await f.history.get({companyId:'a',filters:{...filters,status:'canceled'}})).orderCount,1);
  assert.equal((await f.history.get({companyId:'a',filters:{...filters,supplier:'beta'}})).orderCount,1);assert.equal((await f.history.get({companyId:'a',filters:{...filters,q:orders[3].snapshot.number}})).orderCount,1);
  assert.deepEqual(await reader.list({companyId:'a',filters:{...filters,q:'Header beans only supplier'}}),{orders:[],hasMore:false});
  const unfiltered=await f.history.get({companyId:'a'});assert.equal((await f.history.get({companyId:'a',filters:{product:'  '}})).fingerprint,unfiltered.fingerprint,'An empty product criterion is a no-op.');
  const query=core.purchaseOrderHistoryFilterParams(filters),paths=['/api/purchase-orders','/api/purchase-order-history-exports'];
  const check=async(index,tail,status,company='a')=>{const response=await [core.listGET,core.exportGET][index](new Request('http://localhost'+paths[index]+'?companyId='+company+'&'+tail));assert.equal(response.status,status,tail);assert.equal(response.headers.get('cache-control'),'private, no-store');if(status!==200)assert.ok(!/PRIVATE_|snapshot_json|capMinor/.test(await response.clone().text()));return response;};
  for(let index=0;index<2;index++){
    for(const [user,status] of [[null,401],['employee',403],['b-manager',403],['owner',200],['manager',200]]){f.state.user=user;await check(index,query.toString(),status);}await check(index,query.toString(),403,'b');
    for(const tail of ['product=x&product=y','product='+('x'.repeat(201)),query+'&unknown=x'])await check(index,tail,400);
    f.state.env.PANTRACK_PO_DRAFT_PREVIEW='disabled';await check(index,query.toString(),404);f.state.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';
  }
  for(const tail of ['view=choices&product=beans','orderId='+orders[0].snapshot.id+'&product=beans','revision=1&product=beans'])await check(0,tail,400);
  assert.deepEqual(core.purchaseOrderHistoryQuery(new URLSearchParams('companyId=a&'+query)).filters,filters);assert.deepEqual(exports.purchaseOrderHistoryExportQuery(new URLSearchParams('companyId=a&'+query)).filters,filters);
  const server=createServer(async(req,res)=>{const response=await core.exportGET(new Request('http://localhost'+req.url));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}${paths[1]}?companyId=a&${query}`);assert.equal(response.status,200);assert.equal((await response.json()).history.orderCount,28);}finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  const files=[],requests=[],states=[],controller=new exports.CheckedPurchaseOrderDownloader({fetch:async(url,options)=>{assert.equal(options.cache,'no-store');requests.push(new URL(url,'http://localhost').searchParams);return core.exportGET(new Request('http://localhost'+url));},generate:exports.browserPurchaseOrderHistoryDownloads.generate,download:(...args)=>files.push(args)},state=>states.push(state),exports.purchaseOrderHistoryDownloadFlow);
  await controller.start({companyId:'a',filters},'xlsx');assert.equal(states.at(-1).phase,'success');assert.equal(files.length,1);assert.equal(requests.length,2);for(const params of requests){assert.equal(params.get('product'),'beans');assert.equal(params.get('from'),filters.from);assert.ok(!params.has('offset'));}assert.equal(requests[1].get('expected'),saved.fingerprint);controller.dispose();
  const xlsx=files[0][0],pdf=await exports.serializePurchaseOrderHistoryPdf(saved,readFileSync('public/fonts/NotoSans-Regular.ttf'));writeFileSync(output+'/history.xlsx',xlsx);writeFileSync(output+'/history.pdf',pdf);writeFileSync(output+'/history.json',JSON.stringify(saved,null,2));
  const book=readXlsx(xlsx),lines=lineRecords(book);assert.equal(lines.length,55);assert.ok(lines.some(r=>r.Description==='Paper sleeve'),'Unmatched lines remain in whole-order exports.');
  for(const row of lines){assert.equal(row['Product / item filter'],'beans');assert.equal(row['Export scope'],'Whole matching orders; every saved line retained.');}
  const sheet=book.sheets[0],headers=[...sheet.cells].filter(([key])=>/^[A-Z]+5$/.test(key));for(const row of descendants(sheet.document,'row').filter(r=>Number(r.attributes.r)>5)){const values=Object.fromEntries(headers.map(([key,cell])=>[cell.value,sheet.cells.get(key.replace(/5$/,row.attributes.r))?.value]));assert.equal(values['Product / item filter'],'beans');assert.equal(values['Export scope'],'Whole matching orders; every saved line retained.');}
  const task=getDocument({data:new Uint8Array(pdf),useSystemFonts:false,isEvalSupported:false}),document=await task.promise;let text='';try{for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n),items=(await page.getTextContent()).items.filter(i=>'str' in i);text+=items.map(i=>i.str).join('\n');for(const item of items.filter(i=>i.str.trim())){assert.ok(item.transform[4]>=47&&item.transform[4]+item.width<=565);assert.ok(item.transform[5]>=42&&item.transform[5]<=745);}}}finally{await task.destroy();}
  text=text.replace(/\s/gu,'');for(const value of ['Product/item:beans','Paper sleeve','Matching an item includes every line',...expected])assert.ok(text.includes(value.replace(/\s/gu,'')),value);assert.equal(f.allTables(),before);
  const invalid=structuredClone(saved);invalid.filters.product='NOT-MATCHING';await assert.rejects(exports.verifyPurchaseOrderHistoryExport(invalid),e=>e.code==='source_invalid');
  f.state.beforeHistoryRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");await check(1,query.toString(),403);f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.setTime('2026-11-01T12:00:00.000Z');await f.drafts.create(f.create({lines:[sleeve]}));assert.equal((await f.history.get({companyId:'a',filters,expected:saved.fingerprint})).fingerprint,saved.fingerprint);
  await f.drafts.create(f.create({lines:[{...f.nonStock,description:'New beans line'}]}));await assert.rejects(f.history.get({companyId:'a',filters,expected:saved.fingerprint}),e=>e.code==='changed');
}finally{f.sql.close();delete globalThis.__historyProducts;}
console.log('PASS: current saved product/SKU/description filters across all pages and source kinds, whole-order native exports, literal/ASCII matching, unchanged catalog isolation, combined criteria, actual API/checked download lifecycle, private authorization/refusal/fingerprints and zero export writes.');
