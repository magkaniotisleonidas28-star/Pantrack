import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
await build({entryPoints: ['src/lib/d1-inventory-consumption-store.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.sites-runtime/inventory-store.mjs'});
const {D1InventoryConsumptionStore} = await import('../.sites-runtime/inventory-store.mjs');
class Statement {
  constructor(sql, query, values = []) { Object.assign(this, {sql, query, values}); }
  bind(...values) { return new Statement(this.sql, this.query, values); }
  async first() { return this.sql.prepare(this.query).get(...this.values) ?? null; }
  run() { return this.sql.prepare(this.query).run(...this.values); }
}
class Database {
  constructor(sql) { this.sql = sql; }
  prepare(query) { return new Statement(this.sql, query); }
  async batch(statements) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.run());
      this.sql.exec('COMMIT');
      return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries) {
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
}
const at = '2026-01-03T00:00:00.000Z';
const cutoff = '2026-01-01T00:00:00.000Z';
for (const company of ['a', 'b']) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, at);
  for (const product of ['milk', 'coffee']) {
    sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, product, '{}');
    sql.prepare(`INSERT INTO product_unit_versions
      (company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
      VALUES (?,?, 'g',1,'curated','mass','g','1','1','owner',?)`).run(company, product, at);
    sql.prepare(`INSERT INTO inventory_config_versions
      (company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
      VALUES (?,?,'config',1,'active','g',1,'bag',?,'owner',?)`).run(company, product, cutoff, at);
    sql.prepare(`INSERT INTO inventory_balances_exact VALUES (?,?,'config','mass','1000','0','0',1,?,?)`).run(company, product, cutoff, at);
  }
}
const db = new Database(sql);
const store = new D1InventoryConsumptionStore(db, 'a');
const other = new D1InventoryConsumptionStore(db, 'b');
async function plan(key, target = store) {
  const snapshots = await Promise.all(['milk', 'coffee'].map(product => target.balance(product)));
  const result = {
    contract: 'pantrack.inventory-consumption.v1', companyId: target === other ? 'b' : 'a',
    idempotencyKey: key, status: 'applied', replayed: false, occurredAt: '2026-01-02T00:00:00.000Z',
    selectedVersions: [{lineId: 'line', recipeId: 'latte', recipeVersionId: 'v1', quantity: '1', modifiers: []}],
    changes: snapshots.map(row => ({productId: row.productId, consumed: {dimension: 'mass', minor: '100'},
      balanceBefore: {dimension: 'mass', minor: row.onHandMinor},
      balanceAfter: {dimension: 'mass', minor: String(BigInt(row.onHandMinor) - 100n)},
      versionBefore: row.version, versionAfter: row.version + 1})),
  };
  return {result, snapshots};
}
const commit = (p, fingerprint = 'request-1', target = store) => target.commit(p.result, fingerprint, p.snapshots, 'owner', at);
const count = table => sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

const first = await plan('sale');
const duplicate = await Promise.all([commit(first), commit(first)]);
assert.deepEqual(duplicate.map(value => value.replayed).sort(), [false, true]);
assert.equal((await store.balance('milk')).onHandMinor, '900');
assert.equal((await store.balance('milk')).estimatedUsedMinor, '100');
assert.equal(count('inventory_events_exact'), 2);
assert.equal(count('inventory_consumption_applications'), 1);
assert.equal((await new D1InventoryConsumptionStore(db, 'a').application('sale', 'request-1')).replayed, true);
await assert.rejects(() => commit(first, 'different'), error => error.code === 'idempotency_conflict');
assert.equal(await other.application('sale', 'different'), null);
assert.equal((await other.balance('milk')).onHandMinor, '1000');
await assert.rejects(() => commit(first, 'request-1', other), error => error.code === 'company_mismatch');
await commit(await plan('sale', other), 'independent', other);

// The second ingredient changes after planning: the first update, audit and
// application must all roll back, leaving the key available for a fresh plan.
const stale = await plan('stale');
sql.prepare("UPDATE inventory_balances_exact SET version = version + 1 WHERE company_id = 'a' AND product_id = 'coffee'").run();
const eventsBefore = count('inventory_events_exact');
await assert.rejects(() => commit(stale), error => error.code === 'stale_balance');
assert.equal((await store.balance('milk')).onHandMinor, '900');
assert.equal(count('inventory_events_exact'), eventsBefore);
assert.equal(await store.application('stale', 'request-1'), null);
await commit(await plan('stale'));

// Competing distinct sales cannot overwrite each other's balance updates.
const left = await plan('left');
const right = await plan('right');
const race = await Promise.allSettled([commit(left), commit(right)]);
assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
assert.equal(race.find(row => row.status === 'rejected').reason.code, 'stale_balance');
await commit(await plan('right'));
assert.equal((await store.balance('milk')).onHandMinor, '600');

const changedCount = await plan('count-race');
sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at = ? WHERE company_id = 'a' AND product_id = 'coffee'").run(at);
await assert.rejects(() => commit(changedCount), error => error.code === 'stale_balance');
await assert.rejects(() => plan('old-sale').then(p => commit(p)), error => error.code === 'invalid_plan');
sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at = ? WHERE company_id = 'a'").run(cutoff);
const invalid = await plan('bad');
invalid.result.changes[0].balanceAfter.minor = '999';
await assert.rejects(() => commit(invalid), error => error.code === 'invalid_plan');
assert.equal(await store.application('bad', 'request-1'), null);

// Inject an unrelated database failure after a balance write: it must propagate
// and roll back, never be misreported as success or a duplicate.
sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON inventory_events_exact BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
const failed = await plan('failure');
await assert.rejects(() => commit(failed), /injected failure/);
assert.equal((await store.balance('milk')).onHandMinor, '600');
assert.equal(await store.application('failure', 'request-1'), null);
sql.exec('DROP TRIGGER fail_audit');
await commit(failed);

// Quantities beyond JavaScript's safe integer range must remain exact text.
sql.prepare("UPDATE inventory_balances_exact SET on_hand_minor = '9007199254740993' WHERE company_id = 'a'").run();
await commit(await plan('large'));
assert.equal((await store.balance('milk')).onHandMinor, '9007199254740893');
const overflow = await plan('overflow');
sql.prepare("UPDATE inventory_balances_exact SET estimated_used_minor = '9223372036854775807' WHERE company_id = 'a'").run();
await assert.rejects(() => commit(overflow), error => error.code === 'stale_balance');
await assert.rejects(() => plan('overflow').then(p => commit(p)), error => error.code === 'invalid_plan');
assert.equal(await store.application('overflow', 'request-1'), null);
sql.prepare("UPDATE inventory_balances_exact SET estimated_used_minor = '0' WHERE company_id = 'a'").run();

// The same key with different inputs has one winner, including concurrent calls.
const conflicting = await plan('conflicting');
const conflicts = await Promise.allSettled([commit(conflicting, 'one'), commit(conflicting, 'two')]);
assert.equal(conflicts.filter(row => row.status === 'fulfilled').length, 1);
assert.equal(conflicts.find(row => row.status === 'rejected').reason.code, 'idempotency_conflict');

// A fully offset recipe can have no deductions but must still claim its key.
const empty = await plan('empty');
empty.result.changes = [];
empty.snapshots = [];
const beforeEmpty = count('inventory_events_exact');
await commit(empty);
assert.equal((await commit(empty)).replayed, true);
assert.equal(count('inventory_events_exact'), beforeEmpty);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: inventory commits are atomic, durable across store instances, company-scoped, conflict-aware, and safe against duplicate/stale writes. SQLite-backed D1 batch harness only; no route integration.');
sql.close();
