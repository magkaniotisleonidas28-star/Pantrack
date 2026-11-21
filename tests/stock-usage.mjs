import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// R1b (decision 0011): measured use between counts compared with recorded use. Read only.
mkdirSync('.sites-runtime/stock-usage', { recursive: true });
writeFileSync(
  '.sites-runtime/stock-usage/entry.ts',
  `export * from '../../src/lib/stock-usage';
export * from '../../src/lib/d1-stock-usage';
export * from '../../src/lib/d1-inventory-management';
export { GET } from '../../src/app/api/inventory/usage/route';`,
);
await build({
  entryPoints: ['.sites-runtime/stock-usage/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/stock-usage/bundle.mjs',
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
            ? 'export const database=()=>globalThis.usageDb'
            : path.endsWith('chatgpt-auth')
              ? 'export const getChatGPTUser=async()=>globalThis.usageUser'
              : path.endsWith('company-access')
                ? 'export const companyAccess=async(_user,company)=>company==="a"?{role:globalThis.usageRole}:null'
                : path.endsWith('lib/auth')
                  ? 'export const audit=()=>({run:async()=>{}});export const csrf=()=>true'
                  : 'export const exactInventoryPreviewEnabled=()=>globalThis.usageEnabled',
        }));
      },
    },
  ],
});
const usage = await import('../.sites-runtime/stock-usage/bundle.mjs');
const { productUsage, unrecordedWording, D1StockUsage, D1InventoryManagementService, GET } = usage;

