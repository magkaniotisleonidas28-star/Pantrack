import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// R1c (decision 0011): anyone reports "We just ran out"; a report never changes stock; an owner or
// manager confirms it as a zero count (one batch with that count) or dismisses it.
mkdirSync('.sites-runtime/run-out', { recursive: true });
writeFileSync(
  '.sites-runtime/run-out/entry.ts',
  `export * from '../../src/lib/d1-run-out-reports';
export * from '../../src/lib/run-out-contract';
export * from '../../src/lib/d1-inventory-management';
export { permitted, routePermission } from '../../src/lib/authorization';
export { GET, POST } from '../../src/app/api/inventory/run-out/route';`,
);
await build({
  entryPoints: ['.sites-runtime/run-out/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/run-out/bundle.mjs',
  external: ['cloudflare:workers'],
  plugins: [
    {
      name: 'fixtures',
      setup(b) {
        b.onResolve(
          { filter: /^@\/(db\/raw|lib\/(chatgpt-auth|company-access|auth|exact-inventory-gate))$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: path.endsWith('db/raw')
            ? 'export const database=()=>globalThis.runOutDb'
            : path.endsWith('chatgpt-auth')
              ? 'export const getChatGPTUser=async()=>globalThis.runOutUser'
              : path.endsWith('company-access')
                ? 'export const companyAccess=async(_user,company)=>company==="a"?{role:globalThis.runOutRole}:null'
                : path.endsWith('lib/auth')
                  ? 'export const audit=()=>({run:async()=>{}});export const csrf=()=>true'
                  : 'export const exactInventoryPreviewEnabled=()=>globalThis.runOutEnabled',
        }));
      },
    },
  ],
});
const m = await import('../.sites-runtime/run-out/bundle.mjs');
const { D1RunOutReports, D1InventoryManagementService, RunOutError, permitted, routePermission } =
  m;

class Statement {
  constructor(database, query, values = []) {
    Object.assign(this, { database, query, values });
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
    if (/^\s*(SELECT|WITH)\b/i.test(this.query))
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
    this.beforeBatch = null;
  }
  prepare(query) {
    return new Statement(this.sql, query);
  }
  async batch(statements) {
    // Lets a test act as another request that lands just before this batch.
    const hook = this.beforeBatch;
    this.beforeBatch = null;
    if (hook) hook();
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
let now = new Date('2026-04-01T08:00:00.000Z');
const clock = { now: () => now };
const tick = (minutes = 5) => (now = new Date(now.getTime() + minutes * 60_000));
for (const id of ['a', 'b'])
  sql
    .prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)')
    .run(id, id, now.toISOString());
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock }),
  reports = new D1RunOutReports(db, { clock });
for (const [company, product, opening] of [
  ['a', 'milk', '10'],
  ['a', 'oat', '6'],
  ['a', 'beans', '4'],
  ['b', 'scone', '5'],
]) {
  sql
    .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
    .run(company, product, JSON.stringify({ id: product, name: product }));
  await stock.configure({
    companyId: company,
    actor: 'owner@example.test',
    productId: product,
    operationId: 'setup-' + product,
    stockUnit: { kind: 'curated', id: 'each' },
    purchaseUnitLabel: 'pack',
    purchaseAmount: '1',
    openingAmount: opening,
    effectiveAt: now.toISOString(),
  });
}
sql
  .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
  .run('a', 'unstocked', JSON.stringify({ id: 'unstocked', name: 'No stock yet' }));
const balance = (product) =>
  sql
    .prepare(
      "SELECT on_hand_minor,version FROM inventory_balances_exact WHERE company_id='a' AND product_id=?",
    )
    .get(product);
const snapshot = () =>
  JSON.stringify([
    sql.prepare('SELECT * FROM inventory_balances_exact ORDER BY product_id').all(),
    sql.prepare('SELECT count(*) n FROM inventory_events_exact').get().n,
    sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n,
  ]);
const employee = { userId: 'u-sam', email: 'sam@example.test' },
  colleague = { userId: 'u-ana', email: 'ana@example.test' },
  manager = { userId: 'u-max', email: 'max@example.test' };
const rejects = async (promise, code) =>
  assert.rejects(promise, (error) => error instanceof RunOutError && error.code === code);

