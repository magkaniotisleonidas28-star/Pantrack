import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// R1e (decision 0011): suggested levels from measured use, delivery schedule and spare stock,
// accepted by an owner or manager as a new restocking-settings version.
mkdirSync('.sites-runtime/stock-levels', { recursive: true });
writeFileSync(
  '.sites-runtime/stock-levels/entry.ts',
  `export * from '../../src/lib/stock-levels';
export * from '../../src/lib/d1-stock-levels';
export * from '../../src/lib/d1-inventory-management';
export { GET, POST } from '../../src/app/api/inventory/levels/route';`,
);
await build({
  entryPoints: ['.sites-runtime/stock-levels/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/stock-levels/bundle.mjs',
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
            ? 'export const database=()=>globalThis.levelsDb'
            : path.endsWith('chatgpt-auth')
              ? 'export const getChatGPTUser=async()=>globalThis.levelsUser'
              : path.endsWith('company-access')
                ? 'export const companyAccess=async(_user,company)=>company==="a"?{role:globalThis.levelsRole}:null'
                : path.endsWith('lib/auth')
                  ? 'export const audit=()=>({run:async()=>{}});export const csrf=()=>true'
                  : 'export const exactInventoryPreviewEnabled=()=>globalThis.levelsEnabled',
        }));
      },
    },
  ],
});
const m = await import('../.sites-runtime/stock-levels/bundle.mjs');
const {
  suggestLevel,
  dailyVariation,
  CAUTION_FACTORS,
  D1StockLevels,
  D1InventoryManagementService,
  StockLevelError,
} = m;

// --- Pure calculation --------------------------------------------------------------------
const usage = (extra = {}) => ({
  productId: 'p',
  dimension: 'count',
  status: 'enough',
  countedDays: 20,
  historyDays: 20,
  measuredPerDay: { dimension: 'count', minor: '10' },
  recordedPerDay: { dimension: 'count', minor: '8' },
  unrecordedPercent: 20,
  recentRecordedPerDay: null,
  dailyUse: null,
  unexplainedIncreases: 0,
  recentCounts: [],
  ...extra,
});
const weekly = { supplierId: 's', supplierName: 'Dairy', orderEveryDays: 7, deliveryDays: 2 };
const input = (extra = {}) => ({
  usage: usage(),
  dailyRecordedUse: new Array(14).fill(8),
  suppliers: [{ supplierId: 's', supplierName: 'Dairy', schedule: weekly }],
  runOutReports: 0,
  currentTarget: null,
  caution: 'balanced',
  ...extra,
});
assert.equal(dailyVariation([]), 0);
assert.equal(dailyVariation([5]), 0);
assert.equal(dailyVariation([2, 2, 2]), 0);
assert.equal(dailyVariation([1, 3]), Math.SQRT2);