class Statement {
  constructor(database, query, values = []) {
    Object.assign(this, { database, query, values });
  }
  bind(...values) {
    if (values.length > 100) throw new Error('D1 maximum bound parameters exceeded');
    return new Statement(this.database, this.query, values);
  }
  // Like D1, whole numbers come back as JavaScript numbers, rounded when beyond the exact range.
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

// --- Pure calculation -------------------------------------------------------------------
const DAY = 86_400_000;
const at = (day, hour = 0) => new Date(Date.UTC(2026, 2, 1) + day * DAY + hour * 3_600_000);
const iso = (day, hour) => at(day, hour).toISOString();
const count = (day, measured, previous, received = '0', change = '0', estimate = null) => ({
  effectiveAt: iso(day),
  dimension: 'count',
  measuredMinor: String(measured),
  estimateBeforeMinor: estimate === null ? null : String(estimate),
  opening: previous === null,
  previous: previous && {
    effectiveAt: iso(previous[0]),
    dimension: 'count',
    measuredMinor: String(previous[1]),
  },
  receivedMinor: received,
  recordedChangeMinor: change,
});
const base = {
  productId: 'p',
  dimension: 'count',
  firstRecordedUseAt: iso(1),
  recentRecordedChangeMinor: '-280',
};

// 14 days: 100 + 30 received - 94 counted = 36 really used; 30 recorded; 6 not recorded.
let result = productUsage(
  {
    ...base,
    counts: [count(0, 100, null), count(14, 94, [0, 100], '30', '-30', 100)],
  },
  at(20),
);
assert.equal(result.status, 'enough');
assert.equal(result.countedDays, 14);
assert.equal(result.historyDays, 19);
assert.deepEqual(result.measuredPerDay, { dimension: 'count', minor: '3' }, '36 / 14 rounds to 3');
assert.deepEqual(result.recordedPerDay, { dimension: 'count', minor: '2' }, '30 / 14 rounds to 2');
assert.equal(result.unrecordedPercent, 17, '6 of 36 is 16.7%');
assert.deepEqual(result.dailyUse, { source: 'counts', perDay: result.measuredPerDay });
assert.deepEqual(result.recentRecordedPerDay, { dimension: 'count', minor: '15' }, '280 / 19 days');
assert.equal(result.recentCounts.length, 1);
assert.deepEqual(result.recentCounts[0].difference, { dimension: 'count', minor: '-6' });
assert.equal(result.recentCounts[0].differencePercent, -6);
assert.equal(unrecordedWording(17), 'About 17% more used than recorded');
assert.equal(unrecordedWording(-5), 'About 5% less used than recorded');
assert.equal(unrecordedWording(2), 'Matches what was recorded');
assert.equal(unrecordedWording(null), 'Not measured yet');

// Thin data: one count, or counts too close together, gives no counted use.
result = productUsage({ ...base, counts: [count(0, 100, null)] }, at(20));
assert.equal(result.status, 'needs_counts');
assert.equal(result.measuredPerDay, null);
assert.equal(result.unrecordedPercent, null);
assert.deepEqual(result.dailyUse, { source: 'recorded', perDay: result.recentRecordedPerDay });
result = productUsage(
  { ...base, counts: [count(0, 100, null), count(5, 90, [0, 100], '0', '-10', 90)] },
  at(20),
);
assert.equal(result.status, 'needs_counts', 'Five counted days are fewer than seven');
assert.equal(result.dailyUse.source, 'recorded');
result = productUsage(
  {
    ...base,
    firstRecordedUseAt: iso(10),
    counts: [count(0, 100, null), count(14, 86, [0, 100], '0', '-14', 86)],
  },
  at(20),
);
assert.equal(result.status, 'needs_history', 'Ten days of recorded use are fewer than fourteen');
assert.equal(result.dailyUse.source, 'counts');
result = productUsage(
  { ...base, firstRecordedUseAt: null, counts: [], recentRecordedChangeMinor: '0' },
  at(20),
);
assert.equal(result.status, 'needs_counts');
assert.equal(result.dailyUse, null);
assert.equal(result.historyDays, 0);

// A count that finds more than deliveries explain is left out and reported, never treated as use.
result = productUsage(
  { ...base, counts: [count(0, 10, null), count(10, 15, [0, 10], '0', '0', 10)] },
  at(20),
);
assert.equal(result.unexplainedIncreases, 1);
assert.equal(result.countedDays, 0);
assert.equal(result.recentCounts[0].differencePercent, 50);
// Periods outside the window, in the future, or across a unit change are ignored.
result = productUsage(
  {
    ...base,
    counts: [
      count(-80, 100, null),
      count(-60, 80, [-80, 100], '0', '-20', 80),
      { ...count(10, 70, [-60, 80], '0', '-10', 70), dimension: 'mass' },
      count(30, 60, [10, 70], '0', '-10', 60),
    ],
  },
  at(20),
);
assert.equal(result.countedDays, 0);
assert.equal(result.recentCounts.length, 2, 'Only counts in the current unit are shown');

// --- Database reader ----------------------------------------------------------------------
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const e of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries)
  sql.exec(readFileSync(`drizzle/${e.tag}.sql`, 'utf8'));
let now = at(0);
const clock = { now: () => now };
for (const id of ['a', 'b'])
  sql
    .prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)')
    .run(id, id, now.toISOString());
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock });
const version = (company, product) =>
  sql
    .prepare('SELECT version FROM inventory_balances_exact WHERE company_id=? AND product_id=?')
    .get(company, product).version;
for (const [company, product, unit, opening] of [
  ['a', 'milk', 'each', '100'],
  ['a', 'beans', 'g', '1000'],
  ['a', 'syrup', 'each', '10'],
  ['b', 'scone', 'each', '50'],
]) {
  sql
    .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
    .run(company, product, JSON.stringify({ id: product, name: product }));
  await stock.configure({
    companyId: company,
    actor: 'owner',
    productId: product,
    operationId: 'setup-' + product,
    stockUnit: { kind: 'curated', id: unit },
    purchaseUnitLabel: 'pack',
    purchaseAmount: '1',
    openingAmount: opening,
    effectiveAt: iso(0),
  });
}
const scale = (product) =>
  BigInt(
    sql
      .prepare(
        'SELECT measured_minor m FROM inventory_reconciliations WHERE product_id=? AND opening=1',
      )
      .get(product).m,
  ) /
  BigInt(product === 'beans' ? 1000 : product === 'scone' ? 50 : product === 'syrup' ? 10 : 100);
