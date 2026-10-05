'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Product} from '@/lib/pantry';
import type {InventoryManagementView} from '@/lib/inventory-management-contract';
import {CURATED_UNIT_IDS,curatedUnit,customUnit,formatCanonical,toCanonical,unitLabel,type CuratedUnitId,type UnitDefinition} from '@/lib/inventory-quantities';
import {formatInUnit,packageTotal} from '@/lib/stock-pack-quantities';
import {sendSaveRequest} from '@/lib/waste-client';
import {TaskSection,ChoiceField} from './task-form';

const localNow=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19);
const canonicalId=(dimension:string):CuratedUnitId=>dimension==='mass'?'g':dimension==='volume'?'mL':'each';

export default function StockEntry({companyId,products,view,initialProductId,onReload,onSaved,onDirtyChange}:{
 companyId:string;products:Product[];view:InventoryManagementView;initialProductId?:string;
 onReload:()=>Promise<void>;onSaved:()=>void;onDirtyChange:(dirty:boolean)=>void;
}){
 const initial=view.records.find(r=>r.productId===initialProductId);
 const initialUnit=initial?.measurementUnit??curatedUnit('each');
 const [identity]=useState(()=>({product:crypto.randomUUID(),operation:crypto.randomUUID(),unit:crypto.randomUUID()}));
 const [productId,setProductId]=useState(initialProductId??''),[name,setName]=useState(''),[supplier,setSupplier]=useState(''),[sku,setSku]=useState('');
 const [unit,setUnit]=useState<CuratedUnitId>(initialUnit.kind==='curated'?initialUnit.id as CuratedUnitId:canonicalId(initialUnit.dimension));
 const [pack,setPack]=useState(initial?.purchase?.label??'box');
 const [packAmount,setPackAmount]=useState(initial?.purchase?.enteredAmount??(initial?.purchase?formatCanonical(initial.purchase.quantity):'1'));
 const [contentUnitId,setContentUnitId]=useState(initial?.purchase?.enteredUnitId===initialUnit.id&&initialUnit.kind==='custom'?identity.unit:initial?.purchase?.enteredUnitId??(initial?canonicalId(initial.dimension):'each'));
 const [amount,setAmount]=useState(''),[packages,setPackages]=useState(''),[remainder,setRemainder]=useState('0');
 const [basis,setBasis]=useState<'packages'|'measured'>('packages'),[action,setAction]=useState<'receive'|'count'|'use'|'incoming'|'configure'>('receive');
 const [time,setTime]=useState(localNow()),[note,setNote]=useState(''),[fromIncoming,setFromIncoming]=useState(false);
 const [custom,setCustom]=useState(initialUnit.kind==='custom'),[customLabel,setCustomLabel]=useState(initialUnit.kind==='custom'?initialUnit.label:'');
 const [dimension,setDimension]=useState(initialUnit.dimension),[numerator,setNumerator]=useState(initialUnit.kind==='custom'?initialUnit.numerator:'1'),[denominator,setDenominator]=useState(initialUnit.kind==='custom'?initialUnit.denominator:'1');
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Record<string,unknown>|null>(null),[saved,setSaved]=useState(false);
 const lock=useRef(false),record=view.records.find(r=>r.productId===productId),isNew=productId==='new';
 const setup=isNew||(!!productId&&!record)||action==='configure',opening=setup&&!record;
 const scope={companyId,productId:isNew?identity.product:productId};
 useEffect(()=>{onDirtyChange(dirty||!!pending);return()=>onDirtyChange(false);},[dirty,pending,onDirtyChange]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,pending]);

 function chooseProduct(id:string){
   const r=view.records.find(r=>r.productId===id),m=r?.measurementUnit??curatedUnit('each');
   setProductId(id);setAction('receive');setAmount('');setPackages('');setRemainder('0');setFromIncoming(false);setBasis('packages');
   setCustom(m.kind==='custom');setCustomLabel(m.kind==='custom'?m.label:'');setDimension(m.dimension);
   setNumerator(m.kind==='custom'?m.numerator:'1');setDenominator(m.kind==='custom'?m.denominator:'1');
   setUnit(m.kind==='curated'?m.id as CuratedUnitId:canonicalId(m.dimension));
   setPack(r?.purchase?.label??'box');setPackAmount(r?.purchase?.enteredAmount??(r?.purchase?formatCanonical(r.purchase.quantity):'1'));
   setContentUnitId(r?.purchase?.enteredUnitId===m.id&&m.kind==='custom'?identity.unit:r?.purchase?.enteredUnitId??(r?canonicalId(r.dimension):'each'));
 }
 function touch(){setDirty(true);setError('');}
 function setupMeasurement():UnitDefinition{return custom?customUnit({...scope,id:identity.unit,version:1,label:customLabel,dimension,numerator,denominator}):curatedUnit(unit);}
 let measurement:UnitDefinition|null=null,packQuantity:ReturnType<typeof toCanonical>|null=null,preview='',packagePreview='';
 try{
   measurement=setup?setupMeasurement():record?.measurementUnit??null;
   if(measurement){
     packQuantity=setup?toCanonical(packAmount,contentUnitId===measurement.id?measurement:curatedUnit(contentUnitId),scope,{dimension:measurement.dimension}):record?.purchase?.quantity??null;
     if(packQuantity&&BigInt(packQuantity.minor)>BigInt(0))packagePreview='One '+(setup?pack:record?.purchase?.label)+' contains '+formatInUnit(packQuantity,measurement)+' '+(measurement.kind==='curated'?unitLabel(measurement.id):measurement.label)+'.';
     if((opening||!setup)&&productId){
       const total=basis==='packages'&&action!=='use'&&packQuantity
         ?packageTotal(packQuantity,{packages,remainder:action==='receive'&&!opening?'0':remainder,remainderUnitId:measurement.id},measurement,scope)
         :toCanonical(amount,measurement,scope);
       preview=(opening?'Opening stock: ':action==='count'?'New physical total: ':action==='incoming'?'Expected incoming: ':action==='use'?'Stock used: ':'Stock increase: ')+formatInUnit(total,measurement)+' '+(measurement.kind==='curated'?unitLabel(measurement.id):measurement.label);
     }
   }
 }catch{/* Incomplete fields have no calculation preview; the server validates the save. */}
 const measuredLabel=measurement?(measurement.kind==='curated'?unitLabel(measurement.id):measurement.label):(custom?customLabel:unitLabel(unit));
 const hasPackages=setup||!!record?.purchase;

 async function save(e:React.FormEvent){
   e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
   try{
     let body=pending;
     if(!body){
       const common={companyId,productId:scope.productId,operationId:identity.operation,effectiveAt:new Date(time).toISOString()};
       if(setup){
         body={...common,action:isNew?'createStockExact':'configureExact',...(isNew?{name,supplier,sku}:{}),stockUnit:custom?{kind:'custom',id:identity.unit,label:customLabel,dimension,numerator,denominator}:{kind:'curated',id:unit},purchaseUnitLabel:pack,purchaseAmount:packAmount,purchaseContentUnitId:contentUnitId,...(record?{expectedConfigId:record.configId}:{}),...(opening?(basis==='packages'?{openingPackages:{packages,remainder,remainderUnitId:measurement?.id??unit}}:{openingAmount:amount}):{})};
       }else if(basis==='packages'&&action!=='use'&&record?.purchase){
         body={...common,action:'packageStockExact',configId:record.configId,expectedVersion:record.version,movement:action,quantity:{packages,remainder:action==='receive'?'0':remainder,remainderUnitId:record.stockUnitId},note,...(action==='receive'?{fromIncoming}:{})};
       }else{
         body={...common,action:action==='count'?'countExact':'movementExact',...(action==='count'?{}:{movement:action,fromIncoming}),amount,unitId:record!.stockUnitId,expectedVersion:record!.version,note};
       }
     }
     setPending(body);const outcome=await sendSaveRequest('/api/inventory',body,fetch,!!pending);
     if(outcome.kind==='saved'){setSaved(true);setPending(null);setDirty(false);try{await onReload();onSaved();}catch{setError('Stock saved. Refresh the list before making another change.');}}
     else{setError(outcome.message);if(outcome.kind==='rejected')setPending(null);}
   }catch(e){setError((e as Error).message);}
   finally{lock.current=false;setBusy(false);}
 }
 const disabled=busy||!!pending||saved;
 const contentDimension=custom?dimension:curatedUnit(unit).dimension;

 return <form className="stock-entry recipe-builder task-form" onSubmit={save}>
   <header className="task-form-heading"><h2>{record?'Update stock':'Add stock'}</h2><p>{record?'Record a delivery, check your actual stock, or update this item’s measurements.':'Choose an item, describe its packaging, then enter what you have on hand.'}</p></header>
   {error&&<p role="alert" className="error">{error}</p>}
   <fieldset disabled={disabled} onChange={touch}>
     <TaskSection title="Stock item" description="Use an item already in your catalog, or add a new ingredient or ready-made product.">
       <ChoiceField compact label="Choose an item type" value={isNew?'new':'existing'} onChange={value=>{chooseProduct(value==='new'?'new':'');touch();}} options={[{value:'existing',label:'Existing item'},{value:'new',label:'New item'}]}/>
       {isNew?<>
         <label>Item name<Input required maxLength={150} placeholder="e.g. Whole milk or espresso beans" value={name} onChange={e=>setName(e.target.value)}/></label>
         <details className="task-disclosure"><summary>Add supplier details (optional)</summary><div className="task-field-pair"><label>Supplier<Input maxLength={100} value={supplier} onChange={e=>setSupplier(e.target.value)}/></label><label>Supplier SKU<Input maxLength={100} value={sku} onChange={e=>setSku(e.target.value)}/></label></div><p className="task-help">Price stays unknown until you add purchasing details in Product catalog.</p></details>
       </>:<label>Catalog item<select required value={productId} onChange={e=>chooseProduct(e.target.value)}><option value="">Choose an item</option>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
     </TaskSection>
     {record&&<TaskSection title="Stock update" description="A delivery adds to stock. A physical count sets the total you actually have.">
       <label>What would you like to record?<select value={action} onChange={e=>{setAction(e.target.value as typeof action);setBasis(e.target.value==='use'?'measured':'packages');setPackages('');setRemainder('0');setAmount('');}}>
         <option value="receive">Receive a delivery</option><option value="count">Record a physical count</option><option value="use">Record extra ingredient use</option><option value="incoming">Set expected incoming stock</option><option value="configure">Change measurements or purchase pack</option>
       </select></label>
       <p className="task-help">{action==='receive'?'Enter only the new delivery. This amount is added to your current stock.':action==='count'?'Count everything remaining. This total replaces the current estimate.':action==='incoming'?'Enter the full amount still expected to arrive. This does not increase on-hand stock.':action==='use'?'Enter extra ingredients used outside recorded sales or waste.': 'Updating a purchase pack keeps your current stock total and all previous conversions.'}</p>
     </TaskSection>}
     {setup&&<TaskSection title="Measurements & packaging" description="Recipes use a measurement such as grams or millilitres. Deliveries use a container such as a bag or jug.">
       <label>Measure recipe ingredients in<select value={unit} onChange={e=>{const next=e.target.value as CuratedUnitId;setUnit(next);if(curatedUnit(next).dimension!==contentDimension)setContentUnitId(next);}}>
         {CURATED_UNIT_IDS.map(id=><option value={id} key={id}>{id==='each'?'Individual items (each)':unitLabel(id)}</option>)}
       </select></label>
       <label>Purchase container<Input required maxLength={100} placeholder="e.g. jug, bottle, bag or box" value={pack} onChange={e=>setPack(e.target.value)}/></label>
       <div className="task-field-pair">
         <label>Amount in one {pack||'container'}<Input required inputMode="decimal" value={packAmount} onChange={e=>setPackAmount(e.target.value)}/></label>
         <label>Unit of contents<select required value={contentUnitId} onChange={e=>setContentUnitId(e.target.value)}>
           {custom&&<option value={identity.unit}>{customLabel||'Custom measure'}</option>}
           {CURATED_UNIT_IDS.filter(id=>curatedUnit(id).dimension===contentDimension).map(id=><option value={id} key={id}>{unitLabel(id)}</option>)}
         </select></label>
       </div>
       <p className="task-help">For example: 1 US gallon per milk jug, 750 mL per syrup bottle, or 1 kg per bag of beans.</p>
       {packagePreview&&<p className="task-calculation">{packagePreview}</p>}
       <details className="task-disclosure" open={custom}><summary>Custom scoop or measuring unit (advanced)</summary>
         <label className="checkbox-label"><input type="checkbox" checked={custom} onChange={e=>{setCustom(e.target.checked);setDimension(curatedUnit(unit).dimension);setContentUnitId(e.target.checked?identity.unit:unit);}}/>Use a product-specific scoop or measure</label>
         {custom&&<>
           <label>Measure label<Input required value={customLabel} onChange={e=>setCustomLabel(e.target.value)}/></label>
           <label>Measures<select value={dimension} onChange={e=>{const d=e.target.value as typeof dimension;setDimension(d);setContentUnitId(canonicalId(d));}}><option value="count">Items</option><option value="mass">Grams</option><option value="volume">Millilitres</option></select></label>
           <div className="task-field-pair"><label>Grams, millilitres, or items per measure<Input required inputMode="numeric" value={numerator} onChange={e=>setNumerator(e.target.value)}/></label><label>Divided by (normally 1)<Input required inputMode="numeric" value={denominator} onChange={e=>setDenominator(e.target.value)}/></label></div>
         </>}
       </details>
     </TaskSection>}
     {productId&&(opening||!setup)&&<TaskSection title={opening?'Opening count':action==='count'?'Physical count':action==='incoming'?'Incoming quantity':action==='use'?'Quantity used':'Delivery quantity'} description={opening?'Count what you have now. This becomes the starting point for inventory.':action==='count'?'Include unopened containers and any amount left in an opened one.':action==='receive'?'Enter the containers received in this delivery.':undefined}>
       {hasPackages&&action!=='use'&&<ChoiceField compact label="Enter quantity as" value={basis} onChange={setBasis} options={[{value:'packages',label:action==='receive'&&!opening?'Containers':'Containers + remainder'},{value:'measured',label:`Measured total (${measuredLabel})`}]}/>}
       {basis==='packages'&&action!=='use'&&hasPackages?<div className="task-field-pair">
         <label>{action==='receive'&&!opening?'Containers received':'Full containers'} ({setup?pack:record?.purchase?.label})<Input required inputMode="numeric" type="number" min="0" max="1000000" step="1" placeholder="0" value={packages} onChange={e=>setPackages(e.target.value)}/></label>
         {(opening||action==='count'||action==='incoming')&&<label>Remainder in opened containers ({measuredLabel})<Input required inputMode="decimal" value={remainder} onChange={e=>setRemainder(e.target.value)}/></label>}
       </div>:<label>{opening?'Total on hand':action==='count'?'Actual quantity counted':action==='incoming'?'Total expected incoming':'Quantity'} ({measuredLabel})<Input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
       {preview&&<p role="status" className="task-calculation"><small>{opening?'Starting inventory':'Stock update preview'}</small><strong>{preview}</strong></p>}
       {productId&&!setup&&action==='receive'&&<label className="checkbox-label"><input type="checkbox" checked={fromIncoming} onChange={e=>setFromIncoming(e.target.checked)}/>This delivery was already recorded as incoming</label>}
     </TaskSection>}
     {productId&&<TaskSection title="Entry details" description="The entry uses the current time. Change it if you are recording an earlier count or delivery.">
       <details className="task-disclosure"><summary>Change time{!setup?' or add a note':''}</summary><label>Occurred at<Input required type="datetime-local" step="1" value={time} onChange={e=>setTime(e.target.value)}/></label>{!setup&&<label>Note (optional)<Input maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>}</details>
     </TaskSection>}
     <div className="task-form-actions"><Button type="submit" disabled={!productId}>{setup?(record?'Save measurements':'Save item & opening stock'):action==='count'?'Save physical count':action==='receive'?'Save delivery':'Save stock update'}</Button>{!disabled&&<Button type="button" variant="ghost" onClick={()=>{if(!dirty||window.confirm('Discard this stock edit?'))onSaved();}}>Cancel</Button>}</div>
   </fieldset>
   {pending&&<Button type="button" disabled={busy} onClick={()=>void save({preventDefault(){}} as React.FormEvent)}>{busy?'Confirming…':'Retry the same stock save'}</Button>}
   {saved&&<Button type="button" onClick={()=>void onReload().then(onSaved).catch(()=>setError('Could not refresh. Try again.'))}>Refresh stock list</Button>}
 </form>;
}
