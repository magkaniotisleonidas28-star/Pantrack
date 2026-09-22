'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

type Product = {id:string;name:string;unitId:string|null;unitVersion:number|null;dimension:string|null;
  onHandMinor:string|null;incomingMinor:string|null;cutoff:string|null};
type Recipe = {id:string;versionId:string|null;version:number|null;status:string|null;name:string|null;legacy:number|null};
type Modifier = {recipeId:string;id:string;name:string;versionId:string|null;version:number|null;status:string|null};
type Count = {productId:string;effectiveAt:string;measuredMinor:string|null;varianceMinor:string|null;opening:number};
type SavedIngredient = {recipeId:string;modifierId?:string;versionId:string;productId:string;
  amount:string;unitId:string|null;quantityMinor:string|null};
type Listing = {products:Product[];recipes:Recipe[];modifiers:Modifier[];counts:Count[];
  ingredients:SavedIngredient[];deltas:SavedIngredient[];
  legacy:{products:{productId:string;changedSinceBackfill:boolean;needsOpeningCount:boolean}[];
    recipes:{recipeId:string;changedSinceBackfill:boolean;needsReviewedVersion:boolean}[]}};
type Ingredient = {productId:string;amount:string};
const curated = ['each','mg','g','kg','oz_mass','lb','mL','L','tsp_us','tbsp_us','fl_oz_us','cup_us','pint_us','quart_us','gallon_us'];
const localDateTime = () => new Date(Date.now()-new Date().getTimezoneOffset()*60_000).toISOString().slice(0,16);

