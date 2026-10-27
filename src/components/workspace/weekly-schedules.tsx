'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PoDraftSchedules} from '@/lib/d1-po-draft-schedules';
import type {OccurrenceState} from '@/lib/po-draft-schedule-contract';
import './weekly-schedules.css';

// Weekly order drafts for owners and managers: set a supplier's weekly time, see each week's result.
// The server recalculates and drafts; nothing here prepares a cart, approves spending or orders.
type View=Awaited<ReturnType<D1PoDraftSchedules['list']>>;
type Schedule=View['schedules'][number];
type Form={scheduleId:string;expectedVersion:number;group:string;weekday:string;localTime:string;margin:string;responsible:string;reason:string};
class ScheduleRequestError extends Error {constructor(message:string,public status:number,public uncertain=false){super(message);}}
async function scheduleRequest<T>(companyId:string,body?:Record<string,unknown>):Promise<T>{
  const r=await fetch(body?'/api/po-draft-schedules':`/api/po-draft-schedules?companyId=${encodeURIComponent(companyId)}`,
    body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await r.json().catch(()=>({})) as T&{error?:string;uncertain?:boolean;code?:string};
  if(!r.ok)throw new ScheduleRequestError(data.error??'Could not load weekly drafts.',r.status,!!data.uncertain||data.code==='storage_failure');
  return data;
}
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const RESULTS:Record<OccurrenceState,string>={running:'In progress',retry:'Will retry',drafted:'Draft created',nothing_needed:'Nothing needed',
  skipped_paused:'Skipped: paused',skipped_waiting:'Skipped: a draft is waiting',held:'Held',failed:'Failed'};
const ORDER_STATUS:Record<string,string>={draft:'waiting for review',reviewed:'reviewed',canceled:'canceled'};
const blank=(people:View['choices']['people']):Form=>({scheduleId:'',expectedVersion:0,group:'',weekday:'1',localTime:'09:00',margin:'10',responsible:people[0]?.userId??'',reason:''});
const groupKey=(s:{supplierId:string;accountId:string;locationId:string})=>[s.supplierId,s.accountId,s.locationId].join('\u0000');

/** On an opened draft: says which weekly schedule created it. Silent when the preview is off or the draft is manual. */
export function WeeklyDraftLabel({companyId,orderId}:{companyId:string;orderId:string}){
  const [week,setWeek]=useState<string|null>(null);
  useEffect(()=>{let live=true;setWeek(null);
    fetch(`/api/po-draft-schedules?${new URLSearchParams({companyId,orderId})}`,{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{weeklySchedule:{weekKey:string}|null}>:null)
      .then(data=>{if(live)setWeek(data?.weeklySchedule?.weekKey??null);},()=>{});
    return()=>{live=false;};},[companyId,orderId]);
  return week?<p className="po-weekly-label" data-weekly-draft>Created by the weekly schedule for the week of {week}. Review it like any other draft.</p>:null;
}
export default function WeeklySchedules({companyId,active,onEnabledChange,onDirtyChange}:{companyId:string;active:boolean;onEnabledChange:(v:boolean)=>void;onDirtyChange:(v:boolean)=>void}){
  const [view,setView]=useState<View|null>(null),[enabled,setEnabled]=useState(false),[form,setForm]=useState<Form|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  useEffect(()=>onDirtyChange(!!form||uncertain),[form,uncertain,onDirtyChange]);
  useEffect(()=>{let live=true;void scheduleRequest<View>(companyId).then(data=>{if(live){setView(data);setEnabled(true);onEnabledChange(true);}})
    .catch(e=>{if(live){setEnabled(false);onEnabledChange(false);if(!(e instanceof ScheduleRequestError&&[403,404].includes(e.status)))setError(e.message);}});
    return()=>{live=false;};},[companyId,onEnabledChange]);
  useEffect(()=>{if(enabled&&active&&!form&&!pending.current)void scheduleRequest<View>(companyId).then(setView).catch(e=>setError(e.message));},[enabled,active]);
  async function send(body:Record<string,unknown>,done:string){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');pending.current=body;
    try{await scheduleRequest(companyId,body);pending.current=null;setUncertain(false);
      // The confirmation appears with the refreshed list, never beside stale values.
      const next=await scheduleRequest<View>(companyId);setView(next);setForm(null);setNotice(done);}
    catch(e){const failure=e as ScheduleRequestError;
      if(failure.uncertain){setUncertain(true);setError('The save outcome is uncertain. Retry the same save; it will not be applied twice.');}
      else{pending.current=null;setError(failure.message);}}
    finally{lock.current=false;setBusy(false);}
  }
  if(!active)return null;
  if(!enabled)return <p>Weekly drafts are unavailable. {error}</p>;
  if(!view)return <p role="status">Loading weekly drafts…</p>;
  const zone=view.timeZone,groups=view.choices.suppliers.flatMap(s=>s.groups.map(g=>({key:groupKey({supplierId:s.id,...g}),supplierId:s.id,
    label:`${s.name} — ${g.accountReference} · ${g.locationReference}`,...g})));
  const label=(s:Schedule)=>groups.find(g=>g.key===groupKey(s))?.label??`${s.supplierId} — ${s.accountId} · ${s.locationId}`;
  const local=(iso:string)=>new Date(iso).toLocaleString(undefined,{timeZone:zone??undefined,dateStyle:'medium',timeStyle:'short'});
  const taken=new Set(view.schedules.map(groupKey)),blocked=busy||uncertain;
  function edit(s:Schedule){setNotice('');setError('');setForm({scheduleId:s.id,expectedVersion:s.version,group:groupKey(s),weekday:String(s.weekday),localTime:s.localTime,
    margin:String(s.marginPercent),responsible:s.responsibleUserId,reason:''});}
  function submit(e:React.FormEvent){
    e.preventDefault();if(!form)return;
    const g=groups.find(x=>x.key===form.group);if(!g)return setError('Choose a supplier and delivery location.');
    if(!/^\d{1,3}$/.test(form.margin.trim())||Number(form.margin)>100)return setError('Enter a cap margin from 0 to 100 percent.');
    void send({action:'save',companyId,scheduleId:form.scheduleId||crypto.randomUUID(),expectedVersion:form.expectedVersion,operationId:crypto.randomUUID(),
      supplierId:g.supplierId,accountId:g.accountId,locationId:g.locationId,weekday:Number(form.weekday),localTime:form.localTime,marginPercent:Number(form.margin),
      responsibleUserId:form.responsible,reason:form.reason.trim()},form.scheduleId?'Schedule updated. It applies from now on.':'Schedule saved. The first draft comes at its next weekly time.');
  }
  return <section className="po-preview" data-weekly-schedules>
    <div className="po-heading"><div><div className="eyebrow">WEEKLY DRAFTS</div><h1>Weekly order drafts</h1>
      <p>At a set day and time each week, Pantrack recalculates what a supplier's items need from current stock and creates a draft for review. It never prepares a cart, approves spending or places an order.</p></div>
      {!form&&zone&&<Button disabled={blocked||!groups.some(g=>!taken.has(g.key))} onClick={()=>{setNotice('');setForm(blank(view.choices.people));}}>New schedule</Button>}</div>
    {zone?<p className="po-muted">Times use the café's time zone, {zone}.</p>:<p role="alert">The owner needs to set the café's time zone under Spending limits before schedules can run.</p>}
    {error&&<div role="alert" className="error">{error}</div>}{notice&&<p role="status" className="notice">{notice}</p>}
    {uncertain&&pending.current&&<div className="inventory-actions"><Button disabled={busy} onClick={()=>void send(pending.current!,'Saved.')}>Retry the same save</Button></div>}
    {form&&<form className="po-section" onSubmit={submit} aria-label={form.scheduleId?'Edit weekly schedule':'New weekly schedule'} data-weekly-form><fieldset disabled={blocked}>
      <legend>{form.scheduleId?'Edit weekly schedule':'New weekly schedule'}</legend>
      <div className="po-fields">
        <label>Supplier and delivery location<select required value={form.group} disabled={!!form.scheduleId} onChange={e=>setForm({...form,group:e.target.value})}>
          <option value="">Choose…</option>{groups.filter(g=>g.key===form.group||!taken.has(g.key)).map(g=><option key={g.key} value={g.key}>{g.label}</option>)}</select>
          {form.scheduleId&&<small>A schedule keeps its supplier; create another schedule for a different one.</small>}</label>
        <label>Day<select value={form.weekday} onChange={e=>setForm({...form,weekday:e.target.value})}>{DAYS.map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></label>
        <label>Time<Input type="time" required value={form.localTime} onChange={e=>setForm({...form,localTime:e.target.value})}/></label>
        <label>Cap margin (%)<Input inputMode="numeric" required value={form.margin} onChange={e=>setForm({...form,margin:e.target.value})}/>
          <small>Added to the estimated subtotal for the draft's proposed cap. You confirm the cap when you review the draft.</small></label>
        <label>Draft for<select required value={form.responsible} onChange={e=>setForm({...form,responsible:e.target.value})}>
          {view.choices.people.map(p=><option key={p.userId} value={p.userId}>{p.userId} ({p.role})</option>)}</select></label>
        <label>Reason (optional)<Input maxLength={500} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
      </div>
      <div className="inventory-actions"><Button type="submit">Save schedule</Button><Button type="button" variant="outline" onClick={()=>{setForm(null);setError('');}}>Cancel</Button></div>
    </fieldset></form>}
    {!form&&!view.schedules.length&&<div className="po-empty"><h2>No weekly schedules yet</h2>
      <p>{groups.length?'Add one to get a draft for review at the same time each week.':'Add a supplier with item mappings under Purchasing suppliers first.'}</p></div>}
    {view.schedules.map(s=><article key={s.id} className="po-section weekly-schedule" data-weekly-schedule aria-label={label(s)}>
      <div className="weekly-schedule-head"><div><h2>{label(s)}</h2>
        <p>Every {DAYS[s.weekday-1]} at {s.localTime} · margin {s.marginPercent}% · drafts for {s.responsibleUserId}</p>
        <p className="po-muted">{s.status==='paused'?'Paused. Paused weeks are skipped, not caught up.':s.nextRun?`Next run: ${local(s.nextRun)}`:''}</p></div>
        <span className="weekly-status" data-paused={s.status==='paused'||undefined}>{s.status==='paused'?'Paused':'Active'}</span></div>
      {!form&&<div className="inventory-actions"><Button variant="outline" disabled={blocked} onClick={()=>edit(s)}>Edit</Button>
        <Button variant="outline" disabled={blocked} onClick={()=>void send({action:s.status==='paused'?'resume':'pause',companyId,scheduleId:s.id,expectedVersion:s.version,
          operationId:crypto.randomUUID(),reason:''},s.status==='paused'?'Schedule resumed from now on.':'Schedule paused.')}>{s.status==='paused'?'Resume':'Pause'}</Button></div>}
      {s.weeks.length?<table className="cart-preview-table weekly-weeks"><caption className="sr-only">Recent weeks</caption>
        <thead><tr><th>Week of</th><th>Result</th><th>Details</th></tr></thead>
        <tbody>{s.weeks.map(w=><tr key={w.weekKey}><td data-label="Week of">{w.weekKey}</td><td data-label="Result" data-result={w.state}>{RESULTS[w.state]}</td>
          <td data-label="Details">{w.orderNumber?`${w.orderNumber}, ${ORDER_STATUS[w.orderStatus??'']??w.orderStatus}`:w.reason}</td></tr>)}</tbody></table>
        :<p className="po-muted">No weeks yet.</p>}
    </article>)}
  </section>;
}