const each = scale('milk');
const move = async (company, product, action, amount, day, hour = 0, unitId = 'each') => {
  now = at(day, hour);
  await stock.recordMovement({
    companyId: company,
    productId: product,
    operationId: crypto.randomUUID(),
    expectedVersion: version(company, product),
    actor: 'owner',
    action,
    amount,
    unitId,
    effectiveAt: iso(day, hour),
    note: '',
  });
};
const countNow = async (company, product, amount, day, unitId = 'each') => {
  now = at(day);
  await stock.recordCount({
    companyId: company,
    productId: product,
    operationId: crypto.randomUUID(),
    expectedVersion: version(company, product),
    actor: 'owner',
    amount,
    unitId,
    effectiveAt: iso(day),
    note: '',
  });
};
// Sales can arrive late: their time is when the sale happened, and their stock version is when
// it was recorded. The reader must place them by time, and a tie with a count by version.
const insertEvent = (product, action, units, day, recordedVersion = null) => {
  const row = sql
    .prepare(
      "SELECT config_id,version FROM inventory_balances_exact WHERE company_id='a' AND product_id=?",
    )
    .get(product);
  sql
    .prepare(
      `INSERT INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,
      balance_version_before,balance_version_after,effective_at,recorded_at,actor,note)
      VALUES('a',?,?,?,?,'count',?,?,?,?,?,'sales-ingestion','')`,
    )
    .run(
      crypto.randomUUID(),
      product,
      row.config_id,
      action,
      String(BigInt(units) * each),
      recordedVersion ?? row.version,
      recordedVersion ?? row.version,
      iso(day),
      iso(day),
    );
};

// Milk, period 1 (day 0 → 14): 2 used on days 1–13, 2 wasted on day 7, 30 received on day 10,
// and 1 used just before the count. 94 counted: 36 really used, 29 recorded.
for (let day = 1; day <= 13; day += 1) await move('a', 'milk', 'use', '2', day);
await move('a', 'milk', 'waste', '2', 7, 1);
await move('a', 'milk', 'receive', '30', 10, 1);
await move('a', 'milk', 'use', '1', 13, 23);
await countNow('a', 'milk', '94', 14);
const countVersion = version('a', 'milk');
// A late sale from day 12, recorded after the count, still belongs to period 1: 30 recorded there.
insertEvent('milk', 'sale_consumption', '-1', 12, countVersion + 1);
// Period 2 (day 14 → 20): a sale at the count's exact time but recorded after it, 5 received,
// 3 sold, 1 sale corrected back. 95 counted: 94 + 5 - 95 = 4 really used, 1 + 3 - 1 = 3 recorded.
insertEvent('milk', 'sale_consumption', '-1', 14, countVersion + 1);
await move('a', 'milk', 'receive', '5', 14, 1);
insertEvent('milk', 'sale_consumption', '-3', 16);
insertEvent('milk', 'sale_correction', '1', 17);
await countNow('a', 'milk', '95', 20);
// Beans: only the opening count and 100 g used. Syrup: a count higher than anything explains.
await move('a', 'beans', 'use', '100', 5, 0, 'g');
await countNow('a', 'syrup', '15', 10);
// Company b has its own history, which company a must never see.
await move('b', 'scone', 'use', '10', 3);
await countNow('b', 'scone', '30', 12);

