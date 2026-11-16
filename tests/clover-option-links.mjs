import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Clover options linked once to option-set choices (decision 0009 step 4).
mkdirSync('.sites-runtime/clover-option-links', { recursive: true });
await build({
  entryPoints: [
    'src/lib/d1-recipe-option-sets.ts',
    'src/lib/d1-recipe-publisher.ts',
    'src/lib/d1-inventory-management.ts',
    'src/lib/d1-clover-option-links.ts',
    'src/lib/d1-sales-runtime.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/clover-option-links',
  external: ['cloudflare:workers'],
});
const out = '../.sites-runtime/clover-option-links/';
const { D1RecipeOptionSets } = await import(out + 'd1-recipe-option-sets.js');
const { publishRecipe } = await import(out + 'd1-recipe-publisher.js');
const { D1InventoryManagementService } = await import(out + 'd1-inventory-management.js');
const { D1CloverOptionLinks } = await import(out + 'd1-clover-option-links.js');
const { D1SalesMappingPort } = await import(out + 'd1-sales-runtime.js');

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
  links = new D1CloverOptionLinks(db, { clock }),
  mappings = new D1SalesMappingPort(db),
  actor = 'owner',
  companyId = 'a';
for (const [id, unit] of [
  ['beans', 'g'],
  ['whole', 'mL'],
  ['oat', 'mL'],
  ['vanilla', 'mL'],
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
for (const recipeId of ['medium', 'large', 'drip'])
  await publishRecipe(
    db,
    {
      companyId,
      actor,
      operationId: 'publish-' + recipeId,
      recipeId,
      versionId: recipeId + '-v1',
      name: recipeId,
      expectedActiveVersionId: null,
      expectedModifiers: {},
      ingredients: [{ productId: 'beans', amount: '18', unitId: 'g' }],
      choices: [],
      modifiers:
        recipeId === 'medium'
          ? [
              {
                modifierId: 'extra-shot',
                versionId: 'shot-1',
                name: 'Extra shot',
                deltas: [{ productId: 'beans', amount: '9', unitId: 'g', signed: false }],
              },
            ]
          : [],
    },
    now,
  );
const change = (productId, amount) => [{ productId, amount, unitId: 'mL' }];
const milk = (setId, name, amount) => ({
  companyId,
  actor,
  operationId: setId + '-1',
  setId,
  expectedRevision: 0,
  name,
  kind: 'one',
  choices: [
    { id: 'whole', name: 'Whole milk', changes: change('whole', amount) },
    { id: 'oat', name: 'Oat milk', changes: change('oat', amount) },
  ],
});
const addons = (setId, name) => ({
  companyId,
  actor,
  operationId: setId + '-1',
  setId,
  expectedRevision: 0,
  name,
  kind: 'addons',
  choices: [{ id: 'vanilla', name: 'Vanilla', changes: change('vanilla', '15') }],
});
for (const set of [
  milk('milk-medium', 'Milk: Medium', '300'),
  milk('milk-large', 'Milk: Large', '400'),
  addons('syrups', 'Syrups'),
  addons('syrups-2', 'Syrups again'),
])
  await options.saveSet(set);
now = '2026-04-02T00:00:00.000Z';
const attach = async (recipeId, setIds) =>
  assert.equal(
    (
      await options.attach({
        companyId,
        actor,
        recipeId,
        links: setIds.map((setId) => ({ setId, overrides: {} })),
      })
    ).status,
    'applied',
  );
await attach('medium', ['milk-medium', 'syrups']);
await attach('large', ['milk-large', 'syrups']);

const scope = { companyId, environment: 'sandbox', merchantId: 'merchant-1' };
for (const [item, recipe] of [
  ['clover-medium', 'medium'],
  ['clover-large', 'large'],
  ['clover-drip', 'drip'],
])
  sql
    .prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)')
    .run(companyId, scope.environment, scope.merchantId, item, recipe);
const source = {
  kind: 'native',
  provider: 'clover',
  environment: 'sandbox',
  connectionId: 'clover',
  merchantId: 'merchant-1',
  locationId: 'merchant-1',
};
const resolve = async (item, modifier, overrides = {}) =>
  (
    await mappings.resolveModifier({
      companyId,
      source: { ...source, ...overrides },
      externalItemId: item,
      externalModifierId: modifier,
    })
  ).modifierId ?? 'unknown';
const link = (setId, choiceId, modifierId, name = modifierId) =>
  links.link({ ...scope, actor, setId, choiceId, modifierId, modifierName: name });

// Before linking, Clover options are unknown.
assert.equal(await resolve('clover-medium', 'OAT'), 'unknown');
// One Clover option links to the matching choice in each size's milk set.
await link('milk-medium', 'oat', 'OAT', 'Oat milk');
await link('milk-large', 'oat', 'OAT', 'Oat milk');
await link('syrups', 'vanilla', 'VAN', 'Vanilla');
assert.equal(await resolve('clover-medium', 'OAT'), 'opt-milk-medium-oat');
assert.equal(await resolve('clover-large', 'OAT'), 'opt-milk-large-oat');
assert.equal(await resolve('clover-medium', 'VAN'), 'opt-syrups-vanilla');
// An item that does not carry the set, an unmapped item, another merchant or company: unknown.
assert.equal(await resolve('clover-drip', 'OAT'), 'unknown');
assert.equal(await resolve('clover-unmapped', 'OAT'), 'unknown');
assert.equal(await resolve('clover-medium', 'OAT', { merchantId: 'merchant-2' }), 'unknown');
assert.equal(await resolve('clover-medium', 'OAT', { environment: 'production' }), 'unknown');
assert.equal(
  (
    await mappings.resolveModifier({
      companyId: 'b',
      source,
      externalItemId: 'clover-medium',
      externalModifierId: 'OAT',
    })
  ).status,
  'unknown_modifier',
);
// Items attached later are covered without linking again.
await attach('drip', ['milk-medium']);
assert.equal(await resolve('clover-drip', 'OAT'), 'opt-milk-medium-oat');
// A modifier mapped on one item takes priority over the link.
sql
  .prepare('INSERT INTO clover_modifier_mappings VALUES (?,?,?,?,?,?)')
  .run(companyId, scope.environment, scope.merchantId, 'clover-medium', 'OAT', 'extra-shot');
assert.equal(await resolve('clover-medium', 'OAT'), 'extra-shot');
sql.prepare("DELETE FROM clover_modifier_mappings WHERE modifier_id='OAT'").run();
// Relinking within a set replaces the choice; one Clover option has one choice per set.
await link('milk-medium', 'whole', 'OAT', 'Oat milk');
assert.equal(await resolve('clover-medium', 'OAT'), 'opt-milk-medium-whole');
await link('milk-medium', 'oat', 'OAT', 'Oat milk');
assert.deepEqual(
  (await links.list(scope)).map((l) => [l.setId, l.choiceId, l.modifierId, l.modifierName]),
  [
    ['milk-large', 'oat', 'OAT', 'Oat milk'],
    ['milk-medium', 'oat', 'OAT', 'Oat milk'],
    ['syrups', 'vanilla', 'VAN', 'Vanilla'],
  ],
);
assert.deepEqual(await links.list({ ...scope, companyId: 'b' }), []);
// Two sets on one item linked to the same Clover option are ambiguous and held.
await link('syrups-2', 'vanilla', 'VAN', 'Vanilla');
now = '2026-04-03T00:00:00.000Z';
await attach('medium', ['milk-medium', 'syrups', 'syrups-2']);
assert.equal(await resolve('clover-medium', 'VAN'), 'unknown');
// A set the item carried before still matches, but the one it carries now wins.
now = '2026-04-04T00:00:00.000Z';
await attach('medium', ['milk-medium', 'syrups-2']);
assert.equal(await resolve('clover-medium', 'VAN'), 'opt-syrups-2-vanilla');
// An item that only carried the set in the past still resolves, for late sales.
now = '2026-04-05T00:00:00.000Z';
await attach('large', ['milk-large']);
assert.equal(await resolve('clover-large', 'VAN'), 'opt-syrups-vanilla');

// Refusals: an unknown set, a choice from elsewhere, a blank name, a removed set.
for (const [setId, choiceId, name] of [
  ['missing', 'oat', 'Oat'],
  ['milk-medium', 'soy', 'Soy'],
  ['milk-medium', 'oat', '  '],
])
  await assert.rejects(link(setId, choiceId, 'X', name));
await assert.rejects(
  links.link({
    ...scope,
    companyId: 'b',
    actor,
    setId: 'milk-medium',
    choiceId: 'oat',
    modifierId: 'X',
    modifierName: 'X',
  }),
  /existing option set/,
);
// Removing a set stops its links resolving, and it cannot be linked again.
now = '2026-04-06T00:00:00.000Z';
const removed = await options.removeSet({
  companyId,
  actor,
  setId: 'milk-large',
  expectedRevision: 1,
});
assert.ok(removed.applied.every((a) => a.status === 'applied'));
assert.equal(await resolve('clover-large', 'OAT'), 'unknown');
await assert.rejects(link('milk-large', 'whole', 'WHOLE'), /existing option set/);
// Unlinking stops resolution.
await links.unlink({ ...scope, setId: 'milk-medium', modifierId: 'OAT' });
assert.equal(await resolve('clover-medium', 'OAT'), 'unknown');

console.log('Clover option links passed.');
