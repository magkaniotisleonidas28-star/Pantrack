'use client';
import {useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {PurchaseOrderDownloader,browserPurchaseOrderDownloads,type PurchaseOrderDownloadState} from '@/lib/purchase-order-download';

type Props={companyId:string;orderId:string;revision:number;disabled:boolean;
  cancelRef:MutableRefObject<(()=>void)|null>;onReload:()=>void};
export default function PurchaseOrderDownloads({companyId,orderId,revision,disabled,cancelRef,onReload}:Props){
  const [state,setState]=useState<PurchaseOrderDownloadState>({phase:'idle',message:''});
  const controller=useRef<PurchaseOrderDownloader|null>(null);
  useLayoutEffect(()=>{
    const downloader=new PurchaseOrderDownloader(browserPurchaseOrderDownloads,setState),cancel=()=>downloader.cancel();
    controller.current=downloader;cancelRef.current=cancel;
    return()=>{downloader.dispose();if(controller.current===downloader)controller.current=null;if(cancelRef.current===cancel)cancelRef.current=null;};
  },[companyId,orderId,revision,cancelRef]);
  const busy=state.phase==='loading',blocked=disabled||busy||state.phase==='held';
  return <section className="po-downloads" aria-label="Download saved draft" aria-busy={busy}>
    <h3>Download saved draft</h3><small>Current saved revision {revision}. These files contain saved details only.</small>
    <div className="po-actions">
      <Button type="button" variant="outline" disabled={blocked} aria-busy={busy&&state.format==='pdf'}
        onClick={()=>void controller.current?.start({companyId,orderId,revision},'pdf')}><Download size={16}/>{busy&&state.format==='pdf'?'Preparing PDF…':'Download PDF'}</Button>
      <Button type="button" variant="outline" disabled={blocked} aria-busy={busy&&state.format==='xlsx'}
        onClick={()=>void controller.current?.start({companyId,orderId,revision},'xlsx')}><Download size={16}/>{busy&&state.format==='xlsx'?'Preparing Excel…':'Download Excel'}</Button>
      {busy&&<Button type="button" variant="ghost" onClick={()=>controller.current?.cancel()}>Cancel download</Button>}
    </div>
    {state.message&&<p role={state.phase==='error'||state.phase==='held'?'alert':'status'}>{state.message}</p>}
    {state.phase==='error'&&<Button type="button" variant="ghost" disabled={disabled} onClick={()=>void controller.current?.start({companyId,orderId,revision},state.format!)}>Retry download</Button>}
    {state.reload&&<Button type="button" variant="outline" disabled={disabled} onClick={onReload}>Reload saved draft</Button>}
  </section>;
}
