'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Product} from '@/lib/pantry';
import type {InventoryManagementView} from '@/lib/inventory-management-contract';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';
import {CURATED_UNIT_IDS,curatedUnit,customUnit,formatCanonical,toCanonical,type CuratedUnitId,type UnitDefinition} from '@/lib/inventory-quantities';
import {formatInUnit,packageTotal} from '@/lib/stock-pack-quantities';
import {CONTAINER_SUGGESTIONS,DEFAULT_MEASUREMENT_SYSTEM,everydayUnit,fractionOfPack,guessPackaging,measureFactor,plural,preferredUnits,shortUnitLabel} from '@/lib/unit-preferences';
import {sendSaveRequest} from '@/lib/waste-client';
import {TaskSection,ChoiceField} from './task-form';

const localNow=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19);
const canonicalId=(dimension:string):CuratedUnitId=>dimension==='mass'?'g':dimension==='volume'?'mL':'each';
const dimensionNames:Record<UnitDimension,string>={volume:'Liquid',mass:'Weight',count:'Items'};
const capital=(text:string)=>text.replace(/^./,c=>c.toUpperCase());
type OpenPart='0'|'1'|'2'|'3'|'exact';
/** How much one of a product's own measures holds, in everyday units, for editing. */
function measureText(m:UnitDefinition|null|undefined,system:'us'|'metric'){
 if(m?.kind!=='custom')return '';
 try{return formatInUnit(toCanonical('1',m,m),curatedUnit(everydayUnit(system,m.dimension)),3);}catch{return '';}
}