// Steady use: no spare, 10 a day × (2 + 7) days.
let s = suggestLevel(input());
assert.equal(s.status, 'suggested');
assert.equal(s.coverDays, 9);
assert.deepEqual(s.level, { dimension: 'count', minor: '90' });
assert.deepEqual(s.spare, { dimension: 'count', minor: '0' });
assert.equal(s.appliedCaution, 'balanced');
// Uneven use: spare = 1.65 × variation × (10 / 8 measured gap) × √9, rounded up to whole units.
const uneven = [4, 12, 4, 12, 4, 12, 4, 12, 4, 12, 4, 12, 4, 12];
s = suggestLevel(input({ dailyRecordedUse: uneven }));
const spare = 1.65 * dailyVariation(uneven) * 1.25 * 3;
assert.equal(s.level.minor, String(Math.ceil(90 + spare)));
assert.equal(s.spare.minor, String(Math.ceil(90 + spare) - 90));
// A recent run-out raises the caution one step for this product.
s = suggestLevel(input({ dailyRecordedUse: uneven, runOutReports: 1 }));
assert.equal(s.appliedCaution, 'cautious');
assert.equal(
  s.level.minor,
  String(Math.ceil(90 + CAUTION_FACTORS.cautious * dailyVariation(uneven) * 1.25 * 3)),
);
assert.equal(
  suggestLevel(input({ caution: 'cautious', runOutReports: 2 })).appliedCaution,
  'cautious',
);
assert.equal(suggestLevel(input({ caution: 'lean', runOutReports: 1 })).appliedCaution, 'balanced');
// Several suppliers: the longest to cover is used, so the level errs on the safe side.
s = suggestLevel(
  input({
    suppliers: [
      {
        supplierId: 'a',
        supplierName: 'Quick',
        schedule: { supplierId: 'a', supplierName: 'Quick', orderEveryDays: 3, deliveryDays: 1 },
      },
      { supplierId: 's', supplierName: 'Dairy', schedule: weekly },
      { supplierId: 'n', supplierName: 'No schedule', schedule: null },
    ],
  }),
);
assert.equal(s.supplier.supplierName, 'Dairy');
assert.equal(s.supplierCount, 3);
// Mass and volume round up to whole grams or millilitres.
s = suggestLevel(
  input({
    usage: usage({
      dimension: 'mass',
      measuredPerDay: { dimension: 'mass', minor: '900500000' },
      recordedPerDay: { dimension: 'mass', minor: '900500000' },
    }),
    dailyRecordedUse: [],
  }),
);
assert.equal(s.level.minor, String(Math.ceil((900500000 * 9) / 1e6) * 1e6));
// No suggestion without enough history, use, a supplier, or a schedule.
assert.equal(
  suggestLevel(input({ usage: usage({ status: 'needs_counts' }) })).status,
  'needs_history',
);
assert.equal(
  suggestLevel(input({ usage: usage({ measuredPerDay: { dimension: 'count', minor: '0' } }) }))
    .status,
  'no_use',
);
assert.equal(suggestLevel(input({ suppliers: [] })).status, 'needs_supplier');
s = suggestLevel(input({ suppliers: [{ supplierId: 'n', supplierName: 'N', schedule: null }] }));
assert.equal(s.status, 'needs_schedule');
assert.equal(s.level, null);

// --- Database reader and accept ------------------------------------------------------------
class Statement {
  constructor(database, query, values = []) {
    Object.assign(this, { database, query, values });
  }
  bind(...values) {
    if (values.length > 100) throw new Error('D1 maximum bound parameters exceeded');
    return new Statement(this.database, this.query, values);
  }
  read(method) {
    const statement = this.database.prepare(this.query);
    statement.setReadBigInts(true);
    const rows = method === 'get' ? [statement.get(...this.values)] : statement.all(...this.values);
    return rows.map(
      (row) =>
        row &&
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]),
        ),
    );
  }
  async first() {
    return this.read('get')[0] ?? null;
  }
  async all() {
    return { success: true, results: this.read('all') };
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
const DAY = 86_400_000;
// History ends today, because the route below reads with the real clock.
const base = Date.parse(new Date().toISOString().slice(0, 10)) - 21 * DAY;
const at = (day, hour = 0) => new Date(base + day * DAY + hour * 3_600_000);
let now = at(0);
const clock = { now: () => now };
for (const id of ['a', 'b'])
  sql
    .prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)')
    .run(id, id, now.toISOString());
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock });
const version = (product) =>
  sql
    .prepare("SELECT version FROM inventory_balances_exact WHERE company_id='a' AND product_id=?")
    .get(product).version;
