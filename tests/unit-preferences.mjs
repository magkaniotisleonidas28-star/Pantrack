import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Everyday units, containers, open-container counts and pumps/scoops.
mkdirSync('.sites-runtime/unit-preferences', { recursive: true });
await build({
  entryPoints: [
    'src/lib/unit-preferences.ts',
    'src/lib/d1-inventory-management.ts',
    'src/lib/d1-recipe-publisher.ts',
    'src/lib/d1-inventory-consumption.ts',
    'src/lib/modifier-editor.ts',
    'src/lib/inventory-quantities.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/unit-preferences',
});
const out = '../.sites-runtime/unit-preferences/';
const units = await import(out + 'unit-preferences.js');
const { D1InventoryManagementService } = await import(out + 'd1-inventory-management.js');
const { publishRecipe } = await import(out + 'd1-recipe-publisher.js');
const { D1InventoryConsumptionPort } = await import(out + 'd1-inventory-consumption.js');
const { modifierChanges } = await import(out + 'modifier-editor.js');
const { curatedUnit, toCanonical } = await import(out + 'inventory-quantities.js');

const scope = { companyId: 'a', productId: 'p' };
const q = (amount, unit) => toCanonical(amount, curatedUnit(unit), scope);

// Everyday units and labels.
assert.deepEqual(units.preferredUnits('us', 'volume').slice(0, 1), ['fl_oz_us']);
assert.deepEqual(units.preferredUnits('metric', 'mass'), ['g', 'kg']);
assert.equal(units.everydayUnit('us', 'mass'), 'oz_mass');
assert.equal(units.everydayUnit('metric', 'volume'), 'mL');
assert.equal(units.shortUnitLabel('fl_oz_us'), 'fl oz');
assert.equal(units.shortUnitLabel('oz_mass'), 'oz');
assert.equal(units.formatEveryday(q('64', 'fl_oz_us'), 'us'), '64 fl oz');
assert.equal(units.formatEveryday(q('64', 'fl_oz_us'), 'metric'), '1.89 L');
assert.equal(units.formatEveryday(q('500', 'mL'), 'metric'), '500 mL');
assert.equal(units.formatEveryday(q('2', 'lb'), 'us'), '2 lb');
assert.equal(units.formatEveryday(q('8', 'oz_mass'), 'us'), '8 oz');
assert.equal(units.formatEveryday(q('12', 'each'), 'us'), '12 each');

// Containers in words.
assert.equal(units.plural('carton', 2), 'cartons');
assert.equal(units.plural('box', 2), 'boxes');
assert.equal(units.plural('pastry', 2), 'pastries');
assert.equal(units.plural('carton', 1), 'carton');
const carton = q('64', 'fl_oz_us');
assert.equal(units.friendlyContainers(q('224', 'fl_oz_us'), carton, 'carton'), '3½ cartons');
assert.equal(units.friendlyContainers(q('64', 'fl_oz_us'), carton, 'carton'), '1 carton');
assert.equal(units.friendlyContainers(q('70', 'fl_oz_us'), carton, 'carton'), 'about 1 carton');
assert.equal(units.friendlyContainers(q('48', 'fl_oz_us'), carton, 'carton'), '¾ cartons');
assert.equal(units.friendlyContainers(q('4', 'fl_oz_us'), carton, 'carton'), 'less than ¼ carton');
assert.equal(units.friendlyContainers(q('0', 'fl_oz_us'), carton, 'carton'), '0 cartons');
assert.equal(units.perContainer(q('10', 'fl_oz_us'), carton, 'carton'), 'about 6 per carton');
assert.equal(units.perContainer(q('96', 'fl_oz_us'), carton, 'carton'), 'about 1.5 cartons each');
assert.equal(units.perContainer(q('10', 'g'), carton, 'carton'), '');
// A share of an open container.
assert.deepEqual(units.fractionOfPack(carton, 2), q('32', 'fl_oz_us'));
assert.deepEqual(units.fractionOfPack(carton, 0), { dimension: 'volume', minor: '0' });
assert.deepEqual(units.fractionOfPack({ dimension: 'count', minor: '50' }, 1), {
  dimension: 'count',
  minor: '13',
});

// A product's own measure as an exact factor in canonical units.
assert.deepEqual(units.measureFactor('1', 'mL'), {
  dimension: 'volume',
  numerator: '1',
  denominator: '1',
});
const pump = units.measureFactor('0.25', 'fl_oz_us');
assert.equal(pump.dimension, 'volume');
assert.equal(
  (BigInt(pump.numerator) * 1000000n) / BigInt(pump.denominator),
  BigInt(q('0.25', 'fl_oz_us').minor),
);
assert.deepEqual(units.measureFactor('2', 'each'), {
  dimension: 'count',
  numerator: '2',
  denominator: '1',
});
for (const bad of ['0', '-1', 'abc', '1.1234567'])
  assert.throws(() => units.measureFactor(bad, 'mL'));

// Name-based starting guesses; amounts are never guessed.
for (const [name, container, dimension] of [
  ['Oat milk · barista', 'carton', 'volume'],
  ['Heavy cream', 'carton', 'volume'],
  ['Biscoff cookie butter', 'jar', 'mass'],
  ['Unsalted butter', 'box', 'mass'],
  ['Vanilla syrup', 'bottle', 'volume'],
  ['House espresso blend', 'bag', 'mass'],
  ['12 oz hot cups', 'sleeve', 'count'],
  ['Pastry bags', 'pack', 'count'],
])
  assert.deepEqual(units.guessPackaging(name), { container, dimension }, name);
assert.equal(units.guessPackaging('Mystery item'), null);

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
const now = '2026-04-01T00:00:00.000Z';
const clock = { now: () => new Date(now) };
for (const id of ['a', 'b'])
  sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(id, id, now);
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock });

