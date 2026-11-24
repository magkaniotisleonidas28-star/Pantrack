'use client';
import type {InventorySection} from './workspace-navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {ArrowRight} from 'lucide-react';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {InventoryLayout,StockSearch} from './inventory-layout';
import {DEFAULT_MEASUREMENT_SYSTEM,formatEveryday,friendlyContainers,type MeasurementSystem} from '@/lib/unit-preferences';
import {sendSaveRequest} from '@/lib/waste-client';
import type {InventoryManagementView} from '@/lib/inventory-management-contract';
import {recommendation,type InventoryRecord} from '@/lib/inventory';
import type {Product} from '@/lib/pantry';
import A8ReviewPreview from './a8-review-preview';
import StockEntry from './stock-entry';
import StockUsagePanel from './stock-usage-panel';
import {RunOutReviews} from './run-out';
import {StatusBadge} from '@/components/ui/status-badge';
import {STOCK_STATE_LABEL,STOCK_STATE_TONE,stockState,type StockState} from '@/lib/stock-status';
import {useLevelTargets,relativeDay} from './use-level-targets';
import './home-stock.css';
import RecipeList from './recipe-list';
import RecipeBuilder from './recipe-builder';
import OptionSetsManager from './recipe-option-sets';
import type {OptionSetsView} from '@/lib/recipe-option-sets-contract';
import type {RecipeVersionView} from '@/lib/inventory-management-contract';

const formatPlanningValue=(value:number)=>{
  const fixed=value.toFixed(3);
  return fixed==='-0.000'?'0':fixed.replace(/\.?0+$/,'');
};

