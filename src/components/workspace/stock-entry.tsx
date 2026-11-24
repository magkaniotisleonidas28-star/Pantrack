'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Product} from '@/lib/pantry';
import type {InventoryManagementView} from '@/lib/inventory-management-contract';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';
import { CURATED_UNIT_IDS, curatedUnit, type CuratedUnitId } from '@/lib/inventory-quantities';
import { CONTAINER_SUGGESTIONS, DEFAULT_MEASUREMENT_SYSTEM, everydayUnit, plural, preferredUnits, shortUnitLabel } from '@/lib/unit-preferences';
import {sendSaveRequest} from '@/lib/waste-client';
import {TaskSection,ChoiceField} from './task-form';
import {
  buildStockEntryRequest,
  stockEntryDefaults,
  stockEntryGuess,
  stockEntryMeasureText,
  stockEntryMode,
  stockEntryPreview,
  type OpenPart,
  type StockEntryAction,
  type StockEntryBasis,
  type StockEntryDraft,
  type StockEntryRequest,
} from './stock-entry-model';

const localNow=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19);
const dimensionNames:Record<UnitDimension,string>={volume:'Liquid',mass:'Weight',count:'Items'};
const capital=(text:string)=>text.replace(/^./,c=>c.toUpperCase());
export default function StockEntry({companyId,products,view,initialProductId,onReload,onSaved,onDirtyChange}:{
 companyId:string;products:Product[];view:InventoryManagementView;initialProductId?:string;
 onReload:()=>Promise<void>;onSaved:()=>void;onDirtyChange:(dirty:boolean)=>void;
}){
  const system = view.measurementSystem ?? DEFAULT_MEASUREMENT_SYSTEM;
  const initial = view.records.find((record) => record.productId === initialProductId);
  const [identity] = useState(() => ({
    product: crypto.randomUUID(),
    operation: crypto.randomUUID(),
    unit: crypto.randomUUID(),
  }));
  const defaults = stockEntryDefaults(
    initial,
    initial ? '' : (products.find((product) => product.id === initialProductId)?.name ?? ''),
    system,
    identity.unit,
  );
  const [productId, setProductId] = useState(initialProductId ?? '');
  const [name, setName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState(defaults.unit);
  const [pack, setPack] = useState(defaults.pack);
  const [packAmount, setPackAmount] = useState(defaults.packAmount);
  const [contentUnitId, setContentUnitId] = useState(defaults.contentUnitId);
  const [packagingTouched, setPackagingTouched] = useState(defaults.packagingTouched);
  const [amount, setAmount] = useState('');
  const [packages, setPackages] = useState('');
  const [remainder, setRemainder] = useState('');
  const [openPart, setOpenPart] = useState<OpenPart>('0');
  const [basis, setBasis] = useState<StockEntryBasis>('packages');
  const [action, setAction] = useState<StockEntryAction>('receive');
  const [time, setTime] = useState(localNow());
  const [note, setNote] = useState('');
  const [fromIncoming, setFromIncoming] = useState(false);
  const [custom, setCustom] = useState(defaults.custom);
  const [customLabel, setCustomLabel] = useState(defaults.customLabel);
  const [dimension, setDimension] = useState(defaults.dimension);
  const [measureAmount, setMeasureAmount] = useState(() =>
    stockEntryMeasureText(defaults.measurement, defaults.measureUnitId),
  );
  const [measureUnitId, setMeasureUnitId] = useState(defaults.measureUnitId);
  const [measureEdited, setMeasureEdited] = useState(false);
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<StockEntryRequest|null>(null),[saved,setSaved]=useState(false);
  const lock = useRef(false);
  const record = view.records.find((record) => record.productId === productId);
  const { isNew, setup, opening } = stockEntryMode(productId, record, action);
 const productName=isNew?name.trim():products.find(p=>p.id===productId)?.name??'';
 useEffect(()=>{onDirtyChange(dirty||!!pending);return()=>onDirtyChange(false);},[dirty,pending,onDirtyChange]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,pending]);

  // A guess from the name fills in the container and units until the person changes them.
  function applyGuess(productName: string) {
    const guess = stockEntryGuess(productName, system);
    if (!guess) return;
    setPack(guess.pack);
    setUnit(guess.unit);
    setContentUnitId(guess.unit);
    setDimension(guess.dimension);
    setMeasureUnitId(guess.unit);
  }

  function chooseProduct(id: string) {
    const selected = view.records.find((record) => record.productId === id);
    const defaults = stockEntryDefaults(
      selected,
      selected ? '' : (products.find((product) => product.id === id)?.name ?? ''),
      system,
      identity.unit,
    );
    setProductId(id);
    setAction('receive');
    setAmount('');
    setPackages('');
    setRemainder('');
    setOpenPart('0');
    setFromIncoming(false);
    setBasis('packages');
    setUnit(defaults.unit);
    setPack(defaults.pack);
    setPackAmount(defaults.packAmount);
    setContentUnitId(defaults.contentUnitId);
    setCustom(defaults.custom);
    setCustomLabel(defaults.customLabel);
    setDimension(defaults.dimension);
    setMeasureEdited(false);
    setMeasureAmount(stockEntryMeasureText(defaults.measurement, defaults.measureUnitId));
    setMeasureUnitId(defaults.measureUnitId);
    setPackagingTouched(defaults.packagingTouched);
  }
 function chooseContentUnit(id:string){
   setContentUnitId(id);setPackagingTouched(true);
   if(!id||id===identity.unit)return;
   const d=curatedUnit(id).dimension;
   if(!unit||curatedUnit(unit).dimension!==d){setUnit(everydayUnit(system,d));setDimension(d);setMeasureUnitId(everydayUnit(system,d));}
 }
 function touch(){setDirty(true);setError('');}
 const contentDimension:UnitDimension|null=custom?dimension:unit?curatedUnit(unit).dimension:null;
  const draft: StockEntryDraft = {
    companyId, productId, record, identity, system, action, basis, unit, pack, packAmount,
    contentUnitId, custom, customLabel, dimension, measureAmount, measureUnitId, measureEdited,
    packages, remainder, openPart, amount, name, supplier, sku, time, note, fromIncoming,
  };
  const { measurement, preview, packagePreview, remainderInput } = stockEntryPreview(draft);
 const measuredLabel=measurement?(measurement.kind==='custom'?plural(measurement.label,2):shortUnitLabel(measurement)):custom?plural(customLabel,2):unit?shortUnitLabel(unit):'';
 const hasPackages=setup||!!record?.purchase;
 const packLabel=(setup?pack:record?.purchase?.label)||'container';
 const withRemainder=opening||action==='count';

 async function save(e:React.FormEvent){
   e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
   try{
     const body = pending ?? buildStockEntryRequest(draft, remainderInput);
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
   <header className="task-form-heading"><h2>{record?'Update stock':'Add stock'}</h2></header>
   {error&&<p role="alert" className="error">{error}</p>}
   <fieldset disabled={disabled} onChange={touch}>
     <TaskSection title="Stock item">
       <ChoiceField compact label="Choose an item type" value={isNew?'new':'existing'} onChange={value=>{chooseProduct(value==='new'?'new':'');touch();}} options={[{value:'existing',label:'Existing item'},{value:'new',label:'New item'}]}/>
       {isNew?<>
         <label>Item name<Input required maxLength={150} placeholder="e.g. Oat milk or espresso beans" value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(!packagingTouched)applyGuess(name);}}/></label>
         <details className="task-disclosure"><summary>Add supplier details (optional)</summary><div className="task-field-pair"><label>Supplier<Input maxLength={100} value={supplier} onChange={e=>setSupplier(e.target.value)}/></label><label>Supplier SKU<Input maxLength={100} value={sku} onChange={e=>setSku(e.target.value)}/></label></div><p className="task-help">Add a price later in Product catalog.</p></details>
       </>:<label>Catalog item<select required value={productId} onChange={e=>chooseProduct(e.target.value)}><option value="">Choose an item</option>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
     </TaskSection>
     {record&&<TaskSection title="Stock update">
       <label>What would you like to record?<select value={action} onChange={e=>{setAction(e.target.value as typeof action);setBasis(e.target.value==='use'?'measured':'packages');setPackages('');setRemainder('');setOpenPart('0');setAmount('');}}>
         <option value="receive">Receive a delivery</option><option value="count">Record a physical count</option><option value="use">Record extra ingredient use</option><option value="incoming">Set expected incoming stock</option><option value="configure">Change how it comes or is measured</option>
       </select></label>
       <p className="task-help">{action==='receive'?'Just this delivery. It’s added to stock.':action==='count'?'Everything left. Replaces the estimate.':action==='incoming'?'What’s still on its way.':action==='use'?'Use that wasn’t a sale or waste.':'Stock stays the same.'}</p>
     </TaskSection>}
     {setup&&productId&&<TaskSection title="How it comes" description="How you buy it.">
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
     {productId&&(opening||!setup)&&<TaskSection title={opening?'What you have now':action==='count'?'Physical count':action==='incoming'?'Incoming quantity':action==='use'?'Quantity used':'Delivery quantity'} description={opening?'Count what’s on the shelf.':action==='count'?'Full ones, plus the open one.':undefined}>
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
     {productId&&<TaskSection title="Entry details" description="Uses the time now.">
       <details className="task-disclosure"><summary>Change time{!setup?' or add a note':''}</summary><label>Occurred at<Input required type="datetime-local" step="1" value={time} onChange={e=>setTime(e.target.value)}/></label>{!setup&&<label>Note (optional)<Input maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>}</details>
     </TaskSection>}
     <div className="task-form-actions"><Button type="submit" disabled={!productId}>{setup?(record?'Save changes':'Save item & stock'):action==='count'?'Save physical count':action==='receive'?'Save delivery':'Save stock update'}</Button>{!disabled&&<Button type="button" variant="ghost" onClick={()=>{if(!dirty||window.confirm('Discard this stock edit?'))onSaved();}}>Cancel</Button>}</div>
   </fieldset>
   {pending&&<Button type="button" disabled={busy} onClick={()=>void save({preventDefault(){}} as React.FormEvent)}>{busy?'Confirming…':'Retry the same stock save'}</Button>}
   {saved&&<Button type="button" onClick={()=>void onReload().then(onSaved).catch(()=>setError('Could not refresh. Try again.'))}>Refresh stock list</Button>}
 </form>;
}
