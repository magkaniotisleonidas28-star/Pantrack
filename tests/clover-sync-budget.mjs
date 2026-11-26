// Clover sync budget: Cloudflare limits each Worker run to 50 outside requests
// (free plan) and 1,000 database requests. Found in the P5 sandbox session.
// Fictional data only; Clover is mocked and never contacted.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries)
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));

class Statement {
  constructor(query, values = []) {
    this.query = query;
    this.values = values;
  }
  bind(...values) {
    return new Statement(this.query, values);
  }
  async first() {
    return sql.prepare(this.query).get(...this.values) ?? null;
  }
  async all() {
    return { results: sql.prepare(this.query).all(...this.values) };
  }
  async run() {
    if (/^\s*SELECT\b/i.test(this.query))
      return { results: sql.prepare(this.query).all(...this.values), meta: { changes: 0 } };
    const r = sql.prepare(this.query).run(...this.values);
    return { results: [], meta: { changes: Number(r.changes) } };
  }
}
globalThis.testDB = {
  prepare(query) {
    return new Statement(query);
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const item of statements) results.push(await item.run());
      sql.exec('COMMIT');
      return results;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  },
};
globalThis.testEnv = {
  CLOVER_ENVIRONMENT: 'sandbox',
  CLOVER_CLIENT_ID: 'app',
  CLOVER_CLIENT_SECRET: 'secret',
  VENDOR_ENCRYPTION_KEY: btoa('a'.repeat(32)),
  PANTRACK_CLOVER_SYNC_ENABLED: 'enabled',
};
let dbCalls = 0;
const realDB = globalThis.testDB;
globalThis.testDB = {
  prepare(query) {
    const statement = realDB.prepare(query);
    const wrap = (s) => ({
      bind: (...values) => wrap(s.bind(...values)),
      first: (...a) => (dbCalls++, s.first(...a)),
      all: (...a) => (dbCalls++, s.all(...a)),
      run: (...a) => (dbCalls++, s.run(...a)),
      _inner: s,
    });
    return wrap(statement);
  },
  batch: (statements) => (dbCalls++, realDB.batch(statements.map((s) => s._inner ?? s))),
};
const plugin = {
  name: 'mocks',
  setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$|^@\/db\/raw$/ }, (args) => ({
      path: args.path,
      namespace: 'mock',
    }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
      contents:
        args.path === 'cloudflare:workers'
          ? 'export const env=globalThis.testEnv'
          : 'export function database(){return globalThis.testDB}',
    }));
  },
};
for (const [name, path] of [
  ['sync', 'src/lib/clover-sync.ts'],
  ['scheduled', 'src/lib/clover-scheduled.ts'],
  ['crypto', 'src/lib/vendor-adapter.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-budget-${name}.mjs`,
    plugins: [plugin],
    alias: { '@': './src' },
    logLevel: 'silent',
  });
const { syncClover, CLOVER_FETCH_BUDGET, CLOVER_NEW_SALES_BUDGET, cloverSyncBudget } =
  await import('../.sites-runtime/clover-budget-sync.mjs');
const { runScheduledCloverSync } = await import('../.sites-runtime/clover-budget-scheduled.mjs');
const { encrypt } = await import('../.sites-runtime/clover-budget-crypto.mjs');

const now = Date.now(),
  cutoff = new Date(now - 6 * 3600_000).toISOString(),
  started = now - 3 * 3600_000;
// --- Fixture café: one cup per drink ---------------------------------------
sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('a', 'a', cutoff);
sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a', 'cup', '{}');
sql
  .prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)')
  .run('a', 'cup', 'canonical', 1, 'curated', 'count', 'canonical', '1', '1', 'fixture', cutoff);
sql
  .prepare(
    'INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)',
  )
  .run('a', 'cup', 'active', 1, 'active', 'canonical', 1, 'unit', '1', cutoff, 'fixture', cutoff);
sql
  .prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)")
  .run('a', 'cup', 'active', 'count', '1000', 1, cutoff, cutoff);
sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run('a', 'drink', 'fixture', cutoff);
sql
  .prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)")
  .run('a', 'drink', 'drink-v1', 'Drink', 'fixture', cutoff);
