'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRequestScope} from '@/hooks/use-request-scope';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PurchasingSuppliers} from '@/lib/d1-purchasing-suppliers';
import {deliveryRhythmText,type SupplierProfile,type SupplierVersion,type MappingVersion} from '@/lib/purchasing-supplier-contract';
import {CURATED_UNIT_IDS,curatedUnit,unitLabel,type UnitDefinition} from '@/lib/inventory-quantities';
import {supplierRequest,purchasingCents,purchasingDollars,PurchasingRequestError} from './purchasing-client';
import './purchase-order-drafts.css';
import './supplier-page.css';
import {StatusBadge} from '@/components/ui/status-badge';
import {TaskSection} from './task-form';
import {Pencil,Plus,Truck} from 'lucide-react';

type SupplierList=Awaited<ReturnType<D1PurchasingSuppliers['list']>>;
type MappingList=Awaited<ReturnType<D1PurchasingSuppliers['mappings']>>;
type History=Awaited<ReturnType<D1PurchasingSuppliers['history']>>;
type Stocks=Awaited<ReturnType<D1PurchasingSuppliers['stocks']>>['stocks'];
type MapForm={id:string;version:number;accountId:string;locationId:string;productId:string;sku:string;description:string;unitLabel:string;packAmount:string;unitKey:string;estimate:string};
const unitKey=(unit:UnitDefinition)=>`${unit.id}:${unit.version}`;
// Both or neither: a half-entered delivery schedule is refused before saving.
function rhythm(every:string,takes:string){const a=every.trim(),b=takes.trim();if(!a&&!b)return null;
  const order=Number(a),delivery=Number(b);
  if(!a||!b||!Number.isInteger(order)||!Number.isInteger(delivery)||order<1||order>60||delivery<0||delivery>60)
    throw Error('Enter both delivery schedule numbers in whole days: order every 1–60 days, delivery in 0–60 days.');
  return {orderEveryDays:order,deliveryDays:delivery};}
const newProfile=():SupplierProfile=>{const accountId=crypto.randomUUID();return {name:'',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,
  orderingInstructions:'',notes:'',emailAcceptance:{status:'unknown',note:''},accounts:[{id:accountId,reference:'',status:'active'}],
  locations:[{id:crypto.randomUUID(),accountId,reference:'',address:'',status:'active'}]};};