export default function StockEntry({companyId,products,view,initialProductId,onReload,onSaved,onDirtyChange}:{
 companyId:string;products:Product[];view:InventoryManagementView;initialProductId?:string;
 onReload:()=>Promise<void>;onSaved:()=>void;onDirtyChange:(dirty:boolean)=>void;
}){
 const system=view.measurementSystem??DEFAULT_MEASUREMENT_SYSTEM;
 const initial=view.records.find(r=>r.productId===initialProductId);
 const initialGuess=initial?null:guessPackaging(products.find(p=>p.id===initialProductId)?.name??'');
 const initialUnit=initial?.measurementUnit??(initialGuess?curatedUnit(everydayUnit(system,initialGuess.dimension)):null);
 const [identity]=useState(()=>({product:crypto.randomUUID(),operation:crypto.randomUUID(),unit:crypto.randomUUID()}));
 const [productId,setProductId]=useState(initialProductId??''),[name,setName]=useState(''),[supplier,setSupplier]=useState(''),[sku,setSku]=useState('');
 const [unit,setUnit]=useState<CuratedUnitId|''>(initialUnit?(initialUnit.kind==='curated'?initialUnit.id as CuratedUnitId:canonicalId(initialUnit.dimension)):'');
 const [pack,setPack]=useState(initial?.purchase?.label??initialGuess?.container??'');
 const [packAmount,setPackAmount]=useState(initial?.purchase?.enteredAmount??(initial?.purchase?formatCanonical(initial.purchase.quantity):''));
 const [contentUnitId,setContentUnitId]=useState(initial?.purchase?.enteredUnitId===initialUnit?.id&&initialUnit?.kind==='custom'?identity.unit:initial?.purchase?.enteredUnitId??(initial?canonicalId(initial.dimension):initialUnit?.id??''));
 const [packagingTouched,setPackagingTouched]=useState(!!initial);
 const [amount,setAmount]=useState(''),[packages,setPackages]=useState(''),[remainder,setRemainder]=useState(''),[openPart,setOpenPart]=useState<OpenPart>('0');
 const [basis,setBasis]=useState<'packages'|'measured'>('packages'),[action,setAction]=useState<'receive'|'count'|'use'|'incoming'|'configure'>('receive');
 const [time,setTime]=useState(localNow()),[note,setNote]=useState(''),[fromIncoming,setFromIncoming]=useState(false);
 const [custom,setCustom]=useState(initialUnit?.kind==='custom'),[customLabel,setCustomLabel]=useState(initialUnit?.kind==='custom'?initialUnit.label:'pump');
 const [dimension,setDimension]=useState<UnitDimension>(initialUnit?.dimension??'volume');
 const [measureAmount,setMeasureAmount]=useState(()=>measureText(initialUnit,system));
 const [measureUnitId,setMeasureUnitId]=useState<CuratedUnitId>(everydayUnit(system,initialUnit?.dimension??'volume'));
 const [measureEdited,setMeasureEdited]=useState(false);
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Record<string,unknown>|null>(null),[saved,setSaved]=useState(false);
 const lock=useRef(false),record=view.records.find(r=>r.productId===productId),isNew=productId==='new';
 const setup=isNew||(!!productId&&!record)||action==='configure',opening=setup&&!record;
 const scope={companyId,productId:isNew?identity.product:productId};
 const productName=isNew?name.trim():products.find(p=>p.id===productId)?.name??'';
 useEffect(()=>{onDirtyChange(dirty||!!pending);return()=>onDirtyChange(false);},[dirty,pending,onDirtyChange]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,pending]);

 // A guess from the name fills in the container and units until the person changes them.
 function applyGuess(productName:string){
   const guess=guessPackaging(productName);if(!guess)return;
   setPack(guess.container);setUnit(everydayUnit(system,guess.dimension));setContentUnitId(everydayUnit(system,guess.dimension));setDimension(guess.dimension);setMeasureUnitId(everydayUnit(system,guess.dimension));
 }
 function chooseProduct(id:string){
   const r=view.records.find(r=>r.productId===id),m=r?.measurementUnit??null;
   setProductId(id);setAction('receive');setAmount('');setPackages('');setRemainder('');setOpenPart('0');setFromIncoming(false);setBasis('packages');
   setCustom(m?.kind==='custom');setCustomLabel(m?.kind==='custom'?m.label:'pump');setMeasureEdited(false);setMeasureAmount(measureText(m,system));setMeasureUnitId(everydayUnit(system,m?.dimension??'volume'));
   setUnit(m?(m.kind==='curated'?m.id as CuratedUnitId:canonicalId(m.dimension)):'');setDimension(m?.dimension??'volume');
   setPack(r?.purchase?.label??'');setPackAmount(r?.purchase?.enteredAmount??(r?.purchase?formatCanonical(r.purchase.quantity):''));
   setContentUnitId(r?.purchase?.enteredUnitId===m?.id&&m?.kind==='custom'?identity.unit:r?.purchase?.enteredUnitId??(r?canonicalId(r.dimension):''));
   setPackagingTouched(!!r);
   if(!r)applyGuess(products.find(p=>p.id===id)?.name??'');
 }
 function chooseContentUnit(id:string){
   setContentUnitId(id);setPackagingTouched(true);
   if(!id||id===identity.unit)return;
   const d=curatedUnit(id).dimension;
   if(!unit||curatedUnit(unit).dimension!==d){setUnit(everydayUnit(system,d));setDimension(d);setMeasureUnitId(everydayUnit(system,d));}
 }
 function touch(){setDirty(true);setError('');}
 const contentDimension:UnitDimension|null=custom?dimension:unit?curatedUnit(unit).dimension:null;
 function customFactor(){
   const saved=record?.measurementUnit;
   if(!measureEdited&&saved?.kind==='custom')return {numerator:saved.numerator,denominator:saved.denominator};
   const factor=measureFactor(measureAmount,measureUnitId);return {numerator:factor.numerator,denominator:factor.denominator};
 }
 function setupMeasurement():UnitDefinition{return custom?customUnit({...scope,id:identity.unit,version:1,label:customLabel,dimension,...customFactor()}):curatedUnit(unit);}
 let measurement:UnitDefinition|null=null,packQuantity:ReturnType<typeof toCanonical>|null=null,preview='',packagePreview='',remainderInput={remainder:'0',remainderUnitId:''};
 try{
   measurement=setup?setupMeasurement():record?.measurementUnit??null;
   if(measurement){
     packQuantity=setup?toCanonical(packAmount,contentUnitId===measurement.id||contentUnitId===identity.unit?measurement:curatedUnit(contentUnitId),scope,{dimension:measurement.dimension}):record?.purchase?.quantity??null;
     // Shown in the unit typed for the container when it is a standard one, such as 1 lb.
     const packEveryday=packQuantity&&curatedUnit(setup&&contentUnitId&&contentUnitId!==identity.unit&&curatedUnit(contentUnitId).dimension===packQuantity.dimension?contentUnitId:everydayUnit(system,packQuantity.dimension));
     if(packQuantity&&packEveryday&&BigInt(packQuantity.minor)>BigInt(0))packagePreview=`One ${(setup?pack:record?.purchase?.label)||'container'} holds ${formatInUnit(packQuantity,packEveryday,2)} ${shortUnitLabel(packEveryday)}${measurement.kind==='custom'?`, about ${formatInUnit(packQuantity,measurement,0)} ${plural(measurement.label,2)}`:''}.`;
     // An open container is entered as a share of it, or as an exact amount in everyday units.
     remainderInput=measurement.dimension==='count'||openPart==='exact'
       ?{remainder:remainder||'0',remainderUnitId:measurement.dimension==='count'?measurement.id:everydayUnit(system,measurement.dimension)}
       :{remainder:packQuantity?formatCanonical(fractionOfPack(packQuantity,Number(openPart))):'0',remainderUnitId:canonicalId(measurement.dimension)};
     if((opening||!setup)&&productId){
       const counted=opening||action==='count';
       const total=basis==='packages'&&action!=='use'&&packQuantity
         ?packageTotal(packQuantity,{packages,...(counted?remainderInput:{remainder:'0',remainderUnitId:measurement.id})},measurement,scope)
         :toCanonical(amount,measurement,scope);
       const everyday=curatedUnit(everydayUnit(system,total.dimension));
       preview=(opening?'Opening stock: ':action==='count'?'New physical total: ':action==='incoming'?'Expected incoming: ':action==='use'?'Stock used: ':'Stock increase: ')+formatInUnit(total,everyday,2)+' '+shortUnitLabel(everyday);
     }
   }
 }catch{/* Incomplete fields have no calculation preview; the server validates the save. */}
 const measuredLabel=measurement?(measurement.kind==='custom'?plural(measurement.label,2):shortUnitLabel(measurement)):custom?plural(customLabel,2):unit?shortUnitLabel(unit):'';
 const hasPackages=setup||!!record?.purchase;
 const packLabel=(setup?pack:record?.purchase?.label)||'container';
 const withRemainder=opening||action==='count';

 async function save(e:React.FormEvent){
   e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
   try{
     let body=pending;
     if(!body){
       const common={companyId,productId:scope.productId,operationId:identity.operation,effectiveAt:new Date(time).toISOString()};
       if(setup){
         if(!unit&&!custom)throw new Error('Choose what one container holds, such as 64 fl oz.');
         body={...common,action:isNew?'createStockExact':'configureExact',...(isNew?{name,supplier,sku}:{}),stockUnit:custom?{kind:'custom',id:identity.unit,label:customLabel.trim(),dimension,...customFactor()}:{kind:'curated',id:unit},purchaseUnitLabel:pack.trim(),purchaseAmount:packAmount,purchaseContentUnitId:contentUnitId,...(record?{expectedConfigId:record.configId}:{}),...(opening?(basis==='packages'?{openingPackages:{packages,...remainderInput}}:{openingAmount:amount}):{})};
       }else if(basis==='packages'&&action!=='use'&&record?.purchase){
         body={...common,action:'packageStockExact',configId:record.configId,expectedVersion:record.version,movement:action,quantity:{packages,...(withRemainder?remainderInput:{remainder:'0',remainderUnitId:record.stockUnitId})},note,...(action==='receive'?{fromIncoming}:{})};
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
 const everydayChoices=(['volume','mass','count'] as UnitDimension[]).map(d=>({d,ids:preferredUnits(system,d)}));
 const otherUnits=(d?:UnitDimension|null)=>CURATED_UNIT_IDS.filter(id=>(!d||curatedUnit(id).dimension===d)&&!preferredUnits(system,curatedUnit(id).dimension).includes(id));

 return <form className="stock-entry recipe-builder task-form" onSubmit={save}>
   <header className="task-form-heading"><h2>{record?'Update stock':'Add stock'}</h2><p>{record?'Record a delivery, check your actual stock, or change how this item comes.':'Choose an item, say how it comes, then count what you have.'}</p></header>
   {error&&<p role="alert" className="error">{error}</p>}
   <fieldset disabled={disabled} onChange={touch}>
     <TaskSection title="Stock item" description="Use an item already in your catalog, or add a new ingredient or ready-made product.">
       <ChoiceField compact label="Choose an item type" value={isNew?'new':'existing'} onChange={value=>{chooseProduct(value==='new'?'new':'');touch();}} options={[{value:'existing',label:'Existing item'},{value:'new',label:'New item'}]}/>
       {isNew?<>
         <label>Item name<Input required maxLength={150} placeholder="e.g. Oat milk or espresso beans" value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(!packagingTouched)applyGuess(name);}}/></label>
         <details className="task-disclosure"><summary>Add supplier details (optional)</summary><div className="task-field-pair"><label>Supplier<Input maxLength={100} value={supplier} onChange={e=>setSupplier(e.target.value)}/></label><label>Supplier SKU<Input maxLength={100} value={sku} onChange={e=>setSku(e.target.value)}/></label></div><p className="task-help">Price stays unknown until you add purchasing details in Product catalog.</p></details>
       </>:<label>Catalog item<select required value={productId} onChange={e=>chooseProduct(e.target.value)}><option value="">Choose an item</option>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
     </TaskSection>
     {record&&<TaskSection title="Stock update" description="A delivery adds to stock. A physical count sets the total you actually have.">
       <label>What would you like to record?<select value={action} onChange={e=>{setAction(e.target.value as typeof action);setBasis(e.target.value==='use'?'measured':'packages');setPackages('');setRemainder('');setOpenPart('0');setAmount('');}}>
         <option value="receive">Receive a delivery</option><option value="count">Record a physical count</option><option value="use">Record extra ingredient use</option><option value="incoming">Set expected incoming stock</option><option value="configure">Change how it comes or is measured</option>
       </select></label>
       <p className="task-help">{action==='receive'?'Enter only the new delivery. This amount is added to your current stock.':action==='count'?'Count everything remaining. This total replaces the current estimate.':action==='incoming'?'Enter the full amount still expected to arrive. This does not increase on-hand stock.':action==='use'?'Enter extra ingredients used outside recorded sales or waste.':'Your current stock total and all past records stay the same.'}</p>
     </TaskSection>}
     {setup&&productId&&<TaskSection title="How it comes" description="Say what you buy. Pantrack works out amounts for recipes and counts.">
       <div className="pack-sentence">
         <span>{productName||'It'} comes in a</span>
         <Input required aria-label="Container" list="stock-container-suggestions" maxLength={100} placeholder="carton" value={pack} onChange={e=>{setPack(e.target.value);setPackagingTouched(true);}}/>
         <datalist id="stock-container-suggestions">{CONTAINER_SUGGESTIONS.map(c=><option key={c} value={c}/>)}</datalist>
         <span>that holds</span>
         <Input required aria-label={`Amount in one ${pack||'container'}`} inputMode="decimal" placeholder="64" value={packAmount} onChange={e=>setPackAmount(e.target.value)}/>
         <select required aria-label="Unit" value={contentUnitId} onChange={e=>chooseContentUnit(e.target.value)}>
           <option value="">unit</option>
           {custom&&<option value={identity.unit}>{plural(customLabel||'measure',2)}</option>}
           {everydayChoices.map(({d,ids})=><optgroup key={d} label={dimensionNames[d]}>{ids.map(id=><option key={id} value={id}>{id==='each'?'items':shortUnitLabel(id)}</option>)}</optgroup>)}
           <optgroup label="Other units">{otherUnits().map(id=><option key={id} value={id}>{shortUnitLabel(id)}</option>)}</optgroup>
         </select>
       </div>
       {packagePreview&&<p className="task-calculation">{packagePreview}</p>}
       {contentDimension&&!custom&&(contentDimension==='count'?<p className="task-help">Recipes and counts use single items.</p>:<label className="pack-recipe-unit">In recipes, measure it in<select value={unit} onChange={e=>{setUnit(e.target.value as CuratedUnitId);setPackagingTouched(true);}}>
         {preferredUnits(system,contentDimension).map(id=><option key={id} value={id}>{shortUnitLabel(id)}</option>)}
         {otherUnits(contentDimension).length>0&&<optgroup label="Other units">{otherUnits(contentDimension).map(id=><option key={id} value={id}>{shortUnitLabel(id)}</option>)}</optgroup>}
       </select></label>)}
       {contentDimension&&contentDimension!=='count'&&<details className="task-disclosure" open={custom}><summary>Measured with a pump or scoop? (optional)</summary>
         <label className="checkbox-label"><input type="checkbox" checked={custom} onChange={e=>{const on=e.target.checked;setCustom(on);if(on&&unit)setDimension(curatedUnit(unit).dimension);if(!on&&contentUnitId===identity.unit)setContentUnitId(unit);setMeasureEdited(true);}}/>Yes, recipes use a pump, scoop or shot</label>
         {custom&&<div className="pack-sentence">
           <span>1</span>
           <Input required aria-label="Measure name" maxLength={40} value={customLabel} onChange={e=>setCustomLabel(e.target.value)}/>
           <span>=</span>
           <Input required aria-label="Amount in one measure" inputMode="decimal" placeholder="0.5" value={measureAmount} onChange={e=>{setMeasureAmount(e.target.value);setMeasureEdited(true);}}/>
           <select aria-label="Measure unit" value={measureUnitId} onChange={e=>{setMeasureUnitId(e.target.value as CuratedUnitId);setMeasureEdited(true);}}>
             {preferredUnits(system,dimension).map(id=><option key={id} value={id}>{shortUnitLabel(id)}</option>)}
             <optgroup label="Other units">{otherUnits(dimension).map(id=><option key={id} value={id}>{shortUnitLabel(id)}</option>)}</optgroup>
           </select>
         </div>}
         {custom&&<p className="task-help">Recipes can then say “2 {plural(customLabel||'pump',2)}”, or still use {shortUnitLabel(everydayUnit(system,dimension))}.</p>}
       </details>}
     </TaskSection>}
     {productId&&(opening||!setup)&&<TaskSection title={opening?'What you have now':action==='count'?'Physical count':action==='incoming'?'Incoming quantity':action==='use'?'Quantity used':'Delivery quantity'} description={opening?'Count what is on the shelf now. This is the starting point.':action==='count'?'Count full containers, then say how full the open one is.':action==='receive'?`Enter the ${plural(packLabel,2)} received in this delivery.`:undefined}>
       {hasPackages&&action!=='use'&&<ChoiceField compact label="Enter quantity as" value={basis} onChange={setBasis} options={[{value:'packages',label:capital(plural(packLabel,2))},{value:'measured',label:`Exact total (${measuredLabel||'amount'})`}]}/>}
       {basis==='packages'&&action!=='use'&&hasPackages?<>
         <label>{action==='receive'&&!opening?`${capital(plural(packLabel,2))} received`:`Full ${plural(packLabel,2)}`}<Input required inputMode="numeric" type="number" min="0" max="1000000" step="1" placeholder="0" value={packages} onChange={e=>setPackages(e.target.value)}/></label>
         {withRemainder&&(measurement?.dimension==='count'
           ?<label>Loose items ({measuredLabel})<Input required inputMode="numeric" value={remainder} placeholder="0" onChange={e=>setRemainder(e.target.value)}/></label>
           :<>
             <ChoiceField compact label={`An open ${packLabel}`} value={openPart} onChange={value=>{setOpenPart(value);touch();}} options={[{value:'0',label:'None'},{value:'1',label:'¼ left'},{value:'2',label:'½ left'},{value:'3',label:'¾ left'},{value:'exact',label:'Exact amount'}]}/>
             {openPart==='exact'&&<label>Left in the open {packLabel} ({measurement?shortUnitLabel(everydayUnit(system,measurement.dimension)):''})<Input required inputMode="decimal" placeholder="0" value={remainder} onChange={e=>setRemainder(e.target.value)}/></label>}
           </>)}
       </>:<label>{opening?'Total on hand':action==='count'?'Actual quantity counted':action==='incoming'?'Total expected incoming':'Quantity'} ({measuredLabel})<Input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
       {preview&&<p role="status" className="task-calculation"><small>{opening?'Starting inventory':'Stock update preview'}</small><strong>{preview}</strong></p>}
       {productId&&!setup&&action==='receive'&&<label className="checkbox-label"><input type="checkbox" checked={fromIncoming} onChange={e=>setFromIncoming(e.target.checked)}/>This delivery was already recorded as incoming</label>}
     </TaskSection>}
     {productId&&<TaskSection title="Entry details" description="The entry uses the current time. Change it if you are recording an earlier count or delivery.">
       <details className="task-disclosure"><summary>Change time{!setup?' or add a note':''}</summary><label>Occurred at<Input required type="datetime-local" step="1" value={time} onChange={e=>setTime(e.target.value)}/></label>{!setup&&<label>Note (optional)<Input maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>}</details>
     </TaskSection>}
     <div className="task-form-actions"><Button type="submit" disabled={!productId}>{setup?(record?'Save changes':'Save item & stock'):action==='count'?'Save physical count':action==='receive'?'Save delivery':'Save stock update'}</Button>{!disabled&&<Button type="button" variant="ghost" onClick={()=>{if(!dirty||window.confirm('Discard this stock edit?'))onSaved();}}>Cancel</Button>}</div>
   </fieldset>
   {pending&&<Button type="button" disabled={busy} onClick={()=>void save({preventDefault(){}} as React.FormEvent)}>{busy?'Confirming…':'Retry the same stock save'}</Button>}
   {saved&&<Button type="button" onClick={()=>void onReload().then(onSaved).catch(()=>setError('Could not refresh. Try again.'))}>Refresh stock list</Button>}
 </form>;
}
