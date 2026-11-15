'use client';
import { Input } from '@/components/ui/input';
import type {
  InventoryManagementView,
  RecipeAmountInput,
} from '@/lib/inventory-management-contract';
import { CURATED_UNIT_IDS, curatedUnit, unitLabel } from '@/lib/inventory-quantities';
import type { Product } from '@/lib/pantry';

/** The unit name shown for an amount, including a product's own stock unit. */
export function amountUnitLabel(view: InventoryManagementView, value: RecipeAmountInput) {
  const record = view.records.find((r) => r.productId === value.productId);
  return CURATED_UNIT_IDS.some((id) => id === value.unitId) || record?.stockUnitId !== value.unitId
    ? unitLabel(value.unitId)
    : record.stockUnitLabel;
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
          {record && !CURATED_UNIT_IDS.some((id) => id === record.stockUnitId) && (
            <option value={record.stockUnitId}>{record.stockUnitLabel}</option>
          )}
          {CURATED_UNIT_IDS.filter(
            (id) => !record || curatedUnit(id).dimension === record.dimension,
          ).map((id) => (
            <option key={id} value={id}>
              {unitLabel(id)}
            </option>
          ))}
        </select>
      </label>
      {fixedAmount && <span>Per item</span>}
    </div>
  );
}
