import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
for (const [source, output] of [['recipe-version-service', 'recipe-lifecycle'], ['d1-inventory-consumption', 'recipe-consumption']]) {
  await build({entryPoints: [`src/lib/${source}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `.sites-runtime/${output}.mjs`});
}
const {RecipeVersionService} = await import('../.sites-runtime/recipe-lifecycle.mjs');
const {D1InventoryConsumptionPort} = await import('../.sites-runtime/recipe-consumption.mjs');
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
let now = '2026-02-01T00:00:00.000Z';
const cutoff = '2026-01-01T00:00:00.000Z';
for (const company of ['a', 'b']) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, cutoff);
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(`owner-${company}`, company, 'owner');
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, 'milk', '{}');
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
    VALUES (?,'milk','g',1,'curated','mass','g','1','1','owner',?)`).run(company, cutoff);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
    VALUES (?,'milk','config',1,'active','g',1,'bag',?,'owner',?)`).run(company, cutoff, cutoff);
  sql.prepare(`INSERT INTO inventory_balances_exact VALUES (?,'milk','config','mass','100000000','0','0',1,?,?)`).run(company, cutoff, cutoff);
}
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('employee', 'a', 'employee');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('manager', 'a', 'manager');
const db = new Database(sql);
const service = new RecipeVersionService(db, 'a', 'owner-a', () => now);
const token = async (recipe = 'latte', target = service) => (await target.inspect(recipe)).token;
const input = (amount = '1') => ({name: 'Latte', ingredients: [{productId: 'milk', unitId: 'g', unitVersion: 1, amount}]});
const save = async (draft, recipe = 'latte', target = service) => target.saveDraft(recipe, draft, await token(recipe, target));
const rows = () => sql.prepare("SELECT * FROM recipe_versions WHERE company_id='a' ORDER BY version").all();
const auditCount = () => sql.prepare('SELECT count(*) AS n FROM security_audit').get().n;
const rejected = (operation, code) => assert.rejects(operation, error => error.code === code);

// Authorization applies to both reads and writes; company/role comes from DB.
for (const [user, code] of [[null, 'unauthenticated'], ['owner-b', 'forbidden'], ['employee', 'forbidden']]) {
  const denied = new RecipeVersionService(db, 'a', user, () => now);
  await rejected(() => denied.inspect('latte'), code);
  await rejected(() => denied.saveDraft('latte', input(), '{}'), code);
  await rejected(() => denied.activate('latte', 'unknown', '{}'), code);
  await rejected(() => denied.archive('latte', 'unknown', '{}'), code);
}
assert.equal(auditCount(), 0);
const first = await save(input());
await save({...input('2'), id: first.id});
assert.equal(rows()[0].status, 'draft');
assert.equal(sql.prepare('SELECT quantity_minor FROM recipe_version_ingredients').get().quantity_minor, '2000000');
await service.activate('latte', first.id, await token());
const firstIngredients = sql.prepare('SELECT * FROM recipe_version_ingredients WHERE version_id=?').all(first.id);
await rejected(() => save({...input('3'), id: first.id}), 'immutable');
await rejected(async () => service.activate('latte', first.id, await token()), 'immutable');
const second = await save(input('3'));
await rejected(async () => service.activate('latte', second.id, await token()), 'invalid_history');
now = '2026-02-02T00:00:00.000Z';
await service.activate('latte', second.id, await token());
assert.deepEqual(rows().map(row => [row.status, row.active_from, row.active_to]), [
  ['archived', '2026-02-01T00:00:00.000Z', now], ['active', now, null],
]);
assert.deepEqual(sql.prepare('SELECT * FROM recipe_version_ingredients WHERE version_id=?').all(first.id), firstIngredients);
await rejected(() => save({...input(), id: first.id}), 'immutable');

// Real internal consumption port selects preserved versions on either side.
const consumption = new D1InventoryConsumptionPort(db, 'a', 'owner-a', () => '2026-02-10T00:00:00.000Z');
const sale = (key, occurredAt) => ({contract: 'pantrack.inventory-consumption.v1', companyId: 'a', idempotencyKey: key, occurredAt,
  lines: [{lineId: 'line', recipeId: 'latte', quantity: '1', modifiers: []}]});
const late = await consumption.consume(sale('late', '2026-02-01T12:00:00.000Z'));
assert.equal(late.selectedVersions[0].recipeVersionId, first.id);
assert.equal(late.changes[0].consumed.minor, '2000000');
assert.equal((await consumption.consume(sale('boundary', now))).selectedVersions[0].recipeVersionId, second.id);
now = '2026-02-03T00:00:00.000Z';
await service.archive('latte', second.id, await token());
assert.equal((await consumption.consume(sale('after-archive', now))).status, 'held');

// Stale editors cannot overwrite each other or published versions.
const draft = await save(input('4'));
const stale = await token();
await save({...input('5'), id: draft.id});
await rejected(() => service.saveDraft('latte', {...input('6'), id: draft.id}, stale), 'conflict');
const manager = new RecipeVersionService(db, 'a', 'manager', () => now);
await manager.saveDraft('latte', {...input('6'), id: draft.id}, await token('latte', manager));
const otherDraft = await save(input('7'));
now = '2026-02-04T00:00:00.000Z';
const sameSnapshot = await token();
const race = await Promise.allSettled([service.activate('latte', draft.id, sameSnapshot), service.activate('latte', otherDraft.id, sameSnapshot)]);
assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
assert.equal(race.find(result => result.status === 'rejected').reason.code, 'conflict');
assert.equal(rows().filter(row => row.status === 'active').length, 1);

// Late permission changes roll back the operation and its audit entry.
const priorAudit = auditCount();
const beforeRevoke = await token();
db.beforeBatch = () => { db.beforeBatch = null; sql.exec("UPDATE memberships SET role='employee' WHERE user_id='manager'"); };
await rejected(() => manager.saveDraft('latte', input(), beforeRevoke), 'conflict');
assert.equal(auditCount(), priorAudit);
sql.exec("UPDATE memberships SET role='manager' WHERE user_id='manager'");

// Fault during replacement leaves the prior draft and history intact.
const editable = await save(input('8'));
const beforeFailure = await token(), auditBeforeFailure = auditCount();
sql.exec("CREATE TRIGGER recipe_test_failure BEFORE INSERT ON recipe_version_ingredients BEGIN SELECT RAISE(ABORT,'injected recipe failure'); END;");
await assert.rejects(() => service.saveDraft('latte', {...input('9'), id: editable.id}, beforeFailure), /injected recipe failure/);
assert.equal(await token(), beforeFailure); assert.equal(auditCount(), auditBeforeFailure);
sql.exec('DROP TRIGGER recipe_test_failure');

// Unit and quantity validation, and classified units cannot change mid-save.
await assert.rejects(() => save(input('-1')));
await assert.rejects(() => save(input('0')));
await assert.rejects(() => save(input('1.0000001')));
await rejected(() => save({...input(), ingredients: [{...input().ingredients[0], productId: 'foreign-product'}]}), 'invalid_input');
const beforeUnits = await token();
db.beforeBatch = () => { db.beforeBatch = null; sql.exec("UPDATE product_unit_versions SET kind='legacy_unclassified' WHERE company_id='a'"); };
await rejected(() => service.saveDraft('latte', input(), beforeUnits), 'conflict');
await rejected(() => save(input()), 'invalid_input');
sql.exec("UPDATE product_unit_versions SET kind='curated' WHERE company_id='a'");

// A sale already applied at this exact instant cannot be reinterpreted by activation.
const pending = await save(input('9'));
now = '2026-02-05T00:00:00.000Z';
await consumption.consume(sale('same-instant', now));
await rejected(async () => service.activate('latte', pending.id, await token()), 'invalid_history');
now = '2026-02-05T00:00:00.001Z';
await service.activate('latte', pending.id, await token());

// An activation failure must restore the previously active version too.
const replacement = await save(input('10'));
now = '2026-02-06T00:00:00.000Z';
const beforeActivation = await token(), beforeActivationAudit = auditCount();
sql.exec("CREATE TRIGGER fail_recipe_activation BEFORE UPDATE OF status ON recipe_versions WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'activation failure'); END;");
await assert.rejects(() => service.activate('latte', replacement.id, beforeActivation), /activation failure/);
assert.equal(await token(), beforeActivation);
assert.equal(auditCount(), beforeActivationAudit);
sql.exec('DROP TRIGGER fail_recipe_activation');

// A completed sale landing after the read fences activation as a conflict.
db.beforeBatch = async () => { db.beforeBatch = null; await consumption.consume(sale('activation-race', now)); };
await rejected(() => service.activate('latte', replacement.id, beforeActivation), 'conflict');
await rejected(async () => service.activate('latte', replacement.id, await token()), 'invalid_history');
now = '2026-02-06T00:00:00.001Z';
await service.activate('latte', replacement.id, await token());

// Same IDs in another company are independent.
const other = new RecipeVersionService(db, 'b', 'owner-b', () => now);
await save(input(), 'latte', other);
assert.equal(sql.prepare("SELECT count(*) AS n FROM recipe_versions WHERE company_id='b'").get().n, 1);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: recipe drafts, exact quantities, immutable sale-time history, atomic activation/archive, permissions, races and rollback (SQLite D1 harness; no route cutover).');
sql.close();
