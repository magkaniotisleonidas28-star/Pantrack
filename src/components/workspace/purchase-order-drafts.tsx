'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PurchaseOrderDrafts} from '@/lib/d1-purchase-order-drafts';
import type {PurchaseOrderView} from '@/lib/purchase-order-contract';
import type {D1PurchasingSuppliers} from '@/lib/d1-purchasing-suppliers';
import type {SupplierVersion} from '@/lib/purchasing-supplier-contract';
import {supplierRequest,purchasingDollars,emailAcceptanceLabel} from './purchasing-client';
import {draftStockDisplay} from '@/lib/supplier-order-draft';
import './purchase-order-drafts.css';

type Choices = Awaited<ReturnType<D1PurchaseOrderDrafts['choices']>>;
type List = Awaited<ReturnType<D1PurchaseOrderDrafts['list']>>;
type Line = {key:string;kind:'stock'|'non_stock';productId:string;sku:string;description:string;unitLabel:string;packs:string;estimate:string;mappingId?:string;mappingVersion?:number};
const emptyLine = ():Line=>({key:crypto.randomUUID(),kind:'non_stock',productId:'',sku:'',description:'',unitLabel:'case',packs:'1',estimate:''});
function usd(value:string) {const digits=value.padStart(3,'0');return `$${digits.slice(0,-2)}.${digits.slice(-2)}`;}
function cents(value:string) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter USD amounts with at most two decimal places.');
  const [dollars,fraction='']=value.trim().split('.');return (BigInt(dollars)*BigInt(100)+BigInt(fraction.padEnd(2,'0'))).toString();
}
class RequestError extends Error {constructor(message:string,public status:number){super(message);}}
async function request<T={order:PurchaseOrderView}>(companyId:string,query='',body?:Record<string,unknown>):Promise<T> {
  const response=await fetch(`/api/purchase-orders?companyId=${encodeURIComponent(companyId)}${query}`,body ?
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'});
  const data=await response.json() as T&{error?:string};if(!response.ok)throw new RequestError(data.error ?? 'Could not load purchase orders.',response.status);return data;
}

export default function PurchaseOrderDrafts({companyId,active,refreshKey=0,onEnabledChange,onDirtyChange}:{companyId:string;active:boolean;refreshKey?:number;onEnabledChange:(value:boolean)=>void;onDirtyChange:(value:boolean)=>void}) {
  const [choices,setChoices]=useState<Choices>({stocks:[],proposals:[]}),[list,setList]=useState<List>({orders:[],hasMore:false});
  const [enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState<PurchaseOrderView|null>(null);
  const [source,setSource]=useState<'manual'|'proposals'|'registry'>('registry'),[lines,setLines]=useState<Line[]>([]),[proposalIds,setProposalIds]=useState<string[]>([]);
  const [suppliers,setSuppliers]=useState<Awaited<ReturnType<D1PurchasingSuppliers['list']>>['suppliers']>([]),[supplierMore,setSupplierMore]=useState(false),[supplierOffset,setSupplierOffset]=useState(0);
  const [supplierProfile,setSupplierProfile]=useState<SupplierVersion|null>(null),[supplierId,setSupplierId]=useState(''),[accountId,setAccountId]=useState(''),[locationId,setLocationId]=useState('');
  const [mappings,setMappings]=useState<Awaited<ReturnType<D1PurchasingSuppliers['mappings']>>['mappings']>([]),[mappingMore,setMappingMore]=useState(false),[mappingOffset,setMappingOffset]=useState(0);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[account,setAccount]=useState(''),[location,setLocation]=useState(''),[address,setAddress]=useState('');
  const [cap,setCap]=useState(''),[notes,setNotes]=useState(''),[reason,setReason]=useState(''),[uncertain,setUncertain]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  const dirty=lines.length>0||proposalIds.length>0||!!supplierId||!!name||!!email||!!account||!!location||!!address||!!cap||!!notes;
  useEffect(()=>{onDirtyChange(dirty||uncertain);},[dirty,uncertain,onDirtyChange]);
  useEffect(()=>{let current=true;void request<Choices>(companyId,'&view=choices').then(data=>{
    if(current){setChoices(data);setEnabled(true);onEnabledChange(true);}
  }).catch(cause=>{if(current){setEnabled(false);onEnabledChange(false);if(!(cause instanceof RequestError&&cause.status===404))setError(cause.message);}})
    .finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[companyId,onEnabledChange]);
  useEffect(()=>{if(enabled&&active)void loadHistory(offset);},[enabled,active,offset]);
  useEffect(()=>{if(enabled&&active)void loadSuppliers(0);},[enabled,active,refreshKey]);
  useEffect(()=>{if(!supplierId){setSupplierProfile(null);setMappings([]);return;}let live=true;setSupplierProfile(null);setMappings([]);
    void supplierRequest<{supplier:SupplierVersion}>(companyId,`&supplierId=${encodeURIComponent(supplierId)}`).then(d=>{if(live)setSupplierProfile(d.supplier);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};},[companyId,supplierId]);
  useEffect(()=>{if(supplierId&&active)void loadMappings(0);},[supplierId,active,refreshKey]);
  async function loadSuppliers(page:number){try{const d=await supplierRequest<Awaited<ReturnType<D1PurchasingSuppliers['list']>>>(companyId,`&offset=${page}`);
    setSuppliers(previous=>page===0?d.suppliers:[...previous,...d.suppliers.filter(s=>!previous.some(p=>p.id===s.id))]);setSupplierMore(d.hasMore);setSupplierOffset(page);
  }catch(e){setError((e as Error).message);}}
  async function loadMappings(page:number){try{const d=await supplierRequest<Awaited<ReturnType<D1PurchasingSuppliers['mappings']>>>(companyId,`&view=mappings&supplierId=${encodeURIComponent(supplierId)}&offset=${page}`);
    setMappings(previous=>page===0?d.mappings:[...previous,...d.mappings.filter(m=>!previous.some(p=>p.mapping.id===m.mapping.id))]);setMappingMore(d.hasMore);setMappingOffset(page);
  }catch(e){setError((e as Error).message);}}
  async function loadHistory(page:number) {try{setList(await request<List>(companyId,`&offset=${page}`));}catch(cause){setError((cause as Error).message);}}
  function update(key:string,values:Partial<Line>){setLines(previous=>previous.map(line=>line.key===key?{...line,...values}:line));}
  function reset(){setLines([]);setProposalIds([]);setName('');setEmail('');setAccount('');setLocation('');setAddress('');setCap('');setNotes('');setSource('registry');setSupplierId('');setAccountId('');setLocationId('');}
  async function save(body:Record<string,unknown>) {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');pending.current=body;
    try {
      const data=await request(companyId,'',body);setSelected(data.order);pending.current=null;setUncertain(false);
      if(body.action==='create')reset();setReason('');setOffset(0);await loadHistory(0);
      setNotice(body.action==='create'?'Draft saved. Nothing has been sent.':'Draft canceled; original details remain in history.');
    }catch(cause){
      const error=cause as Error;setError(error.message);
      const unknown=!(cause instanceof RequestError)||cause.status>=500;setUncertain(unknown);
      if(!unknown)pending.current=null;
    }finally{lock.current=false;setBusy(false);}
  }
  function create(event:React.FormEvent) {
    event.preventDefault();if(busy||uncertain)return;
    try {
      if(source==='registry'){
        if(!supplierProfile)throw Error('Choose a saved supplier profile.');
        void save({action:'create',companyId,operationId:crypto.randomUUID(),source,
          supplierRef:{id:supplierProfile.id,version:supplierProfile.version,accountId,locationId},capMinor:cents(cap),notes,
          lines:lines.map(line=>{if(line.kind==='stock'){
            const m=mappings.find(m=>m.mapping.id===line.mappingId)?.mapping;if(!m)throw Error('Choose a saved supplier mapping.');
            if(m.version!==line.mappingVersion)throw Error('Supplier mapping changed. Select the mapping again and review its pack size.');
            return {kind:'stock',mappingId:m.id,mappingVersion:line.mappingVersion,packs:line.packs};}
            return {kind:'non_stock',sku:line.sku,description:line.description,unitLabel:line.unitLabel,packs:line.packs,estimatedUnitMinor:line.estimate.trim()?cents(line.estimate):null};})});return;
      }
      const chosen=choices.proposals.filter(p=>proposalIds.includes(p.id)),group=chosen[0];
      const supplier={id:source==='proposals'?group?.supplier_id:name.trim(),name,email,accountId:source==='proposals'?group?.account_id:account,
        locationId:source==='proposals'?group?.location_id:location,deliveryAddress:address};
      const base={action:'create',companyId,operationId:crypto.randomUUID(),source,supplier,capMinor:cents(cap),notes};
      const body=source==='proposals'?{...base,proposals:chosen.map(p=>({id:p.id,revision:p.revision}))}:{...base,lines:lines.map(line=>{
        const estimate=line.estimate.trim()?cents(line.estimate):null;
        const common={kind:line.kind,sku:line.sku,description:line.description,packs:line.packs,estimatedUnitMinor:estimate};
        if(line.kind==='non_stock')return {...common,unitLabel:line.unitLabel};
        const stock=choices.stocks.find(s=>s.product_id===line.productId);
        if(!stock)throw new Error('Choose a stock item with an exact pack setup.');
        return {...common,productId:stock.product_id,expectedConfigId:stock.config_id,expectedConfigVersion:stock.config_version};
      })};
      void save(body);
    }catch(cause){setError((cause as Error).message);}
  }
  if(!active)return null;
  if(loading)return <p role="status">Loading purchase-order drafts…</p>;
  if(!enabled)return <p>Purchase-order draft preview is unavailable. {error}</p>;
  return <section className="po-preview">
    <div className="page-heading"><div><div className="eyebrow">PURCHASE ORDERS</div><h1>Prepare a purchase-order draft</h1>
      <p>Save supplier details and exact quantities for review. Drafts are not sent.</p></div></div>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
    {uncertain&&<div className="notice"><p>The save outcome is uncertain. Retry the same draft before making another change.</p>
      <Button disabled={busy} onClick={()=>pending.current&&void save(pending.current)}>Retry same request</Button></div>}
    <form onSubmit={create}><fieldset disabled={busy||uncertain}><legend>Draft details</legend>
      <label>Create from<select value={source} onChange={e=>{setSource(e.target.value as typeof source);setLines([]);}}><option value="registry">Saved supplier and mappings</option><option value="manual">Manual lines (foundation)</option><option value="proposals">Saved fictional replenishment proposals</option></select></label>
      <div className="po-fields">
        {source==='registry'?<><label>Saved supplier<select required value={supplierId} onChange={e=>{setSupplierId(e.target.value);setAccountId('');setLocationId('');setLines([]);}}><option value="">Choose supplier</option>{suppliers.filter(s=>s.status==='active').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{supplierMore&&<Button type="button" variant="outline" onClick={()=>void loadSuppliers(supplierOffset+20)}>Load more suppliers</Button>}</label>
          <label>Supplier account<select required value={accountId} onChange={e=>{setAccountId(e.target.value);setLocationId('');setLines([]);}}><option value="">Choose account</option>{supplierProfile?.profile.accounts.filter(a=>a.status==='active').map(a=><option key={a.id} value={a.id}>{a.reference}</option>)}</select></label>
          <label>Delivery location<select required value={locationId} onChange={e=>{setLocationId(e.target.value);setLines([]);}}><option value="">Choose location</option>{supplierProfile?.profile.locations.filter(l=>l.status==='active'&&l.accountId===accountId).map(l=><option key={l.id} value={l.id}>{l.reference}</option>)}</select></label>
          {supplierProfile&&<div><p>Ordering email: {supplierProfile.profile.email??'Unavailable'} · profile version {supplierProfile.version}</p><p>Email acceptance: {emailAcceptanceLabel(supplierProfile.profile.emailAcceptance.status)}</p><p className="po-prewrap">{supplierProfile.profile.locations.find(l=>l.id===locationId)?.address}</p><p>Rules and fees require review; nothing is sent.</p></div>}</>:
        <><label>Supplier name<Input required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>Ordering email<Input required type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
        {source==='manual'&&<><label>Supplier account reference<Input required maxLength={200} value={account} onChange={e=>setAccount(e.target.value)}/></label>
          <label>Delivery location reference<Input required maxLength={200} value={location} onChange={e=>setLocation(e.target.value)}/></label></>}
        <label>Delivery address<textarea required maxLength={1000} value={address} onChange={e=>setAddress(e.target.value)}/></label></>}
        <label>Proposed total spending cap (USD)<Input required inputMode="decimal" value={cap} onChange={e=>setCap(e.target.value)}/><small>Include tax and delivery. Saving does not approve or reserve this amount.</small></label>
        <label>Delivery instructions / notes<textarea maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      </div>
      {source==='proposals'?<fieldset><legend>Saved proposals</legend><p>Mappings are fictional and cannot authorize an order. Quantities are preserved; changed sources are rejected on save.</p>
        {choices.proposals.length===0&&<p>No eligible saved proposals. Create a review in Inventory → Purchasing plan first.</p>}
        {choices.proposals.map(p=><label className="po-checkbox" key={p.id}><input type="checkbox" checked={proposalIds.includes(p.id)} onChange={e=>setProposalIds(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>
          <span>{p.name} · {p.packs} packs · revision {p.revision}<small>{p.supplier_id} / {p.account_id} / {p.location_id}</small></span></label>)}
      </fieldset>:<fieldset><legend>Order lines</legend>{lines.map((line,i)=>{
        const stock=choices.stocks.find(s=>s.product_id===line.productId);
        return <article className="po-line" key={line.key}><div className="between"><h3>Line {i+1}</h3><Button type="button" variant="ghost" onClick={()=>setLines(ls=>ls.filter(l=>l.key!==line.key))}>Remove line {i+1}</Button></div>
          <div className="po-fields"><label>Line type<select value={line.kind} onChange={e=>update(line.key,{kind:e.target.value as Line['kind'],productId:''})}><option value="non_stock">Non-stock item or service</option><option value="stock">Inventory item</option></select></label>
          {line.kind==='stock'&&source==='registry'?<label>Supplier inventory mapping<select required value={line.mappingId??''} onChange={e=>update(line.key,{mappingId:e.target.value,mappingVersion:mappings.find(m=>m.mapping.id===e.target.value)?.mapping.version})}><option value="">Choose mapped item</option>{mappings.filter(({mapping:m,warning})=>!warning&&m.accountId===accountId&&m.locationId===locationId).map(({mapping:m})=><option key={m.id} value={m.id}>{m.description} · {m.sku} · {draftStockDisplay(m.stockUnitsPerPack)} per {m.unitLabel}</option>)}</select>
            {mappingMore&&<Button type="button" variant="outline" onClick={()=>void loadMappings(mappingOffset+20)}>Load more supplier mappings</Button>}
            {mappings.find(m=>m.mapping.id===line.mappingId)&&<small>{mappings.find(m=>m.mapping.id===line.mappingId)!.mapping.version!==line.mappingVersion&&'Mapping changed — select it again before saving. '}Estimated pack price: {mappings.find(m=>m.mapping.id===line.mappingId)!.mapping.estimatedUnitMinor===null?'Unavailable':`$${purchasingDollars(mappings.find(m=>m.mapping.id===line.mappingId)!.mapping.estimatedUnitMinor)}`}</small>}</label>:
          line.kind==='stock'?<label>Inventory item<select required value={line.productId} onChange={e=>{
            const item=choices.stocks.find(s=>s.product_id===e.target.value);update(line.key,{productId:e.target.value,sku:item?.sku??'',description:item?.name??''});
          }}><option value="">Choose an item</option>{choices.stocks.map(s=><option value={s.product_id} key={s.product_id}>{s.name} · {s.purchase_unit_label}</option>)}</select>
            {stock&&<small>Each {stock.purchase_unit_label}: {draftStockDisplay({dimension:stock.dimension,minor:stock.purchase_quantity_minor})}</small>}</label>:
            <label>Order unit / pack description<Input required maxLength={200} value={line.unitLabel} onChange={e=>update(line.key,{unitLabel:e.target.value})}/></label>}
          {(source!=='registry'||line.kind==='non_stock')&&<><label>Description<Input required maxLength={200} value={line.description} onChange={e=>update(line.key,{description:e.target.value})}/></label>
          <label>Supplier SKU / item reference<Input required maxLength={200} value={line.sku} onChange={e=>update(line.key,{sku:e.target.value})}/></label></>}
          <label>Whole packs / order units<Input required inputMode="numeric" pattern="[1-9][0-9]{0,8}" value={line.packs} onChange={e=>update(line.key,{packs:e.target.value})}/></label>
          {(source!=='registry'||line.kind==='non_stock')&&<label>Estimated price per unit (USD, optional)<Input inputMode="decimal" value={line.estimate} onChange={e=>update(line.key,{estimate:e.target.value})}/><small>Blank means unavailable.</small></label>}</div>
        </article>;
      })}<Button type="button" variant="outline" disabled={lines.length>=50} onClick={()=>setLines(ls=>[...ls,emptyLine()])}>Add line</Button></fieldset>}
      <div className="inventory-actions"><Button type="submit" disabled={busy||(source==='proposals'?proposalIds.length===0:lines.length===0)}>Save draft — not sent</Button>
        <Button type="button" variant="outline" onClick={reset}>Reset unsaved fields</Button></div>
    </fieldset></form>
    <section><h2>Saved purchase-order drafts</h2>{list.orders.length===0&&<p>No saved drafts yet.</p>}
      {list.orders.map(order=><article className="po-history" key={order.id}><div><strong>{order.number}</strong><p>{order.supplier_name} · {order.status} · {new Date(order.created_at).toLocaleString()}</p></div>
        <Button variant="outline" disabled={busy} onClick={()=>void request(companyId,`&orderId=${encodeURIComponent(order.id)}`).then(d=>{setSelected(d.order);setReason('');}).catch(e=>setError(e.message))}>View draft</Button></article>)}
      <div className="inventory-actions"><Button variant="outline" disabled={offset===0||busy} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous drafts</Button>
        <Button variant="outline" disabled={!list.hasMore||busy} onClick={()=>setOffset(offset+20)}>More drafts</Button></div>
    </section>
    {selected&&<section className="po-detail" aria-label="Saved purchase-order details"><h2>{selected.snapshot.number}</h2><p><strong>{selected.status==='draft'?'Draft — not sent':'Canceled draft — not sent'}</strong> · revision {selected.revision}</p>
      <p>{selected.snapshot.supplier.name} · {selected.snapshot.supplier.email??'Ordering email unavailable'}</p><p>Account: {selected.snapshot.supplier.accountId} · Location: {selected.snapshot.supplier.locationId}</p>
      <p className="po-prewrap">{selected.snapshot.supplier.deliveryAddress}</p><p>Proposed cap: {usd(selected.snapshot.capMinor)} · Known estimated subtotal: {usd(selected.snapshot.knownSubtotalMinor)}{!selected.snapshot.pricesComplete&&' · Some prices unavailable'}</p>
      {selected.snapshot.lines.map(l=><article className="po-line" key={l.id}><h3>{l.description}</h3><p>{l.sku} · {l.packs} {l.unitLabel} · {l.kind==='stock'?'Inventory':'Non-stock'}</p>
        {l.stockQuantity&&<p>Per pack: {draftStockDisplay(l.stockUnitsPerPack!)} · Stock total: {draftStockDisplay(l.stockQuantity)}</p>}
        <p>Estimated line price: {l.estimatedLineMinor===null?'Unavailable':usd(l.estimatedLineMinor)}</p>
        {l.proposal&&<p>Proposal {l.proposal.proposalId} · revision {l.proposal.revision} · {l.proposal.contract}</p>}</article>)}
      <p className="po-prewrap">{selected.snapshot.notes}</p>{selected.snapshot.warnings.map(w=><p key={w}>{w}</p>)}
      {selected.snapshot.registry&&<details><summary>Saved supplier profile and mapping versions</summary><pre className="po-json">{JSON.stringify(selected.snapshot.registry,null,2)}</pre></details>}
      <h3>Draft history</h3>{selected.events.map(e=><p key={e.revision}>Revision {e.revision} · {e.kind} · {new Date(e.at).toLocaleString()} · {e.actor}: {e.reason}</p>)}
      {selected.status==='draft'&&<div className="inventory-actions"><label>Cancellation reason<Input maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <Button variant="outline" disabled={busy||uncertain||reason.trim().length<4} onClick={()=>void save({action:'cancel',companyId,orderId:selected.snapshot.id,expectedRevision:selected.revision,operationId:crypto.randomUUID(),reason})}>Cancel draft</Button></div>}
    </section>}
  </section>;
}
