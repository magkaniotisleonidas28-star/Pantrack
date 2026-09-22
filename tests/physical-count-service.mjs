import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
for (const [source, output] of [['physical-count-service', 'physical-count-service'],
  ['d1-inventory-consumption', 'count-consumption']]) {
  await build({entryPoints: [`src/lib/${source}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `.sites-runtime/${output}.mjs`});
}
const {PhysicalCountService} = await import('../.sites-runtime/physical-count-service.mjs');
const {D1InventoryConsumptionPort} = await import('../.sites-runtime/count-consumption.mjs');
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
let now = '2026-02-01T12:00:00.000Z';
for (const company of ['a', 'b']) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, initial);
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(`owner-${company}`, company, 'owner');
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, 'milk', '{}');
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
    VALUES (?,'milk','g',1,'curated','mass','g','1','1','owner',?)`).run(company, initial);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
    VALUES (?,'milk','config',1,'active','g',1,'bag',?,'owner',?)`).run(company, initial, initial);
  sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,'milk','config','mass','0','0','0',0,NULL,?)").run(company, initial);
  sql.prepare('INSERT INTO recipe_lineages VALUES (?, ?, ?, ?)').run(company, 'latte', `owner-${company}`, initial);
  sql.prepare("INSERT INTO recipe_versions VALUES (?,'latte','base',1,'active','Latte',?,NULL,0,'owner',?)").run(company, initial, initial);
  sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount)
    VALUES (?,'latte','base',0,'milk','g',1,'mass','1000000','1')`).run(company);
}
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('employee', 'a', 'employee');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('manager', 'a', 'manager');
const db = new Database(sql);
const service = new PhysicalCountService(db, 'a', 'owner-a', () => now);
const input = (amount, effectiveAt = now) => ({unitId: 'g', unitVersion: 1, amount, effectiveAt, note: 'Shelf count'});
const token = async (target = service, product = 'milk') => (await target.inspect(product)).token;
const rejected = (fn, code) => assert.rejects(fn, error => error.code === code);
const row = () => sql.prepare("SELECT * FROM inventory_balances_exact WHERE company_id='a' AND product_id='milk'").get();
const auditCount = () => sql.prepare('SELECT count(*) AS n FROM security_audit').get().n;

for (const [user, code] of [[null, 'unauthenticated'], ['owner-b', 'forbidden'], ['employee', 'forbidden']]) {
  const denied = new PhysicalCountService(db, 'a', user, () => now);
  await rejected(() => denied.inspect('milk'), code);
  await rejected(() => denied.record('milk', input('1'), '{}'), code);
}
await rejected(() => service.inspect('missing'), 'not_found');
const opening = await service.record('milk', input('12.5'), await token());
assert.equal(opening.opening, true);
assert.equal(opening.estimateBefore, null);
assert.equal(opening.variance, null);
assert.equal(row().on_hand_minor, '12500000');
assert.equal(row().latest_count_effective_at, now);
assert.equal(sql.prepare('SELECT opening,variance_minor FROM inventory_reconciliations WHERE id=?').get(opening.id).opening, 1);

now = '2026-02-02T12:00:00.000Z';
const correction = await service.record('milk', input('11'), await token());
assert.deepEqual(correction.estimateBefore, {dimension: 'mass', minor: '12500000'});
assert.deepEqual(correction.variance, {dimension: 'mass', minor: '-1500000'});
assert.equal(row().on_hand_minor, '11000000');
assert.equal(row().estimated_used_minor, '0');
assert.equal(sql.prepare('SELECT variance_minor FROM inventory_reconciliations WHERE id=?').get(correction.id).variance_minor, '-1500000');
assert.equal(sql.prepare('SELECT count(*) AS n FROM inventory_events_exact').get().n, 2);

const consumption = new D1InventoryConsumptionPort(db, 'a', 'owner-a', () => '2026-03-01T00:00:00.000Z');
const sale = (key, occurredAt) => ({contract: 'pantrack.inventory-consumption.v1', companyId: 'a',
  idempotencyKey: key, occurredAt, lines: [{lineId: 'line', recipeId: 'latte', quantity: '1', modifiers: []}]});
assert.equal((await consumption.consume(sale('at-cutoff', now))).issues[0].code, 'before_count_cutoff');
assert.equal((await consumption.consume(sale('after-cutoff', '2026-02-02T12:00:00.001Z'))).status, 'applied');
assert.equal(row().on_hand_minor, '10000000');
now = '2026-02-03T12:00:00.000Z';
await rejected(async () => service.record('milk', input('9', '2026-02-02T12:00:00.001Z'), await token()), 'invalid_history');
await rejected(async () => service.record('milk', input('9', '2026-02-04T00:00:00.000Z'), await token()), 'invalid_history');
await assert.rejects(async () => service.record('milk', input('-1'), await token()), error => error.code === 'invalid_quantity');
await rejected(async () => service.record('milk', {...input('1'), unitId: 'cup'}, await token()), 'unclassified');

const stale = await token();
const third = await service.record('milk', input('9'), stale);
await rejected(() => service.record('milk', input('8'), stale), 'conflict');
assert.equal(row().latest_count_effective_at, third.effectiveAt);
now = '2026-02-04T12:00:00.000Z';
const manager = new PhysicalCountService(db, 'a', 'manager', () => now);
const beforeRevoke = await token(manager), auditsBeforeRevoke = auditCount();
db.beforeBatch = () => { db.beforeBatch = null; sql.exec("UPDATE memberships SET role='employee' WHERE user_id='manager'"); };
await rejected(() => manager.record('milk', input('8'), beforeRevoke), 'conflict');
assert.equal(auditCount(), auditsBeforeRevoke);
sql.exec("UPDATE memberships SET role='manager' WHERE user_id='manager'");

// A sale that arrives during a count invalidates the count's read snapshot.
const beforeSale = await token();
db.beforeBatch = async () => { db.beforeBatch = null; await consumption.consume(sale('count-race', '2026-02-04T11:00:00.000Z')); };
await rejected(() => service.record('milk', input('8'), beforeSale), 'conflict');
assert.equal(row().on_hand_minor, '8000000');
const afterSale = await token(), beforeFailureAudit = auditCount();
sql.exec("CREATE TRIGGER fail_count BEFORE INSERT ON inventory_reconciliations BEGIN SELECT RAISE(ABORT,'injected count failure'); END;");
await assert.rejects(() => service.record('milk', input('8'), afterSale), /injected count failure/);
assert.equal(await token(), afterSale);
assert.equal(auditCount(), beforeFailureAudit);
sql.exec('DROP TRIGGER fail_count');

const other = new PhysicalCountService(db, 'b', 'owner-b', () => now);
// Confirmed incoming stock may be recorded before the first exact count.
sql.prepare("UPDATE inventory_balances_exact SET incoming_minor='5000000',version=1 WHERE company_id='b' AND product_id='milk'").run();
sql.prepare(`INSERT INTO inventory_events_exact
  (company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,
   balance_version_before,balance_version_after,effective_at,recorded_at,actor,note)
  VALUES ('b','incoming-before-opening','milk','config','incoming','mass','5000000','5','g',0,1,?,?,
    'owner-b','Confirmed delivery due')`).run(initial, initial);
sql.prepare(`INSERT INTO inventory_reconciliations
  (company_id,id,product_id,config_id,entered_amount,legacy_unit_label,effective_at,recorded_at,actor,note,opening)
  VALUES ('b','legacy-count','milk','config','7','old bag',?,?,'migration','',1)`).run(initial, initial);
const otherOpening = await other.record('milk', input('7'), await token(other));
assert.equal(otherOpening.opening, true, 'An unclassified legacy count is not a known exact estimate');
assert.equal(row().on_hand_minor, '8000000');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='b'").get().on_hand_minor, '7000000');
assert.equal(sql.prepare("SELECT incoming_minor FROM inventory_balances_exact WHERE company_id='b'").get().incoming_minor, '5000000');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: physical count cutoff, signed variance, exact quantities, role/company isolation, races and rollback (SQLite D1 harness).');
sql.close();
