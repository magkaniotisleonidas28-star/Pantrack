'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {InventoryManagementView,RecipeVersionView,RecipeAmountInput,RecipeChoiceGroup} from '@/lib/inventory-management-contract';
import {CURATED_UNIT_IDS,curatedUnit,formatCanonical,unitLabel} from '@/lib/inventory-quantities';
import {modifierChanges,type ModifierChange} from '@/lib/modifier-editor';
import {sendSaveRequest} from '@/lib/waste-client';
import type {Product} from '@/lib/pantry';
import {Plus,X,ArrowLeft,ArrowRight} from 'lucide-react';
import {TaskSection} from './task-form';

type Rule={modifierId:string;versionId:string;name:string;existing:boolean;changes:ModifierChange[]};
type Model={operationId:string;recipeId:string;versionId:string;name:string;expectedActiveVersionId:string|null;expectedModifiers:Record<string,string>;ingredients:RecipeAmountInput[];choices:RecipeChoiceGroup[];rules:Rule[]};
export default function RecipeBuilder({companyId,view,products,editing,onReload,onSaved,onDirtyChange}:{companyId:string;view:InventoryManagementView;products:Product[];editing:RecipeVersionView|null;onReload:()=>Promise<void>;onSaved:()=>void;onDirtyChange:(dirty:boolean)=>void}){
  const blank=():RecipeAmountInput=>({productId:'',amount:'',unitId:'mL'});
  const create=():Model=>{
    const mods=editing?view.modifiers.filter(m=>m.recipeId===editing.recipeId&&m.status==='active'):[];
    return {operationId:crypto.randomUUID(),recipeId:editing?.recipeId??crypto.randomUUID(),versionId:crypto.randomUUID(),name:editing?.name??'',expectedActiveVersionId:editing?.status==='active'?editing.versionId:null,expectedModifiers:Object.fromEntries(mods.map(m=>[m.modifierId,m.versionId])),ingredients:editing?.ingredients.length?editing.ingredients.map(i=>CURATED_UNIT_IDS.some(id=>id===i.unitId)?{productId:i.productId,amount:i.amount,unitId:i.unitId}:{productId:i.productId,amount:formatCanonical(i.quantity),unitId:{mass:'g',volume:'mL',count:'each'}[i.quantity.dimension]}):[blank()],choices:editing?.choices??[],rules:mods.map(m=>({modifierId:m.modifierId,versionId:crypto.randomUUID(),name:m.name,existing:true,changes:modifierChanges(m)}))};
  };
  const [model,setModel]=useState<Model>(create),[review,setReview]=useState(false),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Record<string,unknown>|null>(null),[saved,setSaved]=useState(false);
  const lock=useRef(false);
  const reviewHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(review)reviewHeading.current?.focus();},[review]);
  const name=(id:string)=>products.find(p=>p.id===id)?.name??'Unavailable ingredient';
  useEffect(()=>{onDirtyChange(dirty||!!pending);return()=>onDirtyChange(false);},[dirty,pending,onDirtyChange]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty||pending){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,pending]);
  function update(change:Partial<Model>){setModel(old=>({...old,...change}));setDirty(true);setReview(false);setError('');}
  const rules=(id:string,change:Partial<Rule>)=>update({rules:model.rules.map(r=>r.modifierId===id?{...r,...change}:r)});
  function amountFields(value:RecipeAmountInput,onChange:(v:RecipeAmountInput)=>void,allowRemove=false){const record=view.records.find(r=>r.productId===value.productId);return <div className="recipe-amount-fields"><label>Ingredient<select required value={value.productId} onChange={e=>{const r=view.records.find(r=>r.productId===e.target.value);onChange({...value,productId:e.target.value,unitId:r?r.stockUnitId:''});}}><option value="">Choose stocked ingredient</option>{view.records.map(r=><option key={r.productId} value={r.productId}>{name(r.productId)}</option>)}</select></label>{!allowRemove&&<label>Quantity<Input required inputMode="decimal" value={value.amount} onChange={e=>onChange({...value,amount:e.target.value})}/></label>}<label>Unit<select required value={value.unitId} onChange={e=>onChange({...value,unitId:e.target.value})}>{record&&!CURATED_UNIT_IDS.some(id=>id===record.stockUnitId)&&<option value={record.stockUnitId}>{record.stockUnitLabel}</option>}{CURATED_UNIT_IDS.filter(id=>!record||curatedUnit(id).dimension===record.dimension).map(id=><option key={id} value={id}>{unitLabel(id)}</option>)}</select></label>{allowRemove&&<span>Per item</span>}</div>;}
  function addRule(sourceId?:string){const source=view.modifiers.find(m=>m.versionId===sourceId);update({rules:[...model.rules,{modifierId:crypto.randomUUID(),versionId:crypto.randomUUID(),name:source?.name??'',existing:false,changes:source?modifierChanges(source):[{...blank(),direction:'add'}]}]});}
  function addChoice(){const options=['Whole milk','Oat milk'].map(label=>({modifierId:crypto.randomUUID(),versionId:crypto.randomUUID(),name:label,existing:false,changes:[{...blank(),direction:'add' as const}]}));update({rules:[...model.rules,...options],choices:[...model.choices,{id:crypto.randomUUID(),name:'Milk choice',modifierIds:options.map(o=>o.modifierId)}]});}
  function request(){return {action:'publishRecipeExact',companyId,operationId:model.operationId,recipeId:model.recipeId,versionId:model.versionId,name:model.name.trim(),expectedActiveVersionId:model.expectedActiveVersionId,expectedModifiers:model.expectedModifiers,ingredients:model.ingredients,choices:model.choices,modifiers:model.rules.map(r=>({modifierId:r.modifierId,versionId:r.versionId,name:r.name.trim(),deltas:r.changes.map(({direction,...c})=>({...c,signed:direction==='remove'}))}))};}
  async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError('');const body=pending??request();setPending(body);try{const outcome=await sendSaveRequest('/api/inventory',body,fetch,!!pending);if(outcome.kind==='saved'){setSaved(true);setPending(null);setDirty(false);try{await onReload();onSaved();}catch{setError('Recipe saved. Refresh the list before making another change.');}}else {setError(outcome.message);if(outcome.kind==='rejected')setPending(null);}}finally{lock.current=false;setBusy(false);}}
  const grouped=new Set(model.choices.flatMap(g=>g.modifierIds));
  const disabled=busy||!!pending||saved;
  return <form className="recipe-builder task-form" onSubmit={e=>{e.preventDefault();setReview(true);setError('');}}>
    <header className="task-form-heading"><h2>{review?'Review recipe':editing?'Edit recipe':'Create recipe'}</h2><p>{review?'Check the quantities for one menu item before saving.':'Build the recipe for one item sold. Add customer choices and extras only if you need them.'}</p></header>
    {editing&&!editing.ingredients.length&&<p className="task-help">This older recipe needs reviewed ingredient quantities. Saving keeps its existing recipe links.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!review&&<fieldset disabled={disabled}>
      <TaskSection title="Recipe details" description="Give the recipe the name your team uses on the menu.">
        <label>Recipe name<Input required maxLength={100} placeholder="e.g. 12 oz latte" value={model.name} onChange={e=>update({name:e.target.value})}/></label>
      </TaskSection>
      <TaskSection title="Base ingredients" description="Enter the quantities used in one item, including cups or packaging. Put milk alternatives under Customer choices.">
        {!view.records.length&&<p className="notice">Set up at least one stock item under Stock → Add stock before building a recipe.</p>}
        {model.ingredients.map((i,index)=><div className="task-ingredient-row" key={index}>
          {amountFields(i,v=>update({ingredients:model.ingredients.map((old,n)=>n===index?v:old)}))}
          <Button type="button" variant="ghost" aria-label={`Remove ingredient ${index+1}${i.productId?' — '+name(i.productId):''}`} disabled={model.ingredients.length===1} onClick={()=>update({ingredients:model.ingredients.filter((_,n)=>n!==index)})}><X size={16}/></Button>
        </div>)}
        <Button type="button" variant="outline" onClick={()=>update({ingredients:[...model.ingredients,blank()]})}><Plus size={16}/>Add ingredient</Button>
      </TaskSection>
      <TaskSection title="Customer choices" description="For alternatives such as whole or oat milk. The customer chooses one, and only that option’s ingredients are used.">
        {!model.choices.length&&<p className="task-help">Optional. Skip this if every item is made the same way.</p>}
        {model.choices.map(g=>{const options=model.rules.filter(r=>g.modifierIds.includes(r.modifierId)),first=options[0]?.changes[0];return <div className="task-option-row" key={g.id}>
          <div className="task-field-pair"><label>Choice name<Input required value={g.name} onChange={e=>update({choices:model.choices.map(c=>c.id===g.id?{...c,name:e.target.value}:c)})}/></label><label>Amount for each option<Input required inputMode="decimal" value={first?.amount??''} onChange={e=>update({rules:model.rules.map(r=>g.modifierIds.includes(r.modifierId)?{...r,changes:r.changes.map(c=>({...c,amount:e.target.value}))}:r)})}/></label></div>
          <p className="task-help">Each option uses this amount in its selected unit.</p>
          {options.map(r=><div className="task-option-row" key={r.modifierId}>
            <div className="task-option-header"><label>Option name<Input required readOnly={r.existing} value={r.name} onChange={e=>rules(r.modifierId,{name:e.target.value})}/></label><Button type="button" variant="ghost" aria-label={'Remove '+(r.name||'choice option')} disabled={options.length<=2} onClick={()=>update({rules:model.rules.filter(m=>m.modifierId!==r.modifierId),choices:model.choices.map(c=>c.id===g.id?{...c,modifierIds:c.modifierIds.filter(id=>id!==r.modifierId)}:c)})}><X size={16}/></Button></div>
            {amountFields(r.changes[0],v=>rules(r.modifierId,{changes:[{...v,amount:first?.amount??v.amount,direction:'add'}]}),true)}
          </div>)}
          <div className="task-inline-actions"><Button type="button" variant="outline" disabled={model.rules.length>=16} onClick={()=>{const id=crypto.randomUUID();update({rules:[...model.rules,{modifierId:id,versionId:crypto.randomUUID(),name:'',existing:false,changes:[{...blank(),amount:first?.amount??'',direction:'add'}]}],choices:model.choices.map(c=>c.id===g.id?{...c,modifierIds:[...c.modifierIds,id]}:c)})}}><Plus size={16}/>Add option</Button><Button type="button" variant="ghost" onClick={()=>update({choices:model.choices.filter(c=>c.id!==g.id),rules:model.rules.filter(r=>!g.modifierIds.includes(r.modifierId))})}>Remove choice group</Button></div>
        </div>;})}
        <Button type="button" variant="outline" disabled={model.rules.length>14} onClick={addChoice}><Plus size={16}/>Add milk choice</Button>
      </TaskSection>
      <TaskSection title="Extras & substitutions" description="Optional changes such as an extra shot or swapping an ingredient. Each change applies only when selected.">
        {!model.rules.some(r=>!grouped.has(r.modifierId))&&<p className="task-help">No extras added.</p>}
        {model.rules.filter(r=>!grouped.has(r.modifierId)).map(r=><div className="task-option-row" key={r.modifierId}>
          <div className="task-option-header"><label>Extra or substitution name<Input required readOnly={r.existing} placeholder="e.g. Extra espresso shot" value={r.name} onChange={e=>rules(r.modifierId,{name:e.target.value})}/></label><Button type="button" variant="ghost" onClick={()=>update({rules:model.rules.filter(m=>m.modifierId!==r.modifierId)})}>Remove extra</Button></div>
          {r.changes.map((c,index)=><div className="task-option-row" key={index}><label>Ingredient change<select value={c.direction} onChange={e=>rules(r.modifierId,{changes:r.changes.map((old,n)=>n===index?{...old,direction:e.target.value as 'add'|'remove'}:old)})}><option value="add">Add ingredient</option><option value="remove">Remove ingredient</option></select></label>{amountFields(c,v=>rules(r.modifierId,{changes:r.changes.map((old,n)=>n===index?{...v,direction:c.direction}:old)}))}<Button type="button" variant="ghost" disabled={r.changes.length===1} onClick={()=>rules(r.modifierId,{changes:r.changes.filter((_,n)=>n!==index)})}>Remove change</Button></div>)}
          <Button type="button" variant="outline" onClick={()=>rules(r.modifierId,{changes:[...r.changes,{...blank(),direction:'add'}]})}><Plus size={16}/>Add ingredient change</Button>
        </div>)}
        <Button type="button" variant="outline" disabled={model.rules.length>=16} onClick={()=>addRule()}><Plus size={16}/>Add extra or substitution</Button>
        <details className="task-disclosure"><summary>Copy an extra from another recipe</summary><label>Existing extra<select value="" disabled={model.rules.length>=16} onChange={e=>addRule(e.target.value)}><option value="">Choose an extra to copy</option>{view.modifiers.filter(m=>m.status==='active'&&m.recipeId!==model.recipeId).map(m=><option key={m.versionId} value={m.versionId}>{m.name} · {view.recipes.find(r=>r.recipeId===m.recipeId)?.name}</option>)}</select></label><p className="task-help">The copy can be edited independently of the original recipe.</p></details>
      </TaskSection>
      <div className="task-form-actions"><Button type="submit" disabled={!view.records.length}>Review recipe<ArrowRight size={16}/></Button>{!disabled&&<Button type="button" variant="ghost" onClick={()=>{if(!dirty||window.confirm('Discard this recipe edit?'))onSaved();}}>Cancel</Button>}</div>
    </fieldset>}
    {review&&<section className="task-review" aria-label="Recipe review">
      <h3 ref={reviewHeading} tabIndex={-1}>{model.name}</h3>
      <TaskSection title="For one item" description="These ingredients are used every time this item is made."><dl className="task-review-lines">{model.ingredients.map((i,index)=><div key={index}><dt>{name(i.productId)}</dt><dd>{i.amount} {unitLabel(i.unitId)}</dd></div>)}</dl></TaskSection>
      {!!model.choices.length&&<TaskSection title="Customer choices" description="Exactly one option is required in each group.">{model.choices.map(g=><div key={g.id}><strong>{g.name}</strong><dl className="task-review-lines">{model.rules.filter(r=>g.modifierIds.includes(r.modifierId)).map(r=><div key={r.modifierId}><dt>{r.name}</dt><dd>{r.changes.map(c=>`${c.amount} ${unitLabel(c.unitId)} ${name(c.productId)}`).join(', ')}</dd></div>)}</dl></div>)}</TaskSection>}
      {model.rules.some(r=>!grouped.has(r.modifierId))&&<TaskSection title="Optional extras" description="Used only when ordered.">{model.rules.filter(r=>!grouped.has(r.modifierId)).map(r=><div key={r.modifierId}><strong>{r.name}</strong><p>{r.changes.map(c=>`${c.direction} ${c.amount} ${unitLabel(c.unitId)} ${name(c.productId)}`).join(', ')}</p></div>)}</TaskSection>}
      <p className="task-help">Saving makes this recipe and its choices available together. Previous versions remain in history.</p>
      <div className="task-form-actions"><Button type="button" disabled={busy||saved} onClick={()=>void save()}>{busy?'Saving…':pending?'Retry same recipe save':'Save recipe'}</Button>{!disabled&&<Button type="button" variant="ghost" onClick={()=>setReview(false)}><ArrowLeft size={16}/>Back to editing</Button>}</div>
    </section>}
    {saved&&<Button type="button" variant="outline" onClick={()=>void onReload().then(onSaved).catch(()=>setError('Could not refresh. Try again.'))}>Refresh recipe list</Button>}
  </form>;
}
