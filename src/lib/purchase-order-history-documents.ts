import {verifyPurchaseOrderHistoryExport,HISTORY_EXPORT_LABEL} from './purchase-order-history-export-contract';
import {projectPurchaseOrderDocuments} from './purchase-order-documents';
import {draftEstimateDisplay} from './supplier-order-draft';
import type {DraftPdfDocument} from './draft-document-pdf';
import type {DraftXlsxDocument} from './draft-document-xlsx';
import {historyDateBounds} from './purchase-order-history-dates';

async function documents(value:unknown){
  const saved=await verifyPurchaseOrderHistoryExport(value),f=saved.filters;
  const dates=historyDateBounds(f),dateColumns:[string,number][]=[['Created from filter',24],['Created through filter',24],['Date time zone',28],['Created from instant (inclusive)',30],['Created before instant (exclusive)',30]],
    dateValues=[f.from??'Unbounded',f.to??'Unbounded',f.timeZone??'Not filtered',dates.start??'Unbounded',dates.before??'Unbounded'];
  const projections=saved.records.map(record=>projectPurchaseOrderDocuments({...record,contract:saved.contract,label:saved.label,limitations:saved.limitations}));
  const context=[`Company: ${saved.companyId}`,`Matching saved drafts: ${saved.orderCount} | lines: ${saved.lineCount}`,
    `Search: ${f.q||'All'}`,`Supplier: ${f.supplier||'All'}`,`Status: ${f.status??'All'}`,
    `Originally created: ${f.from??'Unbounded'} through ${f.to??'Unbounded'} | time zone: ${f.timeZone??'Not filtered'}`,
    ...(f.timeZone?[`Created from (inclusive): ${dates.start??'Unbounded'} | before (exclusive): ${dates.before??'Unbounded'}`]:[]),`Snapshot: ${saved.fingerprint}`,
    'All matches are included, regardless of the page shown in Pantrack. No combined purchase total is calculated.'];
  const columns:[string,number][]=[['PO number',32],['PO ID',38],['Saved revision',18],['Status',18],['Created at',28],['Saved at',28],
    ['Company',28],['Source',18],['Source contract',40],['Export contract',44],['Draft label',48],
    ['Supplier',32],['Supplier ID',32],['Supplier email',32],['Account',28],['Location',28],['Delivery address',50],['Currency',14],
    ['Saved supplier version',22],['Stable account ID',28],['Stable location ID',28],
    ['Reviewed content revision',24],['Reviewer',28],['Reviewed at',28],
    ['Known subtotal (estimate)',32],['Known subtotal minor units',30],['Prices complete',22],['Spending cap minor units',30],
    ['Line count',16],['Notes',50],['Warnings',70],['Search filter',30],['Supplier filter',30],['Status filter',20],['Snapshot fingerprint',70],['Export limitations',90],...dateColumns];
  const summary=saved.records.map(record=>{const d=record.draft;return [d.number,d.id,String(record.revision),record.status,record.createdAt,d.createdAt,
    d.companyId,d.source,d.contract,saved.contract,saved.label,
    d.supplier.name,d.supplier.id,d.supplier.email??'Unavailable',d.supplier.accountId,d.supplier.locationId,d.supplier.deliveryAddress,d.currency,
    record.supplierReference?String(record.supplierReference.version):'Not applicable',record.supplierReference?.accountId??'Not applicable',record.supplierReference?.locationId??'Not applicable',
    record.review?String(record.review.contentRevision):'Not applicable',record.review?.actor??'Not applicable',record.review?.at??'Not applicable',
    draftEstimateDisplay({currency:'USD',minor:d.knownSubtotalMinor}),d.knownSubtotalMinor,d.pricesComplete?'Yes':'No — unavailable estimates excluded',d.capMinor,
    String(d.lines.length),d.notes,JSON.stringify(d.warnings),f.q,f.supplier,f.status??'All',saved.fingerprint,JSON.stringify(saved.limitations),...dateValues];});
  const extra:[string,number][]=[['Search filter',30],['Supplier filter',30],['Status filter',20],['Snapshot fingerprint',70]];
  const xlsx:DraftXlsxDocument={label:HISTORY_EXPORT_LABEL,printLabel:'Draft history - no purchase evidence.',creator:'Pantrack',
    subject:'Complete matching saved draft records; estimates only. Canceled records remain history.',summaryName:'Orders',summaryColumns:columns,summary,
    columns:[...projections[0].xlsx.columns,...extra,...dateColumns],lines:projections.flatMap(p=>p.xlsx.lines.map(row=>[...row,f.q,f.supplier,f.status??'All',saved.fingerprint,...dateValues]))};
  const items:DraftPdfDocument['items'][number][]=[];
  for(const [index,record] of saved.records.entries()){
    const reference=`PO ${record.draft.number} | revision ${record.revision} | ${record.status}`;
    items.push({title:reference,reference:reference+' (continued)',rows:[
      {text:`Originally created at: ${record.createdAt}`,size:9,tone:'muted'},
      ...projections[index].pdf.context.map(text=>({text,size:9,tone:'muted' as const})),
      ...record.draft.warnings.map(text=>({text:`Saved warning: ${text}`,size:9,tone:'warning' as const})),
    ]});
    for(const item of projections[index].pdf.items)items.push({...item,title:`${record.draft.number} / ${item.title}`,reference:reference+' (continued)',
      rows:[{text:reference,tone:record.status==='canceled'?'warning':'muted'},...item.rows]});
  }
  const pdf:DraftPdfDocument={label:saved.label,title:'Saved purchase-order history',creator:'Pantrack',
    subject:'Complete matching saved draft records; no purchase or delivery evidence.',pageReference:`History snapshot ${saved.fingerprint.slice(0,16)} | ${saved.orderCount} records`,
    context,items,warnings:saved.limitations,closing:'Canceled records are retained as history. No purchase or inventory change is recorded by this export.'};
  return {pdf,xlsx};
}
export async function serializePurchaseOrderHistoryPdf(value:unknown,fontBytes:Uint8Array):Promise<Uint8Array>{
  const fontCopy=new Uint8Array(fontBytes),document=(await documents(value)).pdf;
  const {serializeDraftDocumentPdf}=await import('./draft-document-pdf');return serializeDraftDocumentPdf(document,fontCopy);
}
export async function serializePurchaseOrderHistoryXlsx(value:unknown):Promise<Uint8Array>{
  const document=(await documents(value)).xlsx;
  const {serializeDraftDocumentXlsx}=await import('./draft-document-xlsx');return serializeDraftDocumentXlsx(document);
}
