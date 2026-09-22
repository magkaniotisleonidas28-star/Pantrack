import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
await build({entryPoints: ['src/lib/d1-inventory-consumption.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.sites-runtime/inventory-service.mjs'});
const {D1InventoryConsumptionPort} = await import('../.sites-runtime/inventory-service.mjs');
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
    this.beforeBatch?.();
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.run());
      this.sql.exec('COMMIT');
      return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const now = '2026-03-01T00:00:00.000Z';
const cutoff = '2026-01-01T00:00:00.000Z';
const boundary = '2026-02-01T00:00:00.000Z';
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries) sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
  for (const company of ['a', 'b']) {
    sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, now);
    for (const product of ['milk', 'coffee']) {
      sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, product, '{}');
      sql.prepare(`INSERT INTO product_unit_versions
        (company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
        VALUES (?,?,'g',1,'curated','mass','g','1','1','owner',?)`).run(company, product, now);
      sql.prepare(`INSERT INTO inventory_config_versions
        (company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
        VALUES (?,?,'config',1,'active','g',1,'bag',?,'owner',?)`).run(company, product, cutoff, now);
      sql.prepare(`INSERT INTO inventory_balances_exact VALUES (?,?,'config','mass','10000','0','0',1,?,?)`).run(company, product, cutoff, now);
    }
    sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run(company, 'latte', 'owner', cutoff);
    for (const [id, number, status, from, to, quantity] of [
      ['old', 1, 'archived', cutoff, boundary, '100'], ['new', 2, 'active', boundary, null, '200'],
      ['draft', 3, 'draft', null, null, '999'],
    ]) {
      sql.prepare(`INSERT INTO recipe_versions VALUES (?, 'latte', ?,?,?, 'Latte',?,?,0,'owner',?)`).run(company, id, number, status, from, to, now);
      sql.prepare(`INSERT INTO recipe_version_ingredients
        (company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount)
        VALUES (?,'latte',?,0,'milk','g',1,'mass',?,'1')`).run(company, id, quantity);
    }
    sql.prepare(`INSERT INTO recipe_modifier_lineages VALUES (?,'latte','shot','Shot','owner',?)`).run(company, cutoff);
    sql.prepare(`INSERT INTO recipe_modifier_versions VALUES (?,'latte','shot','shot-v1',1,'active',?,NULL,'owner',?)`).run(company, cutoff, now);
    sql.prepare(`INSERT INTO recipe_modifier_deltas VALUES (?,'latte','shot','shot-v1',0,'coffee','g',1,'mass','50','1','g')`).run(company);
  }
  const db = new Database(sql);
  const port = new D1InventoryConsumptionPort(db, 'a', 'owner-a', () => now);
  const balance = (product = 'milk', company = 'a') => sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id = ? AND product_id = ?').get(company, product).on_hand_minor;
  const count = () => sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications').get().n;
  return {sql, db, port, balance, count};
}
const request = (key, occurredAt = boundary, modifiers = []) => ({
  contract: 'pantrack.inventory-consumption.v1', companyId: 'a', idempotencyKey: key, occurredAt,
  lines: [{lineId: 'line', recipeId: 'latte', quantity: '2', modifiers}],
});
const codes = result => result.issues.map(issue => issue.code);

