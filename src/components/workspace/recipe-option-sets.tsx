'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, Plus, X } from 'lucide-react';
import type {
  InventoryManagementView,
  RecipeAmountInput,
  RecipeVersionView,
} from '@/lib/inventory-management-contract';
import type {
  OptionApplyResult,
  OptionChoice,
  OptionSetKind,
  OptionSetView,
  OptionSetsView,
} from '@/lib/recipe-option-sets-contract';
import { sendSaveRequest } from '@/lib/waste-client';
import type { Product } from '@/lib/pantry';
import { ChoiceField, TaskSection } from './task-form';
import { RecipeAmountFields, amountUnitLabel } from './recipe-amount-fields';
import './task-form.css';

export const emptyOptionSets: OptionSetsView = { sets: [], links: [] };

const kindLabels: Record<OptionSetKind, string> = {
  one: 'Pick exactly one',
  addons: 'Optional, any number',
};
const MAX_CHOICES = 40,
  MAX_CHANGES = 10,
  MAX_ITEM_SETS = 10;
const positiveAmount = (value: string) =>
  /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) && !/^0(?:\.0+)?$/.test(value);

type DraftChoice = OptionChoice & { existing: boolean };
type Draft = {
  operationId: string;
  setId: string;
  expectedRevision: number;
  name: string;
  kind: OptionSetKind;
  choices: DraftChoice[];
};

const blank = (): RecipeAmountInput => ({ productId: '', amount: '', unitId: 'mL' });
const newChoice = (): DraftChoice => ({
  id: crypto.randomUUID(),
  name: '',
  existing: false,
  changes: [blank()],
});

function useNames(view: InventoryManagementView, products: Product[]) {
  const product = (id: string) =>
    products.find((p) => p.id === id)?.name ?? 'Unavailable ingredient';
  const item = (recipeId: string) =>
    view.recipes.find((r) => r.recipeId === recipeId && r.status === 'active')?.name ??
    view.recipes.find((r) => r.recipeId === recipeId)?.name ??
    'Unavailable item';
  const changes = (list: RecipeAmountInput[]) =>
    list
      .map((c) => `${c.amount} ${amountUnitLabel(view, c)} ${product(c.productId)}`)
      .join(' + ') || 'No stock change';
  return { product, item, changes };
}

/** Attached sets whose latest revision has not been published onto the item. */
export function staleLinks(optionSets: OptionSetsView, recipeId?: string) {
  return optionSets.links.filter(
    (l) =>
      (!recipeId || l.recipeId === recipeId) &&
      l.appliedRevision !== optionSets.sets.find((s) => s.id === l.setId)?.revision,
  );
}

async function applyItem(companyId: string, recipeId: string) {
  const outcome = await sendSaveRequest('/api/inventory', {
    action: 'applyOptionSetsExact',
    companyId,
    recipeId,
  });
  if (outcome.kind !== 'saved') return outcome.message;
  const result = outcome.result as OptionApplyResult;
  return result.status === 'failed' ? (result.message ?? 'Could not update this item.') : null;
}

