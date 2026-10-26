'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {SpendingLimits,SpendingLimitsResult,SpendingLimitsStatus} from '@/lib/po-cart-spending-limits-contract';
import {purchasingCents,purchasingDollars} from './purchasing-client';
import './purchase-order-drafts.css';
import './spending-limits.css';

// Owner-only spending limits for the fictional cart preview. The server decides access,
// password confirmation and enforcement; this screen only explains and submits.
class LimitsRequestError extends Error {constructor(message:string,public status:number,public code?:string,public uncertain=false){super(message);}}
async function limitsRequest<T>(companyId:string,body?:Record<string,unknown>):Promise<T>{
  const response=await fetch(`/api/po-cart-spending-limits?companyId=${encodeURIComponent(companyId)}`,body?
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json().catch(()=>({})) as T&{error?:string;code?:string;uncertain?:boolean};
  if(!response.ok)throw new LimitsRequestError(data.error??'Could not load spending limits.',response.status,data.code,!!data.uncertain||data.code==='storage_failure');
  return data;
}
type Form={perOrder:string;perDay:string;perMonth:string;outstanding:string};
const dollars=(minor:number|null)=>minor===null?'':purchasingDollars(String(minor));
const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const money=(minor:number)=>usd.format(minor/100),shown=(minor:number|null)=>minor===null?'No limit':money(minor);
const formOf=(limits:SpendingLimits|null):Form=>limits?.ownerSet?{perOrder:dollars(limits.perOrderMinor),perDay:dollars(limits.perDayMinor),
  perMonth:dollars(limits.perMonthMinor),outstanding:dollars(limits.outstandingMinor)}:{perOrder:'',perDay:'',perMonth:'',outstanding:''};
function cents(value:string,label:string){
  const minor=Number(purchasingCents(value));
  if(minor<1||minor>1_000_000_000)throw new Error(`${label} must be between $0.01 and $10,000,000.00.`);return minor;
}
export default function SpendingLimitsPanel({companyId,active,onEnabledChange,onDirtyChange}:{companyId:string;active:boolean;onEnabledChange:(v:boolean)=>void;onDirtyChange:(v:boolean)=>void}){
  const [status,setStatus]=useState<SpendingLimitsStatus|null>(null),[enabled,setEnabled]=useState(false);
  const [form,setForm]=useState<Form>(formOf(null)),[zone,setZone]=useState(''),[password,setPassword]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [confirming,setConfirming]=useState(''),[uncertain,setUncertain]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  const zones=useMemo(()=>{try{return Intl.supportedValuesOf('timeZone');}catch{return [];}},[]);
  const baseline=JSON.stringify([formOf(status?.limits??null),status?.timeZone?.timeZone??'']);
  const dirty=!!status&&JSON.stringify([form,zone])!==baseline;
  useEffect(()=>onDirtyChange(dirty||uncertain||!!confirming),[dirty,uncertain,confirming,onDirtyChange]);
  function adopt(next:SpendingLimitsStatus){setStatus(next);setForm(formOf(next.limits));setZone(next.timeZone?.timeZone??'');}
  useEffect(()=>{let live=true;void limitsRequest<SpendingLimitsStatus>(companyId).then(data=>{if(live){adopt(data);setEnabled(true);onEnabledChange(true);}})
    .catch(e=>{if(live){setEnabled(false);onEnabledChange(false);if(!(e instanceof LimitsRequestError&&[403,404].includes(e.status)))setError(e.message);}});
    return()=>{live=false;};},[companyId,onEnabledChange]);
  useEffect(()=>{if(enabled&&active&&!dirty&&!pending.current)void limitsRequest<SpendingLimitsStatus>(companyId).then(adopt).catch(e=>setError(e.message));},[enabled,active]);
  async function send(body:Record<string,unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');pending.current=body;
    try{
      const result=await limitsRequest<SpendingLimitsResult>(companyId,body);
      pending.current=null;setUncertain(false);setConfirming('');adopt(result.current);
      setNotice(result.receipt.action==='set_time_zone'?'Café time zone saved.':'Spending limits saved.');
    }catch(e){
      const failure=e as LimitsRequestError;
      if(failure.code==='reauthentication_required'){setConfirming(failure.message);return;}
      if(failure.uncertain){setUncertain(true);setError('The save outcome is uncertain. Retry the same save; it will not be applied twice.');return;}
      pending.current=null;setError(failure.message);
    }finally{lock.current=false;setBusy(false);}
  }
  function saveLimits(e:React.FormEvent){
    e.preventDefault();if(!status)return;
    try{
      const perOrderMinor=cents(form.perOrder,'Per order'),perDayMinor=cents(form.perDay,'Per day'),outstandingMinor=cents(form.outstanding,'In progress');
      const perMonthMinor=form.perMonth.trim()?cents(form.perMonth,'Per month'):null;
      if(perOrderMinor>perDayMinor)throw new Error('Per order cannot be more than per day.');
      if(perMonthMinor!==null&&perDayMinor>perMonthMinor)throw new Error('Per day cannot be more than per month.');
      if(perOrderMinor>outstandingMinor)throw new Error('Per order cannot be more than in progress.');
      void send({action:'set_limits',companyId,operationId:crypto.randomUUID(),expectedVersion:status.limits?.version??0,perOrderMinor,perDayMinor,perMonthMinor,outstandingMinor});
    }catch(failure){setError((failure as Error).message);}
  }
  function saveZone(e:React.FormEvent){
    e.preventDefault();if(!status)return;
    void send({action:'set_time_zone',companyId,operationId:crypto.randomUUID(),expectedVersion:status.timeZone?.version??0,timeZone:zone.trim()});
  }
  async function confirm(e:React.FormEvent){
    e.preventDefault();if(lock.current||!pending.current)return;lock.current=true;setBusy(true);setError('');
    let confirmed=false;
    try{
      const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reauthenticate',password})});
      const data=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new Error(data.error??'Password confirmation failed.');confirmed=true;
    }catch(failure){setError(`Password confirmation failed: ${(failure as Error).message}`);}
    finally{setPassword('');lock.current=false;setBusy(false);}
    if(confirmed&&pending.current)await send(pending.current);
  }
  function cancelPending(){pending.current=null;setConfirming('');setUncertain(false);setPassword('');setError('');}
  if(!active)return null;
  if(!enabled)return <p>Spending limits are unavailable. {error}</p>;
  const usage=status?.usage,limits=status?.limits??null,owned=limits?.ownerSet?limits:null,tz=status?.timeZone?.timeZone;
  const local=(iso:string)=>new Date(iso).toLocaleString(undefined,{timeZone:tz,dateStyle:'medium',timeStyle:'short'});
  const blocked=busy||!!confirming||uncertain;
  return <section className="po-preview" data-spending-limits><div className="po-heading"><div><div className="eyebrow">SPENDING LIMITS</div><h1>Owner spending limits</h1>
    <p>Only you, the owner, can see or change these. Pantrack refuses to prepare a cart that would go over any limit. {status?.notice}</p></div></div>
    {error&&<div role="alert" className="error">{error}</div>}{notice&&<p role="status" className="notice">{notice}</p>}
    {confirming&&<form className="po-section" onSubmit={confirm} aria-label="Confirm your password"><fieldset disabled={busy}><legend>Confirm your password</legend>
      <p>{confirming} Tightening a limit never asks for this.</p>
      <label>Current password<Input type="password" autoComplete="current-password" autoFocus required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <div className="inventory-actions"><Button type="submit">Confirm and save</Button><Button type="button" variant="outline" onClick={cancelPending}>Cancel</Button></div></fieldset></form>}
    {uncertain&&<div className="inventory-actions"><Button disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>Retry the same save</Button><Button disabled={busy} variant="outline" onClick={cancelPending}>Discard</Button></div>}
    <section className="po-section" aria-label="Current use"><h2>Current use</h2>
      {!tz?<p>Set the café time zone first. Days and months follow the café's local clock.</p>:!owned?<p>No owner limits are set yet, so Pantrack uses its fictional test policy.</p>:usage&&<dl className="po-fields">
        <div><dt>Today</dt><dd>{money(usage.dayMinor)} of {shown(owned.perDayMinor)}</dd><small>{local(usage.window.dayStart)} – {local(usage.window.dayEnd)}</small></div>
        <div><dt>This month</dt><dd>{money(usage.monthMinor)} of {shown(owned.perMonthMinor)}</dd><small>{local(usage.window.monthStart)} – {local(usage.window.monthEnd)}</small></div>
        <div><dt>In progress</dt><dd>{money(usage.outstandingMinor)} of {shown(owned.outstandingMinor)}</dd><small>Carts reserved and not yet settled.</small></div>
        <div><dt>Per order</dt><dd>{shown(owned.perOrderMinor)}</dd><small>The most any single order can be.</small></div></dl>}
    </section>
    <form className="po-section" onSubmit={saveZone}><fieldset disabled={blocked}><legend>Café time zone</legend>
      <p>Current: {tz??'Not set'}. Changing it always asks for your password, because it moves when a day starts.</p>
      <label className="po-source">Time zone<Input list="spending-limit-zones" required maxLength={64} value={zone} placeholder="America/New_York" onChange={e=>setZone(e.target.value)}/></label>
      <datalist id="spending-limit-zones">{zones.map(z=><option key={z} value={z}/>)}</datalist>
      <div className="inventory-actions"><Button type="submit" disabled={!zone.trim()||zone.trim()===tz}>Save time zone</Button></div></fieldset></form>
    <form className="po-section" onSubmit={saveLimits}><fieldset disabled={blocked||!tz}><legend>Limits</legend>
      <p>Enter US dollars. Raising or removing a limit, or setting limits for the first time, asks for your password.</p>
      <div className="po-fields">
        <label>Per order<Input required inputMode="decimal" value={form.perOrder} onChange={e=>setForm({...form,perOrder:e.target.value})}/><small>The most any single order can be.</small></label>
        <label>Per day<Input required inputMode="decimal" value={form.perDay} onChange={e=>setForm({...form,perDay:e.target.value})}/><small>All orders started on one café day.</small></label>
        <label>Per month (optional)<Input inputMode="decimal" value={form.perMonth} onChange={e=>setForm({...form,perMonth:e.target.value})}/><small>Leave blank for no monthly limit.</small></label>
        <label>In progress<Input required inputMode="decimal" value={form.outstanding} onChange={e=>setForm({...form,outstanding:e.target.value})}/><small>All carts reserved and not yet settled.</small></label>
      </div>
      <div className="inventory-actions"><Button type="submit" disabled={!dirty}>Save limits</Button><Button type="button" variant="outline" disabled={!dirty} onClick={()=>status&&adopt(status)}>Reset unsaved fields</Button></div>
    </fieldset></form>
    <details className="po-section"><summary>Change history</summary>
      {status?.history.length?status.history.map(h=><article className="po-line" key={h.version}><h3>Version {h.version} · {h.ownerSet?'Set by owner':'Fictional test policy'}</h3>
        <p>Per order {shown(h.perOrderMinor)} · per day {shown(h.perDayMinor)} · per month {shown(h.perMonthMinor)} · in progress {shown(h.outstandingMinor)}</p>
        {h.createdAt&&<small>{new Date(h.createdAt).toLocaleString()} · {h.actor}</small>}</article>):<p>No limits have been recorded.</p>}
      {status?.timeZoneHistory.map(z=><p key={'tz'+z.version}>Time zone version {z.version}: {z.timeZone} · {new Date(z.createdAt).toLocaleString()} · {z.actor}</p>)}
    </details>
  </section>;
}
