'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {PurchaseOrderView} from '@/lib/purchase-order-contract';
import type {CartJobView,CartStart} from '@/lib/cart-preview-contract';
import './cart-preview.css';
import DurableCart from './durable-cart';
import {managerStatus,ManagerCartError} from './durable-cart-client';
import type {ManagerCartView} from '@/lib/po-cart-manager-contract';

export default function CartPreview(props:{companyId:string;order:PurchaseOrderView}){
  const [view,setView]=useState<ManagerCartView|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;void managerStatus(props.companyId,props.order.snapshot.id).then(v=>{if(live)setView(v);}).catch(e=>{
    if(live&&!(e instanceof ManagerCartError&&e.status===404))setError(e.message);
  });return()=>{live=false;};},[props.companyId,props.order.snapshot.id]);
  if(error)return <p role="alert" className="po-field-error">{error} Reload to recover preparation status.</p>;
  return view?.mode==='durable'?<DurableCart {...props} initial={view}/>:view?<LegacyCartPreview {...props}/>:null;
}

const states={preparing:'Preparing cart',awaiting_login:'Sign-in needed',needs_review:'Review needed',ready:'Cart ready to review',failed:'Preparation stopped',canceled:'Preparation canceled'};
async function call(companyId:string,body?:Record<string,unknown>,jobId?:string,orderId?:string){
  const response=await fetch(`/api/cart-preview?companyId=${encodeURIComponent(companyId)}${jobId?`&jobId=${encodeURIComponent(jobId)}`:''}${orderId?`&orderId=${encodeURIComponent(orderId)}`:''}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  if(response.status===404)throw Error('Preview unavailable');const data=await response.json() as {job:CartJobView;error?:string};if(!response.ok)throw Error(data.error??'Could not read cart status.');return data;
}
function LegacyCartPreview({companyId,order}:{companyId:string;order:PurchaseOrderView}){
  const [enabled,setEnabled]=useState(false),[job,setJob]=useState<CartJobView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [layout,setLayout]=useState<CartStart['layout']>('rows'),[scenario,setScenario]=useState<CartStart['scenario']>('normal');
  const operation=useRef<string|null>(null),lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;void call(companyId,undefined,undefined,order.snapshot.id).then(data=>{if(alive.current){setEnabled(true);setJob(data.job??null);}}).catch(()=>{});return()=>{alive.current=false;};},[companyId,order.snapshot.id]);
  useEffect(()=>{if(!job||job.state==='canceled')return;let live=true;const refresh=()=>void call(companyId,undefined,job.id).then(d=>{if(live)setJob(d.job);}).catch(e=>{if(live)setError(e.message);});
    const timer=setInterval(refresh,2000);refresh();return()=>{live=false;clearInterval(timer);};},[companyId,job?.id,job?.state,order.revision]);
  async function action(action:'start'|'resume'|'cancel'|'inspect'){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      if(action==='start'&&!operation.current)operation.current=crypto.randomUUID();
      const data=await call(companyId,action==='start'?{action,companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:operation.current,layout,scenario}:{action,companyId,jobId:job?.id});
      if(alive.current){setJob(data.job);if(action==='cancel')operation.current=null;}
    }catch(e){if(alive.current)setError((e as Error).message);}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  if(!enabled)return null;
  return <section className="cart-preview po-section" aria-labelledby="cart-preview-title">
    <div className="cart-preview-heading"><h2 id="cart-preview-title">Prepare a supplier cart</h2><small>Fictional local demo · Offline runner</small></div>
    <p className="po-muted">Use this reviewed list to prepare exact supplier packs, then take over in the supplier browser. Checkout stays disabled in this demo.</p>
    {(!job||job.state==='canceled')&&<><div className="cart-preview-options"><label>Storefront layout<select value={layout} disabled={busy} onChange={e=>{setLayout(e.target.value as CartStart['layout']);operation.current=null;}}><option value="rows">Catalog rows</option><option value="compact">Compact catalog</option></select></label>
      <label>Practice scenario<select value={scenario} disabled={busy} onChange={e=>{setScenario(e.target.value as CartStart['scenario']);operation.current=null;}}><option value="normal">Available items</option><option value="unavailable">Out of stock</option><option value="price_changed">Changed price</option><option value="wrong_pack">Wrong pack size</option><option value="ambiguous">Ambiguous SKU</option><option value="lost_response">Lost response after adding</option><option value="login_expired">Expired sign-in</option><option value="malicious">Untrusted page instructions</option></select></label></div>
      <Button disabled={busy||order.status!=='reviewed'} onClick={()=>void action('start')}>{busy?'Starting…':'Prepare demo cart'}</Button>{order.status!=='reviewed'&&<small>Review the current draft first.</small>}</>}
    {job&&job.state!=='canceled'&&<><div className="cart-preview-status" role="status" aria-live="polite"><strong>{states[job.state]}</strong><span>{job.message}</span></div>
      <table className="cart-preview-table"><caption className="sr-only">Cart item verification</caption><thead><tr><th>Supplier item / pack</th><th>Packs</th><th>Check</th></tr></thead><tbody>{job.lines.map(l=><tr key={l.sku}><td><strong>{l.description}</strong><small>{l.sku} · {l.unitLabel}</small></td><td>{l.packs}</td><td>{l.verified?'Verified':'Pending'}</td></tr>)}</tbody></table>
      <div className="po-actions">{job.state!=='preparing'&&<Button variant={job.state==='ready'?'default':'outline'} disabled={busy} onClick={()=>void action('inspect')}>{job.state==='awaiting_login'?'Open practice sign-in':'Review cart in supplier browser'}</Button>}
        {['awaiting_login','needs_review','failed'].includes(job.state)&&<Button variant="outline" disabled={busy} onClick={()=>void action('resume')}>Resume and verify</Button>}
        <Button variant="ghost" disabled={busy||job.state==='preparing'} onClick={()=>void action('cancel')}>Cancel preparation</Button></div>
      <small>Draft revision {job.revision} · {Math.round(job.elapsedMs/1000)} seconds elapsed, including pauses · {job.interventions} {job.interventions===1?'intervention':'interventions'}. Cart contents remain after cancellation.</small></>}
    {error&&<p role="alert" className="po-field-error">{error}</p>}
  </section>;
}
