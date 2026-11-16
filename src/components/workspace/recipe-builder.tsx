'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MAX_RECIPE_MODIFIERS,
  type InventoryManagementView,
  type ModifierExtra,
  type RecipeVersionView,
  type RecipeAmountInput,
  type RecipeChoiceGroup,
} from '@/lib/inventory-management-contract';
import { CURATED_UNIT_IDS, formatCanonical } from '@/lib/inventory-quantities';
import { modifierChanges, type ModifierChange } from '@/lib/modifier-editor';
import { isOptionGenerated } from '@/lib/recipe-option-sets-contract';
import { sendSaveRequest } from '@/lib/waste-client';
import type { Product } from '@/lib/pantry';
import { Plus, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { TaskSection } from './task-form';
import { RecipeAmountFields, amountUnitLabel } from './recipe-amount-fields';

type Rule = {
  modifierId: string;
  versionId: string;
  name: string;
  existing: boolean;
  changes: ModifierChange[];
  /** Kept as saved, such as light ice adding more of the picked milk. */
  extra?: ModifierExtra;
};

type Model = {
  operationId: string;
  recipeId: string;
  versionId: string;
  name: string;
  expectedActiveVersionId: string | null;
  expectedModifiers: Record<string, string>;
  ingredients: RecipeAmountInput[];
  choices: RecipeChoiceGroup[];
  rules: Rule[];
  /** Option-set choices are managed with their sets and republished unchanged here. */
  carried: Rule[];
  carriedChoices: RecipeChoiceGroup[];
};

export default function RecipeBuilder({
  companyId,
  view,
  products,
  editing,
  onReload,
  onSaved,
  onDirtyChange,
}: {
  companyId: string;
  view: InventoryManagementView;
  products: Product[];
  editing: RecipeVersionView | null;
  onReload: () => Promise<void>;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const blank = (): RecipeAmountInput => ({ productId: '', amount: '', unitId: 'mL' });
  const create = (): Model => {
    const active = editing
      ? view.modifiers.filter((m) => m.recipeId === editing.recipeId && m.status === 'active')
      : [];
    const mods = active.filter((m) => !isOptionGenerated(m.modifierId));
    const toRule = (m: (typeof active)[number]): Rule => ({
      modifierId: m.modifierId,
      versionId: crypto.randomUUID(),
      name: m.name,
      existing: true,
      changes: modifierChanges(m),
      ...(m.extra ? { extra: m.extra } : {}),
    });
    return {
      operationId: crypto.randomUUID(),
      recipeId: editing?.recipeId ?? crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      name: editing?.name ?? '',
      expectedActiveVersionId: editing?.status === 'active' ? editing.versionId : null,
      expectedModifiers: Object.fromEntries(active.map((m) => [m.modifierId, m.versionId])),
      ingredients: editing?.ingredients.length
        ? editing.ingredients.map((i) =>
            CURATED_UNIT_IDS.some((id) => id === i.unitId)
              ? { productId: i.productId, amount: i.amount, unitId: i.unitId }
              : {
                  productId: i.productId,
                  amount: formatCanonical(i.quantity),
                  unitId: { mass: 'g', volume: 'mL', count: 'each' }[i.quantity.dimension],
                },
          )
        : [blank()],
      choices: (editing?.choices ?? []).filter((g) => !isOptionGenerated(g.id)),
      rules: mods.map(toRule),
      carried: active.filter((m) => isOptionGenerated(m.modifierId)).map(toRule),
      carriedChoices: (editing?.choices ?? []).filter((g) => isOptionGenerated(g.id)),
    };
  };
  const [model, setModel] = useState<Model>(create),
    [review, setReview] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unavailable ingredient';
  useEffect(() => {
    onDirtyChange(dirty || !!pending);
    return () => onDirtyChange(false);
  }, [dirty, pending, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);
  function update(change: Partial<Model>) {
    setModel((old) => ({ ...old, ...change }));
    setDirty(true);
    setReview(false);
    setError('');
  }
  const rules = (id: string, change: Partial<Rule>) =>
    update({ rules: model.rules.map((r) => (r.modifierId === id ? { ...r, ...change } : r)) });
  const amountFields = (
    value: RecipeAmountInput,
    onChange: (v: RecipeAmountInput) => void,
    fixedAmount = false,
  ) => (
    <RecipeAmountFields
      view={view}
      products={products}
      value={value}
      onChange={onChange}
      fixedAmount={fixedAmount}
    />
  );
  function addRule(sourceId?: string) {
    const source = view.modifiers.find((m) => m.versionId === sourceId);
    update({
      rules: [
        ...model.rules,
        {
          modifierId: crypto.randomUUID(),
          versionId: crypto.randomUUID(),
          name: source?.name ?? '',
          existing: false,
          changes: source ? modifierChanges(source) : [{ ...blank(), direction: 'add' }],
        },
      ],
    });
  }
  function addChoice() {
    const options = ['', ''].map((label) => ({
      modifierId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      name: label,
      existing: false,
      changes: [{ ...blank(), direction: 'add' as const }],
    }));
    update({
      rules: [...model.rules, ...options],
      choices: [
        ...model.choices,
        {
          id: crypto.randomUUID(),
          name: '',
          modifierIds: options.map((o) => o.modifierId),
        },
      ],
    });
  }
  function request() {
    return {
      action: 'publishRecipeExact',
      companyId,
      operationId: model.operationId,
      recipeId: model.recipeId,
      versionId: model.versionId,
      name: model.name.trim(),
      expectedActiveVersionId: model.expectedActiveVersionId,
      expectedModifiers: model.expectedModifiers,
      ingredients: model.ingredients,
      choices: [...model.choices, ...model.carriedChoices],
      modifiers: [...model.rules, ...model.carried].map((r) => ({
        modifierId: r.modifierId,
        versionId: r.versionId,
        name: r.name.trim(),
        deltas: r.changes.map(({ direction, ...c }) => ({ ...c, signed: direction === 'remove' })),
        ...(r.extra ? { extra: r.extra } : {}),
      })),
    };
  }
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = pending ?? request();
    setPending(body);
    try {
      const outcome = await sendSaveRequest('/api/inventory', body, fetch, !!pending);
      if (outcome.kind === 'saved') {
        setSaved(true);
        setPending(null);
        setDirty(false);
        try {
          await onReload();
          onSaved();
        } catch {
          setError('Item saved. Refresh the list before making another change.');
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
  const grouped = new Set(model.choices.flatMap((g) => g.modifierIds));
  const disabled = busy || !!pending || saved;
  return (
    <form
      className="recipe-builder task-form"
      onSubmit={(e) => {
        e.preventDefault();
        setReview(true);
        setError('');
      }}
    >
      <header className="task-form-heading">
        <h2>{review ? 'Review item' : editing ? 'Edit item' : 'Add item'}</h2>
        <p>
          {review
            ? 'Check the quantities for one item before saving.'
            : 'List what one item always uses. Shared choices such as milk or syrups come from option sets; add modifiers here only for choices this item alone has.'}
        </p>
      </header>
      {editing && !editing.ingredients.length && (
        <p className="task-help">
          This older recipe needs reviewed ingredient quantities. Saving keeps its existing recipe
          links.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!review && (
        <fieldset disabled={disabled}>
          <TaskSection
            title="Item details"
            description="Use the same name as the button in Clover. Each size is its own item."
          >
            <label>
              Item name
              <Input
                required
                maxLength={100}
                placeholder="e.g. Iced Latte Medium"
                value={model.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
          </TaskSection>
          <TaskSection
            title="Always uses"
            description="The quantities used every time one item is made, including cups or packaging. Leave out anything the customer chooses, such as milk."
          >
            {!view.records.length && (
              <p className="notice">
                Set up at least one stock item under Stock → Add stock before adding an item.
              </p>
            )}
            {model.ingredients.map((i, index) => (
              <div className="task-ingredient-row" key={index}>
                {amountFields(i, (v) =>
                  update({
                    ingredients: model.ingredients.map((old, n) => (n === index ? v : old)),
                  }),
                )}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove ingredient ${index + 1}${i.productId ? ' — ' + name(i.productId) : ''}`}
                  disabled={model.ingredients.length === 1}
                  onClick={() =>
                    update({ ingredients: model.ingredients.filter((_, n) => n !== index) })
                  }
                >
                  <X size={16} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => update({ ingredients: [...model.ingredients, blank()] })}
            >
              <Plus size={16} />
              Add ingredient
            </Button>
          </TaskSection>
          <TaskSection
            title="Pick-one choices for this item"
            description="Only for a choice no other item shares. The customer picks exactly one option, and only that option’s ingredients are used. Shared choices like milk belong in an option set."
          >
            {!model.choices.length && <p className="task-help">Optional. Most items need none.</p>}
            {model.carried.length > 0 && (
              <p className="task-help">
                {model.carried.length} option-set choice{model.carried.length === 1 ? '' : 's'}{' '}
                (such as milk or syrups) will be kept as they are. Change them with their option
                sets.
              </p>
            )}
            {model.choices.map((g) => {
              const options = model.rules.filter((r) => g.modifierIds.includes(r.modifierId)),
                first = options[0]?.changes[0];
              return (
                <div className="task-option-row" key={g.id}>
                  <div className="task-field-pair">
                    <label>
                      Choice name
                      <Input
                        required
                        value={g.name}
                        onChange={(e) =>
                          update({
                            choices: model.choices.map((c) =>
                              c.id === g.id ? { ...c, name: e.target.value } : c,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Amount for each option
                      <Input
                        required
                        inputMode="decimal"
                        value={first?.amount ?? ''}
                        onChange={(e) =>
                          update({
                            rules: model.rules.map((r) =>
                              g.modifierIds.includes(r.modifierId)
                                ? {
                                    ...r,
                                    changes: r.changes.map((c) => ({
                                      ...c,
                                      amount: e.target.value,
                                    })),
                                  }
                                : r,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="task-help">Each option uses this amount in its selected unit.</p>
                  {options.map((r) => (
                    <div className="task-option-row" key={r.modifierId}>
                      <div className="task-option-header">
                        <label>
                          Option name
                          <Input
                            required
                            readOnly={r.existing}
                            value={r.name}
                            onChange={(e) => rules(r.modifierId, { name: e.target.value })}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={'Remove ' + (r.name || 'choice option')}
                          disabled={options.length <= 2}
                          onClick={() =>
                            update({
                              rules: model.rules.filter((m) => m.modifierId !== r.modifierId),
                              choices: model.choices.map((c) =>
                                c.id === g.id
                                  ? {
                                      ...c,
                                      modifierIds: c.modifierIds.filter(
                                        (id) => id !== r.modifierId,
                                      ),
                                    }
                                  : c,
                              ),
                            })
                          }
                        >
                          <X size={16} />
                        </Button>
                      </div>
                      {amountFields(
                        r.changes[0],
                        (v) =>
                          rules(r.modifierId, {
                            changes: [
                              { ...v, amount: first?.amount ?? v.amount, direction: 'add' },
                            ],
                          }),
                        true,
                      )}
                    </div>
                  ))}
                  <div className="task-inline-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={model.rules.length + model.carried.length >= MAX_RECIPE_MODIFIERS}
                      onClick={() => {
                        const id = crypto.randomUUID();
                        update({
                          rules: [
                            ...model.rules,
                            {
                              modifierId: id,
                              versionId: crypto.randomUUID(),
                              name: '',
                              existing: false,
                              changes: [
                                { ...blank(), amount: first?.amount ?? '', direction: 'add' },
                              ],
                            },
                          ],
                          choices: model.choices.map((c) =>
                            c.id === g.id ? { ...c, modifierIds: [...c.modifierIds, id] } : c,
                          ),
                        });
                      }}
                    >
                      <Plus size={16} />
                      Add option
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        update({
                          choices: model.choices.filter((c) => c.id !== g.id),
                          rules: model.rules.filter((r) => !g.modifierIds.includes(r.modifierId)),
                        })
                      }
                    >
                      Remove choice group
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              disabled={model.rules.length + model.carried.length + 2 > MAX_RECIPE_MODIFIERS}
              onClick={addChoice}
            >
              <Plus size={16} />
              Add pick-one choice
            </Button>
          </TaskSection>
          <TaskSection
            title="Modifiers for this item only"
            description="Optional changes only this item has, such as an extra shot or whipped cream. Each one applies only when the customer asks for it. A modifier with no ingredient changes uses no stock."
          >
            {!model.rules.some((r) => !grouped.has(r.modifierId)) && (
              <p className="task-help">No modifiers added.</p>
            )}
            {model.rules
              .filter((r) => !grouped.has(r.modifierId))
              .map((r) => (
                <div className="task-option-row" key={r.modifierId}>
                  <div className="task-option-header">
                    <label>
                      Modifier name, as in Clover
                      <Input
                        required
                        readOnly={r.existing}
                        placeholder="e.g. Extra shot"
                        value={r.name}
                        onChange={(e) => rules(r.modifierId, { name: e.target.value })}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        update({ rules: model.rules.filter((m) => m.modifierId !== r.modifierId) })
                      }
                    >
                      Remove modifier
                    </Button>
                  </div>
                  {!r.changes.length && (
                    <p className="task-help">
                      No stock change. Sales with this modifier use no extra ingredients.
                    </p>
                  )}
                  {r.changes.map((c, index) => (
                    <div className="task-option-row" key={index}>
                      <label>
                        Ingredient change
                        <select
                          value={c.direction}
                          onChange={(e) =>
                            rules(r.modifierId, {
                              changes: r.changes.map((old, n) =>
                                n === index
                                  ? { ...old, direction: e.target.value as 'add' | 'remove' }
                                  : old,
                              ),
                            })
                          }
                        >
                          <option value="add">Add ingredient</option>
                          <option value="remove">Remove ingredient</option>
                        </select>
                      </label>
                      {amountFields(c, (v) =>
                        rules(r.modifierId, {
                          changes: r.changes.map((old, n) =>
                            n === index ? { ...v, direction: c.direction } : old,
                          ),
                        }),
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          rules(r.modifierId, { changes: r.changes.filter((_, n) => n !== index) })
                        }
                      >
                        Remove change
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={r.changes.length >= 10}
                    onClick={() =>
                      rules(r.modifierId, {
                        changes: [...r.changes, { ...blank(), direction: 'add' }],
                      })
                    }
                  >
                    <Plus size={16} />
                    Add ingredient change
                  </Button>
                </div>
              ))}
            <Button
              type="button"
              variant="outline"
              disabled={model.rules.length + model.carried.length >= MAX_RECIPE_MODIFIERS}
              onClick={() => addRule()}
            >
              <Plus size={16} />
              Add modifier for this item
            </Button>
            <details className="task-disclosure">
              <summary>Copy a modifier from another item</summary>
              <label>
                Existing modifier
                <select
                  value=""
                  disabled={model.rules.length + model.carried.length >= MAX_RECIPE_MODIFIERS}
                  onChange={(e) => addRule(e.target.value)}
                >
                  <option value="">Choose a modifier to copy</option>
                  {view.modifiers
                    .filter(
                      (m) =>
                        m.status === 'active' &&
                        m.recipeId !== model.recipeId &&
                        !isOptionGenerated(m.modifierId),
                    )
                    .map((m) => (
                      <option key={m.versionId} value={m.versionId}>
                        {m.name} · {view.recipes.find((r) => r.recipeId === m.recipeId)?.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="task-help">
                The copy can be edited independently of the original item.
              </p>
            </details>
          </TaskSection>
          <div className="task-form-actions">
            <Button type="submit" disabled={!view.records.length}>
              Review item
              <ArrowRight size={16} />
            </Button>
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (!dirty || window.confirm('Discard this item edit?')) onSaved();
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </fieldset>
      )}
      {review && (
        <section className="task-review" aria-label="Item review">
          <h3 ref={reviewHeading} tabIndex={-1}>
            {model.name}
          </h3>
          <TaskSection
            title="For one item"
            description="These ingredients are used every time this item is made."
          >
            <dl className="task-review-lines">
              {model.ingredients.map((i, index) => (
                <div key={index}>
                  <dt>{name(i.productId)}</dt>
                  <dd>
                    {i.amount} {amountUnitLabel(view, i)}
                  </dd>
                </div>
              ))}
            </dl>
          </TaskSection>
          {!!model.choices.length && (
            <TaskSection
              title="Pick-one choices"
              description="Exactly one option is required in each group."
            >
              {model.choices.map((g) => (
                <div key={g.id}>
                  <strong>{g.name}</strong>
                  <dl className="task-review-lines">
                    {model.rules
                      .filter((r) => g.modifierIds.includes(r.modifierId))
                      .map((r) => (
                        <div key={r.modifierId}>
                          <dt>{r.name}</dt>
                          <dd>
                            {r.changes
                              .map(
                                (c) =>
                                  `${c.amount} ${amountUnitLabel(view, c)} ${name(c.productId)}`,
                              )
                              .join(', ')}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
              ))}
            </TaskSection>
          )}
          {model.rules.some((r) => !grouped.has(r.modifierId)) && (
            <TaskSection title="Modifiers for this item" description="Used only when ordered.">
              {model.rules
                .filter((r) => !grouped.has(r.modifierId))
                .map((r) => (
                  <div key={r.modifierId}>
                    <strong>{r.name}</strong>
                    <p>
                      {r.changes
                        .map(
                          (c) =>
                            `${c.direction} ${c.amount} ${amountUnitLabel(view, c)} ${name(c.productId)}`,
                        )
                        .join(', ') || 'No stock change'}
                    </p>
                  </div>
                ))}
            </TaskSection>
          )}
          <p className="task-help">
            Saving makes this item and its choices available together. Previous versions remain in
            history.
          </p>
          <div className="task-form-actions">
            <Button type="button" disabled={busy || saved} onClick={() => void save()}>
              {busy ? 'Saving…' : pending ? 'Retry same save' : 'Save item'}
            </Button>
            {!disabled && (
              <Button type="button" variant="ghost" onClick={() => setReview(false)}>
                <ArrowLeft size={16} />
                Back to editing
              </Button>
            )}
          </div>
        </section>
      )}
      {saved && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void onReload()
              .then(onSaved)
              .catch(() => setError('Could not refresh. Try again.'))
          }
        >
          Refresh item list
        </Button>
      )}
    </form>
  );
}
