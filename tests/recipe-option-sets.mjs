import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime/recipe-option-sets', { recursive: true });
await build({
  entryPoints: [
    'src/lib/d1-recipe-option-sets.ts',
    'src/lib/d1-recipe-publisher.ts',
    'src/lib/d1-inventory-management.ts',
    'src/lib/d1-inventory-consumption.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/recipe-option-sets',
});
const out = '../.sites-runtime/recipe-option-sets/';
const { D1RecipeOptionSets } = await import(out + 'd1-recipe-option-sets.js');
const { publishRecipe } = await import(out + 'd1-recipe-publisher.js');
const { D1InventoryManagementService } = await import(out + 'd1-inventory-management.js');
const { D1InventoryConsumptionPort } = await import(out + 'd1-inventory-consumption.js');

// Local D1 stand-in enforcing Cloudflare's 100 bound parameters per statement.
class Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    if (values.length > 100) throw new Error('D1 maximum bound parameters exceeded');
    return new Statement(this.database, this.query, values);
  }

  async first() {
    return this.database.prepare(this.query).get(...this.values) ?? null;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.query).all(...this.values) };
  }

  runSync() {
    const statement = this.database.prepare(this.query);
    if (/^\s*SELECT\b/i.test(this.query))
      return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
    const result = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

class Database {
  constructor(sql) {
    this.sql = sql;
  }

  prepare(query) {
    return new Statement(this.sql, query);
  }

  async batch(statements) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sql.exec('COMMIT');
      return results;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
}

const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const e of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries)
  sql.exec(readFileSync(`drizzle/${e.tag}.sql`, 'utf8'));
let now = '2026-04-01T00:00:00.000Z';
const clock = { now: () => new Date(now) };
for (const id of ['a', 'b'])
  sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(id, id, now);
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock }),
  options = new D1RecipeOptionSets(db, { clock }),
  actor = 'manager',
  companyId = 'a';
for (const [id, unit] of [
  ['beans', 'g'],
  ['cups', 'each'],
  ['whole', 'mL'],
  ['oat', 'mL'],
  ['vanilla', 'mL'],
  ['caramel', 'mL'],
]) {
  sql
    .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
    .run(companyId, id, JSON.stringify({ id, name: id }));
  await stock.configure({
    companyId,
    actor,
    productId: id,
    operationId: 'stock-' + id,
    stockUnit: { kind: 'curated', id: unit },
    purchaseUnitLabel: 'pack',
    purchaseAmount: '1',
    openingAmount: '10000',
    effectiveAt: '2026-01-01T00:00:00Z',
  });
}

const publishItem = (recipeId, name, shots, modifiers = []) =>
  publishRecipe(
    db,
    {
      companyId,
      actor,
      operationId: 'publish-' + recipeId,
      recipeId,
      versionId: recipeId + '-v1',
      name,
      expectedActiveVersionId: null,
      expectedModifiers: {},
      ingredients: [
        { productId: 'beans', amount: String(shots * 9), unitId: 'g' },
        { productId: 'cups', amount: '1', unitId: 'each' },
      ],
      choices: [],
      modifiers,
    },
    now,
  );
await publishItem('medium', 'Iced Latte Medium', 2, [
  {
    modifierId: 'extra-shot',
    versionId: 'extra-shot-1',
    name: 'Extra shot',
    deltas: [{ productId: 'beans', amount: '9', unitId: 'g', signed: false }],
  },
]);
await publishItem('large', 'Iced Latte Large', 3);

const change = (productId, amount) => [{ productId, amount, unitId: 'mL' }];
const milk = {
  companyId,
  actor,
  operationId: 'milk-1',
  setId: 'milk-medium',
  expectedRevision: 0,
  name: 'Milk: Medium iced',
  kind: 'one',
  choices: [
    { id: 'whole', name: 'Whole milk', changes: change('whole', '300') },
    { id: 'oat', name: 'Oat milk', changes: change('oat', '300') },
  ],
};
const syrups = {
  companyId,
  actor,
  operationId: 'syrups-1',
  setId: 'syrups',
  expectedRevision: 0,
  name: 'Syrups',
  kind: 'addons',
  choices: [
    { id: 'vanilla', name: 'Vanilla', changes: change('vanilla', '15') },
    { id: 'caramel', name: 'Caramel', changes: change('caramel', '15') },
  ],
};
const ice = {
  companyId,
  actor,
  operationId: 'ice-1',
  setId: 'ice',
  expectedRevision: 0,
  name: 'Ice',
  kind: 'addons',
  choices: [
    { id: 'light', name: 'Light ice', changes: [] },
    { id: 'none', name: 'No ice', changes: [] },
  ],
};
for (const set of [milk, syrups, ice]) {
  const saved = await options.saveSet(set);
  assert.equal(saved.set.revision, 1);
  assert.deepEqual(saved.applied, []);
}
// Replay returns the saved set without a new revision; a reused operation with other details conflicts.
assert.equal((await options.saveSet(milk)).set.revision, 1);
await assert.rejects(
  options.saveSet({ ...milk, name: 'Different' }),
  (e) => e.code === 'operation_conflict',
);