// --- Reporting never changes stock; a second report for the same product joins the open one.
tick();
const stockBefore = snapshot();
const first = await reports.report(
  { companyId: 'a', operationId: crypto.randomUUID(), productId: 'milk', note: '  fridge empty ' },
  employee,
);
assert.equal(first.created, true);
assert.equal(first.report.note, 'fridge empty');
assert.equal(first.report.reporterEmail, employee.email);
const replayed = await reports.report(
  { companyId: 'a', operationId: first.report.id, productId: 'milk', note: 'fridge empty' },
  employee,
);
assert.deepEqual(replayed.report, first.report, 'A repeated tap returns the same report');
await rejects(
  reports.report(
    { companyId: 'a', operationId: first.report.id, productId: 'milk', note: 'other' },
    employee,
  ),
  'conflict',
);
tick();
const joined = await reports.report(
  { companyId: 'a', operationId: crypto.randomUUID(), productId: 'milk', note: '' },
  colleague,
);
assert.equal(joined.created, false);
assert.equal(joined.report.id, first.report.id, 'Joins the open report for that product');
await rejects(
  reports.report(
    { companyId: 'a', operationId: crypto.randomUUID(), productId: 'unstocked', note: '' },
    employee,
  ),
  'no_stock',
);
await rejects(
  reports.report(
    { companyId: 'a', operationId: crypto.randomUUID(), productId: 'scone', note: '' },
    employee,
  ),
  'no_stock',
);
assert.equal(snapshot(), stockBefore, 'Reports never change stock or counts');
assert.deepEqual(
  (await reports.open('a')).map((r) => r.id),
  [first.report.id],
);
assert.deepEqual(await reports.open('b'), [], 'Other companies see nothing');

// --- Confirming records one zero count and closes every open report for that product.
// A second open report can exist when two people tap at the same moment.
tick();
const raced = crypto.randomUUID();
sql
  .prepare(
    "INSERT INTO run_out_reports(company_id,id,product_id,reported_by,reporter_email,note,reported_at) VALUES('a',?,'milk','u-ana','ana@example.test','',?)",
  )
  .run(raced, now.toISOString());
tick();
const confirmOp = crypto.randomUUID();
const confirmed = await reports.resolve(
  { companyId: 'a', operationId: confirmOp, reportId: first.report.id },
  'confirmed',
  manager,
);
assert.equal(confirmed.outcome, 'confirmed');
assert.deepEqual([...confirmed.reportIds].sort(), [first.report.id, raced].sort());
assert.equal(confirmed.countId, 'count:run-out:' + confirmOp);
assert.equal(balance('milk').on_hand_minor, '0', 'Stock is now zero');
const count = sql
  .prepare(
    "SELECT measured_minor,actor,note,opening FROM inventory_reconciliations WHERE company_id='a' AND id=?",
  )
  .get(confirmed.countId);
assert.deepEqual(
  { ...count },
  {
    measured_minor: '0',
    actor: manager.email,
    note: 'Confirmed run-out report',
    opening: 0,
  },
);
assert.deepEqual(await reports.open('a'), []);
const countsAfterConfirm = sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n;
const again = await reports.resolve(
  { companyId: 'a', operationId: confirmOp, reportId: first.report.id },
  'confirmed',
  manager,
);
assert.deepEqual(again, confirmed, 'A repeated confirm returns the saved outcome');
assert.equal(
  sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n,
  countsAfterConfirm,
);
await rejects(
  reports.resolve(
    { companyId: 'a', operationId: confirmOp, reportId: first.report.id },
    'dismissed',
    manager,
  ),
  'conflict',
);
await rejects(
  reports.resolve(
    { companyId: 'a', operationId: crypto.randomUUID(), reportId: first.report.id },
    'dismissed',
    manager,
  ),
  'already_resolved',
);
await rejects(
  reports.resolve(
    { companyId: 'b', operationId: crypto.randomUUID(), reportId: first.report.id },
    'dismissed',
    manager,
  ),
  'not_found',
);

// --- Dismissing closes the report and leaves stock as it was.
tick();
const oat = await reports.report(
  { companyId: 'a', operationId: crypto.randomUUID(), productId: 'oat', note: '' },
  employee,
);
const oatBefore = snapshot();
const dismissed = await reports.resolve(
  { companyId: 'a', operationId: crypto.randomUUID(), reportId: oat.report.id },
  'dismissed',
  manager,
);
assert.deepEqual(dismissed, { outcome: 'dismissed', reportIds: [oat.report.id], countId: null });
assert.equal(snapshot(), oatBefore, 'Dismissing changes no stock');

// --- If stock changes just before the confirm is saved, nothing is saved and the report stays open.
tick();
const beans = await reports.report(
  { companyId: 'a', operationId: crypto.randomUUID(), productId: 'beans', note: '' },
  employee,
);
tick();
db.beforeBatch = () =>
  sql
    .prepare(
      "UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='beans'",
    )
    .run();
const beansCounts = sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n;
await rejects(
  reports.resolve(
    { companyId: 'a', operationId: crypto.randomUUID(), reportId: beans.report.id },
    'confirmed',
    manager,
  ),
  'stale',
);
assert.equal(
  sql.prepare('SELECT count(*) n FROM run_out_resolutions WHERE report_id=?').get(beans.report.id)
    .n,
  0,
);
assert.equal(sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n, beansCounts);
assert.equal((await reports.open('a')).length, 1, 'Still open after a stale confirm');

// --- If another manager dismisses it at the same moment, the zero count is undone with it.
tick();
db.beforeBatch = () =>
  sql
    .prepare(
      "INSERT INTO run_out_resolutions(company_id,report_id,operation_id,outcome,count_id,resolved_by,resolved_at) VALUES('a',?,'other-op','dismissed',NULL,'ana@example.test',?)",
    )
    .run(beans.report.id, now.toISOString());
