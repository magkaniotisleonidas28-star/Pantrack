'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PoCartDeliveries} from '@/lib/d1-po-cart-deliveries';
import {DeliveryCountForm,deliveryRequest,useDeliverySave} from './delivery-count';

// Manager receiving for a confirmed order: what is still expected, the pending count to approve or
// send back, and the delivery history. Approval posts accepted stock once on the server.
type View=Awaited<ReturnType<D1PoCartDeliveries['manager']>>;
type Decision={accept:string;excess:string;releaseRest:boolean};
const kinds={stock:'',non_stock:' (no stock)',extra:' (substitute, no stock)'};
const time=(iso:string)=>new Date(iso).toLocaleString();
export default function SupplierDeliveries({companyId,jobId}:{companyId:string;jobId:string}){
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[decisions,setDecisions]=useState<Record<string,Decision>>({}),[note,setNote]=useState('');
  async function load(){
    try{
      const next=await deliveryRequest<View>({companyId,view:'manager',jobId});setView(next);setError('');setNote('');
      const pending=next.deliveries.find(d=>d.state==='counted');
      setDecisions(Object.fromEntries((pending?.count??[]).map(c=>{const owed=BigInt(next.lines.find(l=>l.lineId===c.lineId)?.owedPacks??'0'),good=BigInt(c.receivedPacks)-BigInt(c.damagedPacks);
        return [c.lineId,{accept:String(good<owed?good:owed),excess:'0',releaseRest:false}];})));
    }catch(e){setError((e as Error).message);}
  }
  useEffect(()=>{void load();},[companyId,jobId]);
  const save=useDeliverySave(()=>void load());
  if(!view)return error?<p role="alert" className="po-field-error">{error}</p>:null;
  const pending=view.deliveries.find(d=>d.state==='counted'),line=(id:string)=>view.lines.find(l=>l.lineId===id)!;
  const set=(id:string,patch:Partial<Decision>)=>setDecisions({...decisions,[id]:{...decisions[id],...patch}});
  function approve(e:React.FormEvent){
    e.preventDefault();if(!pending)return;
    if(Object.values(decisions).some(d=>!/^\d{1,4}$/.test(d.accept.trim())||!/^\d{1,4}$/.test(d.excess.trim())))return save.setError('Enter whole packs to accept for every item (0 for none).');
    void save.send({action:'approve',companyId,deliveryId:pending.id,operationId:crypto.randomUUID(),note:note.trim(),
      lines:pending.count.map(c=>({lineId:c.lineId,acceptPacks:String(Number(decisions[c.lineId].accept)),excessPacks:String(Number(decisions[c.lineId].excess)),releaseRest:decisions[c.lineId].releaseRest}))});
  }
  function recount(){
    if(!pending)return;if(!note.trim())return save.setError('Say what should be recounted in the note.');
    void save.send({action:'recount',companyId,deliveryId:pending.id,operationId:crypto.randomUUID(),note:note.trim()});
  }
  return <section className="supplier-deliveries" aria-labelledby="supplier-deliveries-title" data-supplier-deliveries>
    <h3 id="supplier-deliveries-title">Deliveries</h3>
    <p role="status">{view.complete?'Everything on this order is received or marked as not arriving.':pending?'A delivery count is waiting for your review.':'Waiting for a delivery to be counted.'}</p>
    <table className="cart-preview-table"><caption className="sr-only">Delivery progress in packs</caption>
      <thead><tr><th>Item</th><th>Confirmed</th><th>Received</th><th>Won't arrive</th><th>Still expected</th></tr></thead>
      <tbody>{view.lines.map(l=><tr key={l.lineId}><td>{l.description} · {l.sku}{kinds[l.kind]}</td><td>{l.confirmedPacks}</td>
        <td>{l.acceptedPacks}{l.excessPacks!=='0'&&` + ${l.excessPacks} extra`}</td><td>{l.releasedPacks}</td><td data-changed={l.owedPacks!=='0'||undefined}>{l.owedPacks}</td></tr>)}</tbody></table>
    {pending&&<form onSubmit={approve} className="delivery-review" aria-label="Review delivery count" data-delivery-review>
      <h4>Review the count</h4>
      <p>Counted by {pending.countedBy} at {time(pending.countedAt)}; arrived {time(pending.deliveredAt)}.{pending.countNote&&<> Note: “{pending.countNote}”</>}</p>
      <p className="po-muted">Damaged packs are never added. Extra packs beyond the order can be added only when everything expected is accepted. Anything not accepted stays expected unless you mark the rest as not arriving.</p>
      <fieldset disabled={save.blocked}>
        <table className="cart-preview-table"><caption className="sr-only">Decide each counted item</caption>
          <thead><tr><th>Item</th><th>Still expected</th><th>Counted (damaged)</th><th>Accept packs</th><th>Extra packs</th><th>Rest won't arrive</th></tr></thead>
          <tbody>{pending.count.map(c=>{const l=line(c.lineId),d=decisions[c.lineId];if(!d)return null;
            const good=BigInt(c.receivedPacks)-BigInt(c.damagedPacks),differs=good!==BigInt(l.owedPacks);
            return <tr key={c.lineId}><td>{l.description}{kinds[l.kind]}</td><td>{l.owedPacks}</td>
              <td data-changed={differs||c.damagedPacks!=='0'||undefined}>{c.receivedPacks}{c.damagedPacks!=='0'&&` (${c.damagedPacks} damaged)`}</td>
              <td><Input aria-label={`Accept packs of ${l.description}`} inputMode="numeric" value={d.accept} onChange={e=>set(c.lineId,{accept:e.target.value})}/></td>
              <td><Input aria-label={`Extra packs of ${l.description}`} inputMode="numeric" value={d.excess} onChange={e=>set(c.lineId,{excess:e.target.value})}/></td>
              <td><input type="checkbox" aria-label={`The rest of ${l.description} won't arrive`} checked={d.releaseRest} onChange={e=>set(c.lineId,{releaseRest:e.target.checked})}/></td></tr>;})}</tbody></table>
        <label>Note (required to ask for a recount)<textarea rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
        <div className="po-actions"><Button type="submit">Approve delivery</Button><Button type="button" variant="outline" onClick={recount}>Ask for a recount</Button></div>
      </fieldset>
      {save.retry}
      {save.error&&<p role="alert" className="po-field-error">{save.error}</p>}
    </form>}
    {!pending&&!view.complete&&<DeliveryCountForm companyId={companyId} order={view.countable} title="Count a delivery" onSaved={()=>void load()}/>}
    {view.deliveries.length>0&&<><h4>Delivery history</h4><ul className="delivery-history">{view.deliveries.map(d=><li key={d.id}>
      <strong>{d.state==='approved'?'Approved':d.state==='recount'?'Sent back for recount':'Waiting for review'}</strong> · arrived {time(d.deliveredAt)} · counted by {d.countedBy}
      {d.decidedBy&&<> · decided by {d.decidedBy} at {time(d.decidedAt!)}</>}{d.state==='approved'&&!d.stockAdded&&' · no stock change'}{d.decisionNote&&<> · “{d.decisionNote}”</>}</li>)}</ul></>}
    <p className="po-muted">Delivery counts and decisions cannot be edited. Closing the order and freeing its spending hold comes in a later step.</p>
  </section>;
}
