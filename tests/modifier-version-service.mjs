import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
for (const [source, output] of [['modifier-version-service', 'modifier-lifecycle'], ['d1-inventory-consumption', 'modifier-consumption']]) {
  await build({entryPoints: [`src/lib/${source}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `.sites-runtime/${output}.mjs`});
}
const {ModifierVersionService} = await import('../.sites-runtime/modifier-lifecycle.mjs');
const {D1InventoryConsumptionPort} = await import('../.sites-runtime/modifier-consumption.mjs');
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
const cutoff = '2026-01-01T00:00:00.000Z';
let now = '2026-02-01T00:00:00.000Z';
for (const company of ['a', 'b']) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, cutoff);
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(`owner-${company}`, company, 'owner');
  for (const product of ['milk', 'oat', 'coffee']) {
    sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, product, '{}');
    sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
      VALUES (?,?,'g',1,'curated','mass','g','1','1','owner',?)`).run(company, product, cutoff);
    sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
      VALUES (?,?,'config',1,'active','g',1,'bag',?,'owner',?)`).run(company, product, cutoff, cutoff);
    sql.prepare(`INSERT INTO inventory_balances_exact VALUES (?,?,'config','mass','100000000','0','0',1,?,?)`).run(company, product, cutoff, cutoff);
  }
  sql.prepare('INSERT INTO recipe_lineages VALUES (?, ?, ?, ?)').run(company, 'latte', `owner-${company}`, cutoff);
  sql.prepare("INSERT INTO recipe_versions VALUES (?,'latte','base',1,'active','Latte',?,NULL,0,'owner',?)").run(company, cutoff, cutoff);
  sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount)
    VALUES (?,'latte','base',0,'milk','g',1,'mass','2000000','2')`).run(company);
}
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('employee', 'a', 'employee');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('manager', 'a', 'manager');
const db = new Database(sql);
const service = new ModifierVersionService(db, 'a', 'owner-a', () => now);
const token = async (target = service, modifierId = 'swap') => (await target.inspect('latte', modifierId)).token;
const delta = (productId, amount) => ({productId, unitId: 'g', unitVersion: 1, amount});
const input = (milk = '-2', oat = '2') => ({name: 'Oat swap', deltas: [delta('milk', milk), delta('oat', oat)]});
const save = async (draft, target = service, modifierId = 'swap') => target.saveDraft('latte', modifierId, draft, await token(target, modifierId));
const rejected = (operation, code) => assert.rejects(operation, error => error.code === code);
const versions = () => sql.prepare("SELECT * FROM recipe_modifier_versions WHERE company_id='a' AND modifier_id='swap' ORDER BY version").all();
const auditCount = () => sql.prepare('SELECT count(*) AS n FROM security_audit').get().n;

for (const [user, code] of [[null, 'unauthenticated'], ['owner-b', 'forbidden'], ['employee', 'forbidden']]) {
  const denied = new ModifierVersionService(db, 'a', user, () => now);
  await rejected(() => denied.inspect('latte', 'swap'), code);
  await rejected(() => denied.saveDraft('latte', 'swap', input(), '{}'), code);
  await rejected(() => denied.activate('latte', 'swap', 'none', '{}'), code);
  await rejected(() => denied.archive('latte', 'swap', 'none', '{}'), code);
}
await rejected(async () => service.saveDraft('missing-recipe', 'swap', input(),
  (await service.inspect('missing-recipe', 'swap')).token), 'not_found');
const first = await save(input());
await save({...input('-2', '3'), id: first.id});
assert.equal(sql.prepare("SELECT quantity_minor FROM recipe_modifier_deltas WHERE product_id='milk'").get().quantity_minor, '-2000000');
assert.equal(sql.prepare("SELECT quantity_minor FROM recipe_modifier_deltas WHERE product_id='oat'").get().quantity_minor, '3000000');
await service.activate('latte', 'swap', first.id, await token());
const firstDeltas = sql.prepare('SELECT * FROM recipe_modifier_deltas WHERE version_id=? ORDER BY position').all(first.id);
await rejected(() => save({...input(), id: first.id}), 'immutable');
await rejected(async () => service.activate('latte', 'swap', first.id, await token()), 'immutable');
await rejected(() => save({...input(), name: 'Different name'}), 'immutable');

// Preserve the first published swap; a later version can change the quantities.
const second = await save(input('-2', '2'));
await rejected(async () => service.activate('latte', 'swap', second.id, await token()), 'invalid_history');
now = '2026-02-02T00:00:00.000Z';
await service.activate('latte', 'swap', second.id, await token());
assert.deepEqual(versions().map(row => [row.status, row.active_from, row.active_to]), [
  ['archived', '2026-02-01T00:00:00.000Z', now], ['active', now, null],
]);
assert.deepEqual(sql.prepare('SELECT * FROM recipe_modifier_deltas WHERE version_id=? ORDER BY position').all(first.id), firstDeltas);

const consumption = new D1InventoryConsumptionPort(db, 'a', 'owner-a', () => '2026-03-01T00:00:00.000Z');
const sale = (key, occurredAt, modifierId = 'swap') => ({contract: 'pantrack.inventory-consumption.v1', companyId: 'a',
  idempotencyKey: key, occurredAt, lines: [{lineId: 'line', recipeId: 'latte', quantity: '1', modifiers: [{modifierId, quantity: '1'}]}]});
const oldSale = await consumption.consume(sale('old', '2026-02-01T12:00:00.000Z'));
assert.equal(oldSale.status, 'applied');
assert.equal(oldSale.selectedVersions[0].modifiers[0].modifierVersionId, first.id);
assert.deepEqual(oldSale.changes.map(change => [change.productId, change.consumed.minor]), [['oat', '3000000']]);
const newSale = await consumption.consume(sale('new', now));
assert.equal(newSale.status, 'applied');
assert.equal(newSale.selectedVersions[0].modifiers[0].modifierVersionId, second.id);
assert.equal(newSale.changes[0].consumed.minor, '2000000');

now = '2026-02-03T00:00:00.000Z';
await service.archive('latte', 'swap', second.id, await token());
assert.equal((await consumption.consume(sale('after', now))).status, 'held');

// Large negative deltas are saved as drafts but cannot consume negative stock.
const negative = await save(input('-9', '2'));
now = '2026-02-04T00:00:00.000Z';
await service.activate('latte', 'swap', negative.id, await token());
const held = await consumption.consume(sale('negative', now));
assert.equal(held.status, 'held');
assert.ok(held.issues.some(issue => issue.code === 'negative_modifier_result'));
await rejected(() => save(input('0', '2')), 'invalid_input');
await assert.rejects(() => save(input('-1.0000001', '2')));
await rejected(async () => service.saveDraft('latte', 'swap', {...input(), deltas: [delta('ghost', '1')]}, await token()), 'invalid_input');

// Two editors cannot publish different versions from the same snapshot.
const third = await save(input());
const fourth = await save(input());
now = '2026-02-05T00:00:00.000Z';
const raceToken = await token();
const race = await Promise.allSettled([
  service.activate('latte', 'swap', third.id, raceToken),
  service.activate('latte', 'swap', fourth.id, raceToken),
]);
assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
assert.equal(race.find(result => result.status === 'rejected').reason.code, 'conflict');
assert.equal(versions().filter(version => version.status === 'active').length, 1);

// A lost manager permission, unit change, or later ingredient error rolls back
// both the modification and its audit entry.
const manager = new ModifierVersionService(db, 'a', 'manager', () => now);
const beforeRevoke = await token(manager), priorAudit = auditCount();
db.beforeBatch = () => { db.beforeBatch = null; sql.exec("UPDATE memberships SET role='employee' WHERE user_id='manager'"); };
await rejected(() => manager.saveDraft('latte', 'swap', input(), beforeRevoke), 'conflict');
assert.equal(auditCount(), priorAudit);
sql.exec("UPDATE memberships SET role='manager' WHERE user_id='manager'");
const editable = await save(input());
const beforeFailure = await token(), auditBeforeFailure = auditCount();
sql.exec("CREATE TRIGGER fail_modifier_delta BEFORE INSERT ON recipe_modifier_deltas BEGIN SELECT RAISE(ABORT,'injected delta failure'); END;");
await assert.rejects(() => service.saveDraft('latte', 'swap', {...input('-2','4'), id: editable.id}, beforeFailure), /injected delta failure/);
assert.equal(await token(), beforeFailure); assert.equal(auditCount(), auditBeforeFailure);
sql.exec('DROP TRIGGER fail_modifier_delta');
const beforeUnits = await token();
db.beforeBatch = () => { db.beforeBatch = null; sql.exec("UPDATE product_unit_versions SET kind='legacy_unclassified' WHERE company_id='a' AND product_id='oat'"); };
await rejected(() => service.saveDraft('latte', 'swap', input(), beforeUnits), 'conflict');
await rejected(() => save(input()), 'invalid_input');
sql.exec("UPDATE product_unit_versions SET kind='curated' WHERE company_id='a' AND product_id='oat'");

// A sale of this modifier at the activation instant cannot be reinterpreted.
const pending = await save(input());
now = '2026-02-06T00:00:00.000Z';
await consumption.consume(sale('at-activation', now));
await rejected(async () => service.activate('latte', 'swap', pending.id, await token()), 'invalid_history');
now = '2026-02-06T00:00:00.001Z';
await service.activate('latte', 'swap', pending.id, await token());

// A failure after archiving the old active modifier restores it and its audit.
const replacement = await save(input());
now = '2026-02-07T00:00:00.000Z';
const beforeActivation = await token(), beforeActivationAudit = auditCount();
sql.exec("CREATE TRIGGER fail_modifier_activation BEFORE UPDATE OF status ON recipe_modifier_versions WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'injected activation failure'); END;");
await assert.rejects(() => service.activate('latte', 'swap', replacement.id, beforeActivation), /injected activation failure/);
assert.equal(await token(), beforeActivation); assert.equal(auditCount(), beforeActivationAudit);
sql.exec('DROP TRIGGER fail_modifier_activation');

// A sale completed between read and write invalidates the whole activation.
db.beforeBatch = async () => { db.beforeBatch = null; await consumption.consume(sale('modifier-activation-race', now)); };
await rejected(() => service.activate('latte', 'swap', replacement.id, beforeActivation), 'conflict');
await rejected(async () => service.activate('latte', 'swap', replacement.id, await token()), 'invalid_history');
now = '2026-02-07T00:00:00.001Z';
await service.activate('latte', 'swap', replacement.id, await token());

// A pure extra adds an ingredient without replacing the base recipe amount.
const shot = await save({name: 'Extra shot', deltas: [delta('coffee', '0.5')]}, service, 'shot');
await service.activate('latte', 'shot', shot.id, await token(service, 'shot'));
const extraSale = await consumption.consume(sale('extra-shot', '2026-02-07T00:00:00.002Z', 'shot'));
assert.equal(extraSale.status, 'applied');
assert.deepEqual(Object.fromEntries(extraSale.changes.map(change => [change.productId, change.consumed.minor])),
  {coffee: '500000', milk: '2000000'});

// Activation requires a currently reviewed base recipe, even if an older
// modifier version is available.
const needsBase = await save(input());
now = '2026-02-08T00:00:00.000Z';
sql.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id='a' AND id='base'").run(now);
await rejected(async () => service.activate('latte', 'swap', needsBase.id, await token()), 'invalid_history');

// Both company and base recipe are required, even for the same modifier ID.
const other = new ModifierVersionService(db, 'b', 'owner-b', () => now);
await rejected(async () => other.saveDraft('missing-recipe', 'swap', input(), (await other.inspect('missing-recipe','swap')).token), 'not_found');
await save(input(), other);
assert.equal(sql.prepare("SELECT count(*) AS n FROM recipe_modifier_versions WHERE company_id='b'").get().n, 1);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: modifier drafts, signed substitutions, immutable sale-time selection, activation, holds, tenant permissions, races and rollback (SQLite D1 harness).');
sql.close();