for (const product of ['milk', 'beans', 'cups']) {
  sql
    .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
    .run('a', product, JSON.stringify({ id: product, name: product }));
  await stock.configure({
    companyId: 'a',
    actor: 'owner',
    productId: product,
    operationId: 'setup-' + product,
    stockUnit: { kind: 'curated', id: 'each' },
    purchaseUnitLabel: 'case',
    purchaseAmount: '12',
    openingAmount: '100',
    effectiveAt: now.toISOString(),
  });
}
const move = async (product, amount, day, hour) => {
  now = at(day, hour);
  await stock.recordMovement({
    companyId: 'a',
    productId: product,
    operationId: crypto.randomUUID(),
    expectedVersion: version(product),
    actor: 'owner',
    action: 'use',
    amount: String(amount),
    unitId: 'each',
    effectiveAt: now.toISOString(),
    note: '',
  });
};
const count = async (product, amount, day) => {
  now = at(day);
  await stock.recordCount({
    companyId: 'a',
    productId: product,
    operationId: crypto.randomUUID(),
    expectedVersion: version(product),
    actor: 'owner',
    amount: String(amount),
    unitId: 'each',
    effectiveAt: now.toISOString(),
    note: '',
  });
};
// Milk: 2 recorded every day, 3 really used (counts 70 then 40), so 3 a day with a steady pattern.
// Beans: 1 and 3 on alternate days, nothing unrecorded (counts 80 then 60), so 2 a day, uneven.
for (let day = 0; day < 20; day += 1) {
  if (day === 10) {
    await count('milk', 70, 10);
    await count('beans', 80, 10);
  }
  await move('milk', 2, day, 12);
  await move('beans', day % 2 === 0 ? 1 : 3, day, 12);
}
await count('milk', 40, 20);
await count('beans', 60, 20);
// Day 20 is used as normal after its count, so every whole day in the window has use.
await move('milk', 2, 20, 12);
await move('beans', 1, 20, 12);
// Supplier schedules: milk from a weekly dairy (7 + 2 days); beans from two, the longer is used.
const snapshot = (id, version, name, rhythm) =>
  sql.prepare("INSERT INTO purchasing_supplier_versions VALUES('a',?,?,?)").run(
    id,
    version,
    JSON.stringify({
      companyId: 'a',
      id,
      version,
      status: 'active',
      profile: { name, ...(rhythm ? { deliveryRhythm: rhythm } : {}) },
    }),
  );
const supplier = (id, name, rhythm) => {
  sql.prepare("INSERT INTO purchasing_suppliers VALUES('a',?,1,'active',?,'t')").run(id, name);
  snapshot(id, 1, name, rhythm);
};
const newVersion = (id, name, rhythm) => {
  sql
    .prepare("UPDATE purchasing_suppliers SET version=version+1 WHERE company_id='a' AND id=?")
    .run(id);
  const { version } = sql
    .prepare("SELECT version FROM purchasing_suppliers WHERE company_id='a' AND id=?")
    .get(id);
  snapshot(id, version, name, rhythm);
};
supplier('dairy', 'Dairy', { orderEveryDays: 7, deliveryDays: 2 });
supplier('quick', 'Quick', { orderEveryDays: 3, deliveryDays: 1 });
supplier('broken', 'Broken', { orderEveryDays: 0, deliveryDays: 99 });
const map = (id, supplierId, product) =>
  sql
    .prepare("INSERT INTO purchasing_mappings VALUES('a',?,1,'active',?,'acct','loc',?,?,'t')")
    .run(id, supplierId, product, id);
map('m1', 'dairy', 'milk');
map('m2', 'dairy', 'beans');
map('m3', 'quick', 'beans');
map('m4', 'broken', 'cups');
now = new Date(at(21).getTime() + 60_000);
const levels = new D1StockLevels(db, { clock });
let view = await levels.read('a');
const find = (v, id) => v.suggestions.find((x) => x.productId === id);
let milk = find(view, 'milk');
assert.equal(view.caution, 'balanced');
assert.equal(milk.status, 'suggested');
assert.deepEqual(milk.level, { dimension: 'count', minor: '27' }, '3 a day × 9 days, no spare');
assert.equal(milk.supplier.supplierName, 'Dairy');
assert.equal(milk.unrecordedPercent, 33);
assert.equal(milk.current, null);
assert.equal(view.settingsVersions.milk, 0);
const beans = find(view, 'beans');
const beanDays = Array.from({ length: 20 }, (_, i) => ((i + 1) % 2 === 0 ? 1 : 3));
assert.equal(beans.supplier.supplierName, 'Dairy', 'Longest schedule of two');
assert.equal(beans.level.minor, String(Math.ceil(2 * 9 + 1.65 * dailyVariation(beanDays) * 3)));
assert.equal(find(view, 'cups').status, 'needs_history', 'No counts after opening');
// A saved schedule outside the rules is not trusted.
newVersion('dairy', 'Dairy', { orderEveryDays: 0, deliveryDays: 99 });
assert.equal(find(await levels.read('a'), 'milk').status, 'needs_schedule');
newVersion('dairy', 'Dairy', { orderEveryDays: 7, deliveryDays: 2 });
assert.equal(
  find(await levels.read('a'), 'milk').status,
  'suggested',
  'The current version is used',
);
// A run-out report in the last 4 weeks raises milk's caution; a dismissed one does not.
sql
  .prepare("INSERT INTO run_out_reports VALUES('a','r1','milk','u','e','',?)")
  .run(at(19).toISOString());
