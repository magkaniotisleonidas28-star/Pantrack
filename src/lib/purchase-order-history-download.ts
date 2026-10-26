import {DownloadRefusal,browserPurchaseOrderDownloads,type PurchaseOrderDownloadDependencies,type PurchaseOrderDownloadFlow} from './purchase-order-download';
import {purchaseOrderHistoryExportRequest,verifyPurchaseOrderHistoryExport,type PurchaseOrderHistoryExportRequest,type PurchaseOrderHistoryExportSnapshot} from './purchase-order-history-export-contract';
import {purchaseOrderHistoryFilterParams} from './purchase-order-history-contract';

export const purchaseOrderHistoryDownloadFlow:PurchaseOrderDownloadFlow<PurchaseOrderHistoryExportRequest,PurchaseOrderHistoryExportSnapshot>={
  loading:'for all matching saved drafts',changed:'The matching history changed. Refresh the results before exporting again.',
  read:async(input,fetch,signal,previous)=>{
    const selection=purchaseOrderHistoryExportRequest.parse(input),f=selection.filters;
    const params=new URLSearchParams({companyId:selection.companyId});purchaseOrderHistoryFilterParams(f).forEach((value,key)=>params.set(key,value));
    if(previous)params.set('expected',previous.fingerprint);
    const response=await fetch('/api/purchase-order-history-exports?'+params,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});
    if(!response.ok){
      if(response.status===401)throw new DownloadRefusal('Your session expired. Sign in again before exporting history.',true);
      if(response.status===403)throw new DownloadRefusal('Owner or manager access to this company is required.',true);
      if(response.status===409)throw new DownloadRefusal('The matching history changed. Refresh the results before exporting again.',true,true);
      if(response.status===413)throw new DownloadRefusal('This history export is too large. Narrow the filters and try again.',true);
      if(response.status===404)throw new DownloadRefusal('No export is available for these filters. Refresh the results.',true,true);
      throw new DownloadRefusal('Saved history could not be exported. Refresh the results or try again.',false,true);
    }
    const body:unknown=await response.json();let snapshot:PurchaseOrderHistoryExportSnapshot;
    try{snapshot=await verifyPurchaseOrderHistoryExport((body as {history?:unknown})?.history);}
    catch{throw new DownloadRefusal('The history snapshot is invalid. Refresh the results and review the drafts.',true,true);}
    if(snapshot.companyId!==selection.companyId||JSON.stringify(snapshot.filters)!==JSON.stringify(f))throw new DownloadRefusal('The history does not match these filters. Refresh the results.',true,true);
    return snapshot;
  },
  filename:(snapshot,format)=>`pantrack-filtered-history-${snapshot.fingerprint.slice(0,12)}.${format}`,
  success:(snapshot,format)=>`${format==='pdf'?'PDF':'Excel'} download started: all ${snapshot.orderCount} matching records and ${snapshot.lineCount} lines. No order was placed.`,
};
export const browserPurchaseOrderHistoryDownloads:PurchaseOrderDownloadDependencies<PurchaseOrderHistoryExportSnapshot>={
  fetch:browserPurchaseOrderDownloads.fetch,download:browserPurchaseOrderDownloads.download,
  generate:async(format,snapshot,signal)=>{
    const documents=await import('./purchase-order-history-documents');if(signal.aborted)throw new DOMException('Canceled','AbortError');
    if(format==='xlsx')return documents.serializePurchaseOrderHistoryXlsx(snapshot);
    const response=await fetch('/fonts/NotoSans-Regular.ttf',{credentials:'same-origin',cache:'force-cache',redirect:'error',signal});
    if(!response.ok)throw new Error('PDF font unavailable.');const font=new Uint8Array(await response.arrayBuffer());
    if(font.length===0||font.length>2_000_000)throw new Error('PDF font unavailable.');return documents.serializePurchaseOrderHistoryPdf(snapshot,font);
  },
};
