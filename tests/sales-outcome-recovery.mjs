import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive: true});
globalThis.testEnv = {
 CLOVER_ENVIRONMENT: 'sandbox', CLOVER_CLIENT_ID: 'fixture-app', CLOVER_CLIENT_SECRET: 'fixture-secret',
 VENDOR_ENCRYPTION_KEY: btoa('a'.repeat(32)), PANTRACK_CLOVER_SYNC_ENABLED: 'enabled',
};
const plugin = {name: 'local-mocks', setup(builder) {
 builder.onResolve({filter: /^cloudflare:workers$|^@\/db\/raw$/}, args => ({path: args.path, namespace: 'mock'}));
 builder.onLoad({filter: /.*/, namespace: 'mock'}, args => ({contents: args.path === 'cloudflare:workers'
  ? 'export const env=globalThis.testEnv' : 'export function database(){return globalThis.testDB}'}));
}};
for (const [name, path] of [
 ['sync', 'src/lib/clover-sync.ts'], ['crypto', 'src/lib/vendor-adapter.ts'],
 ['runtime', 'src/lib/d1-sales-runtime.ts'], ['service', 'src/lib/sales-ingestion.ts'],
 ['inventory', 'src/lib/d1-inventory-consumption.ts'], ['store', 'src/lib/d1-sales-event-store.ts'],
 ['corrections', 'src/lib/d1-sales-corrections.ts'],
]) await build({entryPoints: [path], bundle: true, platform: 'node', format: 'esm',
 outfile: `.sites-runtime/bug02-${name}.mjs`, plugins: [plugin]});
const {syncClover} = await import('../.sites-runtime/bug02-sync.mjs');
const {encrypt} = await import('../.sites-runtime/bug02-crypto.mjs');
const {D1SalesMappingPort} = await import('../.sites-runtime/bug02-runtime.mjs');
const {SalesIngestionService} = await import('../.sites-runtime/bug02-service.mjs');
const {D1InventoryConsumptionPort} = await import('../.sites-runtime/bug02-inventory.mjs');
const {D1SalesEventStore} = await import('../.sites-runtime/bug02-store.mjs');
const {D1SalesCorrectionService} = await import('../.sites-runtime/bug02-corrections.mjs');
const consumptionContract = 'pantrack.inventory-consumption.v1', recoveryContract = 'pantrack.inventory-consumption-recovery.v1';