sql
  .prepare("INSERT INTO run_out_reports VALUES('a','r2','beans','u','e','',?)")
  .run(at(19).toISOString());
sql
  .prepare("INSERT INTO run_out_resolutions VALUES('a','r2','op','dismissed',NULL,'m',?)")
  .run(at(19).toISOString());
view = await levels.read('a');
assert.equal(find(view, 'milk').appliedCaution, 'cautious');
assert.equal(find(view, 'beans').appliedCaution, 'balanced');
assert.deepEqual(find(view, 'milk').level.minor, '27', 'Steady use has no spare to raise');

// Accepting saves the level seen, plus measured daily use, as a new settings version.
const manager = { companyId: 'a', userId: 'max', role: 'manager' };
const op = crypto.randomUUID();
const accept = (extra = {}, actor = manager) =>
  levels.accept(
    {
      companyId: 'a',
      productId: 'milk',
      operationId: op,
      expectedLevelMinor: '27',
      expectedSettingsVersion: 0,
      ...extra,
    },
    actor,
  );
const rejects = (promise, code) =>
  assert.rejects(promise, (e) => e instanceof StockLevelError && e.code === code);
await rejects(accept({}, { ...manager, role: 'employee' }), 'forbidden');
await rejects(accept({ operationId: crypto.randomUUID(), expectedLevelMinor: '28' }), 'stale');
await rejects(accept({ operationId: crypto.randomUUID(), expectedSettingsVersion: 3 }), 'stale');
await rejects(
  levels.accept(
    {
      companyId: 'a',
      productId: 'cups',
      operationId: crypto.randomUUID(),
      expectedLevelMinor: '1',
      expectedSettingsVersion: 0,
    },
    manager,
  ),
  'not_suggested',
);
const saved = await accept();
assert.equal(saved.version, 1);
assert.equal(saved.changeReason, 'Accepted Pantrack suggestion');
assert.equal(saved.changedBy, 'max');
assert.deepEqual(saved.settings, {
  target: { dimension: 'count', minor: '27' },
  capacity: null,
  dailyUse: { dimension: 'count', minor: '3' },
  shelfDays: null,
  countEveryDays: 7,
  minimumPacks: '0',
  orderMultiplePacks: '1',
  maximumPacks: null,
});
const again = await accept();
assert.equal(again.version, 1, 'A repeated accept returns the saved version');
assert.equal(
  sql
    .prepare("SELECT count(*) n FROM replenishment_settings_versions WHERE product_id='milk'")
    .get().n,
  1,
);
await rejects(accept({ expectedLevelMinor: '30' }), 'conflict');
view = await levels.read('a');
assert.deepEqual(find(view, 'milk').current, { dimension: 'count', minor: '27' });
assert.equal(view.settingsVersions.milk, 1);
// Existing settings keep everything except the level and daily use.
const beansLevel = find(view, 'beans').level.minor;
sql
  .prepare(
    `INSERT INTO replenishment_settings_versions(company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,dimension,settings_json,changed_by,change_reason,changed_at)
    SELECT 'a','beans',1,'manual',id,version,'count',?,'owner','Manual setup','t' FROM inventory_config_versions WHERE company_id='a' AND product_id='beans' AND status='active'`,
  )
  .run(
    JSON.stringify({
      target: { dimension: 'count', minor: '50' },
      capacity: { dimension: 'count', minor: '200' },
      dailyUse: { dimension: 'count', minor: '1' },
      shelfDays: 30,
      countEveryDays: 14,
      minimumPacks: '1',
      orderMultiplePacks: '2',
      maximumPacks: '10',
    }),
  );
