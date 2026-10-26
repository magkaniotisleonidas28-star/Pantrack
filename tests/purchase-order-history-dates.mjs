import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {historyFixture,core as exports} from './helpers/purchase-order-history-export.mjs';
import {readXlsx,lineRecords,descendants} from './helpers/xlsx-reader.mjs';
const f=await historyFixture(),output='.sites-runtime/purchase-order-history-date-tests';mkdirSync(output,{recursive:true});
globalThis.__historyDates=f.state;
try{
  await build({stdin:{contents:"export * from './src/lib/purchase-order-history-dates.ts';export * from './src/lib/purchase-order-history-contract.ts';export * from './src/lib/d1-purchase-order-history.ts';export {GET as listGET} from './src/app/api/purchase-orders/route.ts';export {GET as exportGET} from './src/app/api/purchase-order-history-exports/route.ts';",resolveDir:process.cwd()},
    bundle:true,packages:'external',platform:'node',format:'esm',outfile:output+'/module.mjs',plugins:[{name:'date-http',setup(b){
      b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth|a8-review-source))$/},args=>({path:args.path,namespace:'date-http'}));
      b.onLoad({filter:/.*/,namespace:'date-http'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__historyDates.env;':
        args.path==='@/db/raw'?'export const database=()=>globalThis.__historyDates.db;':
        args.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__historyDates.user?{userId:globalThis.__historyDates.user}:null;':
        args.path==='@/lib/auth'?'export const csrf=()=>false;export const audit=()=>({run:async()=>{throw Error("Read must not write an audit");}});':
        'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
    }}]});
  const core=await import('../'+output+'/module.mjs'),ny='America/New_York';
  for(const [date,start,before,hours] of [
    ['2026-03-08','2026-03-08T05:00:00.000Z','2026-03-09T04:00:00.000Z',23],
    ['2026-11-01','2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z',25],
    ['2024-02-29','2024-02-29T05:00:00.000Z','2024-03-01T05:00:00.000Z',24],
    ['2026-12-31','2026-12-31T05:00:00.000Z','2027-01-01T05:00:00.000Z',24],
  ]){assert.deepEqual(core.historyDateBounds({from:date,to:date,timeZone:ny}),{start,before});assert.equal((Date.parse(before)-Date.parse(start))/3600000,hours);}
  assert.deepEqual(core.historyDateBounds({from:'2026-11-01',to:'2026-11-01',timeZone:'UTC'}),{start:'2026-11-01T00:00:00.000Z',before:'2026-11-02T00:00:00.000Z'});
  assert.deepEqual(core.historyDateBounds({}),{});
  assert.equal(core.historyDateBounds({to:'2026-11-01',timeZone:ny}).start,undefined);
  assert.equal(core.historyDateBounds({from:'2026-11-01',timeZone:ny}).before,undefined);
  for(const date of ['1900-01-01','2000-02-29','2024-02-29','9998-12-31'])assert.equal(core.validHistoryDate(date),true,date);
  for(const date of ['','1899-12-31','9999-01-01','1900-02-29','2100-02-29','2026-02-29','2026-04-31','2026-2-01','2026-01-01T00:00:00Z',' 2026-01-01'])assert.equal(core.validHistoryDate(date),false,date);
  const created=[],make=async at=>{f.setTime(at);const order=await f.drafts.create(f.create());created.push({id:order.snapshot.id,at,order});return order;};
  await make('2026-11-01T03:59:59.999Z');
  for(let n=0;n<25;n++)await make(new Date(Date.parse('2026-11-01T04:00:00.000Z')+n*3600000).toISOString());
  await make('2026-11-02T04:59:59.999Z');await make('2026-11-02T05:00:00.000Z');
  for(const at of ['2026-03-08T04:59:59.999Z','2026-03-08T05:00:00.000Z','2026-03-09T03:59:59.999Z','2026-03-09T04:00:00.000Z','2024-02-29T12:00:00.000Z'])await make(at);
  f.setTime('2026-12-01T12:00:00.000Z');await f.review(created[1].order);await f.cancel(created[2].order);await f.drafts.edit(f.edit(created[3].order));
  f.state.user='b-manager';await f.drafts.create(f.create({companyId:'b',notes:'PRIVATE_COMPANY_B'}));f.state.user='manager';
  const list=new core.D1PurchaseOrderHistory(f.db,{identity:async()=>f.state.user}),filters={q:'',supplier:'',from:'2026-11-01',to:'2026-11-01',timeZone:ny};
  const before=f.allTables(),expected=created.filter(r=>r.at>='2026-11-01T04:00:00.000Z'&&r.at<'2026-11-02T05:00:00.000Z').map(r=>r.id).sort();
  const first=await list.list({companyId:'a',filters}),second=await list.list({companyId:'a',filters,offset:20}),saved=await f.history.get({companyId:'a',filters});
  assert.equal(first.orders.length,20);assert.equal(first.hasMore,true);assert.equal(second.orders.length,6);assert.equal(second.hasMore,false);
  assert.deepEqual([...first.orders,...second.orders].map(r=>r.id).sort(),expected);assert.deepEqual(saved.records.map(r=>r.draft.id).sort(),expected);assert.equal(saved.orderCount,26);
  const edited=saved.records.find(r=>r.draft.id===created[3].id);assert.equal(edited.revision,2);
  assert.equal(edited.draft.createdAt,created[3].at,'Edits retain the original creation date.');
  assert.equal(f.sql.prepare("SELECT at FROM purchase_order_draft_events WHERE company_id='a' AND order_id=? AND revision=2").get(created[3].id).at,'2026-12-01T12:00:00.000Z','A later edit event does not move the date-filter match.');
  assert.equal((await f.history.get({companyId:'a',filters:{...filters,status:'reviewed'}})).orderCount,1);
  assert.equal((await f.history.get({companyId:'a',filters:{...filters,status:'canceled'}})).orderCount,1);
  for(const [extra,start,end] of [
    [{from:'2026-03-08',to:'2026-03-08'},'2026-03-08T05:00:00.000Z','2026-03-09T04:00:00.000Z'],
    [{from:'2024-02-29',to:'2024-02-29'},'2024-02-29T05:00:00.000Z','2024-03-01T05:00:00.000Z'],
    [{timeZone:'UTC'},'2026-11-01T00:00:00.000Z','2026-11-02T00:00:00.000Z'],
    [{from:undefined},undefined,'2026-11-02T05:00:00.000Z'],[{to:undefined},'2026-11-01T04:00:00.000Z',undefined],
  ]){const wanted=created.filter(r=>(!start||r.at>=start)&&(!end||r.at<end)).map(r=>r.id).sort();
    const result=await f.history.get({companyId:'a',filters:{...filters,...extra}});assert.deepEqual(result.records.map(r=>r.draft.id).sort(),wanted);}
  const query=core.purchaseOrderHistoryFilterParams(filters),paths=['/api/purchase-orders','/api/purchase-order-history-exports'];
  const get=(index,tail=query.toString(),company='a')=>[core.listGET,core.exportGET][index](new Request('http://127.0.0.1'+paths[index]+'?companyId='+company+'&'+tail));
  const check=async(index,tail,status,company='a')=>{const response=await get(index,tail,company);assert.equal(response.status,status,tail);assert.equal(response.headers.get('cache-control'),'private, no-store');
    if(status!==200)assert.ok(!/PRIVATE_|snapshot_json|capMinor|estimatedLineMinor/.test(await response.clone().text()));return response;};
  for(let index=0;index<2;index++){
    for(const [user,status] of [[null,401],['employee',403],['b-manager',403],['owner',200],['manager',200]]){f.state.user=user;await check(index,query.toString(),status);}await check(index,query.toString(),403,'b');
    for(const tail of ['from=2026-02-29&timeZone=UTC','from=2026-01-01','timeZone=UTC','from=&timeZone=UTC','to=2026-11-01&timeZone=Asia/Tokyo',
      'from=2026-11-02&to=2026-11-01&timeZone=UTC',query+'&from=2026-11-01',query+'&timeZone=UTC',query+'&unknown=x'])await check(index,tail,400);
    f.state.env.PANTRACK_PO_DRAFT_PREVIEW='disabled';await check(index,query.toString(),404);f.state.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';
  }
  for(const tail of ['view=choices&from=2026-11-01&timeZone=UTC','orderId='+created[1].id+'&to=2026-11-01&timeZone=UTC'])await check(0,tail,400);
  assert.deepEqual(core.purchaseOrderHistoryQuery(new URLSearchParams('companyId=a&'+query)).filters,filters);
  assert.deepEqual(exports.purchaseOrderHistoryExportQuery(new URLSearchParams('companyId=a&'+query)).filters,filters);
  assert.ok(core.purchaseOrderHistorySearch(filters,20).includes('from=2026-11-01'));
  const server=createServer(async(req,res)=>{const response=await core.exportGET(new Request('http://127.0.0.1'+req.url));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}${paths[1]}?companyId=a&${query}`);assert.equal(response.status,200);assert.equal((await response.json()).history.orderCount,26);}
  finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  // Actual serializers and actual checked download flow must retain the same criteria on both reads.
  const requests=[],files=[],states=[],controller=new exports.CheckedPurchaseOrderDownloader({
    fetch:async(url,options)=>{requests.push(new URL(url,'http://localhost').searchParams);assert.equal(options.cache,'no-store');return core.exportGET(new Request('http://localhost'+url));},
    generate:exports.browserPurchaseOrderHistoryDownloads.generate,download:(...args)=>files.push(args),
  },state=>states.push(state),exports.purchaseOrderHistoryDownloadFlow);
  await controller.start({companyId:'a',filters},'xlsx');assert.equal(states.at(-1).phase,'success');assert.equal(files.length,1);assert.equal(requests.length,2);
  for(const params of requests){assert.equal(params.get('from'),filters.from);assert.equal(params.get('to'),filters.to);assert.equal(params.get('timeZone'),ny);assert.ok(!params.has('offset'));}
  assert.equal(requests[1].get('expected'),saved.fingerprint);controller.dispose();
  const xlsx=files[0][0],pdf=await exports.serializePurchaseOrderHistoryPdf(saved,readFileSync('public/fonts/NotoSans-Regular.ttf'));
  writeFileSync(output+'/history.xlsx',xlsx);writeFileSync(output+'/history.pdf',pdf);writeFileSync(output+'/history.json',JSON.stringify(saved,null,2));
  const book=readXlsx(xlsx),lines=lineRecords(book);assert.equal(lines.length,26);
  for(const row of lines){assert.equal(row['Created from filter'],'2026-11-01');assert.equal(row['Created through filter'],'2026-11-01');assert.equal(row['Date time zone'],ny);
    assert.equal(row['Created from instant (inclusive)'],'2026-11-01T04:00:00.000Z');assert.equal(row['Created before instant (exclusive)'],'2026-11-02T05:00:00.000Z');}
  const orders=book.sheets[0],headers=[...orders.cells].filter(([address])=>/^[A-Z]+5$/.test(address));
  for(const row of descendants(orders.document,'row').filter(row=>Number(row.attributes.r)>5)){
    const values=Object.fromEntries(headers.map(([address,cell])=>[cell.value,orders.cells.get(address.replace(/5$/,row.attributes.r))?.value]));assert.equal(values['Date time zone'],ny);assert.equal(values['Created through filter'],'2026-11-01');}
  const task=getDocument({data:new Uint8Array(pdf),useSystemFonts:false,isEvalSupported:false}),document=await task.promise;let text='';
  try{for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n),items=(await page.getTextContent()).items.filter(i=>'str' in i);text+=items.map(i=>i.str).join('\n');
    for(const item of items.filter(i=>i.str.trim())){assert.ok(item.transform[4]>=47&&item.transform[4]+item.width<=565);assert.ok(item.transform[5]>=42&&item.transform[5]<=745);}}}
  finally{await task.destroy();}
  text=text.replace(/\s/gu,'');for(const value of [ny,'2026-11-01T04:00:00.000Z','2026-11-02T05:00:00.000Z',...expected])assert.ok(text.includes(value),value);
  assert.equal(f.allTables(),before,'Date-filtered reads and both document paths never write business state.');
  const invalid=structuredClone(saved);invalid.filters.from='2026-11-02';invalid.filters.to='2026-11-02';await assert.rejects(exports.verifyPurchaseOrderHistoryExport(invalid),e=>e.code==='source_invalid');
  f.state.beforeHistoryRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");await check(1,query.toString(),403);
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  await make('2026-12-02T12:00:00.000Z');assert.equal((await f.history.get({companyId:'a',filters,expected:saved.fingerprint})).fingerprint,saved.fingerprint);
  await make('2026-11-01T16:30:00.000Z');await assert.rejects(f.history.get({companyId:'a',filters,expected:saved.fingerprint}),e=>e.code==='changed');
}finally{f.sql.close();delete globalThis.__historyDates;}
console.log('PASS: real date-filtered list/export API and checked file lifecycle, inclusive/open ranges, 23/25-hour DST days, UTC/leap/year boundaries, original-versus-edited dates, all-pages matching, tenant/role/default-off guards, strict queries, independent native files/provenance, fingerprints and zero export writes.');