sql
  .prepare(
    "INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)",
  )
  .run('a', 'drink', 'drink-v1', 0, 'cup', 'count', '1', '1');
sql
  .prepare(
    "UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='a' AND recipe_id='drink'",
  )
  .run(cutoff);
sql
  .prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)')
  .run('a', 'sandbox', 'merchant', 'item', 'drink');
const token = {
  access_token: 'access',
  refresh_token: 'refresh',
  access_token_expiration: Math.floor(now / 1000) + 3600,
  refresh_token_expiration: Math.floor(now / 1000) + 86400,
};
sql
  .prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)')
  .run('a', 'merchant', 'sandbox', await encrypt(JSON.stringify(token), 'clover:a'), cutoff, null);
sql
  .prepare(
    'INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)',
  )
  .run('a', 'sandbox', 'merchant', started, started);

// A busy hour: 105 paid lattes, all more than 10 minutes old.
const orders = Array.from({ length: 105 }, (_, i) => {
  const at = now - 90 * 60_000 + i * 30_000;
  return {
    id: 'ORDER' + String(i).padStart(4, '0'),
    createdTime: at - 1000,
    modifiedTime: at,
    total: 500,
    paymentState: 'PAID',
    payments: { elements: [{ id: 'pay' + i, createdTime: at - 500 }] },
    lineItems: {
      elements: [{ id: 'line' + i, item: { id: 'item' }, modifications: { elements: [] } }],
    },
  };
});
let fetches = 0,
  details = 0;
globalThis.fetch = async (url) => {
  fetches++;
  const u = new URL(String(url));
  if (u.hostname !== 'apisandbox.dev.clover.com') throw new Error('Only mocked Clover.');
  if (u.pathname.endsWith('/orders')) {
    const filters = u.searchParams.getAll('filter');
    if (filters.some((f) => f.startsWith('deletedTime'))) return Response.json({ elements: [] });
    const rows = orders
      .filter((row) =>
        filters.every((f) => {
          const [, field, op, raw] = /^(modifiedTime|id)(>=|<=|>|<|=)(.+)$/.exec(f);
          const value = field === 'id' ? raw : Number(raw),
            actual = row[field];
          return op === '>='
            ? actual >= value
            : op === '<='
              ? actual <= value
              : op === '>'
                ? actual > value
                : op === '<'
                  ? actual < value
                  : actual === value;
        }),
      )
      .sort((a, b) => a.modifiedTime - b.modifiedTime || (a.id < b.id ? -1 : 1));
    return Response.json({
      elements: rows
        .slice(0, Number(u.searchParams.get('limit')))
        .map((o) => ({ id: o.id, modifiedTime: o.modifiedTime })),
    });
  }
  details++;
  return Response.json(
    orders.find((o) => o.id === decodeURIComponent(u.pathname.split('/').pop())),
  );
};
const cups = () =>
  sql
    .prepare(
      "SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id='cup'",
    )
    .get().on_hand_minor;
const received = () =>
  sql.prepare("SELECT COUNT(*) AS n FROM sales_events WHERE company_id='a'").get().n;
const checkpoint = () =>
  sql.prepare("SELECT checkpoint FROM clover_sync_state WHERE company_id='a'").get().checkpoint;

assert.equal(CLOVER_FETCH_BUDGET, 40, 'stays under the free plan’s 50 requests per run');
assert.deepEqual(cloverSyncBudget(), { fetches: 40, newSales: CLOVER_NEW_SALES_BUDGET });
globalThis.testEnv.PANTRACK_CLOVER_FETCH_BUDGET = '500';
assert.equal(cloverSyncBudget().fetches, 500, 'a paid plan can raise it');
globalThis.testEnv.PANTRACK_CLOVER_FETCH_BUDGET = 'lots';
assert.equal(cloverSyncBudget().fetches, 40, 'a bad setting falls back');
delete globalThis.testEnv.PANTRACK_CLOVER_FETCH_BUDGET;

