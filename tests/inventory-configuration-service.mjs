import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
for (const [source, output] of [['inventory-configuration-service', 'configuration-service'],
  ['physical-count-service', 'configuration-count']]) {
  await build({entryPoints: [`src/lib/${source}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `.sites-runtime/${output}.mjs`});
}
const {InventoryConfigurationService} = await import('../.sites-runtime/configuration-service.mjs');
const {PhysicalCountService} = await import('../.sites-runtime/configuration-count.mjs');
class Statement {
  constructor(sql, query, values = []) { Object.assign(this, {sql, query, values}); }
  bind(...values) { return new Statement(this.sql, this.query, values); }
  async first() { return this.sql.prepare(this.query).get(...this.values) ?? null; }
  run() { return this.sql.prepare(this.query).run(...this.values); }
}
class Database {
  constructor(sql) { this.sql = sql; this.beforeBatch = null; }
  prepare(query) { return new Statement(this.sql, query); }
  async batch(statements) {
    await this.beforeBatch?.();
    this.sql.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(statement => statement.run()); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries) sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
const initial = '2026-01-01T00:00:00.000Z';
let now = '2026-02-01T00:00:00.000Z';
for (const company of ['a','b']) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, initial);
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(`owner-${company}`, company, 'owner');
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, 'milk', '{}');
}
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('employee', 'a', 'employee');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('manager', 'a', 'manager');
const db = new Database(sql);
const config = new InventoryConfigurationService(db, 'a', 'owner-a', () => now);
const count = new PhysicalCountService(db, 'a', 'owner-a', () => now);
const token = async (service = config) => (await service.inspect('milk')).token;
const rejected = (fn, code) => assert.rejects(fn, error => error.code === code);
const stock = () => sql.prepare("SELECT * FROM inventory_balances_exact WHERE company_id='a' AND product_id='milk'").get();
const auditCount = () => sql.prepare('SELECT count(*) AS n FROM security_audit').get().n;
const curated = (unitId, packAmount = '100') => ({unit: {kind: 'curated', unitId}, purchaseUnitLabel: 'bag', packAmount});

for (const [user, code] of [[null, 'unauthenticated'], ['owner-b', 'forbidden'], ['employee', 'forbidden']]) {
  const denied = new InventoryConfigurationService(db, 'a', user, () => now);
  await rejected(() => denied.inspect('milk'), code);
  await rejected(() => denied.activate('milk', curated('g'), '{}'), code);
}
await rejected(() => config.inspect('missing'), 'not_found');
const first = await config.activate('milk', curated('g'), await token());
assert.equal(first.dimension, 'mass');
assert.equal(stock().on_hand_minor, '0');
assert.equal(stock().latest_count_effective_at, null);
assert.equal(sql.prepare("SELECT purchase_quantity_minor FROM inventory_config_versions WHERE company_id='a' AND id=?").get(first.configId).purchase_quantity_minor, '100000000');
const sameTime = await token();
await rejected(() => config.activate('milk', curated('kg'), sameTime), 'incompatible_history');
now = '2026-02-02T00:00:00.000Z';
const changed = await config.activate('milk', curated('kg', '0.1'), await token());
assert.equal(changed.dimension, 'mass');
assert.equal(stock().on_hand_minor, '0');
assert.equal(stock().version, 1);
assert.equal(sql.prepare("SELECT status FROM inventory_config_versions WHERE company_id='a' AND id=?").get(first.configId).status, 'archived');

// An unused product may change dimensions, but a counted one cannot.
now = '2026-02-03T00:00:00.000Z';
const each = await config.activate('milk', curated('each', '10'), await token());
assert.equal(each.dimension, 'count');
assert.equal(stock().latest_count_effective_at, null);
now = '2026-02-04T00:00:00.000Z';
const opening = await count.record('milk', {unitId: 'each', unitVersion: 1, amount: '12', effectiveAt: now}, await token(count));
assert.equal(opening.opening, true);
assert.equal(stock().on_hand_minor, '12');
now = '2026-02-05T00:00:00.000Z';
await rejected(async () => config.activate('milk', curated('g'), await token()), 'incompatible_history');

// A new custom version freezes its old conversion and leaves canonical stock alone.
const custom = numerator => ({unit: {kind: 'custom', unitId: 'sleeve', label: 'sleeve',
  dimension: 'count', numerator, denominator: '1'}, purchaseUnitLabel: 'carton', packAmount: '2'});
const v1 = await config.activate('milk', custom('6'), await token());
assert.equal(stock().on_hand_minor, '12');
assert.equal(v1.unitVersion, 1);
now = '2026-02-06T00:00:00.000Z';
const v2 = await config.activate('milk', custom('8'), await token());
assert.equal(v2.unitVersion, 2);
assert.equal(stock().on_hand_minor, '12');
assert.equal(sql.prepare("SELECT purchase_quantity_minor FROM inventory_config_versions WHERE company_id='a' AND id=?").get(v2.configId).purchase_quantity_minor, '16');
assert.ok(sql.prepare("SELECT retired_at FROM product_unit_versions WHERE company_id='a' AND unit_id='sleeve' AND version=1").get().retired_at);

now = '2026-02-07T00:00:00.000Z';
const old = await token(), beforeFailure = auditCount();
sql.exec("CREATE TRIGGER fail_config BEFORE INSERT ON inventory_config_versions BEGIN SELECT RAISE(ABORT,'injected config failure'); END;");
await assert.rejects(() => config.activate('milk', curated('each'), old), /injected config failure/);
assert.equal(await token(), old); assert.equal(auditCount(), beforeFailure);
sql.exec('DROP TRIGGER fail_config');
const manager = new InventoryConfigurationService(db, 'a', 'manager', () => now);
const beforeRevoke = await token(manager), beforeRevokeAudit = auditCount();
db.beforeBatch = () => { db.beforeBatch = null; sql.exec("UPDATE memberships SET role='employee' WHERE user_id='manager'"); };
await rejected(() => manager.activate('milk', curated('each'), beforeRevoke), 'conflict');
assert.equal(auditCount(), beforeRevokeAudit);

const other = new InventoryConfigurationService(db, 'b', 'owner-b', () => now);
await other.activate('milk', curated('g'), await token(other));
assert.equal(stock().on_hand_minor, '12');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: classified configurations, safe unit versions, dimension gates, count integration, permissions and rollback (SQLite D1 harness).');
sql.close();
