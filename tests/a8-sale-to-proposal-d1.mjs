import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

const entries = {
  consumption: 'src/lib/d1-inventory-consumption.ts',
  settings: 'src/lib/d1-replenishment-settings.ts',
  origins: 'src/lib/d1-replenishment-proposal-origins.ts',
  lifecycle: 'src/lib/d1-replenishment-lifecycle.ts',
};
await build({entryPoints: entries, bundle: true, platform: 'node', format: 'esm',
  outdir: '.sites-runtime/a8-sale-to-proposal'});
const {D1InventoryConsumptionPort} = await import('../.sites-runtime/a8-sale-to-proposal/consumption.js');
const {D1ReplenishmentSettingsStore} = await import('../.sites-runtime/a8-sale-to-proposal/settings.js');
const {D1ReplenishmentProposalOrigins} = await import('../.sites-runtime/a8-sale-to-proposal/origins.js');
const {D1ReplenishmentLifecycle} = await import('../.sites-runtime/a8-sale-to-proposal/lifecycle.js');

class Statement {
  constructor(database, query, values = []) { this.database = database; this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.database, this.query, values); }
  async first() { return this.database.sql.prepare(this.query).get(...this.values) ?? null; }
  async all() { return {success: true, results: this.database.sql.prepare(this.query).all(...this.values), meta: {changes: 0}}; }
  runSync() {
    const result = this.database.sql.prepare(this.query).run(...this.values);
    return {success: true, results: [], meta: {changes: Number(result.changes)}};
  }
  async run() { return this.runSync(); }
}
class LocalD1 {
  constructor(sql) { this.sql = sql; }
  prepare(query) { return new Statement(this, query); }
  async batch(statements) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.runSync());
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
for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries) {
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
}
const db = new LocalD1(sql);
const countAt = '2026-09-25T04:22:00.000Z';
const now = '2026-09-26T12:00:00.000Z';
const clock = {now: () => new Date(now)};
const companyId = 'fictional-b7';
for (const id of [companyId, 'other-company']) {
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(id, id, countAt);
}

// B7's documented fictional opening counts and latte ingredients. This is a
// local reproduction, not a read of the hosted B7 company or Clover.
for (const product of [
  {id: 'milk', dimension: 'volume', onHand: '15141647136', pack: '15141647136'},
  {id: 'espresso', dimension: 'mass', onHand: '2267961850', pack: '2267961850'},
  {id: 'cup', dimension: 'count', onHand: '1000', pack: '1000'},
]) {
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)')
    .run(companyId, product.id, JSON.stringify({name: product.id}));
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,
    dimension,label,numerator,denominator,created_by,created_at,retired_at)
    VALUES (?,?,'stock',1,'curated',?,'stock','1','1','fictional-manager',?,NULL)`)
    .run(companyId, product.id, product.dimension, countAt);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,
    stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,
    legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
    VALUES (?,?,?,1,'active','stock',1,'case',?,NULL,?,NULL,'fictional-manager',?)`)
    .run(companyId, product.id, `config-${product.id}`, product.pack, countAt, countAt);
  sql.prepare(`INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,
    on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at)
    VALUES (?,?,?,?,?,'0','0',1,?,?)`)
    .run(companyId, product.id, `config-${product.id}`, product.dimension, product.onHand, countAt, countAt);
}
sql.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)')
  .run(companyId, 'latte', 'fictional-manager', countAt);
sql.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,
  active_from,active_to,legacy,created_by,created_at)
  VALUES (?,'latte','latte-v1',1,'draft','Fictional latte',NULL,NULL,0,'fictional-manager',?)`)
  .run(companyId, countAt);
for (const [position, ingredient] of [
  {id: 'milk', dimension: 'volume', minor: '200000000'},
  {id: 'espresso', dimension: 'mass', minor: '18000000'},
  {id: 'cup', dimension: 'count', minor: '1'},
].entries()) {
  sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,
    product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label)
    VALUES (?,'latte','latte-v1',?,?,'stock',1,?,?,?,'stock',NULL)`)
    .run(companyId, position, ingredient.id, ingredient.dimension, ingredient.minor, ingredient.minor);
}
sql.prepare(`UPDATE recipe_versions SET status='active',active_from=?
  WHERE company_id=? AND recipe_id='latte' AND id='latte-v1'`)
  .run('2026-09-25T04:24:47.198Z', companyId);