export default function PurchasingSuppliers({companyId,active,onEnabledChange,onDirtyChange,onSaved}:{companyId:string;active:boolean;onEnabledChange:(v:boolean)=>void;onDirtyChange:(v:boolean)=>void;onSaved:()=>void}){
  const [enabled,setEnabled]=useState(false),[list,setList]=useState<SupplierList>({suppliers:[],hasMore:false}),[offset,setOffset]=useState(0);
  const [current,setCurrent]=useState<SupplierVersion|null>(null),[profile,setProfile]=useState<SupplierProfile|null>(null),[profileId,setProfileId]=useState('');
  const [minimum,setMinimum]=useState(''),[fee,setFee]=useState(''),[orderEvery,setOrderEvery]=useState(''),[deliveryDays,setDeliveryDays]=useState(''),[reason,setReason]=useState('');
  const [maps,setMaps]=useState<MappingList>({mappings:[],hasMore:false}),[mapOffset,setMapOffset]=useState(0),[mapForm,setMapForm]=useState<MapForm|null>(null);
  const [stocks,setStocks]=useState<Stocks>([]);
  const productId=mapForm?.productId??'',unitSource=JSON.stringify([companyId,current?.id,mapForm?.id,productId]);
  const [unitView,setUnitView]=useState<{source:string;units:UnitDefinition[];config:{productId:string;id:string;version:number}}|null>(null);
  const [observedUnitSource,setObservedUnitSource]=useState(unitSource);
  if(observedUnitSource!==unitSource){setObservedUnitSource(unitSource);setUnitView(null);}
  const units=unitView?.source===unitSource?unitView.units:[],config=unitView?.source===unitSource?unitView.config:null;
  const [stockMore,setStockMore]=useState(false),[stockOffset,setStockOffset]=useState(0);
  const [history,setHistory]=useState<History>({versions:[],hasMore:false}),[historyKind,setHistoryKind]=useState<'profile'|'mapping'>('profile'),[historyId,setHistoryId]=useState(''),[historyOffset,setHistoryOffset]=useState(0);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [editMode,setEditMode]=useState(false),[tab,setTab]=useState<'details'|'products'|'history'>('details');
  const [baseline,setBaseline]=useState('');
  const pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  const profileText=JSON.stringify({profile,minimum,fee,orderEvery,deliveryDays});
  const dirty=!!profile&&profileText!==baseline||!!mapForm;
  useEffect(()=>onDirtyChange(dirty||uncertain),[dirty,uncertain,onDirtyChange]);
  useEffect(()=>{let live=true;void supplierRequest<SupplierList>(companyId).then(data=>{if(live){setList(data);setEnabled(true);onEnabledChange(true);}})
    .catch(e=>{if(live){setEnabled(false);onEnabledChange(false);if(!(e instanceof PurchasingRequestError&&e.status===404))setError(e.message);}});return()=>{live=false;};},[companyId,onEnabledChange]);
  const currentId=current?.id;
  const beginList=useRequestScope(companyId),beginStocks=useRequestScope(companyId),beginMaps=useRequestScope(JSON.stringify([companyId,currentId,current?.version]));
  const loadList=useCallback((page:number)=>{const valid=beginList();return supplierRequest<SupplierList>(companyId,`&offset=${page}`).then(data=>{if(valid())setList(data);}).catch(e=>{if(valid())setError((e as Error).message);});},[companyId,beginList]);
  const loadStocks=useCallback((page:number)=>{const valid=beginStocks();return supplierRequest<Awaited<ReturnType<D1PurchasingSuppliers['stocks']>>>(companyId,`&view=stocks&offset=${page}`).then(d=>{if(!valid())return;setStocks(previous=>page===0?d.stocks:[...previous,...d.stocks.filter(s=>!previous.some(p=>p.product_id===s.product_id))]);setStockMore(d.hasMore);setStockOffset(page);}).catch(e=>{if(valid())setError((e as Error).message);});},[companyId,beginStocks]);
  const loadMaps=useCallback((page:number,supplierId=currentId)=>{if(!supplierId)return Promise.resolve();const valid=beginMaps();return supplierRequest<MappingList>(companyId,`&view=mappings&supplierId=${encodeURIComponent(supplierId)}&offset=${page}`).then(data=>{if(valid())setMaps(data);}).catch(e=>{if(valid())setError((e as Error).message);});},[companyId,currentId,beginMaps]);
  useEffect(()=>{if(enabled&&active)void loadList(offset);},[enabled,active,offset,loadList]);
  useEffect(()=>{if(enabled&&active)void loadStocks(0);},[enabled,active,loadStocks]);
  useEffect(()=>{if(enabled&&active&&current)void loadMaps(mapOffset);},[enabled,active,current,mapOffset,loadMaps]);
  const beginUnits=useRequestScope(unitSource);
  useEffect(()=>{if(!productId)return;const valid=beginUnits();
    void supplierRequest<Awaited<ReturnType<D1PurchasingSuppliers['units']>>>(companyId,`&view=units&productId=${encodeURIComponent(productId)}`).then(data=>{
      if(valid())setUnitView({source:unitSource,config:{productId,id:data.config.id,version:data.config.version},units:[...CURATED_UNIT_IDS.map(curatedUnit).filter(u=>u.dimension===data.config.dimension),...data.units]});
    }).catch(e=>{if(valid())setError(e.message);});},[companyId,productId,unitSource,beginUnits]);
  function adopt(p:SupplierVersion){setCurrent(p);setProfileId(p.id);setProfile(structuredClone(p.profile));const min=purchasingDollars(p.profile.minimumOrderMinor),f=purchasingDollars(p.profile.deliveryFeeMinor);
    const every=String(p.profile.deliveryRhythm?.orderEveryDays??''),takes=String(p.profile.deliveryRhythm?.deliveryDays??'');setOrderEvery(every);setDeliveryDays(takes);
    setMinimum(min);setFee(f);setBaseline(JSON.stringify({profile:p.profile,minimum:min,fee:f,orderEvery:every,deliveryDays:takes}));setReason('');setMapForm(null);setMapOffset(0);}
  function discard(){return !dirty||window.confirm('Discard unsaved supplier or mapping changes?');}
  async function open(id:string){if(!discard())return;try{const data=await supplierRequest<{supplier:SupplierVersion}>(companyId,`&supplierId=${encodeURIComponent(id)}`);adopt(data.supplier);setHistory({versions:[],hasMore:false});setHistoryId('');}catch(e){setError((e as Error).message);}}
  function newSupplier(){if(!discard())return;const p=newProfile();setCurrent(null);setProfileId(crypto.randomUUID());setProfile(p);setMinimum('');setFee('');setOrderEvery('');setDeliveryDays('');setBaseline('');setReason('');setMapForm(null);setMaps({mappings:[],hasMore:false});setHistoryId('');setHistory({versions:[],hasMore:false});}
  async function showHistory(id:string,kind:'profile'|'mapping',page=0){try{setHistory(await supplierRequest<History>(companyId,`&view=history&${kind==='profile'?'supplierId':'mappingId'}=${encodeURIComponent(id)}&offset=${page}`));setHistoryId(id);setHistoryKind(kind);setHistoryOffset(page);}catch(e){setError((e as Error).message);}}
  async function save(body:Record<string,unknown>){if(lock.current)return;lock.current=true;setBusy(true);pending.current=body;setError('');setNotice('');
    try{const data=await supplierRequest<{supplier?:SupplierVersion;mapping?:MappingVersion}>(companyId,'',body);pending.current=null;setUncertain(false);
      if(data.supplier){adopt(data.supplier);setEditMode(false);}if(data.mapping){setMapForm(null);setReason('');setMapOffset(0);await loadMaps(0,data.mapping.supplierId);}
      setOffset(0);await loadList(0);setHistoryId('');setHistory({versions:[],hasMore:false});onSaved();setNotice('Saved with version history. Nothing has been sent.');
    }catch(e){setError((e as Error).message);const unknown=!(e instanceof PurchasingRequestError)||e.status>=500;setUncertain(unknown);if(!unknown)pending.current=null;}
    finally{lock.current=false;setBusy(false);}
  }
  function saveProfile(event:React.FormEvent){event.preventDefault();if(!profile||busy||uncertain)return;
    try{void save({action:'save_profile',companyId,operationId:crypto.randomUUID(),supplierId:profileId,expectedVersion:current?.version??0,reason,
      profile:{...profile,minimumOrderMinor:minimum.trim()?purchasingCents(minimum):null,deliveryFeeMinor:fee.trim()?purchasingCents(fee):null,deliveryRhythm:rhythm(orderEvery,deliveryDays)}});}catch(e){setError((e as Error).message);}}
  function startMapping(mapping?:MappingVersion){if(mapForm&&!window.confirm('Discard the unsaved mapping?'))return;if(!current)return;
    const account=current.profile.accounts.find(a=>a.status==='active'),location=current.profile.locations.find(l=>l.status==='active'&&l.accountId===account?.id);
    setMapForm(mapping?{id:mapping.id,version:mapping.version,accountId:mapping.accountId,locationId:mapping.locationId,productId:mapping.productId,sku:mapping.sku,
      description:mapping.description,unitLabel:mapping.unitLabel,packAmount:mapping.packAmount,unitKey:unitKey(mapping.packUnit),estimate:purchasingDollars(mapping.estimatedUnitMinor)}:
      {id:crypto.randomUUID(),version:0,accountId:account?.id??'',locationId:location?.id??'',productId:'',sku:'',description:'',unitLabel:'case',packAmount:'',unitKey:'',estimate:''});setReason('');}
  function updateMap(values:Partial<MapForm>){setMapForm(m=>m?{...m,...values}:null);}
  function saveMap(event:React.FormEvent){event.preventDefault();if(!mapForm||!current||!config||busy||uncertain)return;
    try{const unit=units.find(u=>unitKey(u)===mapForm.unitKey);if(!unit)throw Error('Select a current compatible measurement.');
      void save({action:'save_mapping',companyId,operationId:crypto.randomUUID(),reason,mappingId:mapForm.id,expectedVersion:mapForm.version,
        supplierId:current.id,expectedSupplierVersion:current.version,accountId:mapForm.accountId,locationId:mapForm.locationId,productId:mapForm.productId,
        expectedConfigId:config.id,expectedConfigVersion:config.version,sku:mapForm.sku,description:mapForm.description,unitLabel:mapForm.unitLabel,
        packAmount:mapForm.packAmount,packUnitId:unit.id,packUnitVersion:unit.version,estimatedUnitMinor:mapForm.estimate.trim()?purchasingCents(mapForm.estimate):null});
    }catch(e){setError((e as Error).message);}}
  if(!active)return null;if(!enabled)return <p>Supplier details are unavailable. {error}</p>;
  const blocked=busy||uncertain;
  const editing=!!profile&&(!current||editMode);
  const money=(minor:string|null|undefined)=>minor===null||minor===undefined?'—':`$${purchasingDollars(minor)}`;
  const activeAccounts=current?.profile.accounts.filter(a=>a.status==='active')??[],activeLocations=current?.profile.locations.filter(l=>l.status==='active')??[];
  function startEdit(){if(!current)return;adopt(current);setEditMode(true);setReason('Updated details');}
  function cancelEdit(){if(!discard())return;if(current){adopt(current);setEditMode(false);}else{setProfile(null);setMapForm(null);}}
  function archiveSupplier(){if(!current)return;const why=window.prompt(`Archive ${current.profile.name}? Give a short reason.`,'No longer used');if(!why||why.trim().length<4)return;void save({action:'archive_profile',companyId,operationId:crypto.randomUUID(),supplierId:current.id,expectedVersion:current.version,reason:why});}
  function archiveMapping(m:MappingVersion){const why=window.prompt(`Stop using ${m.description} from this supplier? Give a short reason.`,'No longer ordered');if(!why||why.trim().length<4)return;void save({action:'archive_mapping',companyId,operationId:crypto.randomUUID(),mappingId:m.id,expectedVersion:m.version,reason:why});}
  return <section className="po-preview supplier-page"><div className="page-heading"><div><div className="eyebrow">Suppliers</div><h1>Your suppliers</h1></div><Button disabled={blocked} onClick={()=>{newSupplier();setEditMode(true);setTab('details');setReason('New supplier');}}><Plus size={16}/>Add supplier</Button></div>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
    {uncertain&&<div className="notice"><p>We couldn’t confirm that save. Try again before changing anything.</p><Button disabled={busy} onClick={()=>pending.current&&void save(pending.current)}>Try again</Button></div>}
    <div className="supplier-layout">
      <nav className="supplier-list" aria-label="Suppliers">
        {list.suppliers.length?list.suppliers.map(s=><button type="button" key={s.id} aria-current={current?.id===s.id?'true':undefined} disabled={blocked} onClick={()=>{void open(s.id);setEditMode(false);setTab('details');}}>
          <span className="supplier-avatar" aria-hidden="true">{s.name.slice(0,1).toUpperCase()}</span><span className="supplier-list-text"><strong>{s.name}</strong><small>Updated {new Date(s.updated_at).toLocaleDateString()}</small></span>
          {s.status!=='active'&&<StatusBadge tone="neutral">Archived</StatusBadge>}</button>)
        :<div className="supplier-empty"><Truck size={26}/><strong>No suppliers yet</strong><span>Add the companies you order from.</span></div>}
        {(offset>0||list.hasMore)&&<div className="supplier-list-pages"><Button size="sm" variant="ghost" disabled={blocked||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</Button><Button size="sm" variant="ghost" disabled={blocked||!list.hasMore} onClick={()=>setOffset(offset+20)}>More</Button></div>}
      </nav>
      <div className="supplier-detail">
        {!profile&&!current&&<div className="supplier-placeholder"><Truck size={30}/><strong>Choose a supplier</strong><span>Or add a new one.</span></div>}
        {current&&!editing&&<article className="supplier-card">
          <header className="supplier-card-head"><span className="supplier-avatar large" aria-hidden="true">{current.profile.name.slice(0,1).toUpperCase()}</span><div><h2>{current.profile.name}</h2><p>{deliveryRhythmText(current.profile.deliveryRhythm)}</p></div>
            <StatusBadge tone={current.status==='active'?'good':'neutral'}>{current.status==='active'?'Active':'Archived'}</StatusBadge></header>
          <div className="supplier-tabs" role="tablist">{(['details','products','history'] as const).map(t=><button type="button" role="tab" key={t} aria-selected={tab===t} onClick={()=>{setTab(t);if(t==='history')void showHistory(current.id,'profile');}}>{t==='details'?'Details':t==='products'?`Products${maps.mappings.length?` (${maps.mappings.length})`:''}`:'History'}</button>)}</div>
          {tab==='details'&&<><dl className="supplier-facts">
            <div><dt>Email</dt><dd>{current.profile.email??'—'}</dd></div><div><dt>Phone</dt><dd>{current.profile.telephone||'—'}</dd></div>
            <div><dt>Minimum order</dt><dd>{money(current.profile.minimumOrderMinor)}</dd></div><div><dt>Delivery fee</dt><dd>{money(current.profile.deliveryFeeMinor)}</dd></div>
            <div><dt>Account</dt><dd>{activeAccounts.map(a=>a.reference).join(', ')||'—'}</dd></div><div><dt>Deliver to</dt><dd>{activeLocations.map(l=>l.address||l.reference).join(' · ')||'—'}</dd></div>
            {current.profile.paymentTerms&&<div className="wide"><dt>Payment terms</dt><dd>{current.profile.paymentTerms}</dd></div>}
            {current.profile.orderingInstructions&&<div className="wide"><dt>Cutoff and delivery rules</dt><dd>{current.profile.orderingInstructions}</dd></div>}
            {current.profile.notes&&<div className="wide"><dt>Notes</dt><dd>{current.profile.notes}</dd></div>}
          </dl>
          {current.status==='active'&&<div className="supplier-actions"><Button disabled={blocked} onClick={startEdit}><Pencil size={15}/>Edit details</Button><Button variant="ghost" disabled={blocked||dirty} onClick={archiveSupplier}>Archive</Button></div>}</>}
          {tab==='products'&&<>
            {maps.mappings.length?<div className="inventory-table dense-table"><table className="supplier-products"><thead><tr><th>Item</th><th>Supplier SKU</th><th>Pack</th><th className="num">Est. price</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {maps.mappings.map(({mapping:m,warning})=><tr key={m.id}><td><strong>{m.description}</strong>{warning&&<small className="warning">{warning}</small>}</td><td>{m.sku}</td><td>{m.unitLabel} of {m.packAmount} {m.packUnit.kind==='curated'?unitLabel(m.packUnit.id):m.packUnit.label}</td><td className="num">{money(m.estimatedUnitMinor)}</td>
                <td className="row-action">{m.status==='active'?<><Button size="sm" variant="outline" disabled={blocked||dirty||current.status!=='active'} onClick={()=>startMapping(m)}>Edit</Button><Button size="sm" variant="ghost" disabled={blocked||dirty} onClick={()=>archiveMapping(m)}>Remove</Button></>:<StatusBadge tone="neutral">Removed</StatusBadge>}</td></tr>)}
            </tbody></table></div>:<p className="muted">No products linked yet.</p>}
            {(mapOffset>0||maps.hasMore)&&<div className="supplier-list-pages"><Button size="sm" variant="ghost" disabled={blocked||mapOffset===0} onClick={()=>setMapOffset(Math.max(0,mapOffset-20))}>Previous</Button><Button size="sm" variant="ghost" disabled={blocked||!maps.hasMore} onClick={()=>setMapOffset(mapOffset+20)}>More</Button></div>}
            {!mapForm&&current.status==='active'&&<div className="supplier-actions"><Button disabled={blocked||dirty} onClick={()=>startMapping()}><Plus size={15}/>Link a product</Button></div>}
            {mapForm&&<form className="task-form supplier-form" onSubmit={saveMap}><fieldset disabled={blocked}>
              <TaskSection title={mapForm.version?'Edit product':'Link a product'}>
                <label>Your stock item<select required disabled={mapForm.version>0} value={mapForm.productId} onChange={e=>{const stock=stocks.find(s=>s.product_id===e.target.value);updateMap({productId:e.target.value,description:stock?.name??'',unitKey:''});}}><option value="">Choose an item</option>{mapForm.version>0&&!stocks.some(s=>s.product_id===mapForm.productId)&&<option value={mapForm.productId}>{mapForm.description}</option>}{stocks.map(s=><option key={s.product_id} value={s.product_id}>{s.name}</option>)}</select></label>
                {stockMore&&<Button type="button" size="sm" variant="ghost" onClick={()=>void loadStocks(stockOffset+20)}>Show more items</Button>}
                <div className="supplier-grid"><label>Supplier SKU<Input required maxLength={200} value={mapForm.sku} onChange={e=>updateMap({sku:e.target.value})}/></label>
                  <label>Name on their list<Input required maxLength={200} value={mapForm.description} onChange={e=>updateMap({description:e.target.value})}/></label></div>
                <div className="supplier-grid three"><label>Sold as<Input required maxLength={200} value={mapForm.unitLabel} onChange={e=>updateMap({unitLabel:e.target.value})} placeholder="case"/></label>
                  <label>Holds<Input required inputMode="decimal" maxLength={128} value={mapForm.packAmount} onChange={e=>updateMap({packAmount:e.target.value})}/></label>
                  <label>Unit<select required value={mapForm.unitKey} onChange={e=>updateMap({unitKey:e.target.value})}><option value="">Choose</option>{units.map(u=><option key={unitKey(u)} value={unitKey(u)}>{u.kind==='curated'?unitLabel(u.id):u.label}</option>)}</select></label></div>
                <label>Price per {mapForm.unitLabel||'pack'} (optional)<Input inputMode="decimal" value={mapForm.estimate} onChange={e=>updateMap({estimate:e.target.value})} placeholder="$"/></label>
                {activeAccounts.length>1&&<label>Account<select required disabled={mapForm.version>0} value={mapForm.accountId} onChange={e=>updateMap({accountId:e.target.value,locationId:''})}>{activeAccounts.map(a=><option key={a.id} value={a.id}>{a.reference}</option>)}</select></label>}
                {current.profile.locations.filter(l=>l.accountId===mapForm.accountId&&l.status==='active').length>1&&<label>Delivered to<select required disabled={mapForm.version>0} value={mapForm.locationId} onChange={e=>updateMap({locationId:e.target.value})}><option value="">Choose</option>{current.profile.locations.filter(l=>l.accountId===mapForm.accountId&&l.status==='active').map(l=><option key={l.id} value={l.id}>{l.reference}</option>)}</select></label>}
                <label>Reason for change<Input required minLength={4} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
              </TaskSection>
              <div className="task-form-actions"><Button type="submit" disabled={!config||config.productId!==mapForm.productId}>Save product</Button><Button type="button" variant="ghost" onClick={()=>setMapForm(null)}>Cancel</Button></div>
            </fieldset></form>}
          </>}
          {tab==='history'&&<section aria-label="Change history" className="supplier-history">{history.versions.map(v=><div className="supplier-history-row" key={v.version}><span className="supplier-history-dot" aria-hidden="true"/><div><strong>{v.reason}</strong><small>{v.actor} · {new Date(v.at).toLocaleString()} · version {v.version}</small>
            <details className="more-info"><summary>What was saved</summary><pre className="po-json">{JSON.stringify('profile' in v?v.profile:v,null,2)}</pre></details></div></div>)}
            {!history.versions.length&&<p className="muted">No history yet.</p>}
            {(historyOffset>0||history.hasMore)&&<div className="supplier-list-pages"><Button size="sm" variant="ghost" disabled={blocked||historyOffset===0} onClick={()=>void showHistory(historyId,historyKind,Math.max(0,historyOffset-20))}>Newer</Button><Button size="sm" variant="ghost" disabled={blocked||!history.hasMore} onClick={()=>void showHistory(historyId,historyKind,historyOffset+20)}>Older</Button></div>}</section>}
        </article>}
        {editing&&profile&&<form className="task-form supplier-form" onSubmit={saveProfile}><header className="task-form-heading"><h2>{current?`Edit ${current.profile.name}`:'Add supplier'}</h2></header>
          <fieldset disabled={blocked||!!mapForm}>
          <TaskSection title="Supplier"><label>Name<Input required maxLength={200} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})} placeholder="e.g. Northline Dairy"/></label>
            <div className="supplier-grid"><label>Email (optional)<Input type="email" maxLength={254} value={profile.email??''} onChange={e=>setProfile({...profile,email:e.target.value||null})}/></label>
              <label>Phone (optional)<Input maxLength={100} value={profile.telephone} onChange={e=>setProfile({...profile,telephone:e.target.value})}/></label></div></TaskSection>
          <TaskSection title="Ordering" description="Used for order suggestions.">
            <div className="supplier-grid"><label>Order every (days)<Input type="number" inputMode="numeric" min={1} max={60} step={1} value={orderEvery} onChange={e=>setOrderEvery(e.target.value)} placeholder="7"/></label>
              <label>Delivery takes (days)<Input type="number" inputMode="numeric" min={0} max={60} step={1} value={deliveryDays} onChange={e=>setDeliveryDays(e.target.value)} placeholder="0 = same day"/></label></div>
            <div className="supplier-grid"><label>Minimum order (optional)<Input inputMode="decimal" value={minimum} onChange={e=>setMinimum(e.target.value)} placeholder="$"/></label>
              <label>Delivery fee (optional)<Input inputMode="decimal" value={fee} onChange={e=>setFee(e.target.value)} placeholder="$"/></label></div></TaskSection>
          <TaskSection title="Account and delivery">
            {profile.accounts.map((a,i)=><div className="supplier-grid" key={a.id}><label>Account number{profile.accounts.length>1?` ${i+1}`:''}<Input required maxLength={200} value={a.reference} onChange={e=>setProfile({...profile,accounts:profile.accounts.map(n=>n.id===a.id?{...n,reference:e.target.value}:n)})}/></label>
              {profile.accounts.length>1&&<label>Status<select value={a.status} onChange={e=>setProfile({...profile,accounts:profile.accounts.map(n=>n.id===a.id?{...n,status:e.target.value as typeof a.status}:n)})}><option value="active">Active</option><option value="archived">Archived</option></select></label>}</div>)}
            {profile.locations.map((l,i)=><div className="supplier-location" key={l.id}><div className="supplier-grid"><label>Location name{profile.locations.length>1?` ${i+1}`:''}<Input required maxLength={200} value={l.reference} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,reference:e.target.value}:n)})} placeholder="e.g. Main café"/></label>
              {profile.accounts.length>1&&<label>Account<select disabled={!!current?.profile.locations.some(n=>n.id===l.id)} value={l.accountId} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,accountId:e.target.value}:n)})}>{profile.accounts.map(a=><option key={a.id} value={a.id}>{a.reference||'New account'}</option>)}</select></label>}</div>
              <label>Delivery address<textarea required maxLength={1000} value={l.address} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,address:e.target.value}:n)})}/></label>
              {profile.locations.length>1&&<label>Status<select value={l.status} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,status:e.target.value as typeof l.status}:n)})}><option value="active">Active</option><option value="archived">Archived</option></select></label>}</div>)}
            <div className="supplier-inline-actions"><Button type="button" size="sm" variant="ghost" disabled={profile.accounts.length>=50} onClick={()=>setProfile({...profile,accounts:[...profile.accounts,{id:crypto.randomUUID(),reference:'',status:'active'}]})}><Plus size={14}/>Another account</Button>
              <Button type="button" size="sm" variant="ghost" disabled={profile.locations.length>=50} onClick={()=>setProfile({...profile,locations:[...profile.locations,{id:crypto.randomUUID(),accountId:profile.accounts[0].id,reference:'',address:'',status:'active'}]})}><Plus size={14}/>Another location</Button></div></TaskSection>
          <TaskSection title="More (optional)"><details className="more-info"><summary>Payment terms, cutoff and notes</summary>
            <label>Payment terms<textarea maxLength={1000} value={profile.paymentTerms} onChange={e=>setProfile({...profile,paymentTerms:e.target.value})}/></label>
            <label>Cutoff and delivery rules<textarea maxLength={1000} value={profile.orderingInstructions} onChange={e=>setProfile({...profile,orderingInstructions:e.target.value})}/></label>
            <label>Notes<textarea maxLength={1000} value={profile.notes} onChange={e=>setProfile({...profile,notes:e.target.value})}/></label>
            <label>Accepts orders by email?<select value={profile.emailAcceptance.status} onChange={e=>setProfile({...profile,emailAcceptance:{...profile.emailAcceptance,status:e.target.value as SupplierProfile['emailAcceptance']['status']}})}><option value="unknown">Don’t know</option><option value="not_accepted">No</option><option value="manager_reported_accepted">Yes, they told us</option></select></label>
            {profile.emailAcceptance.status!=='unknown'&&<label>Who told you, and when?<textarea required maxLength={1000} value={profile.emailAcceptance.note} onChange={e=>setProfile({...profile,emailAcceptance:{...profile.emailAcceptance,note:e.target.value}})}/></label>}
          </details></TaskSection>
          <TaskSection title="Reason for change"><Input required minLength={4} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} aria-label="Reason for change"/></TaskSection>
          <div className="task-form-actions"><Button type="submit">Save supplier</Button><Button type="button" variant="ghost" onClick={cancelEdit}>Cancel</Button></div>
        </fieldset></form>}
      </div>
    </div>
  </section>;
}