const beansBalance = balance('beans');
await rejects(
  reports.resolve(
    { companyId: 'a', operationId: crypto.randomUUID(), reportId: beans.report.id },
    'confirmed',
    manager,
  ),
  'already_resolved',
);
assert.deepEqual(balance('beans'), beansBalance, 'No zero count without its outcome');
assert.equal(sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n, beansCounts);

// --- The tables refuse inconsistent rows.
assert.throws(() =>
  sql
    .prepare("INSERT INTO run_out_reports VALUES('a','x','milk','u','e',?,'t')")
    .run('n'.repeat(201)),
);
sql.prepare("INSERT INTO run_out_reports VALUES('a','y','milk','u','e','','t')").run();
assert.throws(() =>
  sql
    .prepare("INSERT INTO run_out_resolutions VALUES('a','y','op','confirmed',NULL,'m','t')")
    .run(),
);
assert.throws(() =>
  sql
    .prepare("INSERT INTO run_out_resolutions VALUES('a','y','op','dismissed','count:x','m','t')")
    .run(),
);
assert.throws(() =>
  sql.prepare("INSERT INTO run_out_resolutions VALUES('a','y','op','maybe',NULL,'m','t')").run(),
);
assert.throws(() =>
  sql
    .prepare("INSERT INTO run_out_resolutions VALUES('a','missing','op','dismissed',NULL,'m','t')")
    .run(),
);
sql.prepare("DELETE FROM run_out_reports WHERE id='y'").run();

// --- Permissions: everyone may report and see open reports; only owners and managers resolve.
for (const role of ['owner', 'manager', 'employee'])
  assert.equal(permitted(role, routePermission('run-out', 'POST', 'report')), true, role);
for (const action of ['confirm', 'dismiss']) {
  assert.equal(permitted('employee', routePermission('run-out', 'POST', action)), false);
  assert.equal(permitted('manager', routePermission('run-out', 'POST', action)), true);
}
assert.equal(permitted('employee', routePermission('run-out', 'GET')), true);
assert.equal(permitted('employee', 'operate'), false, 'Employees still cannot count stock');

// --- Route: sign-in, company, role, preview switch and input checks.
globalThis.runOutDb = db;
globalThis.runOutEnabled = true;
const post = (body) =>
  m.POST(
    new Request('https://app.local/api/inventory/run-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const get = (company) =>
  m.GET(new Request('https://app.local/api/inventory/run-out?companyId=' + company));
tick();
const reportBody = {
  companyId: 'a',
  action: 'report',
  operationId: crypto.randomUUID(),
  productId: 'oat',
};
globalThis.runOutUser = null;
assert.equal((await post(reportBody)).status, 401, 'Anonymous');
assert.equal((await get('a')).status, 401);
globalThis.runOutUser = { userId: employee.userId, email: employee.email };
globalThis.runOutRole = 'employee';
assert.equal((await post({ ...reportBody, companyId: 'b' })).status, 403, 'Wrong company');
assert.equal((await get('b')).status, 403);
globalThis.runOutRole = 'unknown-role';
assert.equal((await post(reportBody)).status, 403, 'A role without permission');
globalThis.runOutRole = 'employee';
const reported = await post(reportBody);
assert.equal(reported.status, 200);
assert.equal(reported.headers.get('Cache-Control'), 'private, no-store');
const routeReport = (await reported.json()).report;
const listed = await get('a');
assert.equal(listed.status, 200);
const listedBody = await listed.json();
assert.ok(listedBody.open.some((r) => r.id === routeReport.id));
assert.deepEqual(
  listedBody.stocked,
  ['beans', 'milk', 'oat'],
  'Only company a products with stock',
);
const confirmBody = {
  companyId: 'a',
  action: 'confirm',
  operationId: crypto.randomUUID(),
  reportId: routeReport.id,
};
assert.equal((await post(confirmBody)).status, 403, 'Employees cannot confirm');
assert.equal(
  (await post({ ...confirmBody, action: 'dismiss' })).status,
  403,
  'Employees cannot dismiss',
);
assert.equal((await post({ ...reportBody, operationId: 'not-a-uuid' })).status, 400);
assert.equal(
  (await post({ ...reportBody, operationId: crypto.randomUUID(), note: 'x'.repeat(201) })).status,
  400,
);
assert.equal(
  (await post({ ...reportBody, operationId: crypto.randomUUID(), productId: 'unstocked' })).status,
  400,
);
globalThis.runOutRole = 'manager';
globalThis.runOutUser = { userId: manager.userId, email: manager.email };
tick();
const managerConfirm = await post(confirmBody);
assert.equal(managerConfirm.status, 200);
assert.equal((await managerConfirm.json()).outcome, 'confirmed');
assert.equal(balance('oat').on_hand_minor, '0');
assert.equal((await post({ ...confirmBody, operationId: crypto.randomUUID() })).status, 409);
globalThis.runOutEnabled = false;
assert.equal((await post(reportBody)).status, 404, 'Preview off');
assert.equal((await get('a')).status, 404);
console.log('Run-out reports passed.');
