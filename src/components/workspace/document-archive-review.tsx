'use client';
import {useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {Button} from '@/components/ui/button';
import {DocumentArchiveReviewClient,type ArchiveReviewState} from '@/lib/document-archive-review-client';
import {archiveReviewLabels,archiveReviewReasons,type ArchiveReviewSelection,type ArchiveReviewItem} from '@/lib/document-archive-review-contract';
import IssuedFileCheckControl from './issued-file-check';

type Props={selection:ArchiveReviewSelection;viewerId:string;disabled:boolean;cancelRef:MutableRefObject<(()=>void)|null>;documentId?:string;continuationDisabled:boolean;onContinue:(item:ArchiveReviewItem)=>void};
const time=(value:string)=>new Date(value).toLocaleString();
function Summary({item}:{item:ArchiveReviewItem}){return <>
  <strong>{archiveReviewLabels[item.status]}</strong>{' · '}{item.format==='pdf'?'PDF':'Excel'}{' · '}
  {item.source.kind==='draft'?`Revision ${item.source.revision}`:'History copy'}
  <p>Requested <time dateTime={item.requestedAt}>{time(item.requestedAt)}</time>.</p>
  {item.reason&&<p>{archiveReviewReasons[item.reason]}</p>}
  <p>{item.lastCheckedAt?<>Last recorded file check: <time dateTime={item.lastCheckedAt}>{time(item.lastCheckedAt)}</time>.</>:'No file check has been recorded.'}</p>
  {item.status==='unconfirmed'&&<p>The save did not finish within its recorded waiting period. Its outcome still needs confirmation.</p>}
  {item.issued&&item.status!=='issued'&&<p>The original copy remains recorded; its last file check needs attention.</p>}
</>;}
export default function DocumentArchiveReview(props:Props){return <ReviewWorkspace key={JSON.stringify([props.selection,props.viewerId,props.documentId])} {...props}/>;}
function ReviewWorkspace({selection:initialSelection,viewerId,disabled,cancelRef,documentId,continuationDisabled,onContinue}:Props){
  const [selection]=useState(initialSelection);
  const [state,setState]=useState<ArchiveReviewState>({loading:true,message:'',page:null,detail:null,offset:0,eventOffset:0});
  const client=useRef<DocumentArchiveReviewClient|null>(null),checkCancel=useRef<(()=>void)|null>(null);
  useLayoutEffect(()=>{
    const current=new DocumentArchiveReviewClient(selection,viewerId,{fetch:(...args)=>fetch(...args)},setState);client.current=current;
    const cancel=()=>{current.cancel();checkCancel.current?.();};cancelRef.current=cancel;void(documentId?current.detail(documentId):current.list());
    return()=>{cancel();current.dispose();if(client.current===current)client.current=null;if(cancelRef.current===cancel)cancelRef.current=null;};
  },[selection,viewerId,cancelRef,documentId]);
  useLayoutEffect(()=>{if(disabled)client.current?.cancel();},[disabled]);
  const blocked=disabled||state.loading;
  return <section className="po-downloads" aria-label="Saved-document review" aria-busy={state.loading}>
    <h3>Saved-document review</h3>
    <p>This review shows recorded results. Refresh updates the list without checking files again. Use Check file now to record a new verification.</p>
    {state.loading&&<p role="status">Loading saved-document review…</p>}
    {state.message&&<p role="alert">{state.message}</p>}
    <div className="po-actions"><Button type="button" variant="outline" disabled={blocked} onClick={()=>void client.current?.list()}>Refresh review</Button>
      {state.loading&&<Button type="button" variant="ghost" onClick={()=>client.current?.cancel()}>Stop loading review</Button>}
      {state.detail&&<Button type="button" variant="ghost" disabled={disabled} onClick={()=>{if(state.page)client.current?.closeDetail();else void client.current?.list();}}>Back to saves needing attention</Button>}</div>
    {state.detail?<article aria-label="Save history">
      <Summary item={state.detail.item}/><p className="break-all">Save reference: {state.detail.item.id}</p>
      {!state.detail.item.issued&&<section aria-label="Continue original save">
        {state.detail.canContinue?<>
          <p>Continue the exact save you started. Existing file contents are checked; if generation never finished, the original source must still match before a file can be saved.</p>
          {state.detail.item.status==='pending'&&<p>The save is still running. Refresh the review after its waiting period.</p>}
          <Button type="button" variant="outline" disabled={blocked||continuationDisabled||state.detail.item.status==='pending'} onClick={()=>onContinue(state.detail!.item)}>Continue original save</Button>
        </>:<p>Only the person who started this save can continue it, with current owner or manager access.</p>}
      </section>}
      {state.detail.item.issued&&<IssuedFileCheckControl key={state.detail.item.id+'|'+state.detail.viewerId} companyId={selection.companyId} documentId={state.detail.item.id}
        viewerId={state.detail.viewerId} disabled={blocked} cancelRef={checkCancel} recorded={()=>void client.current?.detail(state.detail!.item.id)}/>}
      <h4>Recorded checks, newest first</h4>
      {state.detail.events.length?<ol>{state.detail.events.map(event=><li key={event.id}><time dateTime={event.at}>{time(event.at)}</time>{' · '}{event.summary}</li>)}</ol>:<p>No checks have been recorded for this save.</p>}
      <div className="po-actions">{state.eventOffset>0&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>void client.current?.detail(state.detail!.item.id,Math.max(0,state.eventOffset-20))}>Newer checks</Button>}
        {state.detail.hasMore&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>void client.current?.detail(state.detail!.item.id,state.eventOffset+20)}>Older checks</Button>}</div>
    </article>:state.page&&<>
      {!state.page.items.length?<p>No saves need attention in this list.</p>:<ul>{state.page.items.map(item=><li key={item.id}>
        <Summary item={item}/><Button type="button" variant="ghost" disabled={blocked} onClick={()=>void client.current?.detail(item.id)}>View save history<span className="sr-only"> for {item.format==='pdf'?'PDF':'Excel'} requested {time(item.requestedAt)}, reference {item.id}</span></Button>
      </li>)}</ul>}
      <div className="po-actions">{state.offset>0&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>void client.current?.list(Math.max(0,state.offset-20))}>Later saves</Button>}
        {state.page.hasMore&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>void client.current?.list(state.offset+20)}>Earlier saves</Button>}</div>
    </>}
  </section>;
}
