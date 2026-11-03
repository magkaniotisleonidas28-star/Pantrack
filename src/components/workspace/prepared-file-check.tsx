'use client';
import {useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {Button} from '@/components/ui/button';
import {PreparedFileCheckClient,type PreparedCheckClientState} from '@/lib/prepared-file-check-client';
import type {ArchiveReviewSelection} from '@/lib/document-archive-review-contract';

type Props={selection:ArchiveReviewSelection;documentId:string;viewerId:string;disabled:boolean;cancelRef:MutableRefObject<(()=>void)|null>;recorded:()=>void};
const labels={verified:'The prepared file matched its original details.',missing:'The prepared file was not found during this check.',damaged:'The prepared file contents did not match its original details.',unavailable:'Storage could not confirm the prepared file during this check.'};
export default function PreparedFileCheckControl({selection,documentId,viewerId,disabled,cancelRef,recorded}:Props){
  const client=useRef<PreparedFileCheckClient|null>(null),notify=useRef(recorded);
  useLayoutEffect(()=>{notify.current=recorded;},[recorded]);
  const [state,setState]=useState<PreparedCheckClientState>({working:false,pending:false,retryable:false,message:''});
  useLayoutEffect(()=>{
    const current=new PreparedFileCheckClient({...selection,documentId},viewerId,{fetch:(...args)=>fetch(...args),storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},uuid:()=>crypto.randomUUID(),recorded:()=>notify.current(),refused:()=>notify.current()},setState);
    client.current=current;const cancel=()=>current.cancel();cancelRef.current=cancel;
    return()=>{current.dispose();if(client.current===current)client.current=null;if(cancelRef.current===cancel)cancelRef.current=null;};
  },[selection,documentId,viewerId,cancelRef]);
  useLayoutEffect(()=>{if(disabled)client.current?.cancel();},[disabled]);
  return <section aria-label="Check prepared file" aria-busy={state.working}>
    <p>Check the existing prepared file now. This records a result without issuing, generating or replacing a copy. It does not approve the source or continue the save.</p>
    <div className="po-actions"><Button type="button" variant="outline" disabled={disabled||state.working||state.pending||!client.current} onClick={()=>void client.current?.check()}>Check prepared file now</Button>
      {state.retryable&&<Button type="button" variant="outline" disabled={disabled||state.working} onClick={()=>void client.current?.retry()}>Retry this prepared-file check</Button>}
      {state.working&&<Button type="button" variant="ghost" onClick={()=>client.current?.cancel()}>Stop waiting for prepared-file check</Button>}</div>
    {state.message&&<p role={state.pending&&!state.working?'alert':'status'}>{state.message}</p>}
    {state.check&&<p role="status">{state.replayed?'Recorded result from an earlier prepared-file check':'New prepared-file check recorded'}: {labels[state.check.outcome]}{' '}
      <time dateTime={state.check.checkedAt}>{new Date(state.check.checkedAt).toLocaleString()}</time>. No copy was issued. Start a new check to inspect the file again.</p>}
  </section>;
}
