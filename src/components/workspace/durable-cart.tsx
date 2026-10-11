'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {PurchaseOrderView} from '@/lib/purchase-order-contract';
import type {BrowserConfig} from '@/lib/po-cart-browser-contract';
import type {ManagerCartView} from '@/lib/po-cart-manager-contract';
import {intentKey,readIntent,managerStatus,sendCartIntent,ManagerCartError,type PendingCartIntent} from './durable-cart-client';
import './cart-preview.css';

const labels={queued:'Waiting for a local worker',preparing:'Preparing cart',review_needed:'Review needed',ready:'Cart verified',canceled:'Preparation canceled'};
const holds:Record<string,string>={sign_in_required:'Practice sign-in expired. Open the practice browser, sign in, then close it before resuming.',
  changed_product:'An item no longer matches the authorized product, pack or price. Review the supplier details.',
  uncertain_write:'An addition may have happened without a reliable result. Review the existing cart before any new preparation.',
  verification_failed:'The observed cart failed verification. Review is required before any further preparation.',
  session_unavailable:'The private practice browser session is unavailable. Review is required.'};
const usd=(minor:string|number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(minor)/100);
export default function DurableCart({companyId,order,initial}:{companyId:string;order:PurchaseOrderView;initial:ManagerCartView}){
  const [view,setView]=useState(initial),[pending,setPending]=useState<PendingCartIntent|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [ack,setAck]=useState(false),[browser,setBrowser]=useState<BrowserConfig>({layout:'rows',scenario:'normal'}),[storageReady,setStorageReady]=useState(false),[recoveryError,setRecoveryError]=useState('');
  const [decisionNote,setDecisionNote]=useState('');
  const lock=useRef(false),live=useRef(true),sequence=useRef(0);
  const key=intentKey(initial.actorId,companyId,order.snapshot.id),a=view.authorization,j=view.job,human=j?.session;
  useEffect(()=>{live.current=true;try{setPending(readIntent(sessionStorage,key));setStorageReady(true);}catch{setRecoveryError('Private request recovery is unavailable in this tab. Enable browser session storage before preparing.');}
    return()=>{live.current=false;sequence.current++;};},[key]);
  async function refresh(clearError=true){const n=++sequence.current;
    try{const next=await managerStatus(companyId,order.snapshot.id);if(!live.current||n!==sequence.current)return;
      if(next.actorId!==initial.actorId||next.mode!=='durable')throw new ManagerCartError('Session or local profile changed. Reload before continuing.',false,403);
      setView(next);if(clearError)setError('');
    }catch(e){if(live.current&&n===sequence.current){setError((e as Error).message);if(e instanceof ManagerCartError&&[401,403].includes(e.status)){setStorageReady(false);setRecoveryError('Session or permission changed. Reload after signing in to recover preparation requests.');}}}
  }
  useEffect(()=>{void refresh();if(!j||!['queued','preparing'].includes(j.state)&&!human?.active&&!j.reconciliation?.evidence?.current)return;
    const timer=setInterval(()=>{if(!lock.current)void refresh();},2000);return()=>clearInterval(timer);
  },[order.revision,j?.id,j?.state,human?.active,j?.reconciliation?.evidence?.current]);
  async function submit(intent:PendingCartIntent){
    if(lock.current||!storageReady)return;lock.current=true;setBusy(true);setError('');sequence.current++;
    try{
      // Persist the exact non-secret intent before transmission, including on explicit retry.
      sessionStorage.setItem(key,JSON.stringify(intent));setPending(intent);
      await sendCartIntent(intent);sessionStorage.removeItem(key);if(live.current){setPending(null);setAck(false);}await refresh();
    }catch(e){if(live.current){setError((e as Error).message+' Retry the saved request if its outcome is uncertain.');
      if(e instanceof ManagerCartError&&e.definitive){sessionStorage.removeItem(key);setPending(null);void refresh(false);}}}
    finally{lock.current=false;if(live.current)setBusy(false);}
  }
  const blocked=busy||!!pending||!storageReady;
  function authorize(){void submit({endpoint:'po-cart-authorizations',body:{action:'authorize',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:crypto.randomUUID()}});}
  function prepare(){if(a)void submit({endpoint:'po-cart-jobs',body:{action:'enqueue',companyId,authorizationId:a.id,expectedRevision:a.revision,operationId:crypto.randomUUID(),browser}});}
  function cancel(){if(!a)return;void submit(j?{endpoint:'po-cart-jobs',body:{action:'cancel',companyId,jobId:j.id,expectedRevision:j.revision,operationId:crypto.randomUUID(),reason:'Manager canceled fictional preparation.'}}:
    {endpoint:'po-cart-authorizations',body:{action:'cancel',companyId,authorizationId:a.id,expectedRevision:a.revision,operationId:crypto.randomUUID(),reason:'Manager canceled fictional preparation permission.'}});}
  function requestBrowser(purpose:'sign_in'|'inspect'){if(j)void submit({endpoint:'po-cart-jobs',body:{action:'requestBrowser',companyId,jobId:j.id,expectedRevision:j.revision,operationId:crypto.randomUUID(),purpose}});}
  function browserAction(action:'closeBrowser'|'resume'){if(j&&human)void submit({endpoint:'po-cart-jobs',body:{action,companyId,jobId:j.id,expectedRevision:j.revision,operationId:crypto.randomUUID(),sessionId:human.id,expectedSessionRevision:human.revision}});}
  function decide(action:'acceptVerifiedCart'|'abandonVerifiedCart'){if(j&&human&&a)void submit({endpoint:'po-cart-jobs',body:{action,companyId,jobId:j.id,expectedRevision:j.revision,expectedAuthorizationRevision:a.revision,operationId:crypto.randomUUID(),sessionId:human.id,expectedSessionRevision:human.revision,note:decisionNote.trim()}});}
  const canAuthorize=!a||a.reservation?.state==='released';
  const ready=j?.state==='ready'&&j.valid&&j.verification.some(e=>e.kind==='final'&&e.verified);
  return <section className="cart-preview po-section" aria-labelledby="durable-cart-title" data-durable-cart>
    <div className="cart-preview-heading"><h2 id="durable-cart-title">Prepare a supplier cart</h2><small>Fictional local demo</small></div>
    <p className="po-muted">Authorize exact packs from this reviewed draft, then prepare the practice cart. Checkout is disabled.</p>
    {canAuthorize&&<div className="cart-authorization"><p>Preparation reserves the <strong>{usd(order.snapshot.capMinor??'0')} spending cap</strong> and incoming quantities. On-hand stock stays unchanged.</p>
      <label className="po-check"><input type="checkbox" checked={ack} disabled={blocked||order.status!=='reviewed'} onChange={e=>setAck(e.target.checked)}/><span>I authorize preparation of these exact packs within this cap.</span></label>
      <Button disabled={blocked||!ack||order.status!=='reviewed'} onClick={authorize}>Authorize preparation</Button>{order.status!=='reviewed'&&<p className="po-muted">Review the current draft first.</p>}</div>}
    {a&&<p className="cart-reservation">Spending reservation: <strong>{a.reservation?.state==='reserved'?usd(a.reservation.totalMinor)+' held':'Released'}</strong>. {a.incomingLines} inventory {a.incomingLines===1?'line':'lines'} committed as incoming.</p>}
    {a&&!a.valid&&a.status!=='canceled'&&<p role="status">{a.reason??'Preparation permission changed. Review and safely cancel before authorizing again.'}</p>}
    {a?.valid&&!j&&<><div className="cart-preview-options"><label>Practice storefront layout<select value={browser.layout} disabled={blocked} onChange={e=>setBrowser({...browser,layout:e.target.value as BrowserConfig['layout']})}><option value="rows">Catalog rows</option><option value="compact">Compact catalog</option></select></label>
      <label>Practice scenario<select value={browser.scenario} disabled={blocked} onChange={e=>setBrowser({...browser,scenario:e.target.value as BrowserConfig['scenario']})}>
        <option value="normal">Available items</option><option value="unavailable">Out of stock</option><option value="price_changed">Changed price</option><option value="wrong_pack">Wrong pack size</option><option value="ambiguous">Ambiguous SKU</option><option value="lost_response">Lost response after adding</option><option value="login_expired">Expired sign-in</option><option value="malicious">Untrusted page instructions</option>
      </select></label></div><Button disabled={blocked} onClick={prepare}>Prepare fictional cart</Button></>}
    {j&&<><div className="cart-preview-status" role="status" aria-live="polite"><strong>{j.state!=='canceled'&&(!j.valid||j.state==='ready'&&!ready)?'Review needed':labels[j.state]}</strong>
      <span>{j.state==='canceled'?'Automation is stopped. Existing cart contents remain.':j.holdReason?holds[j.holdReason]??'Preparation stopped for review.':
        !j.valid?j.reason:j.state==='queued'?'Waiting for the separate local browser process. If this persists, check the local demo launcher.':
        ready?'The complete cart passed final verification. You can inspect the practice cart.':'Each addition is checked against the authorized list.'}</span>
      {j.leaseExpired&&<span>The worker lease expired. Recovery must preserve any attempted additions.</span>}</div>
      <table className="cart-preview-table"><caption className="sr-only">Durable cart item verification</caption><thead><tr><th>Supplier item / pack</th><th>Packs</th><th>Check</th></tr></thead><tbody>{j.lines.map(l=><tr key={l.lineId}><td><strong>{l.description}</strong><small>{l.sku} · {l.unitLabel}</small></td><td>{l.packs}</td><td>{l.verified?'Verified':'Pending'}</td></tr>)}</tbody></table>
      <p className="po-muted">Baseline: {j.verification.some(e=>e.kind==='baseline'&&e.verified)?'verified':'not verified'} · Complete cart: {j.verification.some(e=>e.kind==='final'&&e.verified)?'verified':'not verified'}.</p></>}
    {j?.browser&&<div className="cart-human-access">
      {human?.active&&<div role="status" aria-live="polite"><strong>{human.state==='requested'?'Practice browser requested':human.state==='opening'?'Opening practice browser':human.state==='closing'?'Closing and checking practice cart':'Practice browser is open'}</strong>
        <p>{human.purpose==='sign_in'?'Use the separate browser window to click Sign in to practice account. Then close it here before choosing Resume preparation.':'Inspect the cart in the separate browser window. Additions and checkout are blocked.'}</p>
        <p className="po-muted">Automation is paused while this browser is owned. Access ends by {new Date(human.expiresAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}. Closing the window with its X does not confirm a safe cart.</p>
        {['requested','opening','open'].includes(human.state)&&<Button variant="outline" disabled={blocked} onClick={()=>browserAction('closeBrowser')}>Close practice browser</Button>}</div>}
      {human&&!human.active&&<p role="status">{human.state==='closed'?'Practice browser closed.':human.state==='expired'?'Practice browser access expired. Expiry does not allow preparation to resume.':'Practice browser could not close with a verified cart. Review is required.'}</p>}
      <div className="po-actions">{j.eligibility.signIn&&<Button variant="outline" disabled={blocked} onClick={()=>requestBrowser('sign_in')}>Open practice sign-in</Button>}
        {j.eligibility.inspect&&<Button variant="outline" disabled={blocked} onClick={()=>requestBrowser('inspect')}>Inspect practice cart</Button>}
        {j.eligibility.resume&&<Button disabled={blocked} onClick={()=>browserAction('resume')}>Resume preparation</Button>}</div>
      {!!j.attempted&&<p className="po-muted">An attempted addition prevents automatic resume. Inspect and close the practice browser to check whether this preparation can be resolved.</p>}
      {j.reconciliation?.decision&&<p role="status">{j.reconciliation.decision.action==='acceptVerifiedCart'?'A manager accepted the independently verified complete cart.':'The abandoned preparation was closed. Its spending reservation and incoming quantities were released.'}</p>}
      {j.state!=='ready'&&j.reconciliation?.evidence&&j.reconciliation.decision?.sessionId!==j.reconciliation.evidence.sessionId&&<div className="cart-reconciliation" role="group" aria-labelledby="cart-resolution-title">
        <h3 id="cart-resolution-title">Resolve this preparation</h3>
        <p role="status">{!j.reconciliation.evidence.current?'A fresh inspection is required. Inspect the cart again and close it here before deciding.':
          j.eligibility.accept?'The complete cart matches the authorized list. Accepting it keeps the spending reservation and incoming quantities held.':
          j.eligibility.abandon?'The cart matches its starting contents. Closing this preparation releases its spending reservation and incoming quantities.':
          'This cart cannot be resolved yet. Its contents or preparation permission need review; spending and incoming quantities remain held.'}</p>
        {j.reconciliation.evidence.current&&(j.eligibility.accept||j.eligibility.abandon)&&<>
          <label htmlFor="cart-decision-note">Review note<textarea id="cart-decision-note" rows={2} maxLength={500} value={decisionNote} disabled={blocked} onChange={e=>setDecisionNote(e.target.value)} placeholder="Record why you are accepting or closing this preparation."/></label>
          <p className="po-muted">This check is valid until {new Date(j.reconciliation.evidence.expiresAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}. Your decision is saved in the preparation history. Checkout stays disabled.</p>
          <div className="po-actions">{j.eligibility.accept&&<Button disabled={blocked||!decisionNote.trim()} onClick={()=>decide('acceptVerifiedCart')}>Accept verified cart</Button>}
            {j.eligibility.abandon&&<Button variant="outline" disabled={blocked||!decisionNote.trim()} onClick={()=>decide('abandonVerifiedCart')}>Close abandoned preparation</Button>}</div>
        </>}
      </div>}
    </div>}
    {!!j?.attempted&&a?.reservation?.state==='reserved'&&<p className="cart-exposure">An addition was attempted. Cancellation cannot undo cart changes; spending and incoming commitments remain held until verified abandonment or a later order-resolution step.</p>}
    <div className="po-actions">{a&&a.status!=='canceled'&&j?.state!=='canceled'&&<Button variant="outline" disabled={blocked} onClick={cancel}>{j?'Cancel preparation':'Cancel authorization'}</Button>}
      <Button variant="ghost" disabled={busy} onClick={()=>void refresh()}>Refresh preparation status</Button></div>
    {pending&&<div className="cart-pending" role="status"><p>A saved {pending.body.action==='enqueue'?'Prepare':pending.body.action} request needs confirmation. Retry sends the same request identity.</p><Button variant="outline" disabled={busy||!storageReady} onClick={()=>void submit(pending)}>Retry saved request</Button></div>}
    {error&&<p role="alert" className="po-field-error">{error}</p>}
    {recoveryError&&<p role="alert" className="po-field-error">{recoveryError}</p>}
  </section>;
}