const actor = {companyId, userId: 'fictional-manager', role: 'manager'};
const q = minor => ({dimension: 'volume', minor});
await new D1ReplenishmentSettingsStore(db, {clock}).save({
  companyId, productId: 'milk', changeId: 'settings-1', expectedVersion: 0,
  expectedConfigId: 'config-milk', expectedConfigVersion: 1, actor,
  reason: 'Fictional milk target for local A8 check',
  settings: {target: q('30200000000'), capacity: null, dailyUse: q('1000000'),
    shelfDays: null, countEveryDays: 7, minimumPacks: '0', orderMultiplePacks: '1', maximumPacks: '5'},
});
const common = {
  companyId, productId: 'milk', actor,
  sales: {companyId, source: 'fictional_fixture', status: 'current', heldEventCount: 0},
  supplier: {companyId, source: 'fictional_fixture', mappingId: 'fake-mapping', mappingVersion: 1,
    supplierId: 'fake-supplier', accountId: 'fake-account', locationId: 'fake-location', sku: 'MILK-CASE'},
  priceEstimate: {companyId, source: 'fictional_fixture', currency: 'USD', perPackMinor: '1000'},
};
const origins = new D1ReplenishmentProposalOrigins(db, {clock});
const lifecycle = new D1ReplenishmentLifecycle(db, {clock});
const first = await origins.create({...common, id: 'before-sale', createId: 'create-before-sale'});
assert.equal(first.snapshot.explanation.recommendedPacks, '1');
assert.equal(first.snapshot.quantities.onHand.minor, '15141647136');
assert.equal(first.snapshot.estimatedLineTotal.minor, '1000');
assert.equal((await lifecycle.get(companyId, first.id, actor)).handoff.supplierSubmissionAllowed, false);
await assert.rejects(origins.create({...common, actor: {...actor, companyId: 'other-company'},
  id: 'wrong-company', createId: 'wrong-company'}), error => error?.code === 'forbidden');

// The sale occurred before the review, but its inventory application arrives
// afterward. A stale proposal must not survive that delayed consumption.
const sale = {contract: 'pantrack.inventory-consumption.v1', companyId,
  idempotencyKey: 'fictional-b7-latte', occurredAt: '2026-09-26T11:00:00.000Z',
  lines: [{lineId: 'latte-line', recipeId: 'latte', quantity: '1', modifiers: []}]};
let eventNumber = 0;
const consumption = new D1InventoryConsumptionPort(db, {clock,
  idFactory: () => `a8-event-${++eventNumber}`});
const applied = await consumption.consume(sale);
assert.equal(applied.status, 'applied');
assert.deepEqual(applied.changes.map(change => [change.productId, change.consumed.minor]),
  [['cup', '1'], ['espresso', '18000000'], ['milk', '200000000']]);
const replay = await consumption.consume(sale);
assert.equal(replay.status, 'applied');
assert.equal(replay.replayed, true);
assert.equal(sql.prepare(`SELECT on_hand_minor FROM inventory_balances_exact
  WHERE company_id=? AND product_id='milk'`).get(companyId).on_hand_minor, '14941647136');
assert.equal(sql.prepare(`SELECT on_hand_minor FROM inventory_balances_exact
  WHERE company_id=? AND product_id='espresso'`).get(companyId).on_hand_minor, '2249961850');
assert.equal(sql.prepare(`SELECT on_hand_minor FROM inventory_balances_exact
  WHERE company_id=? AND product_id='cup'`).get(companyId).on_hand_minor, '999');
assert.equal(sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n, 1);

const stale = await lifecycle.get(companyId, first.id, actor);
assert.equal(stale.invalidationReason, 'inventory_changed');
assert.equal(stale.events.filter(event => event.kind === 'invalidate').length, 1);
assert.equal((await lifecycle.get(companyId, first.id, actor)).revision, stale.revision);
await assert.rejects(lifecycle.edit({companyId, proposalId: first.id, expectedRevision: stale.revision,
  changeId: 'stale-edit', actor, packs: '2', reason: 'Outdated stock after sale'}),
  error => error?.code === 'conflict');
await assert.rejects(origins.create({...common, id: 'blocked', createId: 'blocked'}),
  error => error?.code === 'quantity_reserved');
await lifecycle.cancel({companyId, proposalId: first.id, expectedRevision: stale.revision,
  changeId: 'cancel-stale', actor, reason: 'Recalculate after recorded sale'});

const contenders = await Promise.allSettled([
  origins.create({...common, id: 'after-sale-a', createId: 'create-after-a'}),
  origins.create({...common, id: 'after-sale-b', createId: 'create-after-b'}),
]);
const winners = contenders.filter(result => result.status === 'fulfilled');
const losers = contenders.filter(result => result.status === 'rejected');
assert.equal(winners.length, 1, 'Only one proposal may reserve the revised quantity.');
assert.equal(losers.length, 1);
assert.equal(losers[0].reason.code, 'quantity_reserved');
const refreshed = winners[0].value;
assert.equal(refreshed.snapshot.quantities.onHand.minor, '14941647136');
assert.equal(refreshed.snapshot.explanation.recommendedPacks, '2');
assert.equal(refreshed.snapshot.estimatedLineTotal.minor, '2000');
assert.equal((await lifecycle.get(companyId, refreshed.id, actor)).handoff.supplierSubmissionAllowed, false);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
sql.close();
console.log('PASS: B7-shaped local sale applies once, invalidates an old proposal, and reserves one refreshed review-only quantity.');