export default function ExactInventoryPanel({companyId,products,role,view,optionSets,legacyRecords,now,hasDraft,onStage,loading,onReload,onCatalogReload,section,onSectionChange,focusProductId,onFocusHandled,onDirtyChange}:{
  section:InventorySection;onSectionChange:(section:InventorySection)=>void;focusProductId?:string;onFocusHandled:()=>void;companyId:string;products:Product[];role:string;view:InventoryManagementView;optionSets:OptionSetsView;legacyRecords:InventoryRecord[];now:number;hasDraft:boolean;
  onStage:(quantities:Record<string,number>)=>void;loading:boolean;onReload:()=>Promise<void>;onCatalogReload:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;
}){
  const canManage=role==='owner'||role==='manager';
  const [recipeView,setRecipeView]=useState<'recipes'|'sets'|'create'>('recipes');
  const [editingRecipe,setEditingRecipe]=useState<RecipeVersionView|null>(null),[builderKey,setBuilderKey]=useState(0);
  const builderDirty=useRef(false),stockDirty=useRef(false),setsDirty=useRef(false);
  const [stockView,setStockView]=useState<'list'|'add'>('list'),[stockKey,setStockKey]=useState(0),[stockProduct,setStockProduct]=useState(focusProductId);
  const stockDirtyChange=useCallback((dirty:boolean)=>{stockDirty.current=dirty;onDirtyChange(dirty||builderDirty.current||setsDirty.current);},[onDirtyChange]);
  const builderDirtyChange=useCallback((dirty:boolean)=>{builderDirty.current=dirty;onDirtyChange(dirty||stockDirty.current||setsDirty.current);},[onDirtyChange]);
  const setsDirtyChange=useCallback((dirty:boolean)=>{setsDirty.current=dirty;onDirtyChange(dirty||stockDirty.current||builderDirty.current);},[onDirtyChange]);
  const [error,setError]=useState(''),[stockSearch,setStockSearch]=useState(''),[unitsBusy,setUnitsBusy]=useState(false);
  const system=view.measurementSystem??DEFAULT_MEASUREMENT_SYSTEM;
  // Only how amounts are shown and entered changes; stored stock stays the same.
  async function changeSystem(next:MeasurementSystem){
    setUnitsBusy(true);setError('');
    try{const outcome=await sendSaveRequest('/api/inventory',{action:'setMeasurementSystemExact',companyId,measurementSystem:next});if(outcome.kind!=='saved')setError(outcome.message);else await onReload();}
    catch(e){setError((e as Error).message);}finally{setUnitsBusy(false);}
  }
  // Guided setup opens each product without stock in turn; skipped ones stay listed.
  const [guide,setGuide]=useState<{total:number;position:number;skipped:string[]}|null>(null);
  const shownProducts=products.filter(item=>[item.name,item.supplier,item.sku].join(' ').toLowerCase().includes(stockSearch.trim().toLowerCase()));
  useEffect(()=>{
    if(!focusProductId)return;
    if(stockDirty.current)setError('Finish your current stock edit first.');
    else {setStockProduct(focusProductId);setStockKey(key=>key+1);setStockView('add');}
    onFocusHandled();
  },[focusProductId,onFocusHandled]);
  const record=(id:string)=>view.records.find(value=>value.productId===id);
  const unconfigured=products.filter(item=>!record(item.id));
  // Status for each product: badges, filter chips and the home page use the same rule.
  const targets=useLevelTargets(companyId,view.records.map(r=>r.productId+':'+r.version).join(','));
  const stateOf=(id:string)=>stockState(record(id),targets[id],now);
  const [stockFilter,setStockFilter]=useState<'all'|'attention'|StockState>('all');
  const countOf=(states:StockState[])=>shownProducts.filter(item=>states.includes(stateOf(item.id))).length;
  const stockFilters:Array<{id:'all'|'attention'|StockState;label:string;count:number}>=[{id:'all',label:'All',count:shownProducts.length},{id:'attention',label:'Needs attention',count:countOf(['out','low','count_due'])},{id:'out',label:'Out',count:countOf(['out'])},{id:'low',label:'Running low',count:countOf(['low'])},{id:'count_due',label:'Count due',count:countOf(['count_due'])},{id:'setup',label:'Needs setup',count:countOf(['setup'])}];
  const filteredProducts=shownProducts.filter(item=>stockFilter==='all'||(stockFilter==='attention'?['out','low','count_due'].includes(stateOf(item.id)):stateOf(item.id)===stockFilter));
  function openStock(id:string){setStockProduct(id);setStockKey(key=>key+1);setStockView('add');}
  function startGuide(){if(stockDirty.current){setError('Finish your current stock edit first.');return;}if(!unconfigured.length)return;setGuide({total:unconfigured.length,position:1,skipped:[]});openStock(unconfigured[0].id);}
  function continueGuide(doneId:string|undefined,skipped:string[]){const next=products.find(item=>!record(item.id)&&item.id!==doneId&&!skipped.includes(item.id));if(!next){setGuide(null);setStockProduct(undefined);setStockKey(key=>key+1);setStockView('list');return;}setGuide(g=>g&&{...g,skipped,position:g.position+1});openStock(next.id);}
  function stopGuide(){if(stockDirty.current){setError('Finish or clear your current stock edit first.');return;}setGuide(null);setStockView('list');}
  const product=(id:string)=>products.find(value=>value.id===id);
  const legacyProducts=view.legacyReview.products.filter(item=>item.changedSinceBackfill||item.needsOpeningCount);
  const legacyRecipes=view.legacyReview.recipes.filter(item=>item.changedSinceBackfill||item.needsReviewedVersion);
  const plans=legacyRecords.map(value=>({record:value,plan:recommendation(value,now)}));
  const suggested=plans.filter(value=>value.plan.packs>0);
  return <InventoryLayout section={section} onSectionChange={onSectionChange} loading={loading} onRefresh={()=>{setError('');void onReload().catch(e=>setError((e as Error).message));}}>
    {!canManage&&<div className="notice">Use the Waste page to record waste. An owner or manager records counts, unit changes, and recipe versions.</div>}
    {error&&<div role="alert" className="error">{error}</div>}
    <>
      {section==='stock'&&<div className="inventory-view-switch" role="group" aria-label="Stock views"><Button variant="outline" aria-pressed={stockView==='list'} onClick={()=>{setGuide(null);setStockView('list');}}>Stock list</Button>{canManage&&<Button className="pin-primary" aria-pressed={stockView==='add'} onClick={()=>setStockView('add')}>Add stock</Button>}</div>}
      <section hidden={section!=='stock'||stockView!=='list'}>{canManage&&<RunOutReviews companyId={companyId} products={products} reloadKey={view.records.map(r=>r.productId+':'+r.version).join(',')} onResolved={onReload}/>}{canManage&&unconfigured.length>0&&<div className="guided-setup-callout"><div><strong>{unconfigured.length} product{unconfigured.length===1?' needs':'s need'} setting up</strong><span>Go through them one at a time: how you measure it, then how much you have now.</span></div><Button onClick={startGuide} disabled={loading}>Set up products <ArrowRight size={16}/></Button></div>}<div className="inventory-stock-tools"><StockSearch value={stockSearch} onChange={setStockSearch}/><span className="inventory-caption">{filteredProducts.length} of {products.length} products</span>{canManage?<label className="unit-preference">Everyday units<select value={system} disabled={loading||unitsBusy} onChange={e=>void changeSystem(e.target.value as MeasurementSystem)}><option value="us">US (fl oz, oz, lb)</option><option value="metric">Metric (mL, g, kg)</option></select></label>:<span className="unit-preference">Units: {system==='us'?'US (fl oz, oz, lb)':'Metric (mL, g, kg)'}</span>}</div>
<div className="filter-chips" role="group" aria-label="Filter stock">{stockFilters.filter(f=>f.id==='all'||f.count>0).map(f=><button type="button" key={f.id} aria-pressed={stockFilter===f.id} onClick={()=>setStockFilter(f.id)}>{f.label}<span>{f.count}</span></button>)}</div>
<div className="inventory-table dense-table stock-list-table"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Status</TableHead><TableHead className="num">On hand</TableHead><TableHead className="num">Incoming</TableHead><TableHead>Last count</TableHead>{canManage&&<TableHead><span className="sr-only">Update</span></TableHead>}</TableRow></TableHeader><TableBody>{filteredProducts.map(item=>{const value=record(item.id),state=stateOf(item.id);return <TableRow key={item.id} data-state={state}><TableCell data-label="Product"><strong>{item.name}</strong><small>{item.sku}</small></TableCell><TableCell data-label="Status"><StatusBadge tone={STOCK_STATE_TONE[state]}>{STOCK_STATE_LABEL[state]}</StatusBadge></TableCell><TableCell data-label="On hand" className="num">{value?(value.purchase?<><strong>{friendlyContainers(value.onHand,value.purchase.quantity,value.purchase.label)}</strong><small>{formatEveryday(value.onHand,system)}</small></>:<strong>{formatEveryday(value.onHand,system)}</strong>):<small className="desktop-only">—</small>}</TableCell><TableCell data-label="Incoming" className="num">{value&&BigInt(value.incoming.minor)>BigInt(0)?(value.purchase?friendlyContainers(value.incoming,value.purchase.quantity,value.purchase.label):formatEveryday(value.incoming,system)):<span className="muted">—</span>}</TableCell><TableCell data-label="Last count"><span title={value?.latestCountEffectiveAt?new Date(value.latestCountEffectiveAt).toLocaleString():undefined}>{value?.latestCountEffectiveAt?<><span className="phone-only">Counted </span>{relativeDay(value.latestCountEffectiveAt,now)}</>:'Not counted yet'}</span></TableCell>{canManage&&<TableCell className="row-action"><Button size="sm" variant="outline" aria-label={`${value?'Update stock':'Set up stock'} for ${item.name}`} onClick={()=>{if(stockDirty.current){setError('Finish your current stock edit first.');return;}setStockProduct(item.id);setStockKey(key=>key+1);setStockView('add');}}>{value?'Update':'Set up'}</Button></TableCell>}</TableRow>;})}</TableBody></Table>{!filteredProducts.length&&<p className="empty">{products.length?'No stock matches. Try another search or filter.':canManage?'Use Add stock to set up your first product and opening count.':'An owner or manager can set up products and opening counts.'}</p>}</div>
      {canManage&&<details className="inventory-review-details"><summary>Older data to review</summary><div className="inventory-section-heading"><div><h2>Older inventory and recipe review</h2><p>This read-only comparison flags records that changed after the original migration snapshot. It does not convert quantities, approve a recipe, or change stock. Review each flagged item before relying on exact inventory.</p></div></div><div className="catalog-grid">{legacyProducts.map(item=><article className="catalog-card" key={'stock-'+item.productId}><h3>{product(item.productId)?.name||item.productId}</h3>{item.changedSinceBackfill&&<p>Legacy stock settings or update time changed after the migration snapshot. Compare this product with its exact setup.</p>}{item.needsOpeningCount&&<p>A fresh exact opening count is still required.</p>}</article>)}{legacyRecipes.map(item=><article className="catalog-card" key={'recipe-'+item.recipeId}><h3>Recipe {item.recipeId}</h3>{item.changedSinceBackfill&&<p>The legacy recipe changed after the migration snapshot. Review its ingredients.</p>}{item.needsReviewedVersion&&<p>Create and activate a reviewed exact recipe version before applying sales.</p>}</article>)}</div>{!legacyProducts.length&&!legacyRecipes.length&&<p className="empty">No older records are flagged for review.</p>}</details>}</section>
      {canManage&&<section hidden={section!=='stock'||stockView!=='add'}>{guide&&<div className="guided-setup-progress"><p className="guide-progress">Setting up products · {guide.position} of {guide.total}</p><div className="guide-actions"><Button type="button" variant="ghost" onClick={()=>{if(stockDirty.current){setError('Finish or clear your current stock edit first.');return;}continueGuide(undefined,[...guide.skipped,...(stockProduct?[stockProduct]:[])]);}}>Skip this product</Button><Button type="button" variant="ghost" onClick={stopGuide}>Stop setup</Button></div></div>}<StockEntry key={stockKey} companyId={companyId} products={products} view={view} initialProductId={stockProduct} onDirtyChange={stockDirtyChange} onReload={async()=>{await onCatalogReload();await onReload();}} onSaved={()=>{if(guide){continueGuide(stockProduct,guide.skipped);return;}setStockProduct(undefined);setStockKey(key=>key+1);setStockView('list');}}/></section>}
      {section==='recipes'&&<div className="inventory-view-switch" role="group" aria-label="Item views">
        <Button type="button" variant="outline" aria-pressed={recipeView==='recipes'} aria-controls="inventory-recipes-view" onClick={()=>setRecipeView('recipes')}>Items</Button>
        <Button type="button" variant="outline" aria-pressed={recipeView==='sets'} aria-controls="inventory-option-sets" onClick={()=>setRecipeView('sets')}>Option sets</Button>
        {canManage&&<Button type="button" aria-pressed={recipeView==='create'} aria-controls="inventory-recipe-builder" onClick={()=>setRecipeView('create')}>{editingRecipe?'Edit item':'Add item'}</Button>}
      </div>}

      <section id="inventory-recipes-view" aria-label="Item list" hidden={section!=='recipes'||recipeView!=='recipes'}><RecipeList companyId={companyId} view={view} products={products} optionSets={optionSets} canManage={canManage} loading={loading} onReload={onReload} onDirtyChange={()=>{}} onEdit={version=>{if(builderDirty.current){setError('Finish your current item edit first.');return;}setEditingRecipe(version);setBuilderKey(key=>key+1);setRecipeView('create');}}/></section>
      <section id="inventory-option-sets" aria-label="Option sets" hidden={section!=='recipes'||recipeView!=='sets'}><OptionSetsManager companyId={companyId} view={view} products={products} optionSets={optionSets} canManage={canManage} loading={loading} onReload={onReload} onDirtyChange={setsDirtyChange}/></section>
      {canManage&&<section id="inventory-recipe-builder" aria-label="Add item" hidden={section!=='recipes'||recipeView!=='create'}><RecipeBuilder key={builderKey} companyId={companyId} view={view} products={products} editing={editingRecipe} onReload={onReload} onDirtyChange={builderDirtyChange} onSaved={()=>{setEditingRecipe(null);setBuilderKey(key=>key+1);setRecipeView('recipes');}}/></section>}
      {section==='plan'&&<section><div className="inventory-section-heading"><div><h2>Purchasing suggestions</h2><p>Based on your planning settings. Nothing is sent.</p></div><Button disabled={!suggested.length||hasDraft||loading} onClick={()=>onStage(Object.fromEntries(suggested.map(value=>[value.record.productId,value.plan.packs])))}>Review suggested order</Button></div><div className="catalog-grid">{plans.map(({record:legacy,plan})=>{const exactRecord=record(legacy.productId);return <article className="catalog-card" key={legacy.productId}><span className="sample-tag">{plan.reason}</span><h2>{product(legacy.productId)?.name||legacy.productId}</h2><p>{plan.packs>0?`Suggest ${plan.packs} purchase pack${plan.packs===1?'':'s'}`:'No automatic suggestion'}</p>{exactRecord&&<p>Exact position: {formatEveryday(exactRecord.onHand,system)} on hand + {formatEveryday(exactRecord.incoming,system)} incoming</p>}{plan.planningHeld?<div className="pack-detail" role="alert">A manager needs to confirm this product’s settings first.</div>:<div className="pack-detail">{plan.needsCheck&&<small>Count it first to rely on this.</small>}<details className="more-info"><summary>How it’s worked out</summary>{plan.fixedTarget?'Manager target':'Reorder point'}: {formatPlanningValue(plan.trigger)} {legacy.settings.unit}<small>Target {formatPlanningValue(plan.target)} · on hand + incoming {formatPlanningValue(legacy.onHand+legacy.incoming)}</small><small>Shortfall {formatPlanningValue(plan.shortfall)} · {legacy.settings.unitsPerPack} {legacy.settings.unit} per purchase pack</small><small>Before limits: {plan.wantedPacks} pack(s).</small>{plan.capacityPacks!==null&&<small>Capacity allows at most {plan.capacityPacks} pack(s) with current stock and incoming.</small>}{plan.shelfPacks!==null&&<small>Shelf life allows at most {plan.shelfPacks} pack(s) at the reviewed daily use.</small>}{plan.limited&&<small>Reduced by the limits above.</small>}</details></div>}</article>;})}</div>{!plans.length&&<p className="empty">Set up stock and planning settings to see purchasing suggestions.</p>}{canManage&&<details className="inventory-review-details"><summary>Clover review</summary><A8ReviewPreview companyId={companyId} products={products}/></details>}</section>}
      <section hidden={section!=='usage'}><StockUsagePanel companyId={companyId} products={products} records={view.records} system={system} canManage={canManage} active={section==='usage'} reloadKey={view.records.map(r=>r.productId+':'+r.version).join(',')+'|'+view.reconciliations.length}/></section>
      {section==='activity'&&<section><div className="inventory-section-heading"><div><h2>Physical-count history</h2><p>Review opening counts, later counts, and recorded differences.</p></div></div><div className="inventory-table"><Table><TableHeader><TableRow><TableHead>Effective time</TableHead><TableHead>Product</TableHead><TableHead>Measured</TableHead><TableHead>Variance</TableHead><TableHead>Recorded by</TableHead></TableRow></TableHeader><TableBody>{view.reconciliations.map(item=><TableRow key={item.id}><TableCell>{new Date(item.effectiveAt).toLocaleString()}</TableCell><TableCell>{product(item.productId)?.name||item.productId}</TableCell><TableCell>{formatEveryday(item.measured,system)}</TableCell><TableCell>{item.opening?'Opening count':item.variance?formatEveryday(item.variance,system):'—'}</TableCell><TableCell>{item.actor}<small>{item.note}</small></TableCell></TableRow>)}</TableBody></Table>{!view.reconciliations.length&&<p className="empty">No physical counts recorded yet.</p>}</div></section>}
    </>
  </InventoryLayout>;
}
