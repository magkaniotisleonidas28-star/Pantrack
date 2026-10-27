'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PoCartConfirmations} from '@/lib/d1-po-cart-confirmations';
import type {ConfirmationState} from '@/lib/po-cart-confirmation-contract';
import {chargeKinds} from '@/lib/po-cart-confirmation-contract';
import {purchasingCents,purchasingDollars} from './purchasing-client';
import './supplier-confirmation.css';

// Manager-entered supplier confirmation for a ready cart. The server decides validity, stock
// effects and over-cap holds; this form only collects what the supplier confirmed.
type View=Awaited<ReturnType<D1PoCartConfirmations['get']>>;
class ConfirmationRequestError extends Error {constructor(message:string,public status:number,public uncertain=false,public code=''){super(message);}}
async function confirmationRequest<T>(companyId:string,jobId:string,body?:Record<string,unknown>):Promise<T>{
  const r=await fetch(body?'/api/po-cart-confirmations':`/api/po-cart-confirmations?companyId=${encodeURIComponent(companyId)}&jobId=${encodeURIComponent(jobId)}`,
    body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await r.json().catch(()=>({})) as T&{error?:string;uncertain?:boolean;code?:string};
  if(!r.ok)throw new ConfirmationRequestError(data.error??'Could not load the supplier confirmation.',r.status,!!data.uncertain||data.code==='storage_failure',data.code??'');
  return data;
}
const usd=(minor:string|number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(minor)/100);
const kindLabels:Record<typeof chargeKinds[number],string>={delivery:'Delivery fee',tax:'Tax',fuel:'Fuel surcharge',other:'Other charge'};
type LineForm={lineId:string;packs:string;price:string};type Extra={sku:string;description:string;packs:string;price:string};
type Charge={kind:typeof chargeKinds[number];description:string;amount:string};
const LIMIT_LABELS={per_order:'the per-order limit',per_day:"that day's limit",per_month:"that month's limit",in_progress:'the in-progress limit'} as const;
type Confirmation=NonNullable<View['confirmation']>;
/**
 * The owner's review of an over-cap confirmation: approve the full total after confirming their
 * password (counted even over a limit, with the overage shown), or leave it held with a note.
 */
function OverCapReview({companyId,jobId,c,onSaved}:{companyId:string;jobId:string;c:Confirmation;onSaved:()=>Promise<void>}){
  const [note,setNote]=useState(''),[password,setPassword]=useState(''),[confirming,setConfirming]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  async function send(body:Record<string,unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');pending.current=body;
    try{await confirmationRequest(companyId,jobId,body);pending.current=null;setUncertain(false);setConfirming('');setNote('');await onSaved();}
    catch(e){const failure=e as ConfirmationRequestError;
      if(failure.code==='reauthentication_required')setConfirming(failure.message);
      else if(failure.uncertain){setUncertain(true);setError('The save outcome is uncertain. Retry the same save; it will not be applied twice.');}
      else{pending.current=null;setError(failure.message);}}
    finally{lock.current=false;setBusy(false);}
  }
  async function confirm(e:React.FormEvent){
    e.preventDefault();if(lock.current||!pending.current)return;lock.current=true;setBusy(true);setError('');let confirmed=false;
    try{
      const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reauthenticate',password})});
      const data=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new Error(data.error??'Password confirmation failed.');confirmed=true;
    }catch(failure){setError(`Password confirmation failed: ${(failure as Error).message}`);}
    finally{setPassword('');lock.current=false;setBusy(false);}
    if(confirmed&&pending.current)await send(pending.current);
  }
  function cancel(){pending.current=null;setConfirming('');setPassword('');setError('');setUncertain(false);}
  const blocked=busy||uncertain||!!confirming;
  return <div className="over-cap-review" data-over-cap-review>
    <h4>Owner review</h4>
    <p>The supplier confirmed {usd(c.totalMinor)}, which is {usd(c.totalMinor-c.capMinor)} over the approved {usd(c.capMinor)} cap. Approving counts the full {usd(c.totalMinor)} toward your limits and adds the confirmed items to incoming stock.</p>
    {c.warnings.length>0&&<div role="note" className="over-cap-warning"><p>Approving puts the café over:</p><ul>{c.warnings.map(w=><li key={w.limit}>{LIMIT_LABELS[w.limit]} ({usd(w.limitMinor)}) by <strong>{usd(w.overByMinor)}</strong></li>)}</ul>
      <p>New carts are refused until spending is back under these limits.</p></div>}
    {confirming&&<form onSubmit={confirm} aria-label="Confirm your password"><fieldset disabled={busy}><p>{confirming}</p>
      <label>Current password<Input type="password" autoComplete="current-password" autoFocus required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <div className="po-actions"><Button type="submit">Confirm and approve</Button><Button type="button" variant="outline" onClick={cancel}>Cancel</Button></div></fieldset></form>}
    <fieldset disabled={blocked}>
      <label>Note (required to leave it held)<textarea rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <div className="po-actions"><Button type="button" onClick={()=>void send({action:'approve_over_cap',companyId,confirmationId:c.id,operationId:crypto.randomUUID(),note:note.trim()})}>Approve {usd(c.totalMinor)}</Button>
        <Button type="button" variant="outline" onClick={()=>{if(!note.trim())return setError('Say what should happen with this order.');
          void send({action:'hold_note',companyId,confirmationId:c.id,operationId:crypto.randomUUID(),note:note.trim()});}}>Leave it held with this note</Button></div>
    </fieldset>
    {uncertain&&pending.current&&<div className="po-actions"><Button type="button" disabled={busy} onClick={()=>void send(pending.current!)}>Retry the same save</Button></div>}
    {error&&<p role="alert" className="po-field-error">{error}</p>}
  </div>;
}
function cents(value:string,label:string){try{return purchasingCents(value);}catch{throw new Error(`${label}: enter dollars with at most two decimal places.`);}}
export default function SupplierConfirmation({companyId,jobId,canRecord,onState}:{companyId:string;jobId:string;canRecord:boolean;onState:(state:ConfirmationState|null)=>void}){
  const [view,setView]=useState<View|null>(null),[lines,setLines]=useState<LineForm[]>([]),[extras,setExtras]=useState<Extra[]>([]),[charges,setCharges]=useState<Charge[]>([]);
  const [reference,setReference]=useState(''),[delivery,setDelivery]=useState(''),[note,setNote]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  function adopt(next:View){
    // An owner-approved over-cap confirmation counts as confirmed from here on.
    setView(next);onState(next.confirmation?(next.confirmation.approval?'confirmed':next.confirmation.state):null);
    setLines(next.authorizedLines.map(l=>({lineId:l.lineId,packs:l.packs,price:purchasingDollars(l.unitMinor)})));
  }
  async function load(){try{adopt(await confirmationRequest<View>(companyId,jobId));setError('');}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();},[companyId,jobId]);
  const totals=useMemo(()=>{try{
    const items=lines.reduce((s,l)=>s+BigInt(l.packs||'0')*BigInt(cents(l.price||'0','Price')),BigInt(0))+extras.reduce((s,e)=>s+BigInt(e.packs||'0')*BigInt(cents(e.price||'0','Price')),BigInt(0));
    const fees=charges.reduce((s,c)=>s+BigInt(cents(c.amount||'0','Charge')),BigInt(0));return {items,fees,total:items+fees};}catch{return null;}},[lines,extras,charges]);
  async function send(body:Record<string,unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');pending.current=body;
    try{await confirmationRequest(companyId,jobId,body);pending.current=null;setUncertain(false);await load();}
    catch(e){const failure=e as ConfirmationRequestError;
      if(failure.uncertain){setUncertain(true);setError('The save outcome is uncertain. Retry the same save; it will not be applied twice.');}
      else{pending.current=null;setError(failure.message);}}
    finally{lock.current=false;setBusy(false);}
  }
  function submit(e:React.FormEvent){
    e.preventDefault();if(!view)return;
    try{
      if(lines.some(l=>!/^\d{1,4}$/.test(l.packs.trim())))throw new Error('Enter whole packs for every line (0 if not confirmed).');
      void send({action:'record',companyId,jobId,expectedJobRevision:view.job.revision,operationId:crypto.randomUUID(),supplierReference:reference.trim(),expectedDelivery:delivery,
        lines:lines.map(l=>({lineId:l.lineId,packs:String(Number(l.packs.trim())),unitMinor:cents(l.price,'Unit price')})),
        extras:extras.map(x=>({sku:x.sku.trim(),description:x.description.trim(),packs:String(Number(x.packs)),unitMinor:cents(x.price,'Extra item price')})),
        charges:charges.map(c=>({kind:c.kind,description:c.description.trim(),amountMinor:cents(c.amount,kindLabels[c.kind])})),note:note.trim()});
    }catch(failure){setError((failure as Error).message);}
  }
  if(!view)return error?<p role="alert" className="po-field-error">{error}</p>:null;
  const c=view.confirmation;
  if(c)return <section className="supplier-confirmation" aria-labelledby="supplier-confirmation-title" data-supplier-confirmation>
    <h3 id="supplier-confirmation-title">Supplier confirmation recorded</h3>
    <p role="status">{c.state==='confirmed'?'Confirmed items were added to incoming stock once. The spending reservation stays held until the delivery is checked.'
      :c.approval?`The owner approved the ${usd(c.approval.totalMinor)} total, over the ${usd(c.capMinor)} cap. Confirmed items were added to incoming stock once, and the full total counts toward the limits.`
      :`The confirmed total is over the approved ${usd(c.capMinor)} cap. It waits for the owner's review; no stock was added.`}</p>
    <p>Supplier order <strong>{c.supplierReference}</strong> · expected {new Date(c.expectedDelivery+'T00:00:00').toLocaleDateString()} · total <strong>{usd(c.totalMinor)}</strong> of {usd(c.capMinor)} cap</p>
    <table className="cart-preview-table"><caption className="sr-only">Confirmed lines and differences</caption><thead><tr><th>Item</th><th>Packs</th><th>Unit price</th></tr></thead>
      <tbody>{c.lines.map((l:{lineId:string;description:string;sku:string;authorizedPacks:string;packs:string;estimateUnitMinor:string;unitMinor:string;packsChanged:boolean;priceChanged:boolean})=><tr key={l.lineId}>
        <td>{l.description} · {l.sku}</td><td data-changed={l.packsChanged||undefined}>{l.packsChanged?`${l.authorizedPacks} → ${l.packs}`:l.packs}</td>
        <td data-changed={l.priceChanged||undefined}>{l.priceChanged?`${usd(l.estimateUnitMinor)} → ${usd(l.unitMinor)}`:usd(l.unitMinor)}</td></tr>)}
        {c.extras.map((x:{sku:string;description:string;packs:string;unitMinor:string},i:number)=><tr key={'x'+i} data-changed><td>Added: {x.description} · {x.sku} (no stock until reviewed)</td><td>{x.packs}</td><td>{usd(x.unitMinor)}</td></tr>)}</tbody></table>
    {c.charges.length>0&&<p>Charges: {c.charges.map((x:{kind:typeof chargeKinds[number];amountMinor:string})=>`${kindLabels[x.kind]} ${usd(x.amountMinor)}`).join(' · ')}</p>}
    <p className="po-muted">Recorded by {c.actor} on {new Date(c.createdAt).toLocaleString()}. Supplier confirmations cannot be edited.</p>
    {c.approval&&<p className="po-muted" data-over-cap-approved>Approved by {c.approval.by} on {new Date(c.approval.at).toLocaleString()}{c.approval.note&&<> · “{c.approval.note}”</>}.</p>}
    {c.notes.length>0&&<ul className="over-cap-notes" aria-label="Owner notes">{c.notes.map((n,i)=><li key={i}>Held by {n.by} on {new Date(n.at).toLocaleString()}: “{n.note}”</li>)}</ul>}
    {c.canReview&&<OverCapReview companyId={companyId} jobId={jobId} c={c} onSaved={load}/>}
    {c.state==='needs_owner_review'&&!c.approval&&!c.canReview&&<p data-over-cap-waiting>Waiting for the owner's review.</p>}
  </section>;
  if(!canRecord)return null;
  const blocked=busy||uncertain,over=!!totals&&totals.total>BigInt(view.capMinor);
  return <form className="supplier-confirmation" onSubmit={submit} aria-labelledby="supplier-confirmation-title" data-supplier-confirmation>
    <h3 id="supplier-confirmation-title">Record supplier confirmation</h3>
    <p>After checking out on the supplier's website, enter what the supplier confirmed, for example from their confirmation email. A checkout alone is not a confirmation.</p>
    <fieldset disabled={blocked}>
      <div className="supplier-confirmation-fields">
        <label>Supplier order number<Input required maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label>
        <label>Expected delivery<Input type="date" required value={delivery} onChange={e=>setDelivery(e.target.value)}/></label>
      </div>
      <table className="cart-preview-table"><caption className="sr-only">Confirmed quantities and prices</caption><thead><tr><th>Item</th><th>Ordered</th><th>Confirmed packs</th><th>Unit price (USD)</th></tr></thead>
        <tbody>{view.authorizedLines.map((l,i)=><tr key={l.lineId}><td>{l.description} · {l.sku}</td><td>{l.packs}</td>
          <td><Input aria-label={`Confirmed packs for ${l.description}`} inputMode="numeric" value={lines[i]?.packs??''} onChange={e=>setLines(lines.map((x,k)=>k===i?{...x,packs:e.target.value}:x))}/></td>
          <td><Input aria-label={`Unit price for ${l.description}`} inputMode="decimal" value={lines[i]?.price??''} onChange={e=>setLines(lines.map((x,k)=>k===i?{...x,price:e.target.value}:x))}/></td></tr>)}</tbody></table>
      <p className="po-muted">Enter 0 packs for anything the supplier did not confirm.</p>
      {extras.map((x,i)=><div className="supplier-confirmation-fields" key={'x'+i}>
        <label>Extra item SKU<Input required value={x.sku} onChange={e=>setExtras(extras.map((y,k)=>k===i?{...y,sku:e.target.value}:y))}/></label>
        <label>Description<Input required value={x.description} onChange={e=>setExtras(extras.map((y,k)=>k===i?{...y,description:e.target.value}:y))}/></label>
        <label>Packs<Input required inputMode="numeric" value={x.packs} onChange={e=>setExtras(extras.map((y,k)=>k===i?{...y,packs:e.target.value}:y))}/></label>
        <label>Unit price (USD)<Input required inputMode="decimal" value={x.price} onChange={e=>setExtras(extras.map((y,k)=>k===i?{...y,price:e.target.value}:y))}/></label>
        <Button type="button" variant="outline" onClick={()=>setExtras(extras.filter((_,k)=>k!==i))}>Remove extra item</Button></div>)}
      {charges.map((x,i)=><div className="supplier-confirmation-fields" key={'c'+i}>
        <label>Charge<select value={x.kind} onChange={e=>setCharges(charges.map((y,k)=>k===i?{...y,kind:e.target.value as Charge['kind']}:y))}>{chargeKinds.map(k=><option key={k} value={k}>{kindLabels[k]}</option>)}</select></label>
        <label>Amount (USD)<Input required inputMode="decimal" value={x.amount} onChange={e=>setCharges(charges.map((y,k)=>k===i?{...y,amount:e.target.value}:y))}/></label>
        <Button type="button" variant="outline" onClick={()=>setCharges(charges.filter((_,k)=>k!==i))}>Remove charge</Button></div>)}
      <div className="po-actions"><Button type="button" variant="outline" disabled={extras.length>=50} onClick={()=>setExtras([...extras,{sku:'',description:'',packs:'1',price:''}])}>Add substituted or extra item</Button>
        <Button type="button" variant="outline" disabled={charges.length>=20} onClick={()=>setCharges([...charges,{kind:'delivery',description:'',amount:''}])}>Add charge</Button></div>
      <label>Note (optional)<textarea rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <p role="status">{totals?<>Items {usd(String(totals.items))} + charges {usd(String(totals.fees))} = <strong>{usd(String(totals.total))}</strong> of the approved {usd(view.capMinor)} cap.</>:'Enter prices in dollars.'}
        {over&&' This is over the approved cap, so it will be held for the owner and no stock will be added.'}</p>
      <div className="po-actions"><Button type="submit" disabled={!reference.trim()||!delivery}>Save supplier confirmation</Button></div>
    </fieldset>
    {uncertain&&<div className="po-actions"><Button type="button" disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>Retry the same save</Button></div>}
    {error&&<p role="alert" className="po-field-error">{error}</p>}
  </form>;
}
