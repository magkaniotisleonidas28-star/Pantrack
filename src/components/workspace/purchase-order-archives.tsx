'use client';
import {useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {Button} from '@/components/ui/button';
import {PurchaseOrderArchiveClient,type ArchiveSelection,type ArchiveClientState} from '@/lib/purchase-order-archive-client';
import {captureArchiveCatalog} from '@/lib/purchase-order-archive-app-contract';
import {browserPurchaseOrderDownloads} from '@/lib/purchase-order-download';
import type {DocumentArchiveArtifact} from '@/lib/purchase-order-document-archive-contract';
import DocumentArchiveReview from './document-archive-review';

type Props={selection:ArchiveSelection;disabled:boolean;allowSave:boolean;cancelRef:MutableRefObject<(()=>void)|null>;onReload:()=>void};
export default function PurchaseOrderArchives(props:Props){return <ArchiveWorkspace key={JSON.stringify(props.selection)} {...props}/>;}
function ArchiveWorkspace({selection:initialSelection,disabled,allowSave,cancelRef,onReload}:Props){
  const [selection]=useState(initialSelection);
  const [visible,setVisible]=useState(false),[state,setState]=useState<ArchiveClientState>({phase:'idle',message:'',pending:false});
  const [offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
  const requestKey=JSON.stringify([selection,offset,refresh]);
  const [catalogView,setCatalogView]=useState<{key:string;artifacts:DocumentArchiveArtifact[];hasMore:boolean;error:string}|null>(null);
  const currentCatalog=catalogView?.key===requestKey?catalogView:null;
  const artifacts=currentCatalog?.artifacts??[],hasMore=currentCatalog?.hasMore??false,listError=currentCatalog?.error??'',loading=!currentCatalog;
  const client=useRef<PurchaseOrderArchiveClient|null>(null),viewer=useRef(''),reviewCancel=useRef<(()=>void)|null>(null);
  const [reviewOpen,setReviewOpen]=useState(false),[reviewDocumentId,setReviewDocumentId]=useState('');
  const source=JSON.stringify(selection);
  const scope=JSON.stringify([selection.companyId,selection.source.kind,selection.source.kind==='draft'?selection.source.orderId:'history']);
  const blocked=disabled||loading||state.phase==='working';
  useLayoutEffect(()=>{
    const abort=new AbortController();let live=true;
    const params=new URLSearchParams({companyId:selection.companyId,view:'list',kind:selection.source.kind,offset:String(offset)});
    if(selection.source.kind==='draft')params.set('orderId',selection.source.orderId);
    void fetch('/api/purchase-order-documents?'+params,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal}).then(async response=>{
      if(!live)return;if(response.status===404){client.current?.dispose();client.current=null;setVisible(false);setCatalogView({key:requestKey,artifacts:[],hasMore:false,error:''});return;}setVisible(true);
      if(!response.ok){client.current?.dispose();client.current=null;throw Error('Saved copies could not be read. Refresh or check your company access.');}
      const catalog=captureArchiveCatalog(await response.json());if(!live)return;
      if(catalog.artifacts.some(a=>a.companyId!==selection.companyId||a.source.kind!==selection.source.kind||a.source.kind==='draft'&&selection.source.kind==='draft'&&a.source.records[0].id!==selection.source.orderId))throw Error('The saved copies did not match this selection.');
      if(!client.current||viewer.current!==catalog.viewerId){client.current?.dispose();viewer.current=catalog.viewerId;
        client.current=new PurchaseOrderArchiveClient(selection,catalog.viewerId,{fetch:(...args)=>fetch(...args),storage:sessionStorage,uuid:()=>crypto.randomUUID(),
          download:browserPurchaseOrderDownloads.download,saved:()=>{setOffset(0);setRefresh(n=>n+1);}},setState);}
      setCatalogView({key:requestKey,artifacts:catalog.artifacts,hasMore:catalog.hasMore,error:''});
    }).catch(error=>{if(live&&!abort.signal.aborted){client.current?.dispose();client.current=null;setVisible(true);setCatalogView({key:requestKey,artifacts:[],hasMore:false,error:error.message});}});
    return()=>{live=false;abort.abort();};
  },[selection,offset,refresh,requestKey]);
  useLayoutEffect(()=>{const cancel=()=>{client.current?.cancel();reviewCancel.current?.();};cancelRef.current=cancel;return()=>{cancel();client.current?.dispose();client.current=null;if(cancelRef.current===cancel)cancelRef.current=null;};},[scope,cancelRef]);
  useLayoutEffect(()=>{if(disabled)client.current?.cancel();},[disabled]);
  const clientReady=!!currentCatalog&&!listError;
  if(!visible)return null;
  return <section className="po-downloads" aria-label="Saved copies" aria-busy={loading||state.phase==='working'}>
    <h3>Saved copies</h3><small>Permanent files keep their original saved details after later edits or cancellation. No order is placed.</small>
    <div className="po-actions"><Button type="button" variant="outline" disabled={blocked||!allowSave||state.pending||!!listError||!clientReady} onClick={()=>void client.current?.save('pdf')}>Save PDF copy</Button>
      <Button type="button" variant="outline" disabled={blocked||!allowSave||state.pending||!!listError||!clientReady} onClick={()=>void client.current?.save('xlsx')}>Save Excel copy</Button>
      {state.phase==='working'&&<Button type="button" variant="ghost" onClick={()=>client.current?.cancel()}>Stop waiting</Button>}
      {state.retryable&&<Button type="button" variant="outline" disabled={blocked||!clientReady} onClick={()=>void client.current?.retry()}>Retry this save</Button>}</div>
    {state.message&&<p role={state.phase==='held'||state.phase==='error'?'alert':'status'}>{state.message}</p>}
    {state.reload&&<Button type="button" variant="outline" disabled={blocked} onClick={onReload}>Reload source</Button>}
    {listError&&<p role="alert">{listError}</p>}
    {loading?<p role="status">Loading saved copies…</p>:!listError&&artifacts.length===0?<p>No saved copies yet.</p>:<ul>{artifacts.map(artifact=><li key={artifact.id}>
      <span>{artifact.source.kind==='draft'?`Revision ${artifact.source.records[0].revision}`:`History · ${artifact.source.records.length} ${artifact.source.records.length===1?'record':'records'}`} · {artifact.format==='pdf'?'PDF':'Excel'} · <time dateTime={artifact.issuedAt}>{new Date(artifact.issuedAt).toLocaleString()}</time></span>{' '}
      <Button type="button" variant="ghost" disabled={blocked||!!listError||!clientReady||state.pending&&!state.retryable} onClick={()=>void client.current?.download(artifact)}>Download saved {artifact.format==='pdf'?'PDF':'Excel'}<span className="sr-only"> from {new Date(artifact.issuedAt).toLocaleString()}</span></Button>
      <Button type="button" variant="ghost" disabled={blocked||!!listError} onClick={()=>{setReviewDocumentId(artifact.id);setReviewOpen(true);}}>Review saved {artifact.format==='pdf'?'PDF':'Excel'}<span className="sr-only"> reference {artifact.id}</span></Button>
    </li>)}</ul>}
    <div className="po-actions"><Button type="button" variant="ghost" disabled={blocked} onClick={()=>{client.current?.cancel();setRefresh(n=>n+1);}}>Refresh saved copies</Button>
      {offset>0&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>{client.current?.cancel();setOffset(n=>Math.max(0,n-20));}}>Newer copies</Button>}
      {hasMore&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>{client.current?.cancel();setOffset(n=>n+20);}}>Older copies</Button>}</div>
    <Button type="button" variant="outline" disabled={blocked} aria-expanded={reviewOpen} onClick={()=>{setReviewDocumentId('');setReviewOpen(open=>!open);}}>{reviewOpen?'Close save review':'Review saves'}</Button>
    {reviewOpen&&<DocumentArchiveReview key={source+'|'+viewer.current+'|'+reviewDocumentId} selection={{companyId:selection.companyId,kind:selection.source.kind,...(selection.source.kind==='draft'?{orderId:selection.source.orderId}:{})}}
      documentId={reviewDocumentId||undefined} viewerId={viewer.current} disabled={disabled||loading||state.phase==='working'} cancelRef={reviewCancel}/>}
  </section>;
}
