'use client';
import type {InventorySection} from './workspace-navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {RefreshCw} from 'lucide-react';
import {formatCanonical,unitLabel} from '@/lib/inventory-quantities';
import {formatInUnit,packageEquivalent} from '@/lib/stock-pack-quantities';
import type {InventoryManagementView} from '@/lib/inventory-management-contract';
import {recommendation,type InventoryRecord} from '@/lib/inventory';
import type {Product} from '@/lib/pantry';
import SalesExceptions from './sales-exceptions';
import A8ReviewPreview from './a8-review-preview';
import StockEntry from './stock-entry';
import RecipeList from './recipe-list';
import RecipeBuilder from './recipe-builder';
import type {RecipeVersionView} from '@/lib/inventory-management-contract';

const formatPlanningValue=(value:number)=>{
  const fixed=value.toFixed(3);
  return fixed==='-0.000'?'0':fixed.replace(/\.?0+$/,'');
};

export default function ExactInventoryPanel({companyId,products,role,view,legacyRecords,now,hasDraft,onStage,loading,onReload,onCatalogReload,section,focusProductId,onFocusHandled,onDirtyChange}:{
  section:InventorySection;focusProductId?:string;onFocusHandled:()=>void;companyId:string;products:Product[];role:string;view:InventoryManagementView;legacyRecords:InventoryRecord[];now:number;hasDraft:boolean;
  onStage:(quantities:Record<string,number>)=>void;loading:boolean;onReload:()=>Promise<void>;onCatalogReload:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;
}){
  const canManage=role==='owner'||role==='manager';
  const [recipeView,setRecipeView]=useState<'recipes'|'create'|'sales'>('recipes');
  const [salesVisited,setSalesVisited]=useState(false);
  const [editingRecipe,setEditingRecipe]=useState<RecipeVersionView|null>(null),[builderKey,setBuilderKey]=useState(0);
  const builderDirty=useRef(false),stockDirty=useRef(false);
  const [stockView,setStockView]=useState<'list'|'add'>('list'),[stockKey,setStockKey]=useState(0),[stockProduct,setStockProduct]=useState(focusProductId);
  const stockDirtyChange=useCallback((dirty:boolean)=>{stockDirty.current=dirty;onDirtyChange(dirty||builderDirty.current);},[onDirtyChange]);
  const builderDirtyChange=useCallback((dirty:boolean)=>{builderDirty.current=dirty;onDirtyChange(dirty||stockDirty.current);},[onDirtyChange]);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!focusProductId)return;
    if(stockDirty.current)setError('Finish your current stock edit first.');
    else {setStockProduct(focusProductId);setStockKey(key=>key+1);setStockView('add');}
    onFocusHandled();
  },[focusProductId,onFocusHandled]);
  const record=(id:string)=>view.records.find(value=>value.productId===id);
  const product=(id:string)=>products.find(value=>value.id===id);
  const activeRecipes=view.recipes.filter(version=>version.status==='active');
  const legacyProducts=view.legacyReview.products.filter(item=>item.changedSinceBackfill||item.needsOpeningCount);
  const legacyRecipes=view.legacyReview.recipes.filter(item=>item.changedSinceBackfill||item.needsReviewedVersion);
  const plans=legacyRecords.map(value=>({record:value,plan:recommendation(value,now)}));
  const suggested=plans.filter(value=>value.plan.packs>0);
  return <>
    <div className="page-heading"><div><h1>Inventory</h1><p>Track stock, manage recipes, and review sales and purchasing suggestions.</p></div><Button variant="outline" disabled={loading} onClick={()=>void onReload()}><RefreshCw size={16}/>Refresh</Button></div>
    {!canManage&&<div className="notice">Use the Waste page to record waste. An owner or manager records counts, unit changes, and recipe versions.</div>}
    {error&&<div role="alert" className="error">{error}</div>}
    <>
      {section==='stock'&&<div className="inventory-view-switch" role="group" aria-label="Stock views"><Button variant="outline" aria-pressed={stockView==='list'} onClick={()=>setStockView('list')}>Stock list</Button>{canManage&&<Button variant="outline" aria-pressed={stockView==='add'} onClick={()=>setStockView('add')}>Add stock</Button>}</div>}
      <section hidden={section!=='stock'||stockView!=='list'}><div className="inventory-table"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>On hand</TableHead><TableHead>Incoming</TableHead><TableHead>Last physical count</TableHead>{canManage&&<TableHead>Update</TableHead>}</TableRow></TableHeader><TableBody>{products.map(item=>{const value=record(item.id);return <TableRow key={item.id}><TableCell><strong>{item.name}</strong><small>{item.sku}</small></TableCell><TableCell>{value?`${value.measurementUnit?formatInUnit(value.onHand,value.measurementUnit):formatCanonical(value.onHand)} ${value.measurementUnit?.kind==='curated'?unitLabel(value.stockUnitId):value.stockUnitLabel}`:'Needs opening stock'}{value?.purchase&&<small>Approximately {packageEquivalent(value.onHand,value.purchase.quantity)} × {value.purchase.label}</small>}</TableCell><TableCell>{value?`${value.measurementUnit?formatInUnit(value.incoming,value.measurementUnit):formatCanonical(value.incoming)} ${value.measurementUnit?.kind==='curated'?unitLabel(value.stockUnitId):value.stockUnitLabel}`:'—'}</TableCell><TableCell>{value?.latestCountEffectiveAt?new Date(value.latestCountEffectiveAt).toLocaleString():'Opening count required'}</TableCell>{canManage&&<TableCell><Button size="sm" variant="outline" onClick={()=>{if(stockDirty.current){setError('Finish your current stock edit first.');return;}setStockProduct(item.id);setStockKey(key=>key+1);setStockView('add');}}>{value?'Update stock':'Set up stock'}</Button></TableCell>}</TableRow>;})}</TableBody></Table></div>
      {canManage&&<details className="inventory-review-details"><summary>Older data to review</summary><div className="inventory-section-heading"><div><h2>Older inventory and recipe review</h2><p>This read-only comparison flags records that changed after the original migration snapshot. It does not convert quantities, approve a recipe, or change stock. Review each flagged item before relying on exact inventory.</p></div></div><div className="catalog-grid">{legacyProducts.map(item=><article className="catalog-card" key={'stock-'+item.productId}><h3>{product(item.productId)?.name||item.productId}</h3>{item.changedSinceBackfill&&<p>Legacy stock settings or update time changed after the migration snapshot. Compare this product with its exact setup.</p>}{item.needsOpeningCount&&<p>A fresh exact opening count is still required.</p>}</article>)}{legacyRecipes.map(item=><article className="catalog-card" key={'recipe-'+item.recipeId}><h3>Recipe {item.recipeId}</h3>{item.changedSinceBackfill&&<p>The legacy recipe changed after the migration snapshot. Review its ingredients.</p>}{item.needsReviewedVersion&&<p>Create and activate a reviewed exact recipe version before applying sales.</p>}</article>)}</div>{!legacyProducts.length&&!legacyRecipes.length&&<p className="empty">No older records are flagged for review.</p>}</details>}</section>
      {canManage&&<section hidden={section!=='stock'||stockView!=='add'}><StockEntry key={stockKey} companyId={companyId} products={products} view={view} initialProductId={stockProduct} onDirtyChange={stockDirtyChange} onReload={async()=>{await onCatalogReload();await onReload();}} onSaved={()=>{setStockProduct(undefined);setStockKey(key=>key+1);setStockView('list');}}/></section>}
      {section==='recipes'&&<div className="inventory-view-switch" role="group" aria-label="Recipes and sales views">
        <Button type="button" variant="outline" aria-pressed={recipeView==='recipes'} aria-controls="inventory-recipes-view" onClick={()=>setRecipeView('recipes')}>Recipes</Button>
        {canManage&&<Button type="button" variant="outline" aria-pressed={recipeView==='create'} aria-controls="inventory-recipe-builder" onClick={()=>setRecipeView('create')}>{editingRecipe?'Edit recipe':'Create recipe'}</Button>}
        <Button type="button" variant="outline" aria-pressed={recipeView==='sales'} aria-controls="inventory-sales-view" onClick={()=>{setSalesVisited(true);setRecipeView('sales');}}>Sales</Button>
      </div>}
      <section id="inventory-recipes-view" aria-label="Recipe list" hidden={section!=='recipes'||recipeView!=='recipes'}><RecipeList companyId={companyId} view={view} products={products} canManage={canManage} loading={loading} onReload={onReload} onDirtyChange={()=>{}} onEdit={version=>{if(builderDirty.current){setError('Finish your current recipe or modifier edit first.');return;}setEditingRecipe(version);setBuilderKey(key=>key+1);setRecipeView('create');}}/></section>
      {canManage&&<section id="inventory-recipe-builder" aria-label="Create recipe" hidden={section!=='recipes'||recipeView!=='create'}><RecipeBuilder key={builderKey} companyId={companyId} view={view} products={products} editing={editingRecipe} onReload={onReload} onDirtyChange={builderDirtyChange} onSaved={()=>{setEditingRecipe(null);setBuilderKey(key=>key+1);setRecipeView('recipes');}}/></section>}
      <section id="inventory-sales-view" aria-label="Sales" hidden={section!=='recipes'||recipeView!=='sales'}>{salesVisited&&<SalesExceptions companyId={companyId} role={role} recipes={activeRecipes.map(value=>({...value,modifiers:view.modifiers.filter(m=>m.recipeId===value.recipeId&&m.status==='active')}))} onInventoryReload={onReload}/>}</section>
      {section==='plan'&&<section><div className="inventory-section-heading"><div><h2>Purchasing suggestions</h2><p>These suggestions use your existing planning settings. Compare them with current stock before preparing an order. Nothing is sent to suppliers.</p></div><Button disabled={!suggested.length||hasDraft||loading} onClick={()=>onStage(Object.fromEntries(suggested.map(value=>[value.record.productId,value.plan.packs])))}>Review suggested order</Button></div><div className="catalog-grid">{plans.map(({record:legacy,plan})=>{const exactRecord=record(legacy.productId);return <article className="catalog-card" key={legacy.productId}><span className="sample-tag">{plan.reason}</span><h2>{product(legacy.productId)?.name||legacy.productId}</h2><p>{plan.packs>0?`Suggest ${plan.packs} purchase pack${plan.packs===1?'':'s'}`:'No automatic suggestion'}</p>{exactRecord&&<p>Exact position: {formatCanonical(exactRecord.onHand)} on hand + {formatCanonical(exactRecord.incoming)} incoming ({exactRecord.dimension})</p>}<div className="pack-detail">{plan.fixedTarget?'Manager target':'Forecast reorder point'}: {formatPlanningValue(plan.trigger)} {legacy.settings.unit}<small>Target {formatPlanningValue(plan.target)} · compatibility position {formatPlanningValue(legacy.onHand+legacy.incoming)}</small><small>Shortfall {formatPlanningValue(plan.shortfall)} · {legacy.settings.unitsPerPack} {legacy.settings.unit} per purchase pack</small><small>Before limits: {plan.wantedPacks} pack(s).</small>{plan.capacityPacks!==null&&<small>Capacity allows at most {plan.capacityPacks} pack(s) with current stock and incoming.</small>}{plan.shelfPacks!==null&&<small>Shelf life allows at most {plan.shelfPacks} pack(s) at the reviewed daily use.</small>}{plan.limited&&<small>Final pack count is reduced by the limit(s) shown above.</small>}{plan.needsCheck&&<small>A current physical count is required before relying on this suggestion.</small>}</div></article>;})}</div>{!plans.length&&<p className="empty">Set up stock and planning settings to see purchasing suggestions.</p>}{canManage&&<details className="inventory-review-details"><summary>Clover review</summary><A8ReviewPreview companyId={companyId} products={products}/></details>}</section>}
      {section==='activity'&&<section><div className="inventory-section-heading"><div><h2>Physical-count history</h2><p>Review opening counts, later counts, and recorded differences.</p></div></div><div className="inventory-table"><Table><TableHeader><TableRow><TableHead>Effective time</TableHead><TableHead>Product</TableHead><TableHead>Measured</TableHead><TableHead>Variance</TableHead><TableHead>Recorded by</TableHead></TableRow></TableHeader><TableBody>{view.reconciliations.map(item=><TableRow key={item.id}><TableCell>{new Date(item.effectiveAt).toLocaleString()}</TableCell><TableCell>{product(item.productId)?.name||item.productId}</TableCell><TableCell>{formatCanonical(item.measured)} {{mass:'g',volume:'mL',count:'each'}[item.measured.dimension]}</TableCell><TableCell>{item.opening?'Opening count':item.variance?formatCanonical(item.variance):'—'}</TableCell><TableCell>{item.actor}<small>{item.note}</small></TableCell></TableRow>)}</TableBody></Table>{!view.reconciliations.length&&<p className="empty">No physical counts recorded yet.</p>}</div></section>}
    </>
  </>;
}
