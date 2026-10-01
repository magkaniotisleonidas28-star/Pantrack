'use client';

import {useEffect, useRef, useState} from 'react';
import {Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {CURATED_UNIT_IDS, curatedUnit} from '@/lib/inventory-quantities';
import type {InventoryManagementView, ModifierVersionView} from '@/lib/inventory-management-contract';
import type {Product} from '@/lib/pantry';
import {modifierChanges, modifierDraftRequest, type ModifierChange, type ModifierDraftIdentity} from '@/lib/modifier-editor';
import {sendSaveRequest} from '@/lib/waste-client';

type Editor = ModifierDraftIdentity & {name: string; changes: ModifierChange[]; existing: boolean};
type Pending = {body: Record<string, unknown>; message: string; uncertain: boolean};

export default function RecipeModifiers({companyId, recipeId, view, products, canManage, loading, onReload, onDirtyChange}: {
  companyId: string; recipeId: string; view: InventoryManagementView; products: Product[];
  canManage: boolean; loading: boolean; onReload: () => Promise<void>;
  onDirtyChange: (recipeId: string, dirty: boolean) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [copySource, setCopySource] = useState('');
  const [busy, setBusy] = useState(false), [refreshNeeded, setRefreshNeeded] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const lock = useRef(false), pendingRef = useRef<Pending | null>(null);
  const modifiers = view.modifiers.filter(modifier => modifier.recipeId === recipeId);
  const available = modifiers.filter(modifier => modifier.status !== 'archived');
  const archived = modifiers.filter(modifier => modifier.status === 'archived');
  const activeRecipe = view.recipes.some(recipe => recipe.recipeId === recipeId && recipe.status === 'active');
  const sources = view.modifiers.filter(modifier => modifier.status === 'active' && modifier.recipeId !== recipeId &&
    view.recipes.some(recipe => recipe.recipeId === modifier.recipeId && recipe.status === 'active'));
  const sourceKey = (modifier: ModifierVersionView) => JSON.stringify([modifier.recipeId, modifier.modifierId, modifier.versionId]);
  const productName = (id: string) => products.find(product => product.id === id)?.name || 'Unavailable ingredient';
  const blocked = busy || loading || !!pending || refreshNeeded || !canManage || !activeRecipe;
  const dirty = !!editor || !!pending;
  useEffect(() => {
    onDirtyChange(recipeId, dirty);
    return () => onDirtyChange(recipeId, false);
  }, [recipeId, dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function blankChange(): ModifierChange {
    const first = view.records[0];
    return {productId: first?.productId || '', unitId: first?.stockUnitId || '', amount: '', direction: 'add'};
  }
  function start(version?: ModifierVersionView) {
    setError(''); setNotice(''); setCopySource('');
    setEditor(version ? {
      modifierId: version.modifierId, draftId: version.status === 'draft' ? version.versionId : crypto.randomUUID(),
      name: version.name, changes: modifierChanges(version), existing: true,
    } : {modifierId: crypto.randomUUID(), draftId: crypto.randomUUID(), name: '', changes: [blankChange()], existing: false});
  }
  function copy(key: string) {
    setCopySource(key);
    const source = sources.find(modifier => sourceKey(modifier) === key);
    if (source) setEditor(current => current && ({...current, name: source.name, changes: modifierChanges(source)}));
    else setEditor(current => current && ({...current, name: '', changes: [blankChange()]}));
  }
  function change(index: number, value: Partial<ModifierChange>) {
    setEditor(current => current && ({...current, changes: current.changes.map((row, position) => position === index ? {...row, ...value} : row)}));
  }
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {await onReload(); setRefreshNeeded(false);}
    catch {setError('The rule was saved, but the list could not refresh. Refresh the recipe before making another change.');}
    finally {lock.current = false; setBusy(false);}
  }
  async function perform(body?: Record<string, unknown>, message = '') {
    if (lock.current) return;
    const attempt = pendingRef.current || (body && {body, message, uncertain: false});
    if (!attempt) return;
    pendingRef.current = attempt; setPending(attempt);
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const outcome = await sendSaveRequest('/api/inventory', attempt.body, fetch, attempt.uncertain);
      if (outcome.kind === 'uncertain') {
        const frozen = {...attempt, uncertain: true}; pendingRef.current = frozen; setPending(frozen);
        setError(outcome.message + ' Keep this recipe open and retry the same change.');
      } else if (outcome.kind === 'rejected') {
        pendingRef.current = null; setPending(null); setError(outcome.message);
      } else {
        pendingRef.current = null; setPending(null); setNotice(attempt.message);
        if (attempt.body.action === 'saveModifierDraftExact') {setEditor(null); setCopySource('');}
        try {await onReload();}
        catch {setRefreshNeeded(true); setError('Saved, but the list could not refresh. Refresh the recipe before making another change.');}
      }
    } finally {lock.current = false; setBusy(false);}
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editor || blocked) return;
    try {
      if (editor.changes.some(row => !view.records.some(record => record.productId === row.productId)))
        throw new Error('Choose a configured ingredient for every change.');
      await perform(modifierDraftRequest(companyId, recipeId, editor, editor.name, editor.changes),
        'Modifier draft saved. Review its ingredients, then activate it when ready.');
    } catch (reason) {setError((reason as Error).message);}
  }
  function activate(modifier: ModifierVersionView) {
    return perform({action: 'activateModifierExact', companyId, recipeId, modifierId: modifier.modifierId,
      versionId: modifier.versionId, expectedActiveVersionId: modifiers.find(row => row.modifierId === modifier.modifierId && row.status === 'active')?.versionId || null},
      'Modifier activated. Earlier sales and waste keep their original ingredient rules.');
  }
  function card(modifier: ModifierVersionView) {
    return <article className="recipe-modifier-card" key={modifier.versionId}>
      <div className="between"><h3>{modifier.name}</h3><span className="sample-tag">{modifier.status} · v{modifier.version}</span></div>
      <ul>{modifierChanges(modifier).map(row => <li key={row.productId}>{row.direction === 'remove' ? 'Remove' : 'Add'} {row.amount} {row.unitId} · {productName(row.productId)}</li>)}</ul>
      {canManage && activeRecipe && modifier.status !== 'archived' && <div className="recipe-modifier-actions">
        <Button type="button" variant="outline" disabled={blocked || !!editor} onClick={() => start(modifier)}>{modifier.status === 'draft' ? 'Edit draft' : 'Edit ingredients'}</Button>
        {modifier.status === 'draft' ? <Button type="button" disabled={blocked || !!editor} onClick={() => void activate(modifier)}>Activate modifier</Button> :
          <Button type="button" variant="ghost" disabled={blocked || !!editor} onClick={() => void perform({action: 'archiveModifierExact', companyId, recipeId, modifierId: modifier.modifierId, versionId: modifier.versionId}, 'Modifier archived. Its history is retained.')}>Archive modifier</Button>}
      </div>}
    </article>;
  }
  return <div className="recipe-modifiers">
    <p>Orders include choices such as “extra shot.” These rules tell Pantrack which ingredients that choice adds or removes. Set them up once, not with every order.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {pending && <Button type="button" disabled={busy} onClick={() => void perform()}>{busy ? 'Confirming…' : 'Retry the same change'}</Button>}
    {refreshNeeded && <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh recipe</Button>}
    {available.map(card)}
    {!available.length && <p className="muted">No modifier rules set up for this recipe yet.</p>}
    {canManage && !activeRecipe && <p className="muted">Activate a recipe version before setting up modifier rules.</p>}
    {canManage && activeRecipe && !editor && <Button type="button" variant="outline" disabled={blocked || !view.records.length} onClick={() => start()}><Plus size={16}/>Add modifier</Button>}
    {editor && canManage && <form className="product-form recipe-modifier-form" onSubmit={save}>
      <h3>{editor.existing ? 'Review modifier ingredients' : 'New modifier'}</h3>
      <fieldset disabled={blocked}>
        {!editor.existing && sources.length > 0 && <label>Copy from another recipe<select value={copySource} onChange={event => copy(event.target.value)}>
          <option value="">Start from scratch</option>{sources.map(source => <option key={sourceKey(source)} value={sourceKey(source)}>{view.recipes.find(recipe => recipe.recipeId === source.recipeId && recipe.status === 'active')?.name} · {source.name}</option>)}
        </select></label>}
        {copySource && <p className="muted">This is an independent copy. Check the quantities for this recipe before activating it. POS connections need a separate mapping for the copy.</p>}
        <label>Modifier name<Input required maxLength={100} value={editor.name} readOnly={editor.existing} onChange={event => setEditor({...editor, name: event.target.value})}/></label>
        {editor.existing && <p className="muted">Changes are saved as a draft. The active rule stays in use until you activate the reviewed draft.</p>}
        {editor.changes.map((row, index) => {
          const record = view.records.find(value => value.productId === row.productId);
          const unitIds = CURATED_UNIT_IDS.filter(id => curatedUnit(id).dimension === record?.dimension);
          const choices: string[] = [...new Set([...unitIds, ...(record ? [record.stockUnitId] : [])])];
          return <div className="modifier-change" key={index}>
            <label>Change<select value={row.direction} onChange={event => change(index, {direction: event.target.value as ModifierChange['direction']})}><option value="add">Add</option><option value="remove">Remove</option></select></label>
            <label>Ingredient<select required value={row.productId} onChange={event => {
              const selected = view.records.find(value => value.productId === event.target.value);
              change(index, {productId: event.target.value, unitId: selected?.stockUnitId || '', amount: ''});
            }}><option value="" disabled>Choose an ingredient</option>{!record && row.productId && <option value={row.productId}>Unavailable ingredient — choose a replacement</option>}{view.records.map(value => <option key={value.productId} value={value.productId}>{productName(value.productId)}</option>)}</select></label>
            <label>Quantity<Input required inputMode="decimal" value={row.amount} onChange={event => change(index, {amount: event.target.value})}/></label>
            <label>Unit<select required value={row.unitId} onChange={event => change(index, {unitId: event.target.value})}>
              {!choices.includes(row.unitId) && <option value={row.unitId}>{row.unitId || 'Choose a unit'}</option>}{choices.map(id => <option key={id} value={id}>{id === record?.stockUnitId ? record.stockUnitLabel : id}</option>)}
            </select></label>
            <Button type="button" variant="ghost" aria-label={`Delete ingredient change ${index + 1}`} onClick={() => setEditor({...editor, changes: editor.changes.filter((_, position) => position !== index)})}>Delete row</Button>
          </div>;
        })}
        <Button type="button" variant="outline" disabled={editor.changes.length >= 50 || !view.records.length} onClick={() => setEditor({...editor, changes: [...editor.changes, blankChange()]})}><Plus size={16}/>Ingredient change</Button>
        <div className="recipe-modifier-actions"><Button type="submit">{busy ? 'Saving…' : 'Save modifier draft'}</Button><Button type="button" variant="ghost" onClick={() => {setEditor(null); setCopySource(''); setError('');}}>Cancel</Button></div>
      </fieldset>
    </form>}
    {archived.length > 0 && <details className="modifier-history"><summary>Earlier modifier versions ({archived.length})</summary>{archived.map(card)}</details>}
  </div>;
}
