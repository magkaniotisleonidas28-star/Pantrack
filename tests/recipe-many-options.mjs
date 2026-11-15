import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime/recipe-many-options', { recursive: true });
await build({
  entryPoints: [
    'src/lib/d1-recipe-publisher.ts',
    'src/lib/d1-inventory-management.ts',
    'src/lib/d1-inventory-consumption.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/recipe-many-options',
});
const { publishRecipe } =
  await import('../.sites-runtime/recipe-many-options/d1-recipe-publisher.js');
const { D1InventoryManagementService } =
  await import('../.sites-runtime/recipe-many-options/d1-inventory-management.js');
const { D1InventoryConsumptionPort } =
  await import('../.sites-runtime/recipe-many-options/d1-inventory-consumption.js');

// Local D1 stand-in that also enforces Cloudflare's 100 bound parameters per statement,
// which node:sqlite does not.
let largestBind = 0;
class Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    if (values.length > 100) throw new Error('D1 maximum bound parameters exceeded');
    largestBind = Math.max(largestBind, values.length);
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
const now = '2026-04-01T00:00:00.000Z',
  companyId = 'a',
  actor = 'manager';
for (const id of ['a', 'b'])
  sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(id, id, now);
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock: { now: () => new Date(now) } });

const milks = Array.from({ length: 8 }, (_, n) => `milk-${n}`),
  syrups = Array.from({ length: 31 }, (_, n) => `syrup-${n}`);
