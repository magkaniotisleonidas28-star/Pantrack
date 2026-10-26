'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PoCartDeliveries} from '@/lib/d1-po-cart-deliveries';
import './deliveries.css';

// Blind delivery counting: item names and pack descriptions only, never expected amounts or prices.
// The server decides validity; a manager approves what enters stock.
export type CountableOrder=Awaited<ReturnType<D1PoCartDeliveries['staff']>>['orders'][number];
export class DeliveryRequestError extends Error {constructor(message:string,public status:number,public uncertain=false){super(message);}}
export async function deliveryRequest<T>(query:Record<string,string>|null,body?:Record<string,unknown>):Promise<T>{
  const r=await fetch(body?'/api/po-cart-deliveries':`/api/po-cart-deliveries?${new URLSearchParams(query??{})}`,
    body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await r.json().catch(()=>({})) as T&{error?:string;uncertain?:boolean;code?:string};
  if(!r.ok)throw new DeliveryRequestError(data.error??'Could not load deliveries.',r.status,!!data.uncertain||data.code==='storage_failure');
  return data;
}
/** Sends one save, offering an exact retry when its outcome is uncertain. */
export function useDeliverySave(onSaved:()=>void){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  async function send(body:Record<string,unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');pending.current=body;
    try{await deliveryRequest(null,body);pending.current=null;setUncertain(false);onSaved();}
    catch(e){const failure=e as DeliveryRequestError;
      if(failure.uncertain){setUncertain(true);setError('The save outcome is uncertain. Retry the same save; it will not be applied twice.');}
      else{pending.current=null;setError(failure.message);}}
    finally{lock.current=false;setBusy(false);}
  }
  const retry=uncertain?<div className="po-actions"><Button type="button" disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>Retry the same save</Button></div>:null;
  return {send,error,setError,busy,blocked:busy||uncertain,retry};
}
const localNow=()=>{const d=new Date();d.setSeconds(0,0);return new Date(d.getTime()-d.getTimezoneOffset()*60_000).toISOString().slice(0,16);};
export function DeliveryCountForm({companyId,order,title='Count this delivery',onSaved}:{companyId:string;order:CountableOrder;title?:string;onSaved:()=>void}){
  const [lines,setLines]=useState(order.lines.map(l=>({lineId:l.lineId,received:'',damaged:'0'}))),[arrived,setArrived]=useState(localNow),[note,setNote]=useState('');
  const save=useDeliverySave(onSaved);
  useEffect(()=>{setLines(order.lines.map(l=>({lineId:l.lineId,received:'',damaged:'0'})));},[order.confirmationId,order.lines.length]);
  function submit(e:React.FormEvent){
    e.preventDefault();
    const whole=(v:string)=>/^\d{1,4}$/.test(v.trim());
    if(lines.some(l=>!whole(l.received)||!whole(l.damaged)))return save.setError('Enter whole packs for every item (0 if it did not arrive).');
    const at=new Date(arrived);if(!Number.isFinite(at.getTime()))return save.setError('Enter when the delivery arrived.');
    void save.send({action:'count',companyId,confirmationId:order.confirmationId,operationId:crypto.randomUUID(),deliveredAt:at.toISOString(),
      lines:lines.map(l=>({lineId:l.lineId,receivedPacks:String(Number(l.received.trim())),damagedPacks:String(Number(l.damaged.trim()))})),note:note.trim()});
  }
  const set=(i:number,patch:Partial<typeof lines[number]>)=>setLines(lines.map((x,k)=>k===i?{...x,...patch}:x));
  return <form className="delivery-count" onSubmit={submit} aria-label={`${title}: supplier order ${order.supplierReference}`} data-delivery-count>
    <h3>{title}</h3>
    <p>Count the packs that arrived, including damaged ones, and say how many are damaged. A manager reviews the count before anything is added to stock.</p>
    <fieldset disabled={save.blocked}>
      <label className="delivery-arrived">Arrived at<Input type="datetime-local" required value={arrived} max={localNow()} onChange={e=>setArrived(e.target.value)}/></label>
      <table className="cart-preview-table"><caption className="sr-only">Packs counted</caption><thead><tr><th>Item</th><th>Packs received</th><th>Damaged</th></tr></thead>
        <tbody>{order.lines.map((l,i)=><tr key={l.lineId}><td>{l.description} · {l.sku}<span className="po-muted"> ({l.unitLabel})</span></td>
          <td><Input aria-label={`Packs received of ${l.description}`} inputMode="numeric" required value={lines[i]?.received??''} onChange={e=>set(i,{received:e.target.value})}/></td>
          <td><Input aria-label={`Damaged packs of ${l.description}`} inputMode="numeric" required value={lines[i]?.damaged??''} onChange={e=>set(i,{damaged:e.target.value})}/></td></tr>)}</tbody></table>
      <label>Note (optional)<textarea rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <div className="po-actions"><Button type="submit">Save count</Button></div>
    </fieldset>
    {save.retry}
    {save.error&&<p role="alert" className="po-field-error">{save.error}</p>}
  </form>;
}
export default function StaffDeliveries({companyId}:{companyId:string}){
  const [orders,setOrders]=useState<CountableOrder[]|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  async function load(){try{setOrders((await deliveryRequest<{orders:CountableOrder[]}>({companyId,view:'staff'})).orders);setError('');}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();},[companyId]);
  return <section className="staff-deliveries" aria-labelledby="staff-deliveries-title" data-staff-deliveries>
    <h1 id="staff-deliveries-title">Deliveries</h1>
    {saved&&<p role="status">Count saved. A manager will review it.</p>}
    {error&&<p role="alert">{error}</p>}
    {!orders&&!error&&<p>Loading…</p>}
    {orders&&!orders.length&&<p>No supplier orders are waiting for a delivery.</p>}
    {orders?.map(o=><article key={o.confirmationId} className="delivery-order">
      <h2>Supplier order {o.supplierReference}</h2>
      <p className="po-muted">Expected {new Date(o.expectedDelivery+'T00:00:00').toLocaleDateString()}</p>
      {o.waitingForReview?<p>The last count for this order is waiting for a manager.</p>
        :<DeliveryCountForm companyId={companyId} order={o} onSaved={()=>{setSaved(true);void load();}}/>}
    </article>)}
  </section>;
}
