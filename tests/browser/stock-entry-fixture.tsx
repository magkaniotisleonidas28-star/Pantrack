import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StockEntry from '../../src/components/workspace/stock-entry';
import type {
  InventoryManagementView,
  ManagedInventoryRecord,
} from '../../src/lib/inventory-management-contract';
import { curatedUnit, customUnit, toCanonical } from '../../src/lib/inventory-quantities';
import type { Product } from '../../src/lib/pantry';
import type { MeasurementSystem } from '../../src/lib/unit-preferences';

const companyId = 'fictional-company';
const milk = { companyId, productId: 'milk' };
const flour = { companyId, productId: 'flour' };
const scoop = customUnit({
  ...flour,
  id: 'stored-scoop',
  version: 2,
  label: 'scoop',
  dimension: 'mass',
  numerator: '5',
  denominator: '2',
});
const volume = toCanonical('1', curatedUnit('L'), milk);
const mass = toCanonical('6', curatedUnit('g'), flour);
const records: ManagedInventoryRecord[] = [
  {
    productId: 'milk',
    configId: 'milk-config',
    dimension: 'volume',
    stockUnitId: 'mL',
    stockUnitLabel: 'mL',
    measurementUnit: curatedUnit('mL'),
    purchase: { label: 'bottle', quantity: volume, enteredAmount: '1', enteredUnitId: 'L' },
    onHand: volume,
    incoming: volume,
    estimatedUsed: toCanonical('0', curatedUnit('mL'), milk),
    version: 7,
    latestCountEffectiveAt: null,
  },
  {
    productId: 'flour',
    configId: 'flour-config',
    dimension: 'mass',
    stockUnitId: scoop.id,
    stockUnitLabel: 'scoop',
    measurementUnit: scoop,
    purchase: { label: 'bag', quantity: mass, enteredAmount: '2.4000', enteredUnitId: scoop.id },
    onHand: mass,
    incoming: mass,
    estimatedUsed: toCanonical('0', curatedUnit('g'), flour),
    version: 7,
    latestCountEffectiveAt: null,
  },
];
records.push(
  {
    ...records[1],
    productId: 'legacy',
    configId: 'legacy-config',
    stockUnitId: 'kg',
    stockUnitLabel: 'kg',
    measurementUnit: curatedUnit('kg'),
    purchase: { label: 'sack', quantity: mass, enteredAmount: null, enteredUnitId: null },
  },
  {
    ...records[1],
    productId: 'missing',
    configId: 'missing-config',
    stockUnitId: 'g',
    stockUnitLabel: 'g',
    measurementUnit: undefined,
    purchase: undefined,
  },
);
const products = [
  { id: 'milk', name: 'Fictional milk' },
  { id: 'flour', name: 'Fictional flour' },
  { id: 'legacy', name: 'Fictional legacy flour' },
  { id: 'missing', name: 'Fictional unpacked flour' },
  { id: 'cream', name: 'Fictional heavy cream' },
] as Product[];
const root = createRoot(document.getElementById('root')!);
const view: InventoryManagementView = {
  records,
  reconciliations: [],
  recipes: [],
  modifiers: [],
  legacyRecipeIds: [],
  legacyReview: { products: [], recipes: [] },
};
const fixture = {
  requests: [] as Record<string, unknown>[],
  responses: [] as number[],
  dirty: false,
  render(initialProductId: string, measurementSystem: MeasurementSystem, version = 7) {
    root.render(
      <StrictMode>
        <StockEntry
          companyId={companyId}
          initialProductId={initialProductId}
          products={products}
          view={{
            ...view,
            measurementSystem,
            records: records.map((record) => ({ ...record, version })),
          }}
          onDirtyChange={(dirty) => {
            fixture.dirty = dirty;
          }}
          onReload={async () => {}}
          onSaved={() => {}}
        />
      </StrictMode>,
    );
  },
  unmount: () => root.unmount(),
};
window.fetch = async (_url, options) => {
  fixture.requests.push(JSON.parse(String(options?.body)));
  const status = fixture.responses.shift() ?? 200;
  return new Response(
    JSON.stringify(status === 200 ? { ok: true } : { error: 'Fictional refusal' }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
};
declare global {
  interface Window {
    stockFixture: typeof fixture;
  }
}
window.stockFixture = fixture;