// Invalid sets are refused before any write.
for (const [label, bad] of [
  [
    'one choice in a pick-one set',
    { ...milk, setId: 'x1', operationId: 'x1', choices: milk.choices.slice(0, 1) },
  ],
  [
    'no-change choice in a pick-one set',
    {
      ...milk,
      setId: 'x2',
      operationId: 'x2',
      choices: [...milk.choices, { id: 'nomilk', name: 'No milk', changes: [] }],
    },
  ],
  [
    'duplicate names',
    {
      ...syrups,
      setId: 'x3',
      operationId: 'x3',
      choices: [syrups.choices[0], { ...syrups.choices[1], name: 'vanilla' }],
    },
  ],
  [
    'unknown product',
    {
      ...syrups,
      setId: 'x4',
      operationId: 'x4',
      choices: [{ id: 'z', name: 'Z', changes: change('missing', '1') }],
    },
  ],
])
  await assert.rejects(options.saveSet(bad), undefined, label);
assert.equal(sql.prepare('SELECT count(*) n FROM recipe_option_sets').get().n, 3);

// Attach sets to the medium latte, with oat milk changed for this item only.
now = '2026-04-02T00:00:00.000Z';
const attached = await options.attach({
  companyId,
  actor,
  recipeId: 'medium',
  links: [
    { setId: 'milk-medium', overrides: { oat: '320' } },
    { setId: 'syrups', overrides: {} },
    { setId: 'ice', overrides: {} },
  ],
});
assert.deepEqual(attached, { recipeId: 'medium', status: 'applied' });
const view = await stock.read(companyId);
const activeRecipe = (id) => view.recipes.find((r) => r.recipeId === id && r.status === 'active');
const activeModifiers = (v, id) =>
  v.modifiers
    .filter((m) => m.recipeId === id && m.status === 'active')
    .map((m) => m.modifierId)
    .sort();
assert.deepEqual(activeModifiers(view, 'medium'), [
  'extra-shot',
  'opt-ice-light',
  'opt-ice-none',
  'opt-milk-medium-oat',
  'opt-milk-medium-whole',
  'opt-syrups-caramel',
  'opt-syrups-vanilla',
]);
assert.deepEqual(activeRecipe('medium').choices, [
  {
    id: 'opt-milk-medium',
    name: 'Milk: Medium iced',
    modifierIds: ['opt-milk-medium-whole', 'opt-milk-medium-oat'],
  },
]);
assert.deepEqual(activeModifiers(view, 'large'), []);
assert.deepEqual(
  (await options.list(companyId)).links.map((l) => [l.recipeId, l.setId, l.appliedRevision]),
  [
    ['medium', 'milk-medium', 1],
    ['medium', 'syrups', 1],
    ['medium', 'ice', 1],
  ],
);
// Overrides only for a known one-ingredient choice with a positive amount.
await options.saveSet({
  companyId,
  actor,
  operationId: 'combo-1',
  setId: 'combo',
  expectedRevision: 0,
  name: 'Combos',
  kind: 'addons',
  choices: [
    {
      id: 'mocha-vanilla',
      name: 'Mocha vanilla',
      changes: [...change('vanilla', '10'), ...change('caramel', '5')],
    },
  ],
});
await assert.rejects(
  options.attach({
    companyId,
    actor,
    recipeId: 'large',
    links: [{ setId: 'combo', overrides: { 'mocha-vanilla': '20' } }],
  }),
  undefined,
  'two-ingredient choice override',
);
for (const overrides of [{ missing: '1' }, { oat: '0' }, { oat: '-5' }])
  await assert.rejects(
    options.attach({
      companyId,
      actor,
      recipeId: 'medium',
      links: [{ setId: 'milk-medium', overrides }],
    }),
  );
await assert.rejects(
  options.attach({
    companyId,
    actor,
    recipeId: 'nope',
    links: [{ setId: 'syrups', overrides: {} }],
  }),
);

// A sale applies the base, one milk (with the item override), two syrups and a no-change option.
const port = new D1InventoryConsumptionPort(db, {
  clock: { now: () => new Date('2026-04-30T00:00:00Z') },
});
const onHand = (id) =>
  BigInt(
    sql.prepare('SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id=?').get(id)
      .n,
  );
