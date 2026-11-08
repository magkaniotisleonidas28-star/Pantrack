'use client';
import {useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {Button} from '@/components/ui/button';
import {IssuedFileCheckClient,type IssuedCheckClientState} from '@/lib/issued-file-check-client';

type Props={companyId:string;documentId:string;viewerId:string;disabled:boolean;cancelRef:MutableRefObject<(()=>void)|null>;recorded:()=>void};
const labels={verified:'The file matched its saved record.',missing:'The file was not found during this check.',damaged:'The file contents did not match its saved record.',unavailable:'Storage could not confirm the file during this check.'};
export default function IssuedFileCheckControl({companyId,documentId,viewerId,disabled,cancelRef,recorded}:Props){
  const client=useRef<IssuedFileCheckClient|null>(null),notify=useRef(recorded);
  useLayoutEffect(()=>{notify.current=recorded;},[recorded]);
  const [state,setState]=useState<IssuedCheckClientState>({working:false,pending:false,retryable:false,message:''});
  useLayoutEffect(()=>{
    const current=new IssuedFileCheckClient({companyId,documentId},viewerId,{fetch:(...args)=>fetch(...args),storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},uuid:()=>crypto.randomUUID(),recorded:()=>notify.current()},setState);
    client.current=current;const cancel=()=>current.cancel();cancelRef.current=cancel;
    return()=>{current.dispose();if(client.current===current)client.current=null;if(cancelRef.current===cancel)cancelRef.current=null;};
  },[companyId,documentId,viewerId,cancelRef]);
  useLayoutEffect(()=>{if(disabled)client.current?.cancel();},[disabled]);
  return <section aria-label="Check issued file" aria-busy={state.working}>
    <p>Check the existing file now. This records a result without changing or replacing the file.</p>
    <div className="po-actions"><Button type="button" variant="outline" disabled={disabled||state.working||state.pending||!client.current} onClick={()=>void client.current?.check()}>Check file now</Button>
      {state.retryable&&<Button type="button" variant="outline" disabled={disabled||state.working} onClick={()=>void client.current?.retry()}>Retry this check</Button>}
      {state.working&&<Button type="button" variant="ghost" onClick={()=>client.current?.cancel()}>Stop waiting for check</Button>}</div>
    {state.message&&<p role={state.pending&&!state.working?'alert':'status'}>{state.message}</p>}
    {state.check&&<p role="status">{state.replayed?'Recorded result from an earlier check':'New check recorded'}: {labels[state.check.outcome]}{' '}
      <time dateTime={state.check.checkedAt}>{new Date(state.check.checkedAt).toLocaleString()}</time>. Start a new check to inspect the file again.</p>}
  </section>;
}