{
  const {sql, db, port, balance} = setup();
  const old = await port.consume(request('late', '2026-01-20T00:00:00Z'));
  assert.equal(old.status, 'applied');
  assert.equal(old.selectedVersions[0].recipeVersionId, 'old');
  assert.equal(balance(), '9800');
  const current = await port.consume(request('boundary', boundary, [{modifierId: 'shot', quantity: '3'}]));
  assert.equal(current.selectedVersions[0].recipeVersionId, 'new');
  assert.equal(balance(), '9400');
  assert.equal(balance('coffee'), '9850', 'Modifier count is total occurrences, not multiplied again by line count');
  assert.equal(balance('milk', 'b'), '10000');
  // Saved receipts win over later counts and unavailable recipes on a retry.
  sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at = ? WHERE company_id = 'a'").run(now);
  sql.exec("UPDATE recipe_versions SET legacy = 1 WHERE company_id = 'a'");
  const restarted = new D1InventoryConsumptionPort(db, 'a', 'owner-a', () => now);
  assert.deepEqual(await restarted.consume(request('late', '2026-01-19T19:00:00-05:00')), {...old, replayed: true});
  const conflict = request('late', '2026-01-20T00:00:00Z');
  conflict.lines[0].quantity = '3';
  assert.deepEqual(codes(await restarted.consume(conflict)), ['idempotency_conflict']);
  sql.close();
}
{
  const {sql, db, port, balance, count} = setup();
  const duplicates = await Promise.all([port.consume(request('duplicate')), port.consume(request('duplicate'))]);
  assert.deepEqual(duplicates.map(result => result.replayed).sort(), [false, true]);
  const sales = await Promise.all([port.consume(request('one')), port.consume(request('two'))]);
  assert.ok(sales.every(result => result.status === 'applied'));
  assert.equal(balance(), '8800');
  assert.equal(count(), 3);
  const wrong = request('wrong'); wrong.companyId = 'b';
  assert.deepEqual(codes(await port.consume(wrong)), ['invalid_request']);
  const other = new D1InventoryConsumptionPort(db, 'b', 'owner-b', () => now);
  assert.equal((await other.consume({...request('duplicate'), companyId: 'b'})).replayed, false);
  assert.equal(balance('milk', 'b'), '9600');
  sql.close();
}
{
  const {sql, port, balance, count} = setup();
  assert.deepEqual(codes(await port.consume(request('cutoff', cutoff))), ['before_count_cutoff']);
  assert.deepEqual(codes(await port.consume(request('future', '2027-01-01T00:00:00Z'))), ['invalid_occurrence_time']);
  assert.deepEqual(codes(await port.consume(request('bad-date', '2026-02-30T00:00:00Z'))), ['invalid_occurrence_time']);
  const malformed = request('malformed'); malformed.lines = [null];
  assert.deepEqual(codes(await port.consume(malformed)), ['invalid_request']);
  const missing = request('missing'); missing.lines[0].recipeId = 'unknown';
  assert.deepEqual(codes(await port.consume(missing)), ['recipe_version_not_found']);
  assert.deepEqual(codes(await port.consume(request('modifier', boundary, [{modifierId: 'unknown', quantity: '1'}]))), ['modifier_version_not_found']);
  sql.exec("UPDATE recipe_versions SET legacy = 1 WHERE id = 'new' AND company_id = 'a'");
  assert.deepEqual(codes(await port.consume(request('legacy'))), ['recipe_version_not_found']);
  sql.exec("UPDATE recipe_versions SET legacy = 0 WHERE company_id = 'a'");
  sql.exec("UPDATE product_unit_versions SET kind = 'legacy_unclassified' WHERE company_id = 'a' AND product_id = 'coffee'");
  assert.ok(codes(await port.consume(request('repair', boundary, [{modifierId: 'shot', quantity: '1'}]))).includes('unit_unclassified'));
  assert.equal(balance(), '10000'); assert.equal(count(), 0);
  sql.exec("UPDATE product_unit_versions SET kind = 'curated' WHERE company_id = 'a'");
  assert.equal((await port.consume(request('repair', boundary, [{modifierId: 'shot', quantity: '1'}]))).status, 'applied');
  sql.close();
}
{
  const {sql, db, port, balance, count} = setup();
  // A changed ingredient between read and commit must invalidate the entire plan.
  db.beforeBatch = () => {
    db.beforeBatch = null;
    sql.exec("UPDATE recipe_version_ingredients SET quantity_minor = '300' WHERE company_id = 'a' AND version_id = 'new'");
  };
  const result = await port.consume(request('recipe-race'));
  assert.equal(result.status, 'applied'); assert.equal(balance(), '9400'); assert.equal(count(), 1);
  db.beforeBatch = () => {
    db.beforeBatch = null;
    sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at = ? WHERE company_id = 'a'").run(now);
  };
  assert.deepEqual(codes(await port.consume(request('count-race'))), ['before_count_cutoff']);
  assert.equal(balance(), '9400'); assert.equal(count(), 1);
  sql.close();
}
{
  const {sql, db, port, balance, count} = setup();
  // A modifier can completely offset a recipe. Even then the recipe snapshot
  // must be fenced, rather than saving a receipt for an outdated zero result.
  sql.exec("UPDATE recipe_modifier_deltas SET product_id = 'milk', quantity_minor = '-400' WHERE company_id = 'a'");
  const zero = request('zero', boundary, [{modifierId: 'shot', quantity: '1'}]);
  assert.equal((await port.consume(zero)).changes.length, 0);
  assert.equal(balance(), '10000');
  db.beforeBatch = () => {
    db.beforeBatch = null;
    sql.exec("UPDATE recipe_version_ingredients SET quantity_minor = '300' WHERE company_id = 'a' AND version_id = 'new'");
  };
  const raced = {...zero, idempotencyKey: 'zero-race'};
  assert.equal((await port.consume(raced)).changes[0].consumed.minor, '200');
  assert.equal(balance(), '9800'); assert.equal(count(), 2);
  sql.exec("UPDATE recipe_modifier_deltas SET quantity_minor = '-900' WHERE company_id = 'a'");
  assert.deepEqual(codes(await port.consume({...zero, idempotencyKey: 'negative'})), ['negative_modifier_result']);
  assert.equal(balance(), '9800');
  sql.close();
}
{
  const {sql, db, port, balance, count} = setup();
  // A configuration classification change during planning blocks every write.
  db.beforeBatch = () => {
    db.beforeBatch = null;
    sql.exec("UPDATE product_unit_versions SET kind = 'legacy_unclassified' WHERE company_id = 'a'");
  };
  assert.ok(codes(await port.consume(request('unit-race'))).includes('unit_unclassified'));
  assert.equal(balance(), '10000'); assert.equal(count(), 0);
  sql.exec("UPDATE product_unit_versions SET kind = 'curated' WHERE company_id = 'a'");
  sql.exec("UPDATE inventory_balances_exact SET latest_count_effective_at = NULL WHERE company_id = 'a'");
  assert.deepEqual(codes(await port.consume(request('uncounted'))), ['opening_count_required']);
  sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at = ? WHERE company_id = 'a'").run(cutoff);
  sql.exec("UPDATE recipe_version_ingredients SET dimension = 'volume' WHERE company_id = 'a' AND version_id = 'new'");
  assert.ok(codes(await port.consume(request('dimension'))).includes('unit_incompatible'));
  assert.equal(balance(), '10000'); assert.equal(count(), 0);
  sql.exec("UPDATE recipe_versions SET status = 'unknown' WHERE company_id = 'a' AND id = 'new'");
  await assert.rejects(() => port.consume(request('corrupt-version')), /version status is invalid/);
  assert.equal(count(), 0);
  sql.close();
}
{
  const {sql, db, port, count} = setup();
  let attempts = 0;
  db.beforeBatch = () => {
    attempts++;
    sql.exec("UPDATE inventory_balances_exact SET version = version + 1 WHERE company_id = 'a'");
  };
  await assert.rejects(() => port.consume(request('busy')), error => error.code === 'stale_balance');
  assert.equal(attempts, 3); assert.equal(count(), 0);
  db.beforeBatch = null;
  assert.equal((await port.consume(request('busy'))).status, 'applied');
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  sql.close();
}
console.log('PASS: persisted recipe selection, modifiers, company isolation, review holds, durable replay and fenced whole-sale retries (SQLite D1 harness; no API cutover).');
