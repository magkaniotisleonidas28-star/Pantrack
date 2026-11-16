'use client';
import { Input } from '@/components/ui/input';
import type {
  InventoryManagementView,
  RecipeAmountInput,
} from '@/lib/inventory-management-contract';
import { CURATED_UNIT_IDS, curatedUnit, toCanonical } from '@/lib/inventory-quantities';
import {
  DEFAULT_MEASUREMENT_SYSTEM,
  perContainer,
  plural,
  preferredUnits,
  shortUnitLabel,
} from '@/lib/unit-preferences';
import type { Product } from '@/lib/pantry';

/** The unit name shown for an amount, including a product's own stock unit. */
export function amountUnitLabel(view: InventoryManagementView, value: RecipeAmountInput) {
  const record = view.records.find((r) => r.productId === value.productId);
  return CURATED_UNIT_IDS.some((id) => id === value.unitId) || record?.stockUnitId !== value.unitId
    ? shortUnitLabel(value.unitId)
    : plural(record.stockUnitLabel, 2);
}

/** How one recipe amount relates to what is bought, such as "about 6 per carton". */
export function amountHint(view: InventoryManagementView, value: RecipeAmountInput) {
  const record = view.records.find((r) => r.productId === value.productId);
  if (!record?.purchase || !value.amount) return '';
  try {
    const unit =
      value.unitId === record.stockUnitId && record.measurementUnit
        ? record.measurementUnit
        : curatedUnit(value.unitId);
    const scope = unit.kind === 'custom' ? unit : { companyId: '', productId: value.productId };
    return perContainer(
      toCanonical(value.amount, unit, scope),
      record.purchase.quantity,
      record.purchase.label,
    );
  } catch {
    return '';
  }
}

/** Ingredient, quantity and unit for one recipe amount, limited to stocked products. */
export function RecipeAmountFields({
  view,
  products,
  value,
  onChange,
  fixedAmount = false,
}: {
  view: InventoryManagementView;
  products: Product[];
  value: RecipeAmountInput;
  onChange: (value: RecipeAmountInput) => void;
  /** Hides the quantity when a shared amount is entered elsewhere. */
  fixedAmount?: boolean;
}) {
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unavailable ingredient';
  const record = view.records.find((r) => r.productId === value.productId);
  const system = view.measurementSystem ?? DEFAULT_MEASUREMENT_SYSTEM;
  const dimension = record?.dimension;
  // The product's own unit first, then the café's everyday units, then the rest.
  const everyday = dimension ? preferredUnits(system, dimension) : [];
  const own =
    record && !everyday.some((id) => id === record.stockUnitId) ? record.stockUnitId : null;
  const others = CURATED_UNIT_IDS.filter(
    (id) =>
      (!dimension || curatedUnit(id).dimension === dimension) &&
      !everyday.some((e) => e === id) &&
      id !== own,
  );
  const hint = amountHint(view, value);
  return (
    <div className="recipe-amount-fields">
      <label>
        Ingredient
        <select
          required
          value={value.productId}
          onChange={(e) => {
            const r = view.records.find((r) => r.productId === e.target.value);
            onChange({ ...value, productId: e.target.value, unitId: r ? r.stockUnitId : '' });
          }}
        >
          <option value="">Choose stocked ingredient</option>
          {view.records.map((r) => (
            <option key={r.productId} value={r.productId}>
              {name(r.productId)}
            </option>
          ))}
        </select>
      </label>
      {!fixedAmount && (
        <label>
          Quantity
          <Input
            required
            inputMode="decimal"
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value })}
          />
        </label>
      )}
      <label>
        Unit
        <select
          required
          value={value.unitId}
          onChange={(e) => onChange({ ...value, unitId: e.target.value })}
        >
          {own && (
            <option value={own}>
              {CURATED_UNIT_IDS.some((id) => id === own)
                ? shortUnitLabel(own)
                : plural(record!.stockUnitLabel, 2)}
            </option>
          )}
          {everyday.map((id) => (
            <option key={id} value={id}>
              {shortUnitLabel(id)}
            </option>
          ))}
          {others.length > 0 && (
            <optgroup label="Other units">
              {others.map((id) => (
                <option key={id} value={id}>
                  {shortUnitLabel(id)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {fixedAmount && <span>Per item</span>}
      {!fixedAmount && hint && <span className="recipe-amount-hint">{hint}</span>}
    </div>
  );
}
