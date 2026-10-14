'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {D1PurchasingSuppliers} from '@/lib/d1-purchasing-suppliers';
import type {SupplierProfile,SupplierVersion,MappingVersion} from '@/lib/purchasing-supplier-contract';
import {CURATED_UNIT_IDS,curatedUnit,unitLabel,type UnitDefinition} from '@/lib/inventory-quantities';
import {draftStockDisplay} from '@/lib/supplier-order-draft';
import {supplierRequest,purchasingCents,purchasingDollars,PurchasingRequestError,emailAcceptanceLabel} from './purchasing-client';
import './purchase-order-drafts.css';

type SupplierList=Awaited<ReturnType<D1PurchasingSuppliers['list']>>;
type MappingList=Awaited<ReturnType<D1PurchasingSuppliers['mappings']>>;
type History=Awaited<ReturnType<D1PurchasingSuppliers['history']>>;
type Stocks=Awaited<ReturnType<D1PurchasingSuppliers['stocks']>>['stocks'];
type MapForm={id:string;version:number;accountId:string;locationId:string;productId:string;sku:string;description:string;unitLabel:string;packAmount:string;unitKey:string;estimate:string};
const unitKey=(unit:UnitDefinition)=>`${unit.id}:${unit.version}`;
const newProfile=():SupplierProfile=>{const accountId=crypto.randomUUID();return {name:'',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,
  orderingInstructions:'',notes:'',emailAcceptance:{status:'unknown',note:''},accounts:[{id:accountId,reference:'',status:'active'}],
  locations:[{id:crypto.randomUUID(),accountId,reference:'',address:'',status:'active'}]};};