export default function ExactInventoryPanel({companyId}:{companyId:string}) {
  const [listing,setListing]=useState<Listing|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [productId,setProductId]=useState(''),[unitId,setUnitId]=useState('g'),[custom,setCustom]=useState(false);
  const [customId,setCustomId]=useState(''),[customLabel,setCustomLabel]=useState(''),[dimension,setDimension]=useState<'count'|'mass'|'volume'>('mass');
  const [numerator,setNumerator]=useState('1'),[denominator,setDenominator]=useState('1'),[pack,setPack]=useState(''),[purchaseLabel,setPurchaseLabel]=useState('bag');
  const [countAmount,setCountAmount]=useState(''),[countAt,setCountAt]=useState(localDateTime),[countNote,setCountNote]=useState('');
  const [movement,setMovement]=useState<'receive'|'use'|'waste'|'incoming'>('receive');
  const [movementId,setMovementId]=useState(()=>crypto.randomUUID());
  const [movementAmount,setMovementAmount]=useState(''),[movementNote,setMovementNote]=useState(''),[fromIncoming,setFromIncoming]=useState(false);
  const [recipeId,setRecipeId]=useState(''),[recipeName,setRecipeName]=useState(''),[ingredients,setIngredients]=useState<Ingredient[]>([]);
  const [modifierId,setModifierId]=useState(''),[modifierName,setModifierName]=useState(''),[deltas,setDeltas]=useState<Ingredient[]>([]);
  const url = (kind='list',other:Record<string,string>={}) => '/api/inventory/exact?'+new URLSearchParams({companyId,kind,...other});
  async function load() {
    const response=await fetch(url(),{cache:'no-store'});
    const result=await response.json() as Listing & {error?:string};
    if(!response.ok)throw new Error(result.error||'Could not load exact inventory.');
    setListing(result);
    setProductId(old=>old||result.products[0]?.id||'');
  }
  useEffect(()=>{void fetch('/api/inventory/exact?'+new URLSearchParams({companyId,kind:'list'}),{cache:'no-store'})
    .then(async response=>{const result=await response.json() as Listing & {error?:string};
      if(!response.ok)throw new Error(result.error||'Could not load exact inventory.');
      setListing(result);setProductId(old=>old||result.products[0]?.id||'');})
    .catch(cause=>setError((cause as Error).message));},[companyId]);
  async function action(kind:'config'|'count'|'movement'|'recipe'|'modifier',name:string,ids:Record<string,string>,fields:Record<string,unknown>) {
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      const inspection=await fetch(url(kind,ids),{cache:'no-store'});
      const current=await inspection.json() as {token?:string;error?:string};
      if(!inspection.ok||!current.token)throw new Error(current.error||'Reload this item and try again.');
      const response=await fetch('/api/inventory/exact',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({companyId,action:name,expected:current.token,...ids,...fields})});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error||'Could not save.');
      await load();if(name==='movement')setMovementId(crypto.randomUUID());setNotice('Saved. Review the updated history below.');
    } catch(cause) {setError((cause as Error).message);} finally {setBusy(false);}
  }
  const product=listing?.products.find(item=>item.id===productId);
  const configured=listing?.products.filter(item=>item.unitId&&item.unitVersion)||[];
  const recipeIds=[...new Set(listing?.recipes.map(item=>item.id)||[])];
  const modifiers=listing?.modifiers.filter(item=>item.recipeId===recipeId)||[];
  const modifierIds=[...new Set(modifiers.map(item=>item.id))];
  function convert(rows:Ingredient[]) {
    return rows.map(row=>{const stock=configured.find(item=>item.id===row.productId);
      if(!stock?.unitId||!stock.unitVersion)throw new Error('Configure each ingredient before saving.');
      return {productId:row.productId,unitId:stock.unitId,unitVersion:stock.unitVersion,amount:row.amount};});
  }
  function rowsEditor(rows:Ingredient[],change:(rows:Ingredient[])=>void,signed=false) {
    return <div>{rows.map((row,index)=><div className="recipe-ingredient" key={index}>
      <select aria-label="Ingredient" value={row.productId} onChange={event=>change(rows.map((item,position)=>position===index?{...item,productId:event.target.value}:item))}>
        {configured.map(item=><option key={item.id} value={item.id}>{item.name} ({item.unitId})</option>)}
      </select>
      <Input aria-label={signed?'Ingredient change':'Ingredient amount'} value={row.amount} onChange={event=>change(rows.map((item,position)=>position===index?{...item,amount:event.target.value}:item))} placeholder={signed?'Use a minus sign to remove stock':'Amount'}/>
      <Button type="button" variant="ghost" onClick={()=>change(rows.filter((_,position)=>position!==index))}>Remove</Button>
    </div>)}<Button type="button" variant="outline" disabled={!configured.length||rows.length>=20} onClick={()=>change([...rows,{productId:configured[0].id,amount:'1'}])}>Add ingredient</Button></div>;
  }
  return <section className="inventory-table">
    <h2>Exact stock preview</h2><p className="inventory-caption">Managers can review exact units, counts, recipes and extras here. The purchasing plan and older sales import have not switched to this view. Keep this preview separate from daily stock operations.</p>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
    {!listing?<p>Loading exact stock…</p>:<>
      {(listing.legacy.products.length>0||listing.legacy.recipes.length>0)&&<div className="payment-callout"><strong>Older records need review before switching.</strong>
        {listing.legacy.products.map(item=><p key={item.productId}>{listing.products.find(product=>product.id===item.productId)?.name||item.productId}: {item.changedSinceBackfill?'changed since the old data was copied; ':''}{item.needsOpeningCount?'needs a new exact opening count':'has an exact count'}. This preview cannot convert its older stock.</p>)}
        {listing.legacy.recipes.map(item=><p key={item.recipeId}>{listing.recipes.find(recipe=>recipe.id===item.recipeId)?.name||item.recipeId}: {item.changedSinceBackfill?'changed since the old data was copied; ':''}{item.needsReviewedVersion?'needs a reviewed recipe version':'has a reviewed version'}.</p>)}
      </div>}
      <div className="catalog-grid"><article className="catalog-card"><h3>Stock unit</h3><label>Ingredient<select value={productId} onChange={event=>setProductId(event.target.value)}>{listing.products.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><input type="checkbox" checked={custom} onChange={event=>setCustom(event.target.checked)}/> Product-specific unit</label>
        {custom?<><label>Unit ID<Input value={customId} onChange={event=>setCustomId(event.target.value)}/></label><label>Unit name<Input value={customLabel} onChange={event=>setCustomLabel(event.target.value)}/></label>
          <label>Measurement<select value={dimension} onChange={event=>setDimension(event.target.value as 'count'|'mass'|'volume')}><option value="count">Items</option><option value="mass">Weight</option><option value="volume">Volume</option></select></label>
          <label>Canonical units per custom unit: numerator<Input value={numerator} onChange={event=>setNumerator(event.target.value)}/></label><label>Denominator<Input value={denominator} onChange={event=>setDenominator(event.target.value)}/></label></>
          :<label>Unit<select value={unitId} onChange={event=>setUnitId(event.target.value)}>{curated.map(item=><option key={item} value={item}>{item}</option>)}</select></label>}
        <label>Supplier pack name<Input value={purchaseLabel} onChange={event=>setPurchaseLabel(event.target.value)}/></label><label>Amount in one pack (optional)<Input value={pack} onChange={event=>setPack(event.target.value)}/></label>
        <Button disabled={busy||!productId} onClick={()=>void action('config','configure',{productId},{unit:custom?{kind:'custom',unitId:customId,label:customLabel,dimension,numerator,denominator}:{kind:'curated',unitId},purchaseUnitLabel:purchaseLabel,...(pack?{packAmount:pack}:{})})}>Save stock unit</Button>
        <small>Changing measurement type after stock, counts or recipes exist is blocked. Existing stock is never guessed from an old label.</small>
      </article><article className="catalog-card"><h3>Physical count</h3><p>{product?.name}: {product?.onHandMinor??'No exact balance'} {product?.dimension??''} minor units</p>
        <label>Measured amount ({product?.unitId??'choose a stock unit'})<Input value={countAmount} onChange={event=>setCountAmount(event.target.value)}/></label>
        <label>When counted<Input type="datetime-local" value={countAt} onChange={event=>setCountAt(event.target.value)}/></label><label>Note<Input value={countNote} onChange={event=>setCountNote(event.target.value)}/></label>
        <Button disabled={busy||!product?.unitId||!countAmount} onClick={()=>{try{void action('count','count',{productId},{unitId:product!.unitId,unitVersion:product!.unitVersion,amount:countAmount,effectiveAt:new Date(countAt).toISOString(),note:countNote});}catch(cause){setError((cause as Error).message);}}}>Record count</Button>
        <small>Counts cannot be in the future or before a recorded stock change. A later count shows the difference from the estimate.</small></article>
      <article className="catalog-card"><h3>Stock activity</h3><p>On hand: {product?.onHandMinor??'—'} · Incoming: {product?.incomingMinor??'—'} ({product?.dimension??'unclassified'} minor units)</p>
        <label>Action<select value={movement} onChange={event=>setMovement(event.target.value as 'receive'|'use'|'waste'|'incoming')}>
          <option value="receive">Receive delivery</option><option value="use">Record use</option><option value="waste">Record waste</option><option value="incoming">Set confirmed incoming total</option>
        </select></label><label>Amount ({product?.unitId??'choose a stock unit'})<Input value={movementAmount} onChange={event=>setMovementAmount(event.target.value)}/></label>
        {movement==='receive'&&<label><input type="checkbox" checked={fromIncoming} onChange={event=>setFromIncoming(event.target.checked)}/> Reduce recorded incoming stock</label>}
        <label>Note / delivery reference<Input value={movementNote} onChange={event=>setMovementNote(event.target.value)}/></label>
        <Button disabled={busy||!product?.unitId||!movementAmount} onClick={()=>void action('movement','movement',{productId},{movementId,movement,
          unitId:product!.unitId,unitVersion:product!.unitVersion,amount:movementAmount,note:movementNote,
          fromIncoming:movement==='receive'&&fromIncoming})}>Save stock activity</Button>
        <small>Deliveries, use and waste require an opening count. Repeated update IDs cannot change stock twice.</small></article></div>
      <div className="catalog-grid"><article className="catalog-card"><h3>Recipe versions</h3><label>Recipe<select value={recipeId} onChange={event=>{setRecipeId(event.target.value);setRecipeName(listing.recipes.find(item=>item.id===event.target.value)?.name||'');}}><option value="">New recipe</option>{recipeIds.map(item=><option key={item} value={item}>{listing.recipes.find(row=>row.id===item)?.name||item}</option>)}</select></label>
        <label>Name<Input value={recipeName} onChange={event=>setRecipeName(event.target.value)}/></label>{rowsEditor(ingredients,setIngredients)}
        <Button disabled={busy||!recipeName||!ingredients.length} onClick={()=>{try{void action('recipe','recipeDraft',{recipeId:recipeId||crypto.randomUUID()},{name:recipeName,ingredients:convert(ingredients)});}catch(cause){setError((cause as Error).message);}}}>Save new draft</Button>
        {listing.recipes.filter(item=>item.id===recipeId).map(item=><p key={item.versionId||'empty'}>Version {item.version}: {item.status}{item.legacy?' (old record)':''}<br/>
          {listing.ingredients.filter(ingredient=>ingredient.recipeId===recipeId&&ingredient.versionId===item.versionId).map((ingredient,index)=><small key={index}>{ingredient.amount} {ingredient.unitId||'old unit'} {listing.products.find(product=>product.id===ingredient.productId)?.name||ingredient.productId}; </small>)}
          {item.status==='draft'&&item.versionId&&<Button disabled={busy} variant="outline" onClick={()=>void action('recipe','recipeActivate',{recipeId,versionId:item.versionId!},{})}>Activate</Button>}{item.status==='active'&&!item.legacy&&item.versionId&&<Button disabled={busy} variant="outline" onClick={()=>void action('recipe','recipeArchive',{recipeId,versionId:item.versionId!},{})}>Archive</Button>}</p>)}
      </article><article className="catalog-card"><h3>Extras and substitutions</h3><label>Base recipe<select value={recipeId} onChange={event=>setRecipeId(event.target.value)}><option value="">Choose a recipe</option>{recipeIds.map(item=><option key={item} value={item}>{listing.recipes.find(row=>row.id===item)?.name||item}</option>)}</select></label>
        <label>Extra or swap<select value={modifierId} onChange={event=>{setModifierId(event.target.value);setModifierName(modifiers.find(item=>item.id===event.target.value)?.name||'');}}><option value="">New extra or swap</option>{modifierIds.map(item=><option key={item} value={item}>{modifiers.find(row=>row.id===item)?.name||item}</option>)}</select></label>
        <label>Name<Input value={modifierName} onChange={event=>setModifierName(event.target.value)}/></label>{rowsEditor(deltas,setDeltas,true)}
        <Button disabled={busy||!recipeId||!modifierName||!deltas.length} onClick={()=>{try{void action('modifier','modifierDraft',{recipeId,modifierId:modifierId||crypto.randomUUID()},{name:modifierName,deltas:convert(deltas)});}catch(cause){setError((cause as Error).message);}}}>Save new draft</Button>
        {modifiers.filter(item=>item.id===modifierId).map(item=><p key={item.versionId||'empty'}>Version {item.version}: {item.status}<br/>
          {listing.deltas.filter(delta=>delta.recipeId===recipeId&&delta.modifierId===modifierId&&delta.versionId===item.versionId).map((delta,index)=><small key={index}>{delta.amount} {delta.unitId||'old unit'} {listing.products.find(product=>product.id===delta.productId)?.name||delta.productId}; </small>)}
          {item.status==='draft'&&item.versionId&&<Button disabled={busy} variant="outline" onClick={()=>void action('modifier','modifierActivate',{recipeId,modifierId,versionId:item.versionId!},{})}>Activate</Button>}{item.status==='active'&&item.versionId&&<Button disabled={busy} variant="outline" onClick={()=>void action('modifier','modifierArchive',{recipeId,modifierId,versionId:item.versionId!},{})}>Archive</Button>}</p>)}
      </article></div>
      <h3>Recent physical counts</h3>{listing.counts.length?listing.counts.map(item=><p key={item.productId+item.effectiveAt}>{listing.products.find(product=>product.id===item.productId)?.name||item.productId}: {item.measuredMinor??'Old unclassified amount'} at {new Date(item.effectiveAt).toLocaleString()}{item.opening?' · opening count':item.varianceMinor!==null?' · difference '+item.varianceMinor:''}</p>):<p>No exact counts yet.</p>}
    </>}
  </section>;
}