class Statement {
 constructor(db, query, values = []) {Object.assign(this, {db, query, values});}
 bind(...values) {return new Statement(this.db, this.query, values);}
 async first() {
  if (this.db.beforeRead) await this.db.beforeRead(this);
  return this.db.sql.prepare(this.query).get(...this.values) ?? null;
 }
 async all() {return {results: this.db.sql.prepare(this.query).all(...this.values)};}
 runSync() {
  const statement = this.db.sql.prepare(this.query);
  if (/^\s*SELECT\b/i.test(this.query)) return {results: statement.all(...this.values), meta: {changes: 0}};
  return {results: [], meta: {changes: Number(statement.run(...this.values).changes)}};
 }
 async run() {return this.runSync();}
}
class Database {
 constructor(sql) {this.sql = sql;}
 prepare(query) {return new Statement(this, query);}
 async batch(statements) {
  // Deferred race gates belong before the transaction, never inside it.
  if (this.beforeBatch) await this.beforeBatch(statements);
  this.sql.exec('BEGIN IMMEDIATE');
  let results;
  try {
   results = statements.map(statement => statement.runSync());
   this.sql.exec('COMMIT');
  } catch (error) {this.sql.exec('ROLLBACK'); throw error;}
  const acknowledgment = results.map(({results}) => ({results})); // D1 acknowledgment metadata is optional.
  return this.afterBatch ? this.afterBatch(statements, acknowledgment) : acknowledgment;
 }
}
const now = Date.now(), cutoff = new Date(now - 600_000).toISOString(), started = now - 300_000;
async function fixture({beforeUpgrade = false} = {}) {
 const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
 const entries = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
 for (const entry of beforeUpgrade ? entries.slice(0, -1) : entries)
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
 const db = new Database(sql); globalThis.testDB = db;
 for (const id of ['a', 'b']) sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(id, id, cutoff);
 sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a', 'cup', '{}');
 sql.prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)')
  .run('a', 'cup', 'canonical', 1, 'curated', 'count', 'canonical', '1', '1', 'fixture', cutoff);
 sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,
  stock_unit_version,purchase_unit_label,purchase_quantity_minor,effective_from,created_by,created_at)
  VALUES ('a','cup','active',1,'active','canonical',1,'unit','1',?,'fixture',?)`).run(cutoff, cutoff);
 sql.prepare("INSERT INTO inventory_balances_exact VALUES ('a','cup','active','count','10','0','0',1,?,?)").run(cutoff, cutoff);
 sql.prepare("INSERT INTO inventory VALUES ('a','cup',?,1)").run(JSON.stringify({productId: 'cup', settings: {unit: 'canonical'},
  onHand: 10, incoming: 0, estimatedUsed: 0, lastCount: cutoff, updated: cutoff, version: 1}));
 sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run('a', 'drink', 'fixture', cutoff);
 sql.prepare("INSERT INTO recipe_versions VALUES ('a','drink','drink-v1',1,'draft','Drink',NULL,NULL,0,'fixture',?)").run(cutoff);
 sql.prepare(`INSERT INTO recipe_version_ingredients VALUES ('a','drink','drink-v1',0,'cup','canonical',1,'count','1','1','canonical',NULL)`).run();
 sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='a' AND recipe_id='drink'").run(cutoff);
 sql.prepare("INSERT INTO clover_item_mappings VALUES ('a','sandbox','merchant','item','drink')").run();
 const token = {access_token: 'fixture-access', refresh_token: 'fixture-refresh',
  access_token_expiration: Math.floor(now / 1000) + 3600, refresh_token_expiration: Math.floor(now / 1000) + 86400};
 sql.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)')
  .run('a', 'merchant', 'sandbox', await encrypt(JSON.stringify(token), 'clover:a'), cutoff, null);
 sql.prepare(`INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until)
  VALUES ('a','sandbox','merchant',?,?,0)`).run(started, started);
 const line = id => ({id, item: {id: 'item'}, modifications: {elements: []}});
 const order = {id: 'order', createdTime: now - 240_000, modifiedTime: now - 190_000, total: 500,
  paymentState: 'PAID', payments: {elements: [{id: 'payment', createdTime: now - 200_000}]},
  lineItems: {elements: [line('original')]}};
 globalThis.fetch = async url => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/orders')) return Response.json({elements:
   u.searchParams.getAll('filter').some(value => value.startsWith('deletedTime')) ? [] : [{id: order.id, modifiedTime: order.modifiedTime}]});
  if (u.pathname.endsWith('/orders/order')) return Response.json(order);
  throw new Error('Unexpected mocked provider request.');
 };
 const stock = () => sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id='cup'").get().on_hand_minor;
 const events = () => sql.prepare(`SELECT e.event_key,e.application_key,e.revision,s.state,s.last_reason
  FROM sales_events e JOIN sales_event_states s USING (company_id,event_key) WHERE e.company_id='a' ORDER BY e.revision`).all();
 const finish = () => {
  const projection = JSON.parse(sql.prepare("SELECT data FROM inventory WHERE company_id='a' AND product_id='cup'").get().data);
  assert.equal(projection.onHand, Number(stock())); assert.equal(projection.estimatedUsed, 10 - Number(stock()));
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []); sql.close();
 };
 const upgrade = () => sql.exec(readFileSync(`drizzle/${entries.at(-1).tag}.sql`, 'utf8'));
 return {sql, db, order, line, stock, events, finish, upgrade};
}

const source = {kind: 'native', provider: 'clover', environment: 'sandbox', connectionId: 'fixture', merchantId: 'merchant', locationId: 'default'};
const context = {companyId: 'a', source, actor: {kind: 'machine', machineId: 'fixture', companyId: 'a', source}};
const manager = {kind: 'user', userId: 'manager', companyId: 'a', role: 'manager'};
function draft(revision, ids = ['original'], extra = {}) {
 return {schemaVersion: 'pantrack.sales.v1', externalEventId: `revision-${revision}`, externalOrderId: 'order', revision,
  eventType: 'sale', orderStatus: 'completed', preparationStatus: 'fulfilled', occurredAt: new Date(now - 200_000).toISOString(),
  timeQuality: 'provider', lines: ids.map(externalLineId => ({externalLineId, externalItemId: 'item', quantity: '1', modifiers: []})), ...extra};
}
function services(h, options = {}) {
 let clockNow = now;
 const clock = {now: () => new Date(clockNow)};
 const store = new D1SalesEventStore(h.db);
 const port = new D1InventoryConsumptionPort(h.db, {clock});
 const inventory = options.legacyWorker ? {consume: request => port.consume(request), reconcile: request => port.reconcile(request)} : port;
 const service = new SalesIngestionService(store, new D1SalesMappingPort(h.db), options.inventory ?? inventory, {clock, afterInventoryApply: options.afterInventoryApply});
 return {store, port, service, expire: () => {clockNow += 360_000;}};
}
function deferred() {let resolve; const promise = new Promise(accept => {resolve = accept;}); return {promise, resolve};}
function failPostcommit(h) {
 let reads = 0;
 h.db.beforeRead = statement => {
  if (/SELECT request_fingerprint,result_json FROM inventory_consumption_applications/.test(statement.query) && ++reads === 2)
   throw new Error('Injected postcommit result-read failure.');
 };
 return () => {assert.equal(reads, 2); h.db.beforeRead = null;};
}
const movements = h => h.sql.prepare("SELECT COUNT(*) AS n FROM inventory_events_exact WHERE action='sale_consumption'").get().n;

// The second matching lookup is the fallible read AFTER the atomic stock commit.
{
 const h = await fixture(); let reads = 0;
 h.db.beforeRead = statement => {
  if (/SELECT request_fingerprint,result_json FROM inventory_consumption_applications/.test(statement.query) && ++reads === 2)
   throw new Error('Injected postcommit result-read failure.');
 };
 await assert.rejects(() => syncClover('a'), /could not be applied/);
 assert.equal(reads, 2); assert.equal(h.stock(), '9');
 assert.equal(h.events()[0].state, 'failed'); assert.equal(h.events()[0].last_reason, 'inventory_unavailable');
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM inventory_consumption_applications').get().n, 1);
 h.db.beforeRead = null;
 h.order.modifiedTime += 1000; h.order.lineItems.elements.push(h.line('additional'));
 await syncClover('a');
 assert.equal(h.stock(), '8', 'Lost result followed by a newer revision consumes only the additional cup.');
 const applications = h.sql.prepare('SELECT result_json FROM inventory_consumption_applications ORDER BY applied_at,idempotency_key').all();
 assert.deepEqual(applications.map(row => JSON.parse(row.result_json).selectedVersions.length), [1, 1]);
 assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM inventory_events_exact WHERE action='sale_consumption'").get().n, 2);
 await syncClover('a'); assert.equal(h.stock(), '8', 'Repeated scan cannot consume again.');
 h.finish();
}
// Receipt-time and claim-time supersession both wait for authoritative evidence.
{
 const h = await fixture(), s = services(h), clearFault = failPostcommit(h);
 const first = await s.service.receive(context, draft(1));
 await s.service.process('a', first.eventKey); clearFault();
 const failedResult = h.sql.prepare('SELECT * FROM sales_event_attempt_results WHERE event_key=?').get(first.eventKey);
 const next = await s.service.receive(context, draft(2, ['original', 'additional']));
 assert.equal(await s.store.state('a', first.eventKey), 'failed', 'Receipt cannot supersede an unresolved failed predecessor.');
 const at = new Date(now).toISOString();
 assert.equal(await s.store.claim('a', next.eventKey, {attemptId: 'unsafe-claim', eventKey: next.eventKey,
  startedAt: at, leaseExpiresAt: new Date(now + 300_000).toISOString()}, at), false, 'Claim cannot bypass outcome reconciliation.');
 assert.equal(await s.store.state('a', first.eventKey), 'failed');
 await s.service.process('a', next.eventKey); assert.equal(h.stock(), '8');
 assert.equal(await s.store.state('a', first.eventKey), 'applied');
 assert.deepEqual(h.sql.prepare('SELECT * FROM sales_event_attempt_results WHERE event_key=?').get(first.eventKey), failedResult,
  'Reconciliation appends evidence without rewriting the original failed reply.');
 const corrections = new D1SalesCorrectionService(h.db);
 const correctionReview = await corrections.request('a', first.eventKey, {userId: 'manager', email: 'fixture@example.test', role: 'manager'}, 'Review recovered sale');
 assert.deepEqual(correctionReview.items.map(item => [item.productId, item.suggestedMinor]), [['cup', '1']]);
 assert.equal(h.stock(), '8', 'Opening a correction review does not repair stock.');
 const third = await s.service.receive(context, draft(3, ['original', 'additional', 'third']));
 await s.service.process('a', third.eventKey); assert.equal(h.stock(), '7'); assert.equal(movements(h), 3);
 const correction = await s.service.receive(context, draft(4, ['original', 'third']));
 assert.equal((await s.service.process('a', correction.eventKey)).state, 'held');
 assert.equal(h.events().at(-1).last_reason, 'correction_required'); assert.equal(h.stock(), '7');
 for (const [revision, eventType, orderStatus] of [[5, 'refund', 'refunded'], [6, 'cancellation', 'canceled']]) {
  const receipt = await s.service.receive(context, draft(revision, ['original', 'additional', 'third'], {eventType, orderStatus}));
  assert.equal((await s.service.process('a', receipt.eventKey)).state, 'applied'); assert.equal(h.stock(), '7');
 }
 assert.equal(await s.store.latestAppliedConsumption('b', (await s.store.event('a', third.eventKey)).lineageKey, 10), null);
 h.finish();
}

// Same-key confirmation uses the saved mapping/version, even if today's mapping
// disappeared and the inventory cutoff advanced after the actual application.
{
 const h = await fixture(), s = services(h), clearFault = failPostcommit(h);
 const first = await s.service.receive(context, draft(1));
 await s.service.process('a', first.eventKey); clearFault();
 const saved = h.sql.prepare('SELECT result_json FROM inventory_consumption_applications').get().result_json;
 h.sql.prepare('DELETE FROM clover_item_mappings').run();
 h.sql.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id='a'").run(new Date(now - 100_000).toISOString());
 h.sql.prepare("UPDATE inventory_balances_exact SET latest_count_effective_at=? WHERE company_id='a'").run(new Date(now - 150_000).toISOString());
 await s.service.retry('a', first.eventKey, manager, 'Confirm original save');
 assert.equal((await s.service.process('a', first.eventKey)).state, 'applied');
 assert.equal(h.stock(), '9'); assert.equal(movements(h), 1);
 assert.equal(h.sql.prepare('SELECT result_json FROM inventory_consumption_applications').get().result_json, saved);
 const recovered = JSON.parse(h.sql.prepare('SELECT inventory_result_json FROM sales_event_inventory_outcomes').get().inventory_result_json);
 assert.equal(recovered.selectedVersions[0].recipeId, 'drink'); assert.equal(recovered.selectedVersions[0].recipeVersionId, 'drink-v1');
 const next = await s.service.receive(context, draft(2, ['original', 'additional']));
 assert.equal((await s.service.process('a', next.eventKey)).state, 'held'); assert.equal(h.events().at(-1).last_reason, 'unknown_item');
 h.sql.prepare("INSERT INTO clover_item_mappings VALUES ('a','sandbox','merchant','item','drink')").run();
 await s.service.replay('a', next.eventKey, manager, 'Mapping reviewed');
 assert.equal((await s.service.process('a', next.eventKey)).state, 'held'); assert.equal(h.events().at(-1).last_reason, 'before_count_cutoff');
 assert.equal(h.stock(), '9'); h.finish();
}

// No commit: fencing the old attempt permits a same-key retry with a new token.
{
 const h = await fixture(), s = services(h);
 h.db.beforeBatch = statements => {
  if (statements.some(statement => /INSERT OR IGNORE INTO inventory_consumption_applications/.test(statement.query))) {
   h.db.beforeBatch = null; throw new Error('Injected before-commit failure.');
  }
 };
 const first = await s.service.receive(context, draft(1));
 assert.equal((await s.service.process('a', first.eventKey)).state, 'failed'); assert.equal(h.stock(), '10');
 await s.service.retry('a', first.eventKey, manager, 'Retry after local outage');
 assert.equal((await s.service.process('a', first.eventKey)).state, 'applied'); assert.equal(h.stock(), '9');
 assert.equal(movements(h), 1);
 assert.equal(h.sql.prepare('SELECT status FROM sales_event_inventory_outcomes').get().status, 'not_applied');
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM inventory_consumption_applications').get().n, 1);
 h.finish();
}

// Expired old workers, including pre-extension workers without a token, cannot
// commit after recovery. Exercise both resumption orders so balance CAS alone
// cannot hide the missing fence. Every gate is BEFORE BEGIN IMMEDIATE.
for (const legacyWorker of [false, true]) for (const resumeBeforeNewCommit of [false, true]) for (const arrivalBeforeRecovery of [false, true]) {
 const h = await fixture(), s = services(h, {legacyWorker}), reached = deferred(), resume = deferred();
 h.db.beforeBatch = async statements => {
  if (statements.some(statement => /INSERT OR IGNORE INTO inventory_consumption_applications/.test(statement.query))) {
   h.db.beforeBatch = null; reached.resolve(); await resume.promise;
  }
 };
 const first = await s.service.receive(context, draft(1));
 const oldWorker = s.service.process('a', first.eventKey);
 const oldFailure = assert.rejects(oldWorker, /no longer owns|missing, complete/);
 await reached.promise; assert.equal(h.stock(), '10');
 assert.deepEqual(await s.service.recoverExpiredLeases('a'), [], 'An unexpired lease cannot be stolen.');
 s.expire();
 let next;
 if (arrivalBeforeRecovery) {
  next = await s.service.receive(context, draft(2, ['original', 'additional']));
  await assert.rejects(() => s.service.process('a', next.eventKey), error => error.code === 'claim_conflict');
 }
 const recoveries = await Promise.all([s.service.recoverExpiredLeases('a'), s.service.recoverExpiredLeases('a')]);
 assert.deepEqual(recoveries.flat(), [first.eventKey]); assert.equal(h.stock(), '10');
 assert.equal(h.sql.prepare('SELECT status FROM sales_event_inventory_outcomes').get().status, 'not_applied');
 if (!arrivalBeforeRecovery) next = await s.service.receive(context, draft(2, ['original', 'additional']));
 if (resumeBeforeNewCommit) {resume.resolve(); await oldFailure; assert.equal(h.stock(), '10');}
 assert.equal((await s.service.process('a', next.eventKey)).state, 'applied'); assert.equal(h.stock(), '8');
 if (!resumeBeforeNewCommit) {resume.resolve(); await oldFailure;}
 assert.equal(h.stock(), '8'); assert.equal(movements(h), 1);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM inventory_consumption_applications').get().n, 1);
 assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM sales_event_audits WHERE action='lease_expired'").get().n, 1);
 assert.deepEqual(await s.service.recoverExpiredLeases('a'), []);
 h.finish();
}

// The old worker may also resume with an already committed result after recovery
// and the newer revision completed. Its stale terminal write must lose the lease.
{
 const h = await fixture(), reached = deferred(), resume = deferred();
 const s = services(h, {afterInventoryApply: async () => {reached.resolve(); await resume.promise;}});
 const first = await s.service.receive(context, draft(1));
 const oldWorker = s.service.process('a', first.eventKey), oldFailure = assert.rejects(oldWorker, /no longer owns/);
 await reached.promise; assert.equal(h.stock(), '9'); s.expire();
 assert.deepEqual(await s.service.recoverExpiredLeases('a'), [first.eventKey]);
 const fresh = services(h), next = await fresh.service.receive(context, draft(2, ['original', 'additional']));
 await fresh.service.process('a', next.eventKey); assert.equal(h.stock(), '8');
 resume.resolve(); await oldFailure; assert.equal(h.stock(), '8'); assert.equal(movements(h), 2);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM sales_event_attempt_results WHERE event_key=?').get(first.eventKey).n, 1);
 h.finish();
}

// More than one successive revision may lose its postcommit result. Each new
// baseline still represents the complete already-consumed order snapshot.
{
 const h = await fixture(), s = services(h);
 for (const [revision, ids, expected] of [[1, ['original'], '9'], [2, ['original', 'additional'], '8']]) {
  const clearFault = failPostcommit(h), receipt = await s.service.receive(context, draft(revision, ids));
  assert.equal((await s.service.process('a', receipt.eventKey)).state, 'failed'); clearFault(); assert.equal(h.stock(), expected);
 }
 const third = await s.service.receive(context, draft(3, ['original', 'additional', 'third']));
 await s.service.process('a', third.eventKey); assert.equal(h.stock(), '7'); assert.equal(movements(h), 3);
 assert.deepEqual(h.sql.prepare('SELECT result_json FROM inventory_consumption_applications').all()
  .map(row => JSON.parse(row.result_json).selectedVersions.length), [1, 1, 1]);
 h.finish();
}

// Crash AFTER commit: recovery confirms consumption; later revisions use its
// snapshot without consuming under a new application identity.
{
 const h = await fixture(), s = services(h, {afterInventoryApply: () => {throw new Error('Injected worker termination.');}});
 const first = await s.service.receive(context, draft(1));
 await assert.rejects(() => s.service.process('a', first.eventKey), /worker termination/);
 assert.equal(h.stock(), '9'); assert.equal(await s.store.state('a', first.eventKey), 'processing');
 s.expire();
 assert.deepEqual(await s.service.recoverExpiredLeases('b'), []);
 assert.deepEqual(await s.service.recoverExpiredLeases('a', {source: {...source, provider: 'other'}}), []);
 const recovered = await Promise.all([s.service.recoverExpiredLeases('a', {limit: 1}), s.service.recoverExpiredLeases('a', {limit: 1})]);
 assert.deepEqual(recovered.flat(), [first.eventKey]); assert.equal(await s.store.state('a', first.eventKey), 'applied');
 const fresh = services(h), next = await fresh.service.receive(context, draft(2, ['original', 'additional']));
 await fresh.service.process('a', next.eventKey); assert.equal(h.stock(), '8'); assert.equal(movements(h), 2);
 await assert.rejects(() => fresh.service.recoverExpiredLeases('a', {limit: 0}), error => error.code === 'invalid_recovery');
 h.finish();
}
// A's recovery producer proves absence only after fencing and isolates companies.
{
 const h = await fixture(), {port} = services(h);
 const sale = {contract: consumptionContract, companyId: 'a', idempotencyKey: 'producer-key',
  occurredAt: new Date(now - 200_000).toISOString(), lines: [{lineId: 'original', recipeId: 'drink', quantity: '1', modifiers: []}]};
 const recovery = {contract: recoveryContract, companyId: 'a', idempotencyKey: sale.idempotencyKey, attemptId: 'old'};
 assert.deepEqual(await port.reconcile(recovery), {...recovery, status: 'not_applied'});
 assert.equal(h.stock(), '10');
 await assert.rejects(() => port.consume(sale, {attemptId: 'old'}), /inventory_attempt_fenced/);
 await assert.rejects(() => port.consume(sale), /inventory_attempt_fenced/, 'A worker without the extension is also fenced.');
 const applied = await port.consume(sale, {attemptId: 'new'}); assert.equal(applied.status, 'applied'); assert.equal(h.stock(), '9');
 const original = h.sql.prepare('SELECT result_json FROM inventory_consumption_applications').get().result_json;
 const result = await port.reconcile(recovery); assert.equal(result.status, 'applied');
 assert.deepEqual(result.application, {...applied, replayed: true});
 assert.equal('_attemptId' in result.application, false); assert.equal('_claimToken' in result.application, false);
 const foreign = await port.reconcile({...recovery, companyId: 'b'}); assert.equal(foreign.status, 'not_applied'); assert.equal(h.stock(), '9');
 assert.equal((await port.consume(sale, {attemptId: 'old'})).replayed, true, 'A fenced worker may confirm an existing result, but cannot write.');
 const changed = await port.consume({...sale, lines: [{...sale.lines[0], quantity: '2'}]}, {attemptId: 'newer'});
 assert.equal(changed.status, 'rejected'); assert.equal(changed.issues[0].code, 'idempotency_conflict');
 assert.equal(h.sql.prepare('SELECT result_json FROM inventory_consumption_applications').get().result_json, original);
 const fences = h.sql.prepare('SELECT * FROM inventory_consumption_fences ORDER BY company_id,attempt_id').all();
 assert.throws(() => h.sql.prepare("UPDATE inventory_consumption_fences SET attempt_id='bypass'").run(), /immutable/);
 assert.throws(() => h.sql.prepare('DELETE FROM inventory_consumption_fences').run(), /immutable/);
 h.sql.prepare("INSERT OR REPLACE INTO inventory_consumption_fences VALUES ('a','producer-key','old','rewritten')").run();
 assert.deepEqual(h.sql.prepare('SELECT * FROM inventory_consumption_fences ORDER BY company_id,attempt_id').all(), fences);
 assert.equal(movements(h), 1); h.finish();
}

// A read or reply failure remains unresolved. No missing row, mismatched reply,
// or failed evidence write authorizes supersession or additional consumption.
for (const failure of ['recovery_read', 'outcome_write', 'company', 'application', 'attempt', 'occurrence', 'line', 'unsupported_port']) {
 const h = await fixture(), real = services(h), clearFault = failPostcommit(h);
 const first = await real.service.receive(context, draft(1)); await real.service.process('a', first.eventKey); clearFault();
 const next = await real.service.receive(context, draft(2, ['original', 'additional']));
 let service = real.service;
 if (failure === 'recovery_read' || failure === 'outcome_write') {
  h.db.beforeBatch = statements => {
   if (statements.some(statement => statement.query.includes(failure === 'recovery_read'
     ? 'INSERT OR IGNORE INTO inventory_consumption_fences' : 'INSERT OR IGNORE INTO sales_event_inventory_outcomes'))) {
    h.db.beforeBatch = null; throw new Error('Injected recovery outage.');
   }
  };
 } else {
  const inventory = {consume: (...args) => real.port.consume(...args)};
  if (failure !== 'unsupported_port') inventory.reconcile = async request => {
   const reply = await real.port.reconcile(request);
   if (failure === 'company') reply.companyId = 'b';
   if (failure === 'application') reply.idempotencyKey = 'other';
   if (failure === 'attempt') reply.attemptId = 'other';
   if (failure === 'occurrence') reply.application.occurredAt = cutoff;
   if (failure === 'line') reply.application.selectedVersions[0].lineId = 'not-in-original';
   return reply;
  };
  service = services(h, {inventory}).service;
 }
 await assert.rejects(() => service.process('a', next.eventKey));
 assert.equal(await real.store.state('a', first.eventKey), 'failed'); assert.equal(await real.store.state('a', next.eventKey), 'received');
 assert.equal(h.stock(), '9'); assert.equal(movements(h), 1);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM sales_event_inventory_outcomes').get().n, 0);
 assert.equal((await real.service.process('a', next.eventKey)).state, 'applied'); assert.equal(h.stock(), '8');
 h.finish();
}

// A missing fence receipt cannot masquerade as a safely absent application.
{
 const h = await fixture(), {port} = services(h);
 h.db.afterBatch = (statements, results) => {
  if (statements.some(statement => statement.query.includes('INSERT OR IGNORE INTO inventory_consumption_fences'))) {
   h.db.afterBatch = null; results[1] = {results: []};
  }
  return results;
 };
 const request = {contract: recoveryContract, companyId: 'a', idempotencyKey: 'unacknowledged', attemptId: 'old'};
 await assert.rejects(() => port.reconcile(request), /fence\/read was not acknowledged/);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM inventory_consumption_fences').get().n, 1);
 assert.equal((await port.reconcile(request)).status, 'not_applied'); assert.equal(h.stock(), '10'); h.finish();
}

// Expired processing stays locked when the reconciliation acknowledgment is
// lost AFTER its fence commits. A later recovery safely confirms the same fence.
{
 const h = await fixture(), real = services(h), first = await real.service.receive(context, draft(1));
 const at = new Date(now).toISOString();
 await real.store.claim('a', first.eventKey, {attemptId: 'expired', eventKey: first.eventKey, startedAt: at,
  leaseExpiresAt: new Date(now + 300_000).toISOString()}, at);
 real.expire();
 const inventory = {consume: (...args) => real.port.consume(...args), reconcile: async request => {
  await real.port.reconcile(request); throw new Error('Lost fenced-read acknowledgment.');
 }};
 const broken = services(h, {inventory}); broken.expire();
 await assert.rejects(() => broken.service.recoverExpiredLeases('a'), /acknowledgment/);
 assert.equal(await real.store.state('a', first.eventKey), 'processing'); assert.equal(h.stock(), '10');
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM inventory_consumption_fences').get().n, 1);
 assert.deepEqual(await real.service.recoverExpiredLeases('a'), [first.eventKey]);
 assert.equal(await real.store.state('a', first.eventKey), 'failed');
 const next = await real.service.receive(context, draft(2, ['original', 'additional']));
 await real.service.process('a', next.eventKey); assert.equal(h.stock(), '8'); h.finish();
}

// Populated upgrade: pre-extension application, failed result, and already
// superseded history remain byte-for-byte intact. No migration repairs stock.
{
 const h = await fixture({beforeUpgrade: true}), s = services(h);
 const first = await s.service.receive(context, draft(1)), record = await s.store.event('a', first.eventKey);
 const at = new Date(now).toISOString(), expires = new Date(now + 300_000).toISOString();
 h.sql.prepare("INSERT INTO sales_event_attempts VALUES ('a','legacy-attempt',?,?,?)").run(first.eventKey, at, expires);
 h.sql.prepare("UPDATE sales_event_states SET state='processing',lease_attempt_id='legacy-attempt',lease_expires_at=? WHERE event_key=?").run(expires, first.eventKey);
 await s.port.consume({contract: consumptionContract, companyId: 'a', idempotencyKey: record.applicationKey,
  occurredAt: record.event.occurredAt, lines: [{lineId: 'original', recipeId: 'drink', quantity: '1', modifiers: []}]});
 h.sql.prepare("INSERT INTO sales_event_attempt_results VALUES ('a','legacy-attempt',?,?,'failed',NULL,NULL,NULL,'inventory_unavailable')").run(first.eventKey, at);
 h.sql.prepare("UPDATE sales_event_states SET state='failed',lease_attempt_id=NULL,lease_expires_at=NULL WHERE event_key=?").run(first.eventKey);
 const next = await s.service.receive(context, draft(2, ['original', 'additional']));
 assert.equal(await s.store.state('a', first.eventKey), 'superseded', 'The old receipt trigger reproduces historical supersession.');
 const tables = ['inventory', 'inventory_balances_exact', 'inventory_consumption_applications', 'inventory_events_exact',
  'sales_events', 'sales_event_states', 'sales_event_attempts', 'sales_event_attempt_results', 'sales_event_transitions',
  'clover_item_mappings', 'recipe_versions', 'recipe_version_ingredients'];
 const before = tables.map(table => h.sql.prepare(`SELECT * FROM ${table}`).all());
 h.upgrade(); assert.deepEqual(tables.map(table => h.sql.prepare(`SELECT * FROM ${table}`).all()), before); assert.equal(h.stock(), '9');
 await s.service.process('a', next.eventKey); assert.equal(h.stock(), '8');
 assert.equal(await s.store.state('a', first.eventKey), 'superseded', 'Historical terminal state is preserved.');
 assert.deepEqual(h.sql.prepare('SELECT * FROM sales_event_attempt_results WHERE attempt_id=?').all('legacy-attempt'), before[7]);
 const outcomes = h.sql.prepare('SELECT * FROM sales_event_inventory_outcomes').all(); assert.equal(outcomes.length, 1);
 assert.throws(() => h.sql.prepare("UPDATE sales_event_inventory_outcomes SET status='not_applied'").run(), /immutable/);
 assert.throws(() => h.sql.prepare('DELETE FROM sales_event_inventory_outcomes').run(), /immutable/);
 const row = outcomes[0];
 h.sql.prepare('INSERT OR REPLACE INTO sales_event_inventory_outcomes VALUES (?,?,?,?,?,?)')
  .run(row.company_id, row.attempt_id, row.event_key, 'rewritten', row.status, row.inventory_result_json);
 assert.deepEqual(h.sql.prepare('SELECT * FROM sales_event_inventory_outcomes').all(), outcomes);
 h.finish();
}
console.log('PASS: real D1/mocked Clover lost-result, retry, crash, supersession, immutable baseline, failure policy, populated upgrade and expired-worker fencing regressions.');
