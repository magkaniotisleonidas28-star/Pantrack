import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// "More of the picked choice" (decision 0009 step 3): light or no ice adds a
// percentage of whichever milk the customer picked.
mkdirSync('.sites-runtime/recipe-choice-extras', { recursive: true });
await build({
  entryPoints: [
    'src/lib/d1-recipe-option-sets.ts',
    'src/lib/d1-recipe-publisher.ts',
    'src/lib/d1-inventory-management.ts',
    'src/lib/d1-inventory-consumption.ts',
    'src/lib/inventory-consumption-fake.ts',
    'src/lib/recipe-choices.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/recipe-choice-extras',
});
const out = '../.sites-runtime/recipe-choice-extras/';
const { D1RecipeOptionSets } = await import(out + 'd1-recipe-option-sets.js');
const { publishRecipe } = await import(out + 'd1-recipe-publisher.js');
const { D1InventoryManagementService } = await import(out + 'd1-inventory-management.js');
const { D1InventoryConsumptionPort } = await import(out + 'd1-inventory-consumption.js');
const { FakeInventoryConsumptionPort } = await import(out + 'inventory-consumption-fake.js');
const { choiceExtraMinor } = await import(out + 'recipe-choices.js');

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

// Rounding: half away from zero to a whole minor unit, per occurrence count.
assert.equal(choiceExtraMinor(300000000n, 25, 1n), 75000000n);
assert.equal(choiceExtraMinor(300000000n, 25, 3n), 225000000n);
assert.equal(choiceExtraMinor(1n, 50, 1n), 1n);
assert.equal(choiceExtraMinor(1n, 49, 1n), 0n);
assert.equal(choiceExtraMinor(-1n, 50, 1n), -1n);
assert.equal(choiceExtraMinor(3n, 33, 1n), 1n);

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
  ['decaf', 'g'],
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

const base = [
  { productId: 'beans', amount: '18', unitId: 'g' },
  { productId: 'cups', amount: '1', unitId: 'each' },
];
const item = (recipeId, extra = {}) => ({
  companyId,
  actor,
  operationId: 'publish-' + recipeId,
  recipeId,
  versionId: recipeId + '-v1',
  name: recipeId,
  expectedActiveVersionId: null,
  expectedModifiers: {},
  ingredients: base,
  choices: [],
  modifiers: [],
  ...extra,
});
const ml = (productId, amount) => ({ productId, amount, unitId: 'mL', signed: false });
for (const id of ['medium', 'large', 'drip']) await publishRecipe(db, item(id), now);
// An item with its own pick-one milk and its own "splash" that adds 10% of it.
await publishRecipe(
  db,
  item('solo', {
    choices: [{ id: 'solo-milk', name: 'Milk', modifierIds: ['solo-whole', 'solo-oat'] }],
    modifiers: [
      { modifierId: 'solo-whole', versionId: 'sw1', name: 'Whole', deltas: [ml('whole', '200')] },
      { modifierId: 'solo-oat', versionId: 'so1', name: 'Oat', deltas: [ml('oat', '200')] },
      {
        modifierId: 'splash',
        versionId: 'sp1',
        name: 'Splash',
        deltas: [],
        extra: { groupId: 'solo-milk', percent: 10 },
      },
    ],
  }),
  now,
);
// An item with an item-only pick-one bean choice, so it has two pick-one choices once milk is added.
await publishRecipe(
  db,
  item('flat', {
    ingredients: [{ productId: 'cups', amount: '1', unitId: 'each' }],
    choices: [{ id: 'bean', name: 'Beans', modifierIds: ['house', 'decaf'] }],
    modifiers: [
      {
        modifierId: 'house',
        versionId: 'h1',
        name: 'House',
        deltas: [{ productId: 'beans', amount: '18', unitId: 'g', signed: false }],
      },
      {
        modifierId: 'decaf',
        versionId: 'd1',
        name: 'Decaf',
        deltas: [{ productId: 'decaf', amount: '18', unitId: 'g', signed: false }],
      },
    ],
  }),
  now,
);

// The publisher refuses an extra without its choice group, on a pick-one option, or out of range.
for (const [modifiers, choices] of [
  [
    [
      {
        modifierId: 'x',
        versionId: 'x1',
        name: 'X',
        deltas: [],
        extra: { groupId: 'nope', percent: 10 },
      },
    ],
    [],
  ],
  [
    [
      {
        modifierId: 'p',
        versionId: 'p1',
        name: 'P',
        deltas: [ml('whole', '1')],
        extra: { groupId: 'g', percent: 10 },
      },
      { modifierId: 'q', versionId: 'q1', name: 'Q', deltas: [ml('oat', '1')] },
    ],
    [{ id: 'g', name: 'G', modifierIds: ['p', 'q'] }],
  ],
  ...[0, 101, 2.5].map((percent) => [
    [
      { modifierId: 'p', versionId: 'p1', name: 'P', deltas: [ml('whole', '1')] },
      { modifierId: 'q', versionId: 'q1', name: 'Q', deltas: [ml('oat', '1')] },
      { modifierId: 'x', versionId: 'x1', name: 'X', deltas: [], extra: { groupId: 'g', percent } },
    ],
    [{ id: 'g', name: 'G', modifierIds: ['p', 'q'] }],
  ]),
])
  await assert.rejects(
    publishRecipe(
      db,
      item('refused', { operationId: crypto.randomUUID(), choices, modifiers }),
      now,
    ),
    (e) => e.code === 'invalid_recipe',
  );
assert.equal(sql.prepare("SELECT count(*) n FROM recipe_lineages WHERE id='refused'").get().n, 0);

// Option sets: only optional add-ons may add more of the picked choice, as a whole 1–100 percent.
const set = (setId, name, kind, choices) => ({
  companyId,
  actor,
  operationId: setId + '-1',
  setId,
  expectedRevision: 0,
  name,
  kind,
  choices,
});
const change = (productId, amount) => [{ productId, amount, unitId: 'mL' }];
const milkMedium = set('milk-medium', 'Milk: Medium iced', 'one', [
  { id: 'whole', name: 'Whole milk', changes: change('whole', '300') },
  { id: 'oat', name: 'Oat milk', changes: change('oat', '300') },
]);
const milkLarge = set('milk-large', 'Milk: Large iced', 'one', [
  { id: 'whole', name: 'Whole milk', changes: change('whole', '400') },
  { id: 'oat', name: 'Oat milk', changes: change('oat', '400') },
]);
const ice = set('ice', 'Ice', 'addons', [
  { id: 'light', name: 'Light ice', changes: [], extraPercent: 25 },
  { id: 'none', name: 'No ice', changes: [], extraPercent: 50 },
]);
const syrups = set('syrups', 'Syrups', 'addons', [
  { id: 'vanilla', name: 'Vanilla', changes: change('vanilla', '15') },
]);
await assert.rejects(
  options.saveSet({
    ...milkMedium,
    operationId: 'bad-kind',
    choices: milkMedium.choices.map((c) => ({ ...c, extraPercent: 10 })),
  }),
  (e) => e.code === 'invalid_option_set',
);
for (const extraPercent of [0, 101, 2.5])
  await assert.rejects(
    options.saveSet({
      ...ice,
      operationId: 'bad-' + extraPercent,
      choices: [{ id: 'light', name: 'Light ice', changes: [], extraPercent }],
    }),
    (e) => e.code === 'invalid_option_set',
  );
for (const s of [milkMedium, milkLarge, ice, syrups]) await options.saveSet(s);
assert.deepEqual(
  (await options.list(companyId)).sets
    .find((s) => s.id === 'ice')
    .choices.map((c) => c.extraPercent),
  [25, 50],
);
// A replay with the same details returns the saved set.
assert.equal((await options.saveSet(ice)).set.revision, 1);

// Attaching: the extra follows each item's own milk set, so one ice set serves every size.
now = '2026-04-02T00:00:00.000Z';
const attach = (recipeId, links) => options.attach({ companyId, actor, recipeId, links });
assert.equal(
  (
    await attach('medium', [
      { setId: 'milk-medium', overrides: {} },
      { setId: 'ice', overrides: {} },
      { setId: 'syrups', overrides: {} },
    ])
  ).status,
  'applied',
);
assert.equal(
  (
    await attach('large', [
      { setId: 'milk-large', overrides: { whole: '420' } },
      { setId: 'ice', overrides: {} },
    ])
  ).status,
  'applied',
);
const extras = () =>
  sql
    .prepare(
      `SELECT e.recipe_id,e.modifier_id,e.group_id,e.percent FROM recipe_modifier_extras e JOIN recipe_modifier_versions v
      ON v.company_id=e.company_id AND v.recipe_id=e.recipe_id AND v.modifier_id=e.modifier_id AND v.id=e.version_id
      WHERE v.status='active' ORDER BY e.recipe_id,e.modifier_id`,
    )
    .all()
    .map((r) => ({ ...r }));
assert.deepEqual(extras(), [
  { recipe_id: 'large', modifier_id: 'opt-ice-light', group_id: 'opt-milk-large', percent: 25 },
  { recipe_id: 'large', modifier_id: 'opt-ice-none', group_id: 'opt-milk-large', percent: 50 },
  { recipe_id: 'medium', modifier_id: 'opt-ice-light', group_id: 'opt-milk-medium', percent: 25 },
  { recipe_id: 'medium', modifier_id: 'opt-ice-none', group_id: 'opt-milk-medium', percent: 50 },
  { recipe_id: 'solo', modifier_id: 'splash', group_id: 'solo-milk', percent: 10 },
]);
const view = await stock.read(companyId);
assert.deepEqual(
  view.modifiers.find(
    (m) => m.recipeId === 'medium' && m.modifierId === 'opt-ice-light' && m.status === 'active',
  ).extra,
  { groupId: 'opt-milk-medium', percent: 25 },
);
assert.equal(
  view.modifiers.find(
    (m) =>
      m.recipeId === 'medium' && m.modifierId === 'opt-syrups-vanilla' && m.status === 'active',
  ).extra,
  undefined,
);

// Without exactly one pick-one choice, the item is not updated and says why.
const drip = await attach('drip', [{ setId: 'ice', overrides: {} }]);
assert.equal(drip.status, 'failed');
assert.match(drip.message, /no pick-one choice/);
const flat = await attach('flat', [
  { setId: 'milk-medium', overrides: {} },
  { setId: 'ice', overrides: {} },
]);
assert.equal(flat.status, 'failed');
assert.match(flat.message, /more than one pick-one choice/);
assert.equal(
  sql
    .prepare(
      "SELECT count(*) n FROM recipe_modifier_versions WHERE recipe_id IN ('drip','flat') AND modifier_id LIKE 'opt-%'",
    )
    .get().n,
  0,
);

// An item's own modifier keeps its extra when a set is attached.
assert.equal((await attach('solo', [{ setId: 'syrups', overrides: {} }])).status, 'applied');
assert.ok(extras().some((e) => e.recipe_id === 'solo' && e.modifier_id === 'splash'));

// Stored extras are immutable once active.
assert.throws(
  () => sql.exec("UPDATE recipe_modifier_extras SET percent=99 WHERE recipe_id='medium'"),
  /immutable/,
);
assert.throws(
  () => sql.exec("DELETE FROM recipe_modifier_extras WHERE recipe_id='medium'"),
  /only from drafts/,
);
const active = sql
  .prepare(
    "SELECT modifier_id,id FROM recipe_modifier_versions WHERE recipe_id='medium' AND modifier_id='opt-syrups-vanilla' AND status='active'",
  )
  .get();
assert.throws(
  () =>
    sql
      .prepare('INSERT INTO recipe_modifier_extras VALUES (?,?,?,?,?,?)')
      .run(companyId, 'medium', active.modifier_id, active.id, 'opt-milk-medium', 10),
  /only to drafts/,
);

// Sales.
const port = new D1InventoryConsumptionPort(db, {
  clock: { now: () => new Date('2026-04-30T00:00:00Z') },
});
const onHand = (id) =>
  BigInt(
    sql.prepare('SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id=?').get(id)
      .n,
  );
const sale = (key, recipeId, modifiers, quantity = '1', occurredAt = '2026-04-03T00:00:00Z') => ({
  contract: 'pantrack.inventory-consumption.v1',
  companyId,
  idempotencyKey: key,
  occurredAt,
  lines: [
    {
      lineId: 'line',
      recipeId,
      quantity,
      modifiers: modifiers.map((m) =>
        typeof m === 'string' ? { modifierId: m, quantity } : { modifierId: m[0], quantity: m[1] },
      ),
    },
  ],
});
const used = async (request, products) => {
  const before = products.map(onHand);
  const result = await port.consume(request);
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  return products.map((p, i) => before[i] - onHand(p));
};
const mL = (n) => BigInt(Math.round(n * 1_000_000));

// Medium oat + light ice: 300 + 25% = 375 mL of oat, no whole milk.
assert.deepEqual(
  await used(sale('s1', 'medium', ['opt-milk-medium-oat', 'opt-ice-light']), ['oat', 'whole']),
  [mL(375), 0n],
);
// Large whole (changed to 420 for this item) + no ice: 420 + 50% = 630 mL.
assert.deepEqual(
  await used(sale('s2', 'large', ['opt-milk-large-whole', 'opt-ice-none']), ['whole']),
  [mL(630)],
);
// Regular ice sends nothing, so only the milk is used.
assert.deepEqual(await used(sale('s3', 'medium', ['opt-milk-medium-whole']), ['whole']), [mL(300)]);
// Two items, both light ice: 2 × 375.
assert.deepEqual(
  await used(sale('s4', 'medium', ['opt-milk-medium-oat', 'opt-ice-light'], '2'), ['oat']),
  [mL(750)],
);
// Two items, one with light ice: 2 × 300 + 75.
assert.deepEqual(
  await used(sale('s5', 'medium', ['opt-milk-medium-oat', ['opt-ice-light', '1']], '2'), ['oat']),
  [mL(675)],
);
// Syrups are unaffected; the extra follows only the milk.
assert.deepEqual(
  await used(
    sale('s6', 'medium', ['opt-milk-medium-whole', 'opt-ice-light', 'opt-syrups-vanilla']),
    ['whole', 'vanilla'],
  ),
  [mL(375), mL(15)],
);
// An item's own modifier works the same way.
assert.deepEqual(await used(sale('s7', 'solo', ['solo-oat', 'splash']), ['oat']), [mL(220)]);
// The applied result records the modifier versions, and a replay changes nothing more.
const before = onHand('oat');
const replay = await port.consume(sale('s1', 'medium', ['opt-milk-medium-oat', 'opt-ice-light']));
assert.equal(replay.replayed, true);
assert.equal(onHand('oat'), before);
// Light ice without a milk is held for the missing choice, using nothing.
const held = await port.consume(sale('s8', 'medium', ['opt-ice-light']));
assert.equal(held.status, 'held');
assert.deepEqual(
  held.issues.map((i) => i.code),
  ['required_choice_missing'],
);

// Editing the set applies from then on; earlier sales keep 25%.
now = '2026-04-10T00:00:00.000Z';
const edited = await options.saveSet({
  ...ice,
  operationId: 'ice-2',
  expectedRevision: 1,
  choices: [
    { id: 'light', name: 'Light ice', changes: [], extraPercent: 30 },
    { id: 'none', name: 'No ice', changes: [], extraPercent: 50 },
  ],
});
assert.deepEqual(edited.applied.map((a) => [a.recipeId, a.status]).sort(), [
  ['drip', 'failed'],
  ['flat', 'failed'],
  ['large', 'applied'],
  ['medium', 'applied'],
]);
assert.deepEqual(
  await used(
    sale('s9', 'medium', ['opt-milk-medium-oat', 'opt-ice-light'], '1', '2026-04-05T00:00:00Z'),
    ['oat'],
  ),
  [mL(375)],
);
assert.deepEqual(
  await used(
    sale('s10', 'medium', ['opt-milk-medium-oat', 'opt-ice-light'], '1', '2026-04-11T00:00:00Z'),
    ['oat'],
  ),
  [mL(390)],
);
// Taking the extra off a choice republishes without it.
now = '2026-04-12T00:00:00.000Z';
await options.saveSet({
  ...ice,
  operationId: 'ice-3',
  expectedRevision: 2,
  choices: [
    { id: 'light', name: 'Light ice', changes: [] },
    { id: 'none', name: 'No ice', changes: [], extraPercent: 50 },
  ],
});
assert.ok(!extras().some((e) => e.modifier_id === 'opt-ice-light'));
assert.deepEqual(
  await used(
    sale('s11', 'medium', ['opt-milk-medium-oat', 'opt-ice-light'], '1', '2026-04-13T00:00:00Z'),
    ['oat'],
  ),
  [mL(300)],
);

// Another company's sale cannot use company a's items or extras.
const other = await port.consume({
  ...sale('s12', 'medium', ['opt-milk-medium-oat', 'opt-ice-none']),
  companyId: 'b',
});
assert.equal(other.status, 'held');
assert.ok(other.issues.every((i) => i.code === 'recipe_version_not_found'));

// The fake port used by the contract tests agrees.
const cut = '2026-01-01T00:00:00Z';
const balance = (productId) => ({
  companyId,
  productId,
  dimension: 'volume',
  onHandMinor: '1000000000',
  version: 1,
  classified: true,
  openingCountAt: cut,
});
const version = (fields) => ({
  companyId,
  recipeId: 'latte',
  status: 'active',
  activeFrom: cut,
  activeTo: null,
  ...fields,
});
const fake = new FakeInventoryConsumptionPort({
  now: '2026-04-30T00:00:00Z',
  balances: [balance('whole'), balance('oat')],
  recipes: [
    version({
      versionId: 'r1',
      ingredients: [],
      choices: [{ id: 'milk', name: 'Milk', modifierIds: ['whole', 'oat'] }],
    }),
  ],
  modifiers: [
    version({
      modifierId: 'whole',
      versionId: 'w1',
      deltas: [{ productId: 'whole', quantity: { dimension: 'volume', minor: '300000000' } }],
    }),
    version({
      modifierId: 'oat',
      versionId: 'o1',
      deltas: [{ productId: 'oat', quantity: { dimension: 'volume', minor: '300000000' } }],
    }),
    version({
      modifierId: 'light',
      versionId: 'l1',
      deltas: [],
      extra: { groupId: 'milk', percent: 25 },
    }),
  ],
});
const fakeResult = await fake.consume(sale('f1', 'latte', ['oat', ['light', '1']], '2'));
assert.equal(fakeResult.status, 'applied', JSON.stringify(fakeResult.issues));
assert.deepEqual(
  fakeResult.changes.map((c) => [c.productId, c.consumed.minor]),
  [['oat', String(mL(675))]],
);
const fakeHeld = await fake.consume(sale('f2', 'latte', ['light']));
assert.deepEqual(
  fakeHeld.issues.map((i) => i.code),
  ['required_choice_missing'],
);

console.log('Recipe choice extras passed.');