export default function PurchasingSuppliers({companyId,active,onEnabledChange,onDirtyChange,onSaved}:{companyId:string;active:boolean;onEnabledChange:(v:boolean)=>void;onDirtyChange:(v:boolean)=>void;onSaved:()=>void}){
  const [enabled,setEnabled]=useState(false),[list,setList]=useState<SupplierList>({suppliers:[],hasMore:false}),[offset,setOffset]=useState(0);
  const [current,setCurrent]=useState<SupplierVersion|null>(null),[profile,setProfile]=useState<SupplierProfile|null>(null),[profileId,setProfileId]=useState('');
  const [minimum,setMinimum]=useState(''),[fee,setFee]=useState(''),[reason,setReason]=useState(''),[archiveReason,setArchiveReason]=useState('');
  const [maps,setMaps]=useState<MappingList>({mappings:[],hasMore:false}),[mapOffset,setMapOffset]=useState(0),[mapForm,setMapForm]=useState<MapForm|null>(null);
  const [stocks,setStocks]=useState<Stocks>([]),[units,setUnits]=useState<UnitDefinition[]>([]),[config,setConfig]=useState<{productId:string;id:string;version:number}|null>(null);
  const [stockMore,setStockMore]=useState(false),[stockOffset,setStockOffset]=useState(0);
  const [history,setHistory]=useState<History>({versions:[],hasMore:false}),[historyKind,setHistoryKind]=useState<'profile'|'mapping'>('profile'),[historyId,setHistoryId]=useState(''),[historyOffset,setHistoryOffset]=useState(0);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const baseline=useRef(''),pending=useRef<Record<string,unknown>|null>(null),lock=useRef(false);
  const profileText=JSON.stringify({profile,minimum,fee});
  const dirty=!!profile&&profileText!==baseline.current||!!mapForm;
  useEffect(()=>onDirtyChange(dirty||uncertain),[dirty,uncertain,onDirtyChange]);
  useEffect(()=>{let live=true;void supplierRequest<SupplierList>(companyId).then(data=>{if(live){setList(data);setEnabled(true);onEnabledChange(true);}})
    .catch(e=>{if(live){setEnabled(false);onEnabledChange(false);if(!(e instanceof PurchasingRequestError&&e.status===404))setError(e.message);}});return()=>{live=false;};},[companyId,onEnabledChange]);
  useEffect(()=>{if(enabled&&active)void loadList(offset);},[enabled,active,offset]);
  useEffect(()=>{if(enabled&&active)void loadStocks(0);},[enabled,active]);
  useEffect(()=>{if(enabled&&active&&current)void loadMaps(mapOffset);},[enabled,active,current,mapOffset]);
  useEffect(()=>{if(!mapForm){setConfig(null);setUnits([]);return;}let live=true;setConfig(null);setUnits([]);
    if(mapForm.productId)void supplierRequest<Awaited<ReturnType<D1PurchasingSuppliers['units']>>>(companyId,`&view=units&productId=${encodeURIComponent(mapForm.productId)}`).then(data=>{
      if(live){setConfig({productId:mapForm.productId,id:data.config.id,version:data.config.version});setUnits([...CURATED_UNIT_IDS.map(curatedUnit).filter(u=>u.dimension===data.config.dimension),...data.units]);}
    }).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[companyId,mapForm?.productId]);
  async function loadList(page:number){try{setList(await supplierRequest<SupplierList>(companyId,`&offset=${page}`));}catch(e){setError((e as Error).message);}}
  async function loadStocks(page:number){try{const d=await supplierRequest<Awaited<ReturnType<D1PurchasingSuppliers['stocks']>>>(companyId,`&view=stocks&offset=${page}`);setStocks(previous=>page===0?d.stocks:[...previous,...d.stocks.filter(s=>!previous.some(p=>p.product_id===s.product_id))]);setStockMore(d.hasMore);setStockOffset(page);}catch(e){setError((e as Error).message);}}
  async function loadMaps(page:number,supplierId=current?.id){if(!supplierId)return;try{setMaps(await supplierRequest<MappingList>(companyId,`&view=mappings&supplierId=${encodeURIComponent(supplierId)}&offset=${page}`));}catch(e){setError((e as Error).message);}}
  function adopt(p:SupplierVersion){setCurrent(p);setProfileId(p.id);setProfile(structuredClone(p.profile));const min=purchasingDollars(p.profile.minimumOrderMinor),f=purchasingDollars(p.profile.deliveryFeeMinor);
    setMinimum(min);setFee(f);baseline.current=JSON.stringify({profile:p.profile,minimum:min,fee:f});setReason('');setMapForm(null);setMapOffset(0);setArchiveReason('');}
  function discard(){return !dirty||window.confirm('Discard unsaved supplier or mapping changes?');}
  async function open(id:string){if(!discard())return;try{const data=await supplierRequest<{supplier:SupplierVersion}>(companyId,`&supplierId=${encodeURIComponent(id)}`);adopt(data.supplier);setHistory({versions:[],hasMore:false});setHistoryId('');}catch(e){setError((e as Error).message);}}
  function newSupplier(){if(!discard())return;const p=newProfile();setCurrent(null);setProfileId(crypto.randomUUID());setProfile(p);setMinimum('');setFee('');baseline.current='';setReason('');setMapForm(null);setMaps({mappings:[],hasMore:false});setHistoryId('');setHistory({versions:[],hasMore:false});}
  async function showHistory(id:string,kind:'profile'|'mapping',page=0){try{setHistory(await supplierRequest<History>(companyId,`&view=history&${kind==='profile'?'supplierId':'mappingId'}=${encodeURIComponent(id)}&offset=${page}`));setHistoryId(id);setHistoryKind(kind);setHistoryOffset(page);}catch(e){setError((e as Error).message);}}
  async function save(body:Record<string,unknown>){if(lock.current)return;lock.current=true;setBusy(true);pending.current=body;setError('');setNotice('');
    try{const data=await supplierRequest<{supplier?:SupplierVersion;mapping?:MappingVersion}>(companyId,'',body);pending.current=null;setUncertain(false);
      if(data.supplier)adopt(data.supplier);if(data.mapping){setMapForm(null);setReason('');setMapOffset(0);await loadMaps(0,data.mapping.supplierId);}
      setOffset(0);await loadList(0);setHistoryId('');setHistory({versions:[],hasMore:false});onSaved();setNotice('Saved with version history. Nothing has been sent.');
    }catch(e){setError((e as Error).message);const unknown=!(e instanceof PurchasingRequestError)||e.status>=500;setUncertain(unknown);if(!unknown)pending.current=null;}
    finally{lock.current=false;setBusy(false);}
  }
  function saveProfile(event:React.FormEvent){event.preventDefault();if(!profile||busy||uncertain)return;
    try{void save({action:'save_profile',companyId,operationId:crypto.randomUUID(),supplierId:profileId,expectedVersion:current?.version??0,reason,
      profile:{...profile,minimumOrderMinor:minimum.trim()?purchasingCents(minimum):null,deliveryFeeMinor:fee.trim()?purchasingCents(fee):null}});}catch(e){setError((e as Error).message);}}
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
  if(!active)return null;if(!enabled)return <p>Purchasing supplier preview is unavailable. {error}</p>;
  const blocked=busy||uncertain;
  return <section className="po-preview"><div className="page-heading"><div><div className="eyebrow">PURCHASING SUPPLIERS</div><h1>Supplier profiles and packs</h1><p>Saved details for review drafts. No email or order is sent.</p></div></div>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
    {uncertain&&<div className="notice"><p>The save outcome is uncertain. Retry the same request before changing anything.</p><Button disabled={busy} onClick={()=>pending.current&&void save(pending.current)}>Retry same request</Button></div>}
    <Button disabled={blocked} onClick={newSupplier}>New supplier profile</Button>
    {list.suppliers.map(s=><article className="po-history" key={s.id}><div><strong>{s.name}</strong><p>{s.status} · version {s.version}</p></div><Button disabled={blocked} variant="outline" onClick={()=>void open(s.id)}>View {s.name}</Button></article>)}
    <div className="inventory-actions"><Button variant="outline" disabled={blocked||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous suppliers</Button><Button variant="outline" disabled={blocked||!list.hasMore} onClick={()=>setOffset(offset+20)}>More suppliers</Button></div>
    {profile&&<form onSubmit={saveProfile}><fieldset disabled={blocked||!!mapForm||current?.status==='archived'}><legend>{current?`${current.profile.name} · version ${current.version}`:'New supplier'}</legend>
      <div className="po-fields"><label>Supplier name<Input required maxLength={200} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
        <label>Ordering email (optional)<Input type="email" maxLength={254} value={profile.email??''} onChange={e=>setProfile({...profile,email:e.target.value||null})}/></label>
        <label>Telephone (optional)<Input maxLength={100} value={profile.telephone} onChange={e=>setProfile({...profile,telephone:e.target.value})}/></label>
        <label>Payment terms<textarea maxLength={1000} value={profile.paymentTerms} onChange={e=>setProfile({...profile,paymentTerms:e.target.value})}/></label>
        <label>Estimated minimum order (USD, optional)<Input inputMode="decimal" value={minimum} onChange={e=>setMinimum(e.target.value)}/></label>
        <label>Estimated delivery fee (USD, optional)<Input inputMode="decimal" value={fee} onChange={e=>setFee(e.target.value)}/></label>
        <label>Delivery rules and ordering cutoff<textarea maxLength={1000} value={profile.orderingInstructions} onChange={e=>setProfile({...profile,orderingInstructions:e.target.value})}/></label>
        <label>Notes<textarea maxLength={1000} value={profile.notes} onChange={e=>setProfile({...profile,notes:e.target.value})}/></label>
        <label>Email PO acceptance<select value={profile.emailAcceptance.status} onChange={e=>setProfile({...profile,emailAcceptance:{...profile.emailAcceptance,status:e.target.value as SupplierProfile['emailAcceptance']['status']}})}><option value="unknown">Unknown</option><option value="not_accepted">Not accepted</option><option value="manager_reported_accepted">Manager-reported accepted</option></select><small>This records a report and does not enable sending.</small></label>
        <label>Acceptance report note<textarea required={profile.emailAcceptance.status!=='unknown'} maxLength={1000} value={profile.emailAcceptance.note} onChange={e=>setProfile({...profile,emailAcceptance:{...profile.emailAcceptance,note:e.target.value}})}/></label>
      </div>
      <fieldset><legend>Supplier accounts</legend>{profile.accounts.map((a,i)=><div className="po-fields" key={a.id}><label>Account reference {i+1}<Input required maxLength={200} value={a.reference} onChange={e=>setProfile({...profile,accounts:profile.accounts.map(n=>n.id===a.id?{...n,reference:e.target.value}:n)})}/></label><label>Account {i+1} status<select value={a.status} onChange={e=>setProfile({...profile,accounts:profile.accounts.map(n=>n.id===a.id?{...n,status:e.target.value as typeof a.status}:n)})}><option value="active">Active</option><option value="archived">Archived</option></select></label></div>)}
        <Button type="button" variant="outline" disabled={profile.accounts.length>=50} onClick={()=>setProfile({...profile,accounts:[...profile.accounts,{id:crypto.randomUUID(),reference:'',status:'active'}]})}>Add account</Button></fieldset>
      <fieldset><legend>Delivery locations</legend>{profile.locations.map((l,i)=><article className="po-line" key={l.id}><div className="po-fields"><label>Location reference {i+1}<Input required maxLength={200} value={l.reference} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,reference:e.target.value}:n)})}/></label>
        <label>Account for location {i+1}<select disabled={!!current?.profile.locations.some(n=>n.id===l.id)} value={l.accountId} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,accountId:e.target.value}:n)})}>{profile.accounts.map(a=><option key={a.id} value={a.id}>{a.reference||'New account'}</option>)}</select></label>
        <label>Delivery address {i+1}<textarea required maxLength={1000} value={l.address} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,address:e.target.value}:n)})}/></label>
        <label>Location {i+1} status<select value={l.status} onChange={e=>setProfile({...profile,locations:profile.locations.map(n=>n.id===l.id?{...n,status:e.target.value as typeof l.status}:n)})}><option value="active">Active</option><option value="archived">Archived</option></select></label></div></article>)}
        <Button type="button" variant="outline" disabled={profile.locations.length>=50} onClick={()=>setProfile({...profile,locations:[...profile.locations,{id:crypto.randomUUID(),accountId:profile.accounts[0].id,reference:'',address:'',status:'active'}]})}>Add delivery location</Button></fieldset>
      <label>Profile change reason<Input required minLength={4} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <div className="inventory-actions"><Button type="submit">Save supplier profile</Button><Button type="button" variant="outline" onClick={()=>{if(current)adopt(current);else{setProfile(null);setMapForm(null);}}}>Reset unsaved fields</Button></div>
      <p>Blank estimates mean unavailable. Ordering rules are recorded for review and are not automatically enforced.</p>
    </fieldset></form>}
    {current&&<section><p>{current.status} · Email report: {emailAcceptanceLabel(current.profile.emailAcceptance.status)} · {current.emailAcceptanceReportedBy} · {new Date(current.emailAcceptanceReportedAt).toLocaleString()}</p>
      <Button disabled={blocked} variant="outline" onClick={()=>void showHistory(current.id,'profile')}>View supplier version history</Button>
      {current.status==='active'&&<div className="inventory-actions"><label>Supplier archive reason<Input value={archiveReason} maxLength={500} onChange={e=>setArchiveReason(e.target.value)}/></label><Button disabled={blocked||dirty||archiveReason.trim().length<4} variant="outline" onClick={()=>void save({action:'archive_profile',companyId,operationId:crypto.randomUUID(),supplierId:current.id,expectedVersion:current.version,reason:archiveReason})}>Archive supplier</Button></div>}
      <h2>Supplier inventory mappings</h2><Button disabled={blocked||dirty||current.status!=='active'} onClick={()=>startMapping()}>Add inventory mapping</Button>
      {maps.mappings.map(({mapping:m,warning})=><article className="po-line" key={m.id}><h3>{m.description} · {m.sku}</h3><p>{m.unitLabel}: {m.packAmount} {m.packUnit.label} · {draftStockDisplay(m.stockUnitsPerPack)} · version {m.version} · {m.status}</p>
        <p>Estimated pack price: {m.estimatedUnitMinor===null?'Unavailable':`$${purchasingDollars(m.estimatedUnitMinor)}`}</p>{warning&&<p className="notice">{warning}</p>}
        <div className="inventory-actions"><Button disabled={blocked||dirty||current.status!=='active'||m.status!=='active'} variant="outline" onClick={()=>startMapping(m)}>Review mapping</Button><Button disabled={blocked} variant="outline" onClick={()=>void showHistory(m.id,'mapping')}>View mapping history</Button>
          <Button disabled={blocked||dirty||m.status!=='active'||archiveReason.trim().length<4} variant="outline" onClick={()=>void save({action:'archive_mapping',companyId,operationId:crypto.randomUUID(),mappingId:m.id,expectedVersion:m.version,reason:archiveReason})}>Archive mapping</Button></div></article>)}
      <label>Mapping archive reason<Input value={archiveReason} maxLength={500} onChange={e=>setArchiveReason(e.target.value)}/></label>
      <div className="inventory-actions"><Button disabled={blocked||mapOffset===0} variant="outline" onClick={()=>setMapOffset(Math.max(0,mapOffset-20))}>Previous mappings</Button><Button disabled={blocked||!maps.hasMore} variant="outline" onClick={()=>setMapOffset(mapOffset+20)}>More mappings</Button></div>
    </section>}
    {mapForm&&current&&<form onSubmit={saveMap}><fieldset disabled={blocked}><legend>{mapForm.version?'Review mapping':'New inventory mapping'}</legend><div className="po-fields">
      <label>Supplier account<select required disabled={mapForm.version>0} value={mapForm.accountId} onChange={e=>updateMap({accountId:e.target.value,locationId:''})}>{current.profile.accounts.filter(a=>a.status==='active').map(a=><option key={a.id} value={a.id}>{a.reference}</option>)}</select></label>
      <label>Delivery location<select required disabled={mapForm.version>0} value={mapForm.locationId} onChange={e=>updateMap({locationId:e.target.value})}><option value="">Choose location</option>{current.profile.locations.filter(l=>l.accountId===mapForm.accountId&&l.status==='active').map(l=><option key={l.id} value={l.id}>{l.reference}</option>)}</select></label>
      <label>Inventory item<select required disabled={mapForm.version>0} value={mapForm.productId} onChange={e=>{const stock=stocks.find(s=>s.product_id===e.target.value);updateMap({productId:e.target.value,description:stock?.name??'',unitKey:''});}}><option value="">Choose inventory item</option>{mapForm.version>0&&!stocks.some(s=>s.product_id===mapForm.productId)&&<option value={mapForm.productId}>{mapForm.description}</option>}{stocks.map(s=><option key={s.product_id} value={s.product_id}>{s.name}</option>)}</select>{stockMore&&<Button type="button" variant="outline" onClick={()=>void loadStocks(stockOffset+20)}>Load more inventory items</Button>}</label>
      <label>Supplier SKU<Input required maxLength={200} value={mapForm.sku} onChange={e=>updateMap({sku:e.target.value})}/></label>
      <label>Supplier item description<Input required maxLength={200} value={mapForm.description} onChange={e=>updateMap({description:e.target.value})}/></label>
      <label>Order unit / pack label<Input required maxLength={200} value={mapForm.unitLabel} onChange={e=>updateMap({unitLabel:e.target.value})}/></label>
      <label>Contents per supplier pack<Input required inputMode="decimal" maxLength={128} value={mapForm.packAmount} onChange={e=>updateMap({packAmount:e.target.value})}/></label>
      <label>Pack contents measurement<select required value={mapForm.unitKey} onChange={e=>updateMap({unitKey:e.target.value})}><option value="">Choose measurement</option>{units.map(u=><option key={unitKey(u)} value={unitKey(u)}>{u.kind==='curated'?unitLabel(u.id):u.label}</option>)}</select></label>
      <label>Estimated pack price (USD, optional)<Input inputMode="decimal" value={mapForm.estimate} onChange={e=>updateMap({estimate:e.target.value})}/></label>
      <label>Mapping change reason<Input required minLength={4} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    </div><p>The exact conversion is derived and saved on the server. This does not change the inventory item's pack setup.</p>
      <div className="inventory-actions"><Button type="submit" disabled={!config||config.productId!==mapForm.productId}>Save inventory mapping</Button><Button type="button" variant="outline" onClick={()=>setMapForm(null)}>Reset unsaved mapping</Button></div>
    </fieldset></form>}
    {historyId&&<section aria-label="Registry version history"><h2>{historyKind==='profile'?'Supplier':'Mapping'} version history</h2>{history.versions.map(v=><article className="po-line" key={v.version}><h3>Version {v.version} · {v.status}</h3><p>{v.actor} · {new Date(v.at).toLocaleString()} · {v.reason}</p>
      {'profile' in v?<><p>{v.profile.name} · {v.profile.email??'Ordering email unavailable'}</p><p className="po-prewrap">{v.profile.paymentTerms} · {v.profile.orderingInstructions}</p>{v.profile.locations.map(l=><p key={l.id}>{l.reference}: {l.address} · {l.status}</p>)}<details><summary>Complete saved profile</summary><pre className="po-json">{JSON.stringify(v.profile,null,2)}</pre></details></>:
        <><p>{v.sku} · {v.description} · {v.packAmount} {v.packUnit.label} per {v.unitLabel} · {draftStockDisplay(v.stockUnitsPerPack)}</p><p>Estimated pack price: {v.estimatedUnitMinor===null?'Unavailable':`$${purchasingDollars(v.estimatedUnitMinor)}`}</p><details><summary>Complete saved mapping</summary><pre className="po-json">{JSON.stringify(v,null,2)}</pre></details></>}
    </article>)}<div className="inventory-actions"><Button disabled={blocked||historyOffset===0} variant="outline" onClick={()=>void showHistory(historyId,historyKind,Math.max(0,historyOffset-20))}>Previous versions</Button><Button disabled={blocked||!history.hasMore} variant="outline" onClick={()=>void showHistory(historyId,historyKind,historyOffset+20)}>Older versions</Button></div></section>}
  </section>;
}