const beansSaved = await levels.accept(
  {
    companyId: 'a',
    productId: 'beans',
    operationId: crypto.randomUUID(),
    expectedLevelMinor: beansLevel,
    expectedSettingsVersion: 1,
  },
  { ...manager, role: 'owner' },
);
assert.equal(beansSaved.version, 2);
assert.deepEqual(beansSaved.settings, {
  target: { dimension: 'count', minor: beansLevel },
  capacity: { dimension: 'count', minor: '200' },
  dailyUse: { dimension: 'count', minor: '2' },
  shelfDays: 30,
  countEveryDays: 14,
  minimumPacks: '1',
  orderMultiplePacks: '2',
  maximumPacks: '10',
});

// --- Route ----------------------------------------------------------------------------------
globalThis.levelsDb = db;
globalThis.levelsEnabled = true;
const get = (company) =>
  m.GET(new Request('https://app.local/api/inventory/levels?companyId=' + company));
const post = (body) =>
  m.POST(
    new Request('https://app.local/api/inventory/levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const milkLevel = find(await levels.read('a'), 'milk').level.minor;
const body = {
  action: 'accept',
  companyId: 'a',
  productId: 'milk',
  operationId: crypto.randomUUID(),
  expectedLevelMinor: milkLevel,
  expectedSettingsVersion: 1,
};
globalThis.levelsUser = null;
assert.equal((await get('a')).status, 401, 'Anonymous');
assert.equal((await post(body)).status, 401);
globalThis.levelsUser = { userId: 'u', email: 'u@example.test' };
globalThis.levelsRole = 'employee';
assert.equal((await get('b')).status, 403, 'Wrong company');
assert.equal((await post({ ...body, companyId: 'b' })).status, 403);
const seen = await get('a');
assert.equal(seen.status, 200, 'Employees may see suggestions');
assert.equal(seen.headers.get('Cache-Control'), 'private, no-store');
assert.equal((await seen.json()).suggestions.length, 3);
assert.equal((await post(body)).status, 403, 'Employees cannot accept');
globalThis.levelsRole = 'manager';
assert.equal((await post({ ...body, operationId: 'not-a-uuid' })).status, 400);
assert.equal((await post({ ...body, expectedLevelMinor: '-1' })).status, 400);
assert.equal(
  (await post({ ...body, operationId: crypto.randomUUID(), expectedLevelMinor: '999' })).status,
  409,
);
const accepted = await post(body);
assert.equal(accepted.status, 200);
assert.deepEqual(await accepted.json(), {
  version: 2,
  target: { dimension: 'count', minor: milkLevel },
});
globalThis.levelsEnabled = false;
assert.equal((await get('a')).status, 404, 'Preview off');
assert.equal((await post(body)).status, 404);
// --- Part 2: caution choice and Ignore -----------------------------------------------------
globalThis.levelsEnabled = true;
const owner = { companyId: 'a', userId: 'olive', role: 'owner' };
const beansAt = async () => find(await levels.read('a'), 'beans');
const spareFor = (factor) => String(Math.ceil(2 * 9 + factor * dailyVariation(beanDays) * 3));
assert.equal((await levels.read('a')).caution, 'balanced', 'Balanced until changed');
await rejects(
  levels.setCaution(
    { companyId: 'a', productId: '*', caution: 'lean' },
    { ...manager, role: 'employee' },
  ),
  'forbidden',
);
await rejects(
  levels.setCaution({ companyId: 'a', productId: '*', caution: 'cafe' }, manager),
  'not_suggested',
);
await rejects(
  levels.setCaution({ companyId: 'a', productId: 'nothing', caution: 'lean' }, manager),
  'not_suggested',
);
await levels.setCaution({ companyId: 'a', productId: '*', caution: 'cautious' }, manager);
view = await levels.read('a');
assert.equal(view.caution, 'cautious');
assert.equal(find(view, 'beans').appliedCaution, 'cautious');
assert.equal(find(view, 'beans').level.minor, spareFor(2.33));
// A product's own caution overrides the café's; 'cafe' makes it follow the café again.
await levels.setCaution({ companyId: 'a', productId: 'beans', caution: 'lean' }, owner);
view = await levels.read('a');
assert.deepEqual(view.productCautions, { beans: 'lean' });
assert.equal(find(view, 'beans').caution, 'lean');
assert.equal(find(view, 'beans').level.minor, spareFor(1.04));
assert.equal(find(view, 'milk').caution, 'cautious', 'Other products follow the café');
await levels.setCaution({ companyId: 'a', productId: 'beans', caution: 'balanced' }, owner);
assert.equal((await beansAt()).level.minor, spareFor(1.65), 'Changing it again replaces it');
await levels.setCaution({ companyId: 'a', productId: 'beans', caution: 'cafe' }, owner);
assert.deepEqual((await levels.read('a')).productCautions, {});
assert.equal((await beansAt()).level.minor, spareFor(2.33));
assert.equal(
  sql
    .prepare("SELECT updated_by FROM stock_level_cautions WHERE company_id='a' AND product_id='*'")
    .get().updated_by,
  'max',
);
// Ignore hides only the suggestion that was seen; new numbers show it again.
const cautiousLevel = (await beansAt()).level.minor;
await rejects(
  levels.ignore({ companyId: 'a', productId: 'beans', expectedLevelMinor: '1' }, manager),
  'stale',
);
await rejects(
  levels.ignore({ companyId: 'a', productId: 'cups', expectedLevelMinor: '1' }, manager),
  'not_suggested',
);
await rejects(
  levels.ignore(
    { companyId: 'a', productId: 'beans', expectedLevelMinor: cautiousLevel },
    { ...manager, role: 'employee' },
  ),
  'forbidden',
);
await levels.ignore(
  { companyId: 'a', productId: 'beans', expectedLevelMinor: cautiousLevel },
  manager,
);
assert.deepEqual((await levels.read('a')).ignored, { beans: true });
await levels.setCaution({ companyId: 'a', productId: '*', caution: 'lean' }, manager);
assert.deepEqual((await levels.read('a')).ignored, {}, 'A different suggestion is shown again');
await levels.setCaution({ companyId: 'a', productId: '*', caution: 'cautious' }, manager);
assert.deepEqual(
  (await levels.read('a')).ignored,
  { beans: true },
  'The ignored numbers stay ignored',
);
await rejects(
  levels.unignore({ companyId: 'a', productId: 'beans' }, { ...manager, role: 'employee' }),
  'forbidden',
);
await levels.unignore({ companyId: 'a', productId: 'beans' }, manager);
assert.deepEqual((await levels.read('a')).ignored, {});
// Stock and saved levels are untouched by caution and ignore changes.
assert.equal(
  sql
    .prepare("SELECT count(*) n FROM replenishment_settings_versions WHERE product_id='beans'")
    .get().n,
  2,
);
// The tables refuse unknown cautions and malformed levels.
assert.throws(() =>
  sql.prepare("INSERT INTO stock_level_cautions VALUES('a','x','maybe','u','t')").run(),
);
for (const bad of ['-1', 'abc', '1.5', ''])
  assert.throws(
    () => sql.prepare("INSERT INTO stock_level_ignores VALUES('a','x',?,'u','t')").run(bad),
    bad,
  );
// Route: employees cannot change these; owners and managers can; bad input is refused.
globalThis.levelsRole = 'employee';
assert.equal(
  (await post({ action: 'set_caution', companyId: 'a', productId: '*', caution: 'lean' })).status,
  403,
);
assert.equal((await post({ action: 'unignore', companyId: 'a', productId: 'beans' })).status, 403);
globalThis.levelsRole = 'manager';
assert.equal(
  (await post({ action: 'set_caution', companyId: 'a', productId: '*', caution: 'reckless' }))
    .status,
  400,
);
assert.equal(
  (await post({ action: 'set_caution', companyId: 'b', productId: '*', caution: 'lean' })).status,
  403,
);
assert.equal(
  (await post({ action: 'set_caution', companyId: 'a', productId: '*', caution: 'balanced' }))
    .status,
  200,
);
const routeLevel = (await beansAt()).level.minor;
const ignoredByRoute = await post({
  action: 'ignore',
  companyId: 'a',
  productId: 'beans',
  expectedLevelMinor: routeLevel,
});
assert.equal(ignoredByRoute.status, 200);
assert.deepEqual((await (await get('a')).json()).ignored, { beans: true });
assert.equal(
  (await post({ action: 'ignore', companyId: 'a', productId: 'beans', expectedLevelMinor: '1' }))
    .status,
  409,
);
console.log('Stock levels passed.');