// --- Before the fix, one run tried all 105 and failed at Cloudflare's limit. Now each run
// stays within budget, records how far it got, and the next run carries on.
const runs = [];
let previous = checkpoint();
for (let run = 1; run <= 12 && received() < 105; run++) {
  fetches = 0;
  dbCalls = 0;
  const result = await syncClover('a');
  runs.push({ fetches, dbCalls, created: result.created, partial: result.partial });
  assert.ok(fetches <= 40, `run ${run}: ${fetches} Clover requests, within 40`);
  assert.ok(dbCalls <= 900, `run ${run}: ${dbCalls} database requests, under 1,000`);
  assert.ok(checkpoint() >= previous, 'the checkpoint never moves back');
  if (result.partial)
    assert.ok(checkpoint() > previous || result.created > 0, 'each partial run makes progress');
  previous = checkpoint();
}
assert.equal(received(), 105, 'all 105 sales arrived');
assert.equal(cups(), String(1000 - 105), 'each took its cup exactly once');
assert.ok(runs.length >= 6 && runs.length <= 7, `caught up in ${runs.length} runs`);
assert.ok(
  runs.slice(0, -1).every((r) => r.partial),
  'earlier runs were partial',
);
assert.equal(
  sql.prepare("SELECT last_error FROM clover_sync_state WHERE company_id='a'").get().last_error,
  null,
);
console.log('runs:', JSON.stringify(runs));

// --- A quiet run re-lists the hour but doesn't fetch details it already has.
fetches = 0;
details = 0;
dbCalls = 0;
const quiet = await syncClover('a');
assert.equal(quiet.created, 0);
assert.equal(quiet.partial, false);
assert.equal(details, 0, 'already-received orders are not read again');
assert.ok(fetches <= 4, `only list pages: ${fetches}`);
assert.equal(cups(), String(1000 - 105));

// --- An order changed in the last 10 minutes is read again: a refund can appear on the
// same modified time after the sale was received.
const recent = {
  ...orders[0],
  id: 'RECENT0001',
  createdTime: now - 3 * 60_000,
  modifiedTime: now - 2 * 60_000,
  payments: { elements: [{ id: 'payR', createdTime: now - 2 * 60_000 - 500 }] },
};
orders.push(recent);
await syncClover('a');
assert.equal(cups(), String(1000 - 106));
recent.refunds = { elements: [{ id: 'refundR', amount: 500 }] };
details = 0;
await syncClover('a');
assert.equal(details, 1, 'the recent order was read again');
assert.equal(
  sql
    .prepare(
      "SELECT COUNT(*) AS n FROM sales_events WHERE company_id='a' AND external_order_id='RECENT0001'",
    )
    .get().n,
  2,
  'its refund was received as a new revision',
);
assert.equal(cups(), String(1000 - 106), 'refunds never put stock back (decision 0003)');

// --- The 10-minute check shares one budget across its passes and stops when it runs out.
for (let i = 0; i < 30; i++) {
  const at = now - 40 * 60_000 + i * 10_000;
  orders.push({
    ...orders[0],
    id: 'LATE' + String(i).padStart(4, '0'),
    createdTime: at - 1000,
    modifiedTime: at,
    payments: { elements: [{ id: 'pl' + i, createdTime: at - 500 }] },
  });
}
orders.sort((a, b) => a.modifiedTime - b.modifiedTime || (a.id < b.id ? -1 : 1));
sql
  .prepare("UPDATE clover_sync_state SET checkpoint=? WHERE company_id='a'")
  .run(now - 45 * 60_000);
fetches = 0;
dbCalls = 0;
const scheduled = await runScheduledCloverSync({ sync: syncClover });
assert.equal(scheduled.cafes[0].outcome, 'synced');
assert.equal(scheduled.cafes[0].passes, 1, 'a partial pass ends the café’s turn');
assert.ok(
  fetches <= 40 && dbCalls <= 900,
  `one run: ${fetches} requests, ${dbCalls} database requests`,
);
await runScheduledCloverSync({ sync: syncClover });
assert.equal(cups(), String(1000 - 136), 'the next run finished the rest, once each');
console.log(
  'PASS: Clover sync stays within Cloudflare’s per-run limits and carries on where it stopped.',
);