for (const [id, unit] of [
  ['beans', 'g'],
  ['cups', 'each'],
  ...milks.map((id) => [id, 'mL']),
  ...syrups.map((id) => [id, 'mL']),
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

const add = (productId, amount) => [{ productId, amount, unitId: 'mL', signed: false }];
const options = (suffix) => [
  ...milks.map((id) => ({
    modifierId: id,
    versionId: `${id}-${suffix}`,
    name: `Milk ${id}`,
    deltas: add(id, '200'),
  })),
  ...syrups.map((id) => ({
    modifierId: id,
    versionId: `${id}-${suffix}`,
    name: `Syrup ${id}`,
    deltas: add(id, '10'),
  })),
  // An option with no stock effect, such as "light ice" or "extra hot".
  { modifierId: 'light-ice', versionId: `light-ice-${suffix}`, name: 'Light ice', deltas: [] },
];
const base = {
  companyId,
  actor,
  recipeId: 'iced-latte',
  name: 'Iced Latte Medium',
  ingredients: [
    { productId: 'beans', amount: '18', unitId: 'g' },
    { productId: 'cups', amount: '1', unitId: 'each' },
  ],
  choices: [{ id: 'milk', name: 'Milk', modifierIds: milks }],
};

// 40 options (8 required milks, 31 syrups, one no-change option) publish atomically.
const first = {
  ...base,
  operationId: 'publish-1',
  versionId: 'v1',
  expectedActiveVersionId: null,
  expectedModifiers: {},
  modifiers: options('1'),
};
assert.equal(first.modifiers.length, 40);
assert.deepEqual(await publishRecipe(db, first, now), { recipeId: 'iced-latte', versionId: 'v1' });
const active = () =>
  sql
    .prepare(
      "SELECT count(*) n FROM recipe_modifier_versions WHERE company_id=? AND recipe_id='iced-latte' AND status='active'",
    )
    .get(companyId).n;
assert.equal(active(), 40);
assert.ok(largestBind <= 100);

// A republish names all 40 active versions; the check binds a constant number of values.
const current = Object.fromEntries(first.modifiers.map((m) => [m.modifierId, m.versionId]));
const second = {
  ...base,
  operationId: 'publish-2',
  versionId: 'v2',
  expectedActiveVersionId: 'v1',
  expectedModifiers: current,
  modifiers: options('2'),
};
const stale = (label, expectedModifiers) =>
  assert.rejects(
    publishRecipe(
      db,
      { ...second, operationId: 'stale-' + label, versionId: 'stale-' + label, expectedModifiers },
      '2026-04-02T00:00:00.000Z',
    ),
    (e) => e.code === 'concurrent_update',
    label,
  );
const missing = Object.fromEntries(Object.entries(current).filter(([id]) => id !== 'syrup-3'));
await stale('one stale version', { ...current, 'syrup-3': 'syrup-3-old' });
await stale('one missing', missing);
await stale('one swapped for an unknown', { ...missing, 'not-a-modifier': 'x-1' });
await stale('all plus one unknown', { ...current, 'not-a-modifier': 'x-1' });
await stale('empty', {});
assert.equal(active(), 40);
assert.deepEqual(await publishRecipe(db, second, '2026-04-02T00:00:00.000Z'), {
  recipeId: 'iced-latte',
  versionId: 'v2',
});
assert.equal(active(), 40);
assert.equal(
  sql
    .prepare(
      "SELECT count(*) n FROM recipe_modifier_versions WHERE recipe_id='iced-latte' AND status='archived'",
    )
    .get().n,
  40,
);
assert.ok(largestBind <= 100, `largest bind ${largestBind}`);

// Over the limit is refused before any write.
await assert.rejects(
  publishRecipe(
    db,
    {
      ...second,
      operationId: 'too-many',
      versionId: 'v-too-many',
      expectedActiveVersionId: 'v2',
      expectedModifiers: Object.fromEntries(
        second.modifiers.map((m) => [m.modifierId, m.versionId]),
      ),
      modifiers: [
        ...options('3'),
        ...Array.from({ length: 25 }, (_, n) => ({
          modifierId: `extra-${n}`,
          versionId: `extra-${n}-3`,
          name: `Extra ${n}`,
          deltas: [],
        })),
      ],
    },
    '2026-04-03T00:00:00.000Z',
  ),
  (e) => e.code === 'invalid_recipe',
);

// Sales: a required milk plus syrups and the no-change option apply exactly once.
const port = new D1InventoryConsumptionPort(db, {
  clock: { now: () => new Date('2026-04-30T00:00:00Z') },
});
const onHand = (id) =>
  sql.prepare('SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id=?').get(id).n;
const sale = (key, modifiers) => ({
  contract: 'pantrack.inventory-consumption.v1',
  companyId,
  idempotencyKey: key,
  occurredAt: '2026-04-03T00:00:00Z',
  lines: [
    {
      lineId: 'line',
      recipeId: 'iced-latte',
      quantity: '1',
      modifiers: modifiers.map((modifierId) => ({ modifierId, quantity: '1' })),
    },
  ],
});
const milkBefore = onHand('milk-5'),
  syrupBefore = onHand('syrup-30');
const applied = await port.consume(sale('sale-1', ['milk-5', 'syrup-30', 'syrup-0', 'light-ice']));
assert.equal(applied.status, 'applied', JSON.stringify(applied.issues));
assert.equal(BigInt(milkBefore) - BigInt(onHand('milk-5')), 200000000n);
assert.equal(BigInt(syrupBefore) - BigInt(onHand('syrup-30')), 10000000n);
const noChoice = await port.consume(sale('sale-2', ['syrup-1', 'light-ice']));
assert.equal(noChoice.status, 'held');
assert.ok(noChoice.issues.some((i) => i.code === 'required_choice_missing'));
const onlyNoChange = await port.consume(sale('sale-3', ['milk-0', 'light-ice']));
assert.equal(onlyNoChange.status, 'applied', JSON.stringify(onlyNoChange.issues));

// Company isolation: the other company cannot republish or use this recipe.
await assert.rejects(
  publishRecipe(
    db,
    { ...second, companyId: 'b', operationId: 'other', versionId: 'other' },
    '2026-04-04T00:00:00.000Z',
  ),
);
assert.equal(sql.prepare("SELECT count(*) n FROM recipe_versions WHERE company_id='b'").get().n, 0);

sql.close();
console.log(
  'PASS: recipes publish 40 options (required milks, syrups, a no-change option) within D1 bind limits; stale/missing/extra republishes are refused; over 64 is rejected; sales apply each option once.',
);