now = at(20, 2);
const eventsBefore = sql.prepare('SELECT count(*) n FROM inventory_events_exact').get().n;
const view = await new D1StockUsage(db, clock).read('a');
assert.equal(
  sql.prepare('SELECT count(*) n FROM inventory_events_exact').get().n,
  eventsBefore,
  'Reading usage changes nothing',
);
assert.deepEqual(
  view.products.map((p) => p.productId),
  ['beans', 'milk', 'syrup'],
  'Only company a products',
);
const milk = view.products.find((p) => p.productId === 'milk');
const per = (units, days) => {
  const n = units * Number(each) * DAY,
    d = days * DAY;
  return String(Math.round(n / d));
};
assert.equal(milk.status, 'enough');
assert.equal(milk.countedDays, 20);
assert.equal(milk.measuredPerDay.minor, per(40, 20), '40 really used in 20 days');
assert.equal(milk.recordedPerDay.minor, per(33, 20), '33 recorded in 20 days');
assert.equal(milk.unrecordedPercent, 18, '7 of 40 not recorded (17.5% rounds up)');
assert.equal(milk.dailyUse.source, 'counts');
assert.equal(milk.unexplainedIncreases, 0);
assert.deepEqual(
  milk.recentCounts.map((c) => [c.difference.minor, c.differencePercent]),
  [
    [String(-4n * each), -4],
    [String(-7n * each), -7],
  ],
  'Newest first: 95 found vs 99 expected, then 94 vs 101',
);
// Seen from day 71, only period 2 is inside the 56-day window, which shows each late sale landed
// in the right period: the tie after the count is in period 2, the day-12 sale is not.
now = at(71);
const later = (await new D1StockUsage(db, clock).read('a')).products.find(
  (p) => p.productId === 'milk',
);
assert.equal(later.countedDays, 6);
assert.equal(later.measuredPerDay.minor, per(4, 6));
assert.equal(later.recordedPerDay.minor, per(3, 6));
now = at(20, 2);
const beans = view.products.find((p) => p.productId === 'beans');
assert.equal(beans.status, 'needs_counts');
assert.equal(beans.dailyUse.source, 'recorded');
assert.equal(beans.historyDays, 15.1);
const syrup = view.products.find((p) => p.productId === 'syrup');
assert.equal(syrup.unexplainedIncreases, 1);
assert.equal(syrup.measuredPerDay, null);

// --- Route: sign-in, company access, role and preview switch -----------------------------
globalThis.usageDb = db;
globalThis.usageEnabled = true;
globalThis.usageRole = 'employee';
const get = async (company) =>
  GET(new Request('https://app.local/api/inventory/usage?companyId=' + company));
globalThis.usageUser = null;
assert.equal((await get('a')).status, 401, 'Anonymous');
globalThis.usageUser = { userId: 'u', email: 'u@example.test' };
assert.equal((await get('b')).status, 403, 'Wrong company');
globalThis.usageRole = 'unknown-role';
assert.equal((await get('a')).status, 403, 'A role without read permission');
for (const role of ['employee', 'manager', 'owner']) {
  globalThis.usageRole = role;
  const response = await get('a');
  assert.equal(response.status, 200, role);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.json();
  assert.ok(body.products.every((p) => p.productId !== 'scone'));
}
globalThis.usageEnabled = false;
assert.equal((await get('a')).status, 404, 'Preview off');
globalThis.usageEnabled = true;
// A total too large to show exactly is refused, never rounded.
const huge = sql
  .prepare(
    "SELECT config_id,version FROM inventory_balances_exact WHERE company_id='a' AND product_id='beans'",
  )
  .get();
sql
  .prepare(
    `INSERT INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,
    balance_version_before,balance_version_after,effective_at,recorded_at,actor,note)
    VALUES('a','huge','beans',?,'use','mass','-9007199254740993',?,?,?,?,'test','')`,
  )
  .run(
    huge.config_id,
    huge.version,
    huge.version,
    new Date(Date.now() - DAY).toISOString(),
    new Date(Date.now() - DAY).toISOString(),
  );
assert.equal((await get('a')).status, 503, 'An inexact total is refused');
sql.prepare("DELETE FROM inventory_events_exact WHERE id='huge'").run();
assert.equal((await get('a')).status, 200);
globalThis.usageDb = {
  prepare() {
    throw new Error('database down');
  },
};
assert.equal((await get('a')).status, 503, 'A failed read is reported, not guessed');
console.log('Stock usage and accuracy passed.');
