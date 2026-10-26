'use client';
import {useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {CheckedPurchaseOrderDownloader,type PurchaseOrderDownloadState} from '@/lib/purchase-order-download';
import {browserPurchaseOrderHistoryDownloads,purchaseOrderHistoryDownloadFlow} from '@/lib/purchase-order-history-download';
import {HISTORY_EXPORT_MAX_ORDERS,HISTORY_EXPORT_MAX_LINES,type PurchaseOrderHistoryExportRequest,type PurchaseOrderHistoryExportSnapshot} from '@/lib/purchase-order-history-export-contract';
import type {PurchaseOrderHistoryFilters} from '@/lib/purchase-order-history-contract';

type Controller=CheckedPurchaseOrderDownloader<PurchaseOrderHistoryExportRequest,PurchaseOrderHistoryExportSnapshot>;
type Props={companyId:string;filters:PurchaseOrderHistoryFilters;disabled:boolean;pendingFilters:boolean;cancelRef:MutableRefObject<(()=>void)|null>;onRefresh:()=>void};
export default function PurchaseOrderHistoryDownloads({companyId,filters,disabled,pendingFilters,cancelRef,onRefresh}:Props){
  const [state,setState]=useState<PurchaseOrderDownloadState>({phase:'idle',message:''}),controller=useRef<Controller|null>(null);
  useLayoutEffect(()=>{
    const downloader=new CheckedPurchaseOrderDownloader(browserPurchaseOrderHistoryDownloads,setState,purchaseOrderHistoryDownloadFlow),cancel=()=>downloader.cancel();
    controller.current=downloader;cancelRef.current=cancel;
    return()=>{downloader.dispose();if(controller.current===downloader)controller.current=null;if(cancelRef.current===cancel)cancelRef.current=null;};
  },[companyId,filters,cancelRef]);
  const busy=state.phase==='loading',blocked=disabled||pendingFilters||busy||state.phase==='held';
  return <section className="po-downloads" aria-label="Export matching history" aria-busy={busy}>
    <h3>Export all matching history</h3><small>{pendingFilters?'Apply your filter changes before exporting.':
      `Includes every matching page, up to ${HISTORY_EXPORT_MAX_ORDERS} saved drafts and ${HISTORY_EXPORT_MAX_LINES} lines. Canceled records remain labeled as history.`}</small>
    <div className="po-actions"><Button type="button" variant="outline" disabled={blocked} aria-busy={busy&&state.format==='pdf'} onClick={()=>void controller.current?.start({companyId,filters},'pdf')}>
      <Download size={16}/>{busy&&state.format==='pdf'?'Preparing PDF…':'Export history PDF'}</Button>
      <Button type="button" variant="outline" disabled={blocked} aria-busy={busy&&state.format==='xlsx'} onClick={()=>void controller.current?.start({companyId,filters},'xlsx')}>
        <Download size={16}/>{busy&&state.format==='xlsx'?'Preparing Excel…':'Export history Excel'}</Button>
      {busy&&<Button type="button" variant="ghost" onClick={()=>controller.current?.cancel()}>Cancel history export</Button>}</div>
    {state.message&&<p role={state.phase==='held'||state.phase==='error'?'alert':'status'}>{state.message}</p>}
    {state.phase==='error'&&<Button type="button" variant="ghost" disabled={disabled||pendingFilters} onClick={()=>void controller.current?.start({companyId,filters},state.format!)}>Retry history export</Button>}
    {state.reload&&<Button type="button" variant="outline" disabled={disabled} onClick={onRefresh}>Refresh history results</Button>}
  </section>;
}
