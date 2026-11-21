import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
await build({
  entryPoints: ['src/components/workspace/order-product-groups.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/order-product-groups.mjs',
});
const { groupOrderProducts, orderCategories } =
  await import('../.sites-runtime/order-product-groups.mjs');
const product = (id, name, supplier, category, price) => ({
  id,
  name,
  supplier,
  category,
  price,
  sku: 'SKU-' + id,
  pack: '1 case',
  unit: 'case',
  url: '',
  sample: false,
});
const products = [
  product('a', 'Whole milk', 'Northline Dairy', 'Dairy', 2400),
  product('b', 'Napkins', 'Service Supply', 'Packaging', 3200),
  product('c', 'Butter', 'Northline Dairy', 'Dairy', 10800),
  product('d', 'Cups', 'Service Supply', 'Packaging', 7400),
  product('e', 'Flour', 'Bakers Mill', 'Baking', 1900),
  product('f', 'Almond milk', 'Northline Dairy', 'Alt milk', 3100),
];

// Suppliers A–Z; products by category, then name.
const groups = groupOrderProducts(products, { a: 2, c: 1 });
assert.deepEqual(
  groups.map((g) => g.supplier),
  ['Bakers Mill', 'Northline Dairy', 'Service Supply'],
);
assert.deepEqual(
  groups[1].products.map((p) => p.name),
  ['Almond milk', 'Butter', 'Whole milk'],
);
assert.deepEqual(
  products.map((p) => p.id),
  ['a', 'b', 'c', 'd', 'e', 'f'],
  'Input order is not changed',
);

// Chosen counts and subtotals are in cents, like prices.
assert.equal(groups[1].chosenCount, 2);
assert.equal(groups[1].subtotal, 2 * 2400 + 10800);
assert.equal(groups[0].chosenCount, 0);
assert.equal(groups[0].subtotal, 0);

// Sample minimums are whole dollars and are converted to cents; unknown suppliers have none.
assert.equal(groups[1].minimum, 100 * 100, 'Northline Dairy $100 minimum in cents');
assert.equal(groups[2].minimum, 100 * 100);
assert.equal('minimum' in groups[0], false, 'No minimum for a supplier Pantrack does not know');
assert.ok(
  groupOrderProducts(products, { a: 2 })[1].subtotal < groups[1].minimum,
  '$48 is below $100',
);

// Zero and missing quantities are not chosen; an empty list has no groups.
assert.equal(groupOrderProducts(products, { a: 0 })[1].chosenCount, 0);
assert.deepEqual(groupOrderProducts([], {}), []);

// Category filters come from the products, sorted, after "All products".
assert.deepEqual(orderCategories(products), [
  'All products',
  'Alt milk',
  'Baking',
  'Dairy',
  'Packaging',
]);
assert.deepEqual(orderCategories([]), ['All products']);

// Wiring: the order page uses the grouped list, the derived filters and the "In my order" filter.
const workspace = readFileSync('src/components/workspace/workspace.tsx', 'utf8');
assert.match(workspace, /categories=orderCategories\(orderable\)/);
assert.match(workspace, /\(!inOrderOnly\|\|qty\[p\.id\]>0\)/);
assert.match(workspace, /<OrderProductList companyId=\{companyId\} products=\{shown\}/);
assert.doesNotMatch(workspace, /\['All products','Dairy','Coffee & pantry','Packaging'\]/);
const list = readFileSync('src/components/workspace/order-product-list.tsx', 'utf8');
assert.match(list, /aria-expanded=\{expanded\}/);
assert.match(
  list,
  /'pantrack-order-groups:' \+ companyId/,
  'Open lists are remembered per company',
);
console.log('Order product groups passed.');