/** Shared option sets: list, create and edit. Saving republishes every attached item. */
export default function OptionSetsManager({
  companyId,
  view,
  products,
  optionSets,
  canManage,
  loading,
  onReload,
  onDirtyChange,
}: {
  companyId: string;
  view: InventoryManagementView;
  products: Product[];
  optionSets: OptionSetsView;
  canManage: boolean;
  loading: boolean;
  onReload: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const names = useNames(view, products);
  const [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    onDirtyChange(dirty || !!pending);
    return () => onDirtyChange(false);
  }, [dirty, pending, onDirtyChange]);
  const usedBy = (setId: string) =>
    optionSets.links.filter((l) => l.setId === setId).map((l) => l.recipeId);
  const active = (recipeId: string) =>
    view.recipes.some((r) => r.recipeId === recipeId && r.status === 'active');

  function open(set?: OptionSetView) {
    if (dirty || pending) {
      setError('Finish or cancel the option set you are editing first.');
      return;
    }
    setError('');
    setNotice('');
    setDraft(
      set
        ? {
            operationId: crypto.randomUUID(),
            setId: set.id,
            expectedRevision: set.revision,
            name: set.name,
            kind: set.kind,
            choices: set.choices.map((c) => ({ ...c, existing: true })),
          }
        : {
            operationId: crypto.randomUUID(),
            setId: crypto.randomUUID(),
            expectedRevision: 0,
            name: '',
            kind: 'one',
            choices: [newChoice(), newChoice()],
          },
    );
  }
  function update(change: Partial<Draft>) {
    setDraft((old) => old && { ...old, ...change });
    setDirty(true);
    setError('');
  }
  const choice = (id: string, change: Partial<DraftChoice>) =>
    draft && update({ choices: draft.choices.map((c) => (c.id === id ? { ...c, ...change } : c)) });

  async function save() {
    if (lock.current || !draft) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = pending ?? {
      action: 'saveOptionSetExact',
      companyId,
      operationId: draft.operationId,
      setId: draft.setId,
      expectedRevision: draft.expectedRevision,
      name: draft.name.trim(),
      kind: draft.kind,
      choices: draft.choices.map((c) => ({ id: c.id, name: c.name.trim(), changes: c.changes })),
    };
    setPending(body);
    try {
      const outcome = await sendSaveRequest('/api/inventory', body, fetch, !!pending);
      if (outcome.kind === 'saved') {
        const applied = (outcome.result as { applied?: OptionApplyResult[] }).applied ?? [];
        const failed = applied.filter((a) => a.status === 'failed');
        const changed = applied.filter((a) => a.status === 'applied').length;
        setPending(null);
        setDirty(false);
        setDraft(null);
        if (failed.length)
          setError(
            `Option set saved, but ${failed.map((a) => names.item(a.recipeId)).join(', ')} could not be updated. Use Update now below to try again.`,
          );
        else
          setNotice(
            changed
              ? `Option set saved. ${changed} item${changed === 1 ? '' : 's'} updated.`
              : 'Option set saved.',
          );
        try {
          await onReload();
        } catch {
          setError('Option set saved. Refresh before making another change.');
        }
      } else {
        setError(outcome.message);
        if (outcome.kind === 'rejected') setPending(null);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function updateItems(recipeIds: string[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const failed: string[] = [];
      for (const recipeId of recipeIds) {
        const message = await applyItem(companyId, recipeId);
        if (message) failed.push(`${names.item(recipeId)}: ${message}`);
      }
      if (failed.length) setError(failed.join(' '));
      else setNotice('Items updated.');
      await onReload().catch(() => setError('Refresh to see the latest items.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (draft) {
    const removed = optionSets.sets
      .find((s) => s.id === draft.setId)
      ?.choices.filter((c) => !draft.choices.some((d) => d.id === c.id));
    const items = usedBy(draft.setId);
    return (
      <form
        className="recipe-builder task-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="task-form-heading">
          <h2>{draft.expectedRevision ? 'Edit option set' : 'Add option set'}</h2>
          <p>
            Set the choices and amounts once. Every item this set is attached to uses them, and
            saving updates those items. Past sales keep the amounts that applied at the time.
          </p>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy || !!pending}>
          <TaskSection
            title="Set details"
            description="A name that tells sets apart, for example “Milk: Medium iced”."
          >
            <label>
              Set name
              <Input
                required
                maxLength={100}
                placeholder="e.g. Milk: Medium iced"
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <ChoiceField
              label="How customers choose"
              value={draft.kind}
              onChange={(kind) => update({ kind })}
              options={[
                {
                  value: 'one',
                  label: kindLabels.one,
                  description: 'Like milk: Clover asks for one choice on every sale.',
                },
                {
                  value: 'addons',
                  label: kindLabels.addons,
                  description:
                    'Like syrups or light ice: added only when the customer asks, and several may be picked.',
                },
              ]}
            />
          </TaskSection>
          <TaskSection
            title="Choices"
            description="Use the same names as the options in Clover. A choice can add one or more ingredients, or change nothing."
          >
            {draft.choices.map((c, index) => (
              <div className="task-option-row" key={c.id}>
                <div className="task-option-header">
                  <label>
                    Choice name, as in Clover
                    <Input
                      required
                      maxLength={100}
                      readOnly={c.existing}
                      placeholder={index ? 'e.g. Oat milk' : 'e.g. Whole milk'}
                      value={c.name}
                      onChange={(e) => choice(c.id, { name: e.target.value })}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={draft.choices.length === 1}
                    onClick={() => update({ choices: draft.choices.filter((x) => x.id !== c.id) })}
                  >
                    Remove choice
                  </Button>
                </div>
                {c.existing && (
                  <p className="task-help">
                    Saved choice names stay fixed so sales keep matching. Add a new choice to use
                    another name.
                  </p>
                )}
                {!c.changes.length && (
                  <p className="task-help">
                    {draft.kind === 'one'
                      ? 'Add the ingredient this choice uses.'
                      : 'No stock change. Pantrack records the choice without using stock.'}
                  </p>
                )}
                {c.changes.map((value, n) => (
                  <div className="task-ingredient-row" key={n}>
                    <RecipeAmountFields
                      view={view}
                      products={products}
                      value={value}
                      onChange={(next) =>
                        choice(c.id, {
                          changes: c.changes.map((old, i) => (i === n ? next : old)),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ingredient ${n + 1} from ${c.name || 'this choice'}`}
                      onClick={() => choice(c.id, { changes: c.changes.filter((_, i) => i !== n) })}
                    >
                      <X size={16} />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={c.changes.length >= MAX_CHANGES}
                  onClick={() => choice(c.id, { changes: [...c.changes, blank()] })}
                >
                  <Plus size={16} />
                  Add ingredient
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={draft.choices.length >= MAX_CHOICES}
              onClick={() => update({ choices: [...draft.choices, newChoice()] })}
            >
              <Plus size={16} />
              Add choice
            </Button>
            {!!removed?.length && (
              <p className="task-help">
                Removing {removed.map((c) => c.name).join(', ')} takes{' '}
                {removed.length === 1 ? 'it' : 'them'} off every item using this set. Sales that
                still include {removed.length === 1 ? 'it' : 'them'} will be held for review.
              </p>
            )}
          </TaskSection>
          <TaskSection
            title="Items using this set"
            description="Attach a set to an item from that item’s details under Items."
          >
            <p className="task-help">
              {items.length
                ? `Saving updates ${items.map(names.item).join(', ')}.`
                : 'Not attached to any item yet.'}
            </p>
          </TaskSection>
        </fieldset>
        <div className="task-form-actions">
          <Button type="submit" disabled={busy || !view.records.length}>
            {busy ? 'Saving…' : pending ? 'Retry same save' : 'Save option set'}
          </Button>
          {!busy && !pending && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (!dirty || window.confirm('Discard this option set edit?')) {
                  setDraft(null);
                  setDirty(false);
                  setError('');
                }
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <div className="recipe-browser task-form">
      <div className="recipe-list-toolbar">
        <p>
          Set the amounts once, then attach a set to every item that offers those choices, such as
          one milk set for all your medium iced items.
        </p>
        {canManage && (
          <Button type="button" disabled={loading || busy} onClick={() => open()}>
            <Plus size={16} />
            Add option set
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="compact-recipe-list">
        {optionSets.sets.map((s) => {
          const items = usedBy(s.id),
            stale = staleLinks(optionSets).filter((l) => l.setId === s.id && active(l.recipeId));
          return (
            <details className="compact-recipe" key={s.id}>
              <summary>
                <ChevronRight size={18} aria-hidden="true" />
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {kindLabels[s.kind]} · {s.choices.length} choice
                    {s.choices.length === 1 ? '' : 's'} · used by {items.length} item
                    {items.length === 1 ? '' : 's'}
                  </small>
                </span>
                {stale.length > 0 && (
                  <span className="sample-tag">
                    {stale.length} item{stale.length === 1 ? '' : 's'} to update
                  </span>
                )}
              </summary>
              <div className="compact-recipe-detail">
                <dl className="task-review-lines">
                  {s.choices.map((c) => (
                    <div key={c.id}>
                      <dt>{c.name}</dt>
                      <dd>{names.changes(c.changes)}</dd>
                    </div>
                  ))}
                </dl>
                <p>Used by: {items.map(names.item).join(', ') || 'No items yet'}</p>
                <p>
                  Linking these choices to their Clover options is coming soon. Until then, Clover
                  sales that include them are held for review.
                </p>
                {canManage && (
                  <div className="recipe-detail-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading || busy}
                      onClick={() => open(s)}
                    >
                      Edit option set
                    </Button>
                    {stale.length > 0 && (
                      <Button
                        type="button"
                        disabled={loading || busy}
                        onClick={() => void updateItems(stale.map((l) => l.recipeId))}
                      >
                        Update {stale.length} item{stale.length === 1 ? '' : 's'} now
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
      {!optionSets.sets.length && (
        <div className="recipe-empty">
          <h3>No option sets yet</h3>
          <p>
            {canManage
              ? 'Create one for each group of choices several items share: milk for your medium iced items, your syrups, or light and no ice.'
              : 'An owner or manager can create option sets.'}
          </p>
        </div>
      )}
    </div>
  );
}

/** The option sets attached to one item, with per-item amounts and a retry for stale ones. */
export function ItemOptionSets({
  companyId,
  recipe,
  view,
  products,
  optionSets,
  canManage,
  loading,
  onReload,
}: {
  companyId: string;
  recipe: RecipeVersionView;
  view: InventoryManagementView;
  products: Product[];
  optionSets: OptionSetsView;
  canManage: boolean;
  loading: boolean;
  onReload: () => Promise<void>;
}) {
  const names = useNames(view, products);
  const attached = optionSets.links
    .filter((l) => l.recipeId === recipe.recipeId)
    .sort((a, b) => a.position - b.position);
  const stale = staleLinks(optionSets, recipe.recipeId).length > 0;
  const [links, setLinks] = useState<Array<{
    setId: string;
    overrides: Record<string, string>;
  }> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  const set = (id: string) => optionSets.sets.find((s) => s.id === id);

  async function run(task: () => Promise<string | null>, done: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await task();
      if (message) setError(message);
      else setNotice(done);
      await onReload().catch(() => setError('Saved. Refresh to see the latest item.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function save() {
    if (!links) return;
    const bad = links.some((l) =>
      Object.values(l.overrides).some((v) => v !== '' && !positiveAmount(v.trim())),
    );
    if (bad) {
      setError('Enter a positive amount, or leave the box empty to use the set’s amount.');
      return;
    }
    const body = {
      action: 'attachOptionSetsExact',
      companyId,
      recipeId: recipe.recipeId,
      // Only amounts for choices that still have a single ingredient can be changed.
      links: links.map((l) => ({
        setId: l.setId,
        overrides: Object.fromEntries(
          Object.entries(l.overrides)
            .map(([id, v]) => [id, v.trim()] as const)
            .filter(
              ([id, v]) =>
                v !== '' &&
                set(l.setId)?.choices.some((c) => c.id === id && c.changes.length === 1),
            ),
        ),
      })),
    };
    void run(async () => {
      const outcome = await sendSaveRequest('/api/inventory', body);
      if (outcome.kind !== 'saved') return outcome.message;
      setLinks(null);
      const result = outcome.result as OptionApplyResult;
      return result.status === 'failed'
        ? `Option sets saved, but this item could not be updated: ${result.message} Then choose Update now.`
        : null;
    }, 'Option sets saved.');
  }

  return (
    <div className="item-option-sets">
      <h3>Option sets</h3>
      {attached.length ? (
        <ul>
          {attached.map((l) => {
            const s = set(l.setId),
              changed = Object.keys(l.overrides).length;
            return (
              <li key={l.setId}>
                <strong>{s?.name ?? 'Unavailable option set'}</strong>
                {s && ` · ${kindLabels[s.kind].toLowerCase()}`}
                {changed > 0 &&
                  ` · ${changed} amount${changed === 1 ? '' : 's'} changed for this item`}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>None attached.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {stale && (
        <div className="item-option-stale" role="status">
          <span>This item has not picked up the latest option-set changes yet.</span>
          {canManage && (
            <Button
              type="button"
              size="sm"
              disabled={busy || loading || !!links}
              onClick={() => void run(() => applyItem(companyId, recipe.recipeId), 'Item updated.')}
            >
              Update now
            </Button>
          )}
        </div>
      )}
      {canManage && !links && (
        <div className="recipe-detail-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy || loading || !optionSets.sets.length}
            onClick={() => {
              setError('');
              setNotice('');
              setLinks(attached.map((l) => ({ setId: l.setId, overrides: { ...l.overrides } })));
            }}
          >
            Change option sets
          </Button>
          {!optionSets.sets.length && (
            <p className="task-help">Create option sets under Option sets first.</p>
          )}
        </div>
      )}
      {links && (
        <fieldset className="item-option-editor" disabled={busy}>
          <legend>Option sets for {recipe.name}</legend>
          {optionSets.sets.map((s) => {
            const link = links.find((l) => l.setId === s.id);
            const adjustable = s.choices.filter((c) => c.changes.length === 1);
            return (
              <div key={s.id} className="item-option-choice">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!link}
                    disabled={!link && links.length >= MAX_ITEM_SETS}
                    onChange={(e) =>
                      setLinks(
                        e.target.checked
                          ? [...links, { setId: s.id, overrides: {} }]
                          : links.filter((l) => l.setId !== s.id),
                      )
                    }
                  />
                  <span>
                    {s.name}
                    <small>
                      {kindLabels[s.kind]} · {s.choices.map((c) => c.name).join(', ')}
                    </small>
                  </span>
                </label>
                {link && adjustable.length > 0 && (
                  <details
                    className="task-disclosure"
                    open={Object.keys(link.overrides).length > 0}
                  >
                    <summary>Change an amount for this item only (optional)</summary>
                    {adjustable.map((c) => (
                      <label key={c.id} className="item-option-override">
                        <span>
                          {c.name}
                          <small>
                            Usually {names.changes(c.changes)}. Leave empty to keep it. Amount in{' '}
                            {amountUnitLabel(view, c.changes[0])}.
                          </small>
                        </span>
                        <Input
                          inputMode="decimal"
                          placeholder={c.changes[0].amount}
                          value={link.overrides[c.id] ?? ''}
                          onChange={(e) =>
                            setLinks(
                              links.map((l) =>
                                l.setId === s.id
                                  ? { ...l, overrides: { ...l.overrides, [c.id]: e.target.value } }
                                  : l,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </details>
                )}
              </div>
            );
          })}
          <div className="recipe-detail-actions">
            <Button type="button" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save option sets'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setLinks(null);
                setError('');
              }}
            >
              Cancel
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