const sale = (key, recipeId, modifiers, occurredAt = '2026-04-03T00:00:00Z') => ({
  contract: 'pantrack.inventory-consumption.v1',
  companyId,
  idempotencyKey: key,
  occurredAt,
  lines: [
    {
      lineId: 'line',
      recipeId,
      quantity: '1',
      modifiers: modifiers.map((modifierId) => ({ modifierId, quantity: '1' })),
    },
  ],
});
const before = Object.fromEntries(
  ['oat', 'vanilla', 'caramel', 'beans'].map((id) => [id, onHand(id)]),
);
const result = await port.consume(
  sale('sale-1', 'medium', [
    'opt-milk-medium-oat',
    'opt-syrups-vanilla',
    'opt-syrups-caramel',
    'opt-ice-light',
    'extra-shot',
  ]),
);
assert.equal(result.status, 'applied', JSON.stringify(result.issues));
assert.equal(before.oat - onHand('oat'), 320000000n);
assert.equal(before.vanilla - onHand('vanilla'), 15000000n);
assert.equal(before.caramel - onHand('caramel'), 15000000n);
assert.equal(before.beans - onHand('beans'), 27000000n);
const noMilk = await port.consume(sale('sale-2', 'medium', ['opt-syrups-vanilla']));
assert.equal(noMilk.status, 'held');

// Editing a set republishes attached items from then on; others are untouched.
now = '2026-04-05T00:00:00.000Z';
await assert.rejects(
  options.saveSet({ ...milk, operationId: 'stale', expectedRevision: 0 }),
  (e) => e.code === 'concurrent_update',
);
await assert.rejects(
  options.saveSet({
    ...milk,
    operationId: 'rename',
    expectedRevision: 1,
    choices: [{ ...milk.choices[0], name: 'Whole' }, milk.choices[1]],
  }),
);
const edited = await options.saveSet({
  ...milk,
  operationId: 'milk-2',
  expectedRevision: 1,
  choices: [{ ...milk.choices[0], changes: change('whole', '310') }, milk.choices[1]],
});
assert.equal(edited.set.revision, 2);
// The database refuses a save based on an older revision even if it reaches the write.
await assert.rejects(
  options.saveSet({ ...milk, operationId: 'stale-update', expectedRevision: 1 }),
  (e) => e.code === 'concurrent_update',
);
assert.deepEqual(edited.applied, [{ recipeId: 'medium', status: 'applied' }]);
const after = await stock.read(companyId);
const whole = after.modifiers.find(
  (m) =>
    m.recipeId === 'medium' && m.modifierId === 'opt-milk-medium-whole' && m.status === 'active',
);
assert.equal(whole.deltas[0].quantity.minor, '310000000');
const oat = after.modifiers.find(
  (m) => m.recipeId === 'medium' && m.modifierId === 'opt-milk-medium-oat' && m.status === 'active',
);
assert.equal(oat.deltas[0].quantity.minor, '320000000', 'item override survives a set edit');
assert.equal(
  after.recipes.filter((r) => r.recipeId === 'large').length,
  1,
  'items without the set are not republished',
);
// A sale from before the edit keeps the amounts active at its time.
const wholeBefore = onHand('whole');
assert.equal(
  (await port.consume(sale('sale-3', 'medium', ['opt-milk-medium-whole'], '2026-04-03T12:00:00Z')))
    .status,
  'applied',
);
assert.equal(wholeBefore - onHand('whole'), 300000000n);
// Re-applying without changes is a no-op.
assert.deepEqual(await options.apply(companyId, 'medium', actor), {
  recipeId: 'medium',
  status: 'unchanged',
});

// Detaching every set leaves only the item's own modifier.
now = '2026-04-06T00:00:00.000Z';
assert.deepEqual(await options.attach({ companyId, actor, recipeId: 'medium', links: [] }), {
  recipeId: 'medium',
  status: 'applied',
});
const detached = await stock.read(companyId);
assert.deepEqual(activeModifiers(detached, 'medium'), ['extra-shot']);
assert.deepEqual(
  detached.recipes.find((r) => r.recipeId === 'medium' && r.status === 'active').choices,
  [],
);

// Company isolation.
assert.deepEqual(await options.list('b'), { sets: [], links: [] });
await assert.rejects(
  options.saveSet({ ...syrups, companyId: 'b', operationId: 'b-1', setId: 'b-syrups' }),
);
await assert.rejects(options.attach({ companyId: 'b', actor, recipeId: 'medium', links: [] }));
await assert.rejects(
  options.attach({
    companyId: 'b',
    actor,
    recipeId: 'b-none',
    links: [{ setId: 'syrups', overrides: {} }],
  }),
);
assert.equal(
  sql.prepare("SELECT count(*) n FROM recipe_option_sets WHERE company_id='b'").get().n,
  0,
);

sql.close();
console.log(
  'PASS: option sets: create/replay/conflict, attach with item overrides, generated modifiers and pick-one group, sales with milk + syrups + no-change ice, set edits republish attached items only with history kept, detach, and company isolation.',
);
