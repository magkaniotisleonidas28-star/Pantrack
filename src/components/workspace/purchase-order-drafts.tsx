'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Plus,Pencil,Check} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input as BaseInput} from '@/components/ui/input';
import type {D1PurchaseOrderDrafts} from '@/lib/d1-purchase-order-drafts';
import type {PurchaseOrderView,PurchaseOrderSnapshot} from '@/lib/purchase-order-contract';
import type {D1PurchasingSuppliers} from '@/lib/d1-purchasing-suppliers';
import type {SupplierVersion} from '@/lib/purchasing-supplier-contract';
import {supplierRequest,emailAcceptanceLabel} from './purchasing-client';
import {draftStockDisplay} from '@/lib/supplier-order-draft';
import {emptyEditor,editorFrom,newLine,cents,dollars,statusLabel,snapshotChanges,type DraftEditor,type EditorLine} from './purchase-order-editor-model';
import './purchase-order-drafts.css';

type Choices=Awaited<ReturnType<D1PurchaseOrderDrafts['choices']>>;
type List=Awaited<ReturnType<D1PurchaseOrderDrafts['list']>>;
type Suppliers=Awaited<ReturnType<D1PurchasingSuppliers['list']>>;
type Mappings=Awaited<ReturnType<D1PurchasingSuppliers['mappings']>>;
type Props={companyId:string;active:boolean;refreshKey?:number;onEnabledChange:(value:boolean)=>void;onDirtyChange:(value:boolean)=>void};
class RequestError extends Error {constructor(message:string,public status:number){super(message);}}
async function request<T={order:PurchaseOrderView}>(companyId:string,query='',body?:Record<string,unknown>):Promise<T>{
  const response=await fetch(`/api/purchase-orders?companyId=${encodeURIComponent(companyId)}${query}`,body?
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json() as T&{error?:string};if(!response.ok)throw new RequestError(data.error??'Could not load purchase orders.',response.status);return data;
}
const date=(at:string)=>new Date(at).toLocaleString();
const money=(v:string|null)=>v===null?'Unavailable':`$${dollars(v)}`;
const FieldErrors=createContext<Record<string,string>>({});
function Input(props:React.ComponentProps<typeof BaseInput>){const errors=useContext(FieldErrors),error=props.name?errors[props.name]:undefined;
  return <BaseInput {...props} aria-invalid={error?true:undefined} aria-describedby={error?`po-error-${props.name}`:props['aria-describedby']}/>;}

export default function PurchaseOrderDrafts(props:Props){return <DraftWorkspace key={props.companyId} {...props}/>;}
function DraftWorkspace({companyId,active,refreshKey=0,onEnabledChange,onDirtyChange}:Props){
  const [enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [choices,setChoices]=useState<Choices>({stocks:[],proposals:[]}),[list,setList]=useState<List>({orders:[],hasMore:false}),[offset,setOffset]=useState(0);
  const [suppliers,setSuppliers]=useState<Suppliers>({suppliers:[],hasMore:false}),[supplierPage,setSupplierPage]=useState(0);
  const [profile,setProfile]=useState<SupplierVersion|null>(null),[mappings,setMappings]=useState<Mappings>({mappings:[],hasMore:false}),[mappingPage,setMappingPage]=useState(0);
  const [selected,setSelected]=useState<PurchaseOrderView|null>(null),[editor,setEditor]=useState<DraftEditor|null>(null),[baseline,setBaseline]=useState('');
  const [reason,setReason]=useState(''),[ack,setAck]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [invalid,setInvalid]=useState<Record<string,string>>({}),[uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false);
  const [latest,setLatest]=useState<PurchaseOrderView|null>(null),[history,setHistory]=useState<{order:PurchaseOrderView;changes:string[]}|null>(null),[historyBusy,setHistoryBusy]=useState(false);
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false),historyRequest=useRef(0);
  const dirty=!!editor&&JSON.stringify(editor)!==baseline||uncertain;
  useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{if(!dirty)return;const protect=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[dirty]);
  useEffect(()=>{let live=true;void request<Choices>(companyId,'&view=choices').then(data=>{if(live){setChoices(data);setEnabled(true);onEnabledChange(true);}})
    .catch(e=>{if(live){setEnabled(false);onEnabledChange(false);if(!(e instanceof RequestError&&e.status===404))setError(e.message);}})
    .finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[companyId,onEnabledChange]);
  useEffect(()=>{if(enabled&&active)void loadList(offset);},[enabled,active,offset]);
  useEffect(()=>{if(enabled&&active){void loadSuppliers(0);void request<Choices>(companyId,'&view=choices').then(setChoices).catch(e=>setError(e.message));}},[enabled,active,refreshKey]);
  const supplierId=editor?.source==='registry'?editor.supplierId:'';
  useEffect(()=>{if(!supplierId){setProfile(null);return;}if(selected){setProfile(selected.snapshot.registry?.profile??null);return;}
    let live=true;setProfile(null);void supplierRequest<{supplier:SupplierVersion}>(companyId,`&supplierId=${encodeURIComponent(supplierId)}`)
      .then(d=>{if(live)setProfile(d.supplier);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[supplierId,selected,companyId]);
  useEffect(()=>{let live=true;setMappings({mappings:[],hasMore:false});setMappingPage(0);
    if(supplierId)void supplierRequest<Mappings>(companyId,`&view=mappings&supplierId=${encodeURIComponent(supplierId)}&offset=0`)
      .then(d=>{if(live)setMappings(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[supplierId,refreshKey,companyId]);
  async function loadList(page:number){try{setList(await request<List>(companyId,`&offset=${page}`));}catch(e){setError((e as Error).message);}}
  async function loadSuppliers(page:number){try{const data=await supplierRequest<Suppliers>(companyId,`&offset=${page}`);setSuppliers(old=>page?{...data,suppliers:[...old.suppliers,...data.suppliers.filter(s=>!old.suppliers.some(o=>o.id===s.id))]}:data);setSupplierPage(page);}catch(e){setError((e as Error).message);}}
  async function moreMappings(){try{const page=mappingPage+20,data=await supplierRequest<Mappings>(companyId,`&view=mappings&supplierId=${encodeURIComponent(supplierId)}&offset=${page}`);setMappings(old=>({...data,mappings:[...old.mappings,...data.mappings.filter(m=>!old.mappings.some(o=>o.mapping.id===m.mapping.id))]}));setMappingPage(page);}catch(e){setError((e as Error).message);}}
  function clearFeedback(){setError('');setNotice('');setInvalid({});setConflict(false);setLatest(null);setHistory(null);setHistoryBusy(false);historyRequest.current++;setAck(false);setReason('');}
  function mayLeave(){return !busy&&!uncertain&&(!dirty||window.confirm('Discard your unsaved draft changes?'));}
  function openEditor(value:DraftEditor){setEditor(value);setBaseline(JSON.stringify(value));setReason('');setInvalid({});setAck(false);}
  async function open(id:string){if(!mayLeave())return;setBusy(true);clearFeedback();try{const {order}=await request(companyId,`&orderId=${encodeURIComponent(id)}`);setSelected(order);setEditor(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function back(){if(!mayLeave())return;setSelected(null);setEditor(null);clearFeedback();void loadList(offset);}
  function patch(values:Partial<DraftEditor>){setEditor(old=>old?{...old,...values}:old);setInvalid({});setAck(false);}
  function patchLine(key:string,values:Partial<EditorLine>){setEditor(old=>old?{...old,lines:old.lines.map(l=>l.key===key?{...l,...values}:l)}:old);setInvalid({});}
  function mappingFor(line:EditorLine){return mappings.mappings.find(m=>m.mapping.id===line.mappingId&&m.mapping.version===line.mappingVersion)?.mapping??
    selected?.snapshot.registry?.mappings.find(m=>m.mapping.id===line.mappingId&&m.mapping.version===line.mappingVersion)?.mapping;}
  async function save(body:Record<string,unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');pending.current=body;
    try{const {order}=await request(companyId,'',body);setSelected(order);setEditor(null);setUncertain(false);pending.current=null;setConflict(false);setLatest(null);setHistory(null);historyRequest.current++;setAck(false);setReason('');setOffset(0);void loadList(0);
      setNotice(body.action==='review'?'Draft reviewed. No purchase is approved or sent.':body.action==='cancel'?'Draft canceled. Its history is preserved.':body.action==='edit'?'Changes saved. This revision needs review.':'Draft saved and ready for review.');
    }catch(e){setError((e as Error).message);const unknown=!(e instanceof RequestError)||e.status>=500;setUncertain(unknown);setConflict(e instanceof RequestError&&e.status===409);if(!unknown)pending.current=null;}
    finally{lock.current=false;setBusy(false);}
  }
  function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!editor||busy||uncertain)return;
    try{
      const cap=cents(editor.cap);
      if(BigInt(cap)===BigInt(0)||BigInt(cap)<BigInt(known)){
        setInvalid(old=>({...old,cap:BigInt(cap)===BigInt(0)?'Enter a spending cap greater than zero.':'The cap must cover the known estimated subtotal.'}));
        (event.currentTarget.elements.namedItem('cap') as HTMLInputElement)?.focus();return;
      }
      const common={companyId,operationId:crypto.randomUUID(),capMinor:cap,notes:editor.notes};
      let content:Record<string,unknown>;
      if(editor.source==='registry'){
        if(!profile)throw Error('Choose a saved supplier.');
        content={source:'registry',supplierRef:{id:editor.supplierId,version:selected?editor.supplierVersion:profile.version,accountId:editor.accountId,locationId:editor.locationId},
          lines:editor.lines.map(l=>l.kind==='stock'?{kind:'stock',mappingId:l.mappingId,mappingVersion:l.mappingVersion,packs:l.packs}:
            {kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,estimatedUnitMinor:l.estimate.trim()?cents(l.estimate):null})};
      }else{
        const proposals=choices.proposals.filter(p=>editor.proposalIds.includes(p.id)),group=proposals[0];
        const supplier={id:selected?selected.snapshot.supplier.id:editor.source==='proposals'?group?.supplier_id:editor.name.trim(),name:editor.name,email:editor.email,
          accountId:selected?selected.snapshot.supplier.accountId:editor.source==='proposals'?group?.account_id:editor.accountId,
          locationId:selected?selected.snapshot.supplier.locationId:editor.source==='proposals'?group?.location_id:editor.locationId,deliveryAddress:editor.address};
        content={source:editor.source,supplier};
        if(editor.source==='proposals'){if(!selected)content.proposals=proposals.map(p=>({id:p.id,revision:p.revision}));}
        else content.lines=editor.lines.map(l=>{const price=l.estimate.trim()?cents(l.estimate):null,base={kind:l.kind,sku:l.sku,description:l.description,packs:l.packs,estimatedUnitMinor:price};
          return l.kind==='stock'?{...base,productId:l.productId,expectedConfigId:l.configId,expectedConfigVersion:l.configVersion}:{...base,unitLabel:l.unitLabel};});
      }
      void save({...common,...content,...(selected?{action:'edit',orderId:selected.snapshot.id,expectedRevision:selected.revision,reason}:{action:'create'})});
    }catch(e){setError((e as Error).message);}
  }
  async function inspectRevision(revision:number){
    if(!selected)return;const seq=++historyRequest.current;setHistoryBusy(true);setError('');
    try{const responses=await Promise.all([request(companyId,`&orderId=${encodeURIComponent(selected.snapshot.id)}&revision=${revision}`),
      revision>1?request(companyId,`&orderId=${encodeURIComponent(selected.snapshot.id)}&revision=${revision-1}`):Promise.resolve(null)]);
      if(seq===historyRequest.current)setHistory({order:responses[0].order,changes:responses[1]?snapshotChanges(responses[1].order.snapshot,responses[0].order.snapshot):['Original draft created.']});
    }catch(e){if(seq===historyRequest.current)setError((e as Error).message);}finally{if(seq===historyRequest.current)setHistoryBusy(false);}
  }
  async function checkLatest(){if(!selected)return;setBusy(true);try{setLatest((await request(companyId,`&orderId=${encodeURIComponent(selected.snapshot.id)}`)).order);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function useLatest(){if(!latest||!mayLeave())return;setSelected(latest);setEditor(null);clearFeedback();}
  const blocked=busy||uncertain;
  const fieldError=(name:string)=>invalid[name]?<small id={`po-error-${name}`} role="alert" className="po-field-error">{invalid[name]}</small>:null;
  const snapshot=selected?.snapshot;
  let known=snapshot?.knownSubtotalMinor??'0',complete=snapshot?.pricesComplete??false;
  if(editor){let subtotal=BigInt(0);complete=true;
    const orderLines=editor.source==='proposals'?(selected?.snapshot.lines??choices.proposals.filter(p=>editor.proposalIds.includes(p.id)).map(()=>({estimatedLineMinor:null}))):editor.lines.map(l=>{
      try{const price=editor.source==='registry'&&l.kind==='stock'?mappingFor(l)?.estimatedUnitMinor??null:l.estimate.trim()?cents(l.estimate):null;
        return {estimatedLineMinor:price!==null&&/^[1-9]\d{0,8}$/.test(l.packs)?(BigInt(price)*BigInt(l.packs)).toString():null};}catch{return {estimatedLineMinor:null};}});
    for(const l of orderLines){if(l.estimatedLineMinor===null)complete=false;else subtotal+=BigInt(l.estimatedLineMinor);}known=subtotal.toString();
  }
  if(!active)return null;
  if(loading)return <p role="status">Loading purchase-order drafts…</p>;
  if(!enabled)return <p>Purchase-order draft preview is unavailable. {error}</p>;
  return <FieldErrors.Provider value={invalid}><section className="po-preview" aria-label="Purchase-order drafts">
    <header className="po-heading"><div><h1>{editor?(selected?'Edit purchase-order draft':'New purchase-order draft'):selected?'Purchase-order draft':'Purchase orders'}</h1>
      <p>{editor?'Prepare the details, then save a revision for review.':selected?statusLabel(selected.status):'Prepare and review supplier orders. Nothing is approved or sent here.'}</p></div>
      {!editor&&!selected&&<Button disabled={blocked} onClick={()=>{clearFeedback();openEditor(emptyEditor());}}><Plus size={16}/> New draft</Button>}
      {(editor||selected)&&<Button variant="ghost" disabled={blocked} onClick={back}><ArrowLeft size={16}/> All drafts</Button>}
    </header>
    {notice&&<p role="status" className="notice">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
    {uncertain&&<div className="po-recovery"><p>The save outcome is uncertain. Keep this page open and retry the same request.</p><Button disabled={busy} onClick={()=>pending.current&&void save(pending.current)}>Retry same request</Button></div>}
    {conflict&&selected&&<div className="po-recovery"><p>Your entered values are preserved. Check the latest saved version before trying again.</p><Button variant="outline" disabled={blocked} onClick={()=>void checkLatest()}>Check latest saved version</Button>
      {latest&&<div><p>Latest: revision {latest.revision} · {statusLabel(latest.status)}</p><ul>{snapshotChanges(selected.snapshot,latest.snapshot).map(c=><li key={c}>{c}</li>)}</ul>
        <Button variant="outline" disabled={blocked} onClick={useLatest}>Load latest saved version</Button><small>This replaces unsaved fields after confirmation.</small></div>}</div>}
    {!editor&&!selected&&<>
      {list.orders.length===0?<div className="po-empty"><h2>No purchase-order drafts yet</h2><p>Choose a supplier and add the items you want a manager to review.</p><Button disabled={blocked} onClick={()=>openEditor(emptyEditor())}>Create a draft</Button></div>:
        <div className="po-list"><div className="po-list-header"><span>Supplier / draft</span><span>Status</span><span>Created</span><span className="sr-only">Open</span></div>
          {list.orders.map(o=><div className="po-list-row" key={o.id}><div><strong>{o.supplier_name}</strong><small>{o.number} · revision {o.revision}</small></div>
            <span>{statusLabel(o.status as PurchaseOrderView['status'])}</span><time dateTime={o.created_at}>{date(o.created_at)}</time><Button variant="ghost" disabled={blocked} onClick={()=>void open(o.id)}>Open<span className="sr-only"> {o.number}</span></Button></div>)}</div>}
      <nav className="po-pagination" aria-label="Draft pages"><Button variant="outline" disabled={offset===0||blocked} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</Button><Button variant="outline" disabled={!list.hasMore||blocked} onClick={()=>setOffset(offset+20)}>Next</Button></nav>
    </>}
    {(editor||selected)&&<div className="po-workspace"><div className="po-main">
      {editor?<form id="po-editor" onSubmit={submit} onInvalidCapture={e=>{const input=e.target as HTMLInputElement;setInvalid(old=>({...old,[input.name]:input.validationMessage}));}}>
        <fieldset disabled={blocked} className="po-section"><legend>Supplier and delivery</legend>
          {!selected&&<label className="po-source">Start with<select value={editor.source} onChange={e=>{if(dirty&&!window.confirm('Discard these fields and choose a different draft source?')){e.currentTarget.value=editor.source;return;}openEditor({...emptyEditor(),source:e.target.value as DraftEditor['source']});setProfile(null);}}><option value="registry">Saved supplier and item mappings</option><option value="manual">Manual supplier details</option><option value="proposals">Saved inventory proposals</option></select></label>}
          {selected&&<p className="po-muted">{selected.snapshot.number} · revision {selected.revision}. Supplier grouping is fixed; create a new draft to change it.</p>}
          {editor.source==='registry'?<>
            {!selected?<div className="po-fields"><label>Supplier<select name="supplier" required value={editor.supplierId} onChange={e=>patch({supplierId:e.target.value,accountId:'',locationId:'',lines:[]})}><option value="">Choose supplier</option>{suppliers.suppliers.filter(s=>s.status==='active').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{fieldError('supplier')}
              {suppliers.hasMore&&<Button type="button" variant="ghost" onClick={()=>void loadSuppliers(supplierPage+20)}>More suppliers</Button>}</label>
              <label>Account<select name="account" required value={editor.accountId} onChange={e=>patch({accountId:e.target.value,locationId:'',lines:[]})}><option value="">Choose account</option>{profile?.profile.accounts.filter(a=>a.status==='active').map(a=><option key={a.id} value={a.id}>{a.reference}</option>)}</select>{fieldError('account')}</label>
              <label>Delivery location<select name="location" required value={editor.locationId} onChange={e=>patch({locationId:e.target.value,lines:[]})}><option value="">Choose location</option>{profile?.profile.locations.filter(l=>l.status==='active'&&l.accountId===editor.accountId).map(l=><option key={l.id} value={l.id}>{l.reference}</option>)}</select>{fieldError('location')}</label></div>:
              <p><strong>{snapshot!.supplier.name}</strong><br/>Account: {snapshot!.supplier.accountId} · Location: {snapshot!.supplier.locationId}</p>}
            {profile&&<p className="po-prewrap">{profile.profile.email??'Ordering email unavailable'}<br/>{profile.profile.locations.find(l=>l.id===editor.locationId)?.address}<small>Saved supplier version {profile.version} · {emailAcceptanceLabel(profile.profile.emailAcceptance.status)}</small></p>}
          </>:<div className="po-fields"><label>Supplier name<Input name="name" required maxLength={200} value={editor.name} onChange={e=>patch({name:e.target.value})}/>{fieldError('name')}</label>
            <label>Ordering email<Input name="email" required type="email" maxLength={254} value={editor.email} onChange={e=>patch({email:e.target.value})}/>{fieldError('email')}</label>
            {editor.source==='manual'&&<><label>Account reference<Input name="account" required readOnly={!!selected} maxLength={200} value={editor.accountId} onChange={e=>patch({accountId:e.target.value})}/>{fieldError('account')}</label>
              <label>Location reference<Input name="location" required readOnly={!!selected} maxLength={200} value={editor.locationId} onChange={e=>patch({locationId:e.target.value})}/>{fieldError('location')}</label></>}
            <label className="po-wide">Delivery address<textarea name="address" required maxLength={1000} value={editor.address} onChange={e=>patch({address:e.target.value})}/>{fieldError('address')}</label></div>}
        </fieldset>
        <fieldset disabled={blocked} className="po-section"><legend>Order lines</legend>
          {editor.source==='proposals'?(selected?<><p>Quantities and references are frozen from Inventory → Purchasing plan. Create a new draft to use changed proposals.</p><SavedLines snapshot={snapshot!}/></>:
            <><p>Choose proposals from one supplier/account/location group. Their quantities are preserved.</p>{choices.proposals.length===0&&<p>No eligible proposals. Prepare a purchasing plan in Inventory first.</p>}
              {choices.proposals.map(p=><label className="po-check" key={p.id}><input type="checkbox" checked={editor.proposalIds.includes(p.id)} onChange={e=>patch({proposalIds:e.target.checked?[...editor.proposalIds,p.id]:editor.proposalIds.filter(id=>id!==p.id)})}/>
                <span>{p.name} · {p.packs} packs<small>{p.supplier_id} / {p.account_id} / {p.location_id} · revision {p.revision}</small></span></label>)}</>):
            <><div className="po-lines-heading" aria-hidden="true"><span>Item and pack</span><span>Quantity and estimate</span></div>
              {editor.lines.map((l,i)=>{const prefix=`line-${i}`,mapped=mappingFor(l),current=mappings.mappings.find(m=>m.mapping.id===l.mappingId);
                return <div className="po-edit-row" key={l.key}><div className="po-item-fields"><label>Line {i+1} type<select value={l.kind} onChange={e=>patchLine(l.key,{kind:e.target.value as EditorLine['kind'],productId:'',mappingId:undefined,mappingVersion:undefined,configId:undefined,configVersion:undefined})}><option value="non_stock">Non-stock item or service</option><option value="stock">Inventory item</option></select></label>
                  {l.kind==='stock'?(editor.source==='registry'?<label>Mapped supplier item<select name={`${prefix}-mapping`} required value={l.mappingId?`${l.mappingId}:${l.mappingVersion}`:''} onChange={e=>{const m=mappings.mappings.find(m=>`${m.mapping.id}:${m.mapping.version}`===e.target.value)?.mapping;if(m)patchLine(l.key,{mappingId:m.id,mappingVersion:m.version,description:m.description,sku:m.sku});}}><option value="">Choose mapped item</option>
                    {mapped&&!mappings.mappings.some(m=>m.mapping.id===mapped.id&&m.mapping.version===mapped.version)&&<option value={`${mapped.id}:${mapped.version}`}>{mapped.description} · saved version {mapped.version}</option>}
                    {mappings.mappings.filter(m=>!m.warning&&m.mapping.accountId===editor.accountId&&m.mapping.locationId===editor.locationId).map(({mapping:m})=><option key={`${m.id}:${m.version}`} value={`${m.id}:${m.version}`}>{m.description} · {m.sku} · version {m.version}</option>)}</select>{fieldError(`${prefix}-mapping`)}
                    {mapped&&<small>{draftStockDisplay(mapped.stockUnitsPerPack)} per {mapped.unitLabel} · estimated {money(mapped.estimatedUnitMinor)} per pack</small>}
                    {current&&current.mapping.version!==l.mappingVersion&&<small className="po-field-error">Mapping changed. Select the current version to review its new pack details.</small>}</label>:
                    <label>Inventory item<select name={`${prefix}-product`} required value={l.productId} onChange={e=>{const s=choices.stocks.find(s=>s.product_id===e.target.value);if(s)patchLine(l.key,{productId:s.product_id,configId:s.config_id,configVersion:s.config_version,sku:s.sku,description:s.name,unitLabel:s.purchase_unit_label});}}><option value="">Choose inventory item</option>
                      {l.productId&&!choices.stocks.some(s=>s.product_id===l.productId)&&<option value={l.productId}>{l.description} · saved item unavailable</option>}{choices.stocks.map(s=><option key={s.product_id} value={s.product_id}>{s.name} · {s.purchase_unit_label}</option>)}</select>{fieldError(`${prefix}-product`)}
                      {l.configId&&<small>Saved pack configuration version {l.configVersion}.</small>}
                      {choices.stocks.find(s=>s.product_id===l.productId)&&choices.stocks.find(s=>s.product_id===l.productId)!.config_id!==l.configId&&
                        <Button type="button" variant="outline" onClick={()=>{const s=choices.stocks.find(s=>s.product_id===l.productId)!;patchLine(l.key,{configId:s.config_id,configVersion:s.config_version,unitLabel:s.purchase_unit_label});}}>Use current pack configuration</Button>}</label>):
                    <label>Order unit<Input name={`${prefix}-unit`} required maxLength={200} value={l.unitLabel} onChange={e=>patchLine(l.key,{unitLabel:e.target.value})}/>{fieldError(`${prefix}-unit`)}</label>}
                  {(editor.source!=='registry'||l.kind==='non_stock')&&<div className="po-fields"><label>Description<Input name={`${prefix}-description`} required maxLength={200} value={l.description} onChange={e=>patchLine(l.key,{description:e.target.value})}/>{fieldError(`${prefix}-description`)}</label>
                    <label>Supplier SKU / reference<Input name={`${prefix}-sku`} required maxLength={200} value={l.sku} onChange={e=>patchLine(l.key,{sku:e.target.value})}/>{fieldError(`${prefix}-sku`)}</label></div>}</div>
                  <div className="po-quantity-fields"><label>Whole packs / units<Input name={`${prefix}-packs`} required inputMode="numeric" pattern="[1-9][0-9]{0,8}" value={l.packs} onChange={e=>patchLine(l.key,{packs:e.target.value})}/>{fieldError(`${prefix}-packs`)}</label>
                    {(editor.source!=='registry'||l.kind==='non_stock')&&<label>Estimated price per unit (USD)<Input name={`${prefix}-price`} inputMode="decimal" pattern="[0-9]{1,10}(\.[0-9]{1,2})?" value={l.estimate} onChange={e=>patchLine(l.key,{estimate:e.target.value})}/><small>Leave blank if unavailable.</small>{fieldError(`${prefix}-price`)}</label>}
                    <Button type="button" variant="ghost" onClick={()=>patch({lines:editor.lines.filter(n=>n.key!==l.key)})}>Remove<span className="sr-only"> line {i+1}</span></Button></div></div>;})}
              {editor.lines.length===0&&<p className="po-muted">Add an inventory item or a non-stock item to begin.</p>}
              <div className="po-actions"><Button type="button" variant="outline" disabled={editor.lines.length>=50} onClick={()=>patch({lines:[...editor.lines,newLine()]})}><Plus size={16}/> Add line</Button>{editor.source==='registry'&&mappings.hasMore&&<Button type="button" variant="ghost" onClick={()=>void moreMappings()}>Load more mappings</Button>}</div></>}
        </fieldset>
        <fieldset disabled={blocked} className="po-section"><legend>Instructions and review details</legend><label>Delivery instructions / notes<textarea name="notes" maxLength={1000} value={editor.notes} onChange={e=>patch({notes:e.target.value})}/></label>
          {selected&&<label>Reason for these changes<Input name="reason" required minLength={4} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/><small>Saved with this revision so other managers can understand the correction.</small>{fieldError('reason')}</label>}
        </fieldset>
      </form>:snapshot&&<>
        <section className="po-section"><h2>Supplier and delivery</h2><p><strong>{snapshot.supplier.name}</strong><br/>{snapshot.supplier.email??'Ordering email unavailable'}</p><p>Account: {snapshot.supplier.accountId} · Location: {snapshot.supplier.locationId}</p><p className="po-prewrap">{snapshot.supplier.deliveryAddress}</p></section>
        <section className="po-section"><h2>Order lines</h2><SavedLines snapshot={snapshot}/></section>
        <section className="po-section"><h2>Delivery instructions</h2><p className="po-prewrap">{snapshot.notes||'No delivery instructions added.'}</p></section>
        <SavedSource snapshot={snapshot}/>
      </>}
      {selected&&<details className="po-section po-history"><summary>Revision history · {selected.events.length} records</summary><ol>{selected.events.map(e=><li key={e.revision}><div><strong>Revision {e.revision} · {e.kind==='review'?'Reviewed':e.kind==='edit'?'Edited':e.kind==='cancel'?'Canceled':'Created'}</strong><p>{e.reason}</p><small>{date(e.at)} · {e.actor}</small></div><Button type="button" variant="ghost" disabled={historyBusy||blocked} onClick={()=>void inspectRevision(e.revision)}>Inspect<span className="sr-only"> revision {e.revision}</span></Button></li>)}</ol>
        {historyBusy&&<p role="status">Loading revision…</p>}{history&&<div className="po-revision"><h3>Saved revision {history.order.revision}</h3><p>{statusLabel(history.order.status)}</p><ul>{history.changes.length?history.changes.map(c=><li key={c}>{c}</li>):<li>Order details unchanged. Status and review history updated.</li>}</ul>
          <details><summary>Complete saved details</summary><p>{history.order.snapshot.supplier.name} · {history.order.snapshot.supplier.email??'Email unavailable'}</p><p className="po-prewrap">{history.order.snapshot.supplier.deliveryAddress}</p><p>Proposed cap: {money(history.order.snapshot.capMinor)} · Account: {history.order.snapshot.supplier.accountId} · Location: {history.order.snapshot.supplier.locationId}</p><SavedLines snapshot={history.order.snapshot}/><p className="po-prewrap">{history.order.snapshot.notes||'No instructions'}</p><SavedSource snapshot={history.order.snapshot}/><ul>{history.order.snapshot.warnings.map(w=><li key={w}>{w}</li>)}</ul></details></div>}
      </details>}
    </div><aside className="po-summary" aria-label="Spending and review"><h2>Spending summary</h2><dl><div><dt>Known estimated subtotal</dt><dd>{money(known)}</dd></div></dl>{!complete&&<p>Some prices are unavailable. This subtotal excludes those items.</p>}
      {editor?<label>Proposed total spending cap (USD)<Input form="po-editor" name="cap" required inputMode="decimal" pattern="[0-9]{1,10}(\.[0-9]{1,2})?" value={editor.cap} disabled={blocked} onInvalid={e=>setInvalid(old=>({...old,cap:e.currentTarget.validationMessage}))} onChange={e=>{patch({cap:e.target.value});setInvalid(old=>({...old,cap:''}));}}/>{fieldError('cap')}<small>Include tax and delivery. No funds are reserved.</small></label>:
        <dl><div><dt>Proposed total cap</dt><dd>{money(snapshot!.capMinor)}</dd></div></dl>}
      <p className="po-muted">Prices are estimates. Review does not approve a purchase, reserve stock or spending, or send an order.</p>
      {editor?<div className="po-summary-actions"><Button type="submit" form="po-editor" disabled={blocked||(editor.source==='proposals'&&!selected?editor.proposalIds.length===0:editor.lines.length===0)||(!!selected&&!dirty)}>{busy?'Saving…':selected?'Save changes':'Save draft'}</Button>
        <Button variant="ghost" disabled={blocked} onClick={()=>{if(mayLeave()){setEditor(null);setInvalid({});setReason('');}}}>{selected?'Discard edits':'Cancel new draft'}</Button></div>:
        selected&&<div className="po-summary-actions">{selected.status!=='canceled'&&<Button variant="outline" disabled={blocked} onClick={()=>{clearFeedback();openEditor(editorFrom(selected.snapshot));}}><Pencil size={16}/> Edit draft</Button>}
          {selected.status==='draft'&&<><h3>Manager review</h3><ul className="po-warnings">{snapshot!.warnings.map(w=><li key={w}>{w}</li>)}</ul><label className="po-check"><input type="checkbox" checked={ack} disabled={blocked} onChange={e=>setAck(e.target.checked)}/><span>I checked these details and warnings. This review does not authorize an order.</span></label><Button disabled={blocked||!ack} onClick={()=>void save({action:'review',companyId,operationId:crypto.randomUUID(),orderId:snapshot!.id,expectedRevision:selected.revision,acknowledgeWarnings:true})}><Check size={16}/> Mark reviewed</Button></>}
          {selected.review&&<p>Reviewed by {selected.review.actor} on {date(selected.review.at)}.<br/>Content revision {selected.review.contentRevision}. Any saved edit requires another review.</p>}
          {selected.status!=='canceled'&&<details className="po-cancel"><summary>Cancel this draft</summary><label>Cancellation reason<Input disabled={blocked} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button variant="outline" disabled={blocked||reason.trim().length<4} onClick={()=>void save({action:'cancel',companyId,operationId:crypto.randomUUID(),orderId:snapshot!.id,expectedRevision:selected.revision,reason})}>Cancel draft</Button></details>}
        </div>}
      {selected&&<small>{selected.snapshot.number}<br/>Revision {selected.revision}</small>}
    </aside></div>}
  </section></FieldErrors.Provider>;
}
function SavedSource({snapshot}:{snapshot:PurchaseOrderSnapshot}){const saved=snapshot.registry;if(!saved)return null;const p=saved.profile.profile;
  return <details className="po-section"><summary>Saved supplier terms · version {saved.profile.version}</summary><dl><dt>Payment terms</dt><dd>{p.paymentTerms||'Unavailable'}</dd><dt>Minimum order estimate</dt><dd>{money(p.minimumOrderMinor)}</dd><dt>Delivery fee estimate</dt><dd>{money(p.deliveryFeeMinor)}</dd><dt>Email ordering acceptance</dt><dd>{emailAcceptanceLabel(p.emailAcceptance.status)}</dd></dl><p className="po-prewrap">{p.orderingInstructions||'No ordering instructions recorded.'}</p><p className="po-prewrap">{p.notes}</p></details>;}
function SavedLines({snapshot}:{snapshot:PurchaseOrderSnapshot}){return <div className="po-saved-lines"><div className="po-lines-heading" aria-hidden="true"><span>Item and pack</span><span>Quantity / estimate</span></div>{snapshot.lines.map(l=><div className="po-saved-row" key={l.id}><div><strong>{l.description}</strong><small>{l.sku} · {l.kind==='stock'?'Inventory item':'Non-stock item'}</small>{l.stockUnitsPerPack&&<small>{draftStockDisplay(l.stockUnitsPerPack)} per {l.unitLabel}</small>}{l.proposal&&<small>Proposal {l.proposal.proposalId} · revision {l.proposal.revision}</small>}{l.mappingId&&<small>Mapping {l.mappingId} · version {l.mappingVersion}</small>}</div><div><strong>{l.packs} {l.unitLabel}</strong>{l.stockQuantity&&<small>{draftStockDisplay(l.stockQuantity)} stock total</small>}<small>Estimated {money(l.estimatedLineMinor)}</small></div></div>)}</div>;}