// The café setting: US by default, per company, and only US or metric.
assert.equal(await stock.measurementSystem('a'), 'us');
assert.deepEqual(
  await stock.setMeasurementSystem({ companyId: 'a', actor: 'owner', measurementSystem: 'metric' }),
  { measurementSystem: 'metric' },
);
assert.equal((await stock.read('a')).measurementSystem, 'metric');
assert.equal((await stock.read('b')).measurementSystem, 'us');
await assert.rejects(
  stock.setMeasurementSystem({ companyId: 'a', actor: 'owner', measurementSystem: 'imperial' }),
  (e) => e.code === 'invalid_preference',
);
assert.throws(() =>
  sql.prepare("UPDATE company_preferences SET measurement_system='imperial'").run(),
);
await stock.setMeasurementSystem({ companyId: 'a', actor: 'owner', measurementSystem: 'us' });
assert.equal(await stock.measurementSystem('a'), 'us');

// A syrup measured in pumps: 1 pump = 0.25 fl oz, sold in 25.4 fl oz bottles,
// opened with 2 full bottles and one half full, as the stock screen sends it.
for (const id of ['syrup', 'oat'])
  sql
    .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
    .run('a', id, JSON.stringify({ id, name: id }));
const bottle = q('25.4', 'fl_oz_us');
const half = units.fractionOfPack(bottle, 2);
const { formatCanonical } = await import(out + 'inventory-quantities.js');
await stock.configure({
  companyId: 'a',
  actor: 'owner',
  productId: 'syrup',
  operationId: 'syrup-setup',
  stockUnit: { kind: 'custom', id: 'pump', label: 'pump', ...pump },
  purchaseUnitLabel: 'bottle',
  purchaseAmount: '25.4',
  purchaseContentUnitId: 'fl_oz_us',
  openingPackages: { packages: '2', remainder: formatCanonical(half), remainderUnitId: 'mL' },
  effectiveAt: '2026-01-01T00:00:00Z',
});
const syrup = (await stock.read('a')).records.find((r) => r.productId === 'syrup');
assert.equal(syrup.stockUnitLabel, 'pump');
assert.equal(
  units.friendlyContainers(syrup.onHand, syrup.purchase.quantity, 'bottle'),
  '2½ bottles',
);
assert.equal(units.formatEveryday(syrup.onHand, 'us'), '63.5 fl oz');
// Oat milk: the open carton entered as an exact amount in fl oz.
await stock.configure({
  companyId: 'a',
  actor: 'owner',
  productId: 'oat',
  operationId: 'oat-setup',
  stockUnit: { kind: 'curated', id: 'fl_oz_us' },
  purchaseUnitLabel: 'carton',
  purchaseAmount: '64',
  purchaseContentUnitId: 'fl_oz_us',
  openingPackages: { packages: '3', remainder: '20', remainderUnitId: 'fl_oz_us' },
  effectiveAt: '2026-01-01T00:00:00Z',
});
const oat = (await stock.read('a')).records.find((r) => r.productId === 'oat');
assert.equal(units.formatEveryday(oat.onHand, 'us'), '212 fl oz');

// A latte with 10 fl oz of oat milk and 2 pumps of syrup.
await publishRecipe(
  db,
  {
    companyId: 'a',
    actor: 'owner',
    operationId: 'latte',
    recipeId: 'latte',
    versionId: 'latte-1',
    name: 'Latte',
    expectedActiveVersionId: null,
    expectedModifiers: {},
    ingredients: [
      { productId: 'oat', amount: '10', unitId: 'fl_oz_us' },
      { productId: 'syrup', amount: '2', unitId: 'pump' },
    ],
    choices: [],
    modifiers: [
      {
        modifierId: 'extra-oat',
        versionId: 'extra-oat-1',
        name: 'Extra oat',
        deltas: [{ productId: 'oat', amount: '2', unitId: 'fl_oz_us', signed: false }],
      },
    ],
  },
  now,
);
const port = new D1InventoryConsumptionPort(db, {
  clock: { now: () => new Date('2026-04-30T00:00:00Z') },
});
const sale = await port.consume({
  contract: 'pantrack.inventory-consumption.v1',
  companyId: 'a',
  idempotencyKey: 'sale-1',
  occurredAt: '2026-04-02T00:00:00Z',
  lines: [{ lineId: 'l', recipeId: 'latte', quantity: '1', modifiers: [] }],
});
assert.equal(sale.status, 'applied', JSON.stringify(sale.issues));
const used = Object.fromEntries(sale.changes.map((c) => [c.productId, c.consumed]));
assert.equal(units.formatEveryday(used.oat, 'us'), '10 fl oz');
assert.equal(units.formatEveryday(used.syrup, 'us'), '0.5 fl oz');
assert.equal(
  units.perContainer(used.syrup, syrup.purchase.quantity, 'bottle'),
  'about 50 per bottle',
);

// Editing keeps amounts entered in standard units instead of converting to mL.
const extra = (await stock.read('a')).modifiers.find((m) => m.modifierId === 'extra-oat');
assert.deepEqual(modifierChanges(extra), [
  { productId: 'oat', amount: '2', unitId: 'fl_oz_us', direction: 'add' },
]);

console.log('Unit preferences passed.');
