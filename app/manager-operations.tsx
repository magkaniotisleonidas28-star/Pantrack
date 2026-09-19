'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
export default function ManagerOperations({companyId}:{companyId:string}){
  const [data,setData]=useState<{mode:string;jobs:{id:string;status:string;amount:number}[]}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function load(){try{const r=await fetch('/api/automation?companyId='+encodeURIComponent(companyId)),d=await r.json() as NonNullable<typeof data> & {error?:string;message?:string};if(!r.ok)throw new Error(d.error);setData(d);}catch(e){setMessage((e as Error).message);}}
  useEffect(()=>{void load();},[companyId]);
  async function act(action:string,id?:string){setBusy(true);try{const r=await fetch('/api/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,action,id})}),d=await r.json() as NonNullable<typeof data> & {error?:string;message?:string};if(!r.ok)throw new Error(d.error);setMessage(d.message||'Updated.');await load();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section><h1>Purchasing operations</h1><p>Automation: {data?.mode||'Loading…'}. Supplier submission remains disabled until the purchasing milestones are verified.</p>{message&&<p role="status">{message}</p>}<Button disabled={busy} onClick={()=>void act('pause')}>Pause automation</Button><Button disabled={busy} onClick={()=>void act('run')}>Check replenishment</Button>{data?.jobs.map(j=><div key={j.id}><p>{j.id} — {j.status} — ${(j.amount/100).toFixed(2)}</p>{(j.status==='review'?['approve','dismiss']:['accepted','unknown'].includes(j.status)?['reconcile',...(j.status==='accepted'?['received']:[])]:[]).map(a=><Button key={a} disabled={busy} onClick={()=>void act(a,j.id)}>{a}</Button>)}</div>)}</section>;
}
