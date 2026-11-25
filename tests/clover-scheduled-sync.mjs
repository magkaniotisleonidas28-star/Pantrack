// Clover pilot step P3: Pantrack checks Clover every 10 minutes (decision 0012).
// Fictional sandbox data only; Clover is mocked and never contacted.
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
  ['scheduled', 'src/lib/clover-scheduled.ts'],
  ['sync', 'src/lib/clover-sync.ts'],
  ['crypto', 'src/lib/vendor-adapter.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-p3-${name}.mjs`,
    plugins: [plugin],
    alias: { '@': './src' },
    logLevel: 'silent',
  });
const { runScheduledCloverSync, MAX_PASSES_PER_CAFE, RUN_BUDGET_MS } =
  await import('../.sites-runtime/clover-p3-scheduled.mjs');
const { syncClover } = await import('../.sites-runtime/clover-p3-sync.mjs');
const { encrypt } = await import('../.sites-runtime/clover-p3-crypto.mjs');

const now = Date.now(),
  day = 86_400_000,
  cutoff = new Date(now - 5 * day).toISOString();

// --- Sync off: the trigger does nothing at all ----------------------------------
let queries = 0;
const realDB = globalThis.testDB;
globalThis.testEnv.PANTRACK_CLOVER_SYNC_ENABLED = 'disabled';
assert.deepEqual(
  await runScheduledCloverSync({
    db: { prepare: () => (queries++, realDB.prepare('SELECT 1')) },
  }),
  { skipped: 'sync_disabled', cafes: [] },
);
assert.equal(queries, 0, 'with sync off, nothing is read');
globalThis.testEnv.PANTRACK_CLOVER_SYNC_ENABLED = 'enabled';

// --- Unit: passes, budget and outcomes with a fake sync -----------------------------
{
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('u1', 'u1', cutoff);
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('u2', 'u2', cutoff);
  for (const id of ['u1', 'u2']) {
    sql
      .prepare(
        "INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,lease_until) VALUES (?,?,'sandbox','x',?,0)",
      )
      .run(id, 'm-' + id, cutoff);
    sql
      .prepare(
        "INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,'sandbox',?,?,?,0)",
      )
      .run(id, 'm-' + id, now - 3 * day, now - 3 * day);
  }
  // u1 is three days behind: each pass moves a day, then it is caught up.
  const behind = { u1: now - 3 * day, u2: now - 60_000 };
  const calls = [];
  const fake = async (companyId) => {
    calls.push(companyId);
    behind[companyId] = Math.min(now, behind[companyId] + day);
    return { created: 1, paused: 0, checkpoint: new Date(behind[companyId]).toISOString() };
  };
  const run = await runScheduledCloverSync({ sync: fake, now: () => now });
  assert.deepEqual(
    run.cafes.map((c) => [c.companyId, c.outcome, c.passes]),
    [
      ['u1', 'synced', 3],
      ['u2', 'synced', 1],
    ],
    'the café furthest behind goes first and catches up in one run',
  );
  // A café can't take more than MAX_PASSES_PER_CAFE passes in one run.
  const stuck = await runScheduledCloverSync({
    sync: async () => ({ created: 0, checkpoint: new Date(now - 10 * day).toISOString() }),
    now: () => now,
  });
  assert.ok(stuck.cafes.every((c) => c.passes === MAX_PASSES_PER_CAFE));
  // Over the time budget, no new café is started; the next run carries on.
  let clock = now;
  const slow = await runScheduledCloverSync({
    sync: async () => {
      clock += RUN_BUDGET_MS + 1;
      return { created: 0, checkpoint: new Date(clock).toISOString() };
    },
    now: () => clock,
  });
  assert.equal(slow.cafes.length, 1, 'a run that used its time budget stops starting cafés');
  // One café's error doesn't stop the others; a held lease counts as busy.
  const mixed = await runScheduledCloverSync({
    sync: async (companyId) => {
      if (companyId === 'u1')
        throw new Error('Clover is disconnected or a sync is already running.');
      return { created: 2, checkpoint: new Date(now).toISOString() };
    },
    now: () => now,
  });
  assert.deepEqual(
    mixed.cafes.map((c) => [c.companyId, c.outcome, c.created]),
    [
      ['u1', 'busy', 0],
      ['u2', 'synced', 2],
    ],
  );
  const failing = await runScheduledCloverSync({
    sync: async (companyId) => {
      if (companyId === 'u1') throw new Error('Mock Clover outage.');
      return { created: 0, checkpoint: new Date(now).toISOString() };
    },
    now: () => now,
  });
  assert.deepEqual(
    failing.cafes.map((c) => [c.companyId, c.outcome]),
    [
      ['u1', 'failed'],
      ['u2', 'synced'],
    ],
  );
  for (const id of ['u1', 'u2']) {
    sql.prepare('DELETE FROM clover_sync_state WHERE company_id=?').run(id);
    sql.prepare('DELETE FROM clover_connections WHERE company_id=?').run(id);
  }
}

// --- Real sync: three cafés, mocked Clover -----------------------------------------
// a: connected, three days behind. b: connected, Clover fails for it.
// c: disconnected (sync state kept, no connection). d: another environment.
function stock(company) {
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company, 'cup', '{}');
  sql
    .prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)')
    .run(
      company,
      'cup',
      'canonical',
      1,
      'curated',
      'count',
      'canonical',
      '1',
      '1',
      'fixture',
      cutoff,
    );
  sql
    .prepare(
      'INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)',
    )
    .run(
      company,
      'cup',
      'active',
      1,
      'active',
      'canonical',
      1,
      'unit',
      '1',
      cutoff,
      'fixture',
      cutoff,
    );
  sql
    .prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)")
    .run(company, 'cup', 'active', 'count', '20', 1, cutoff, cutoff);
  sql
    .prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)')
    .run(company, 'drink', 'fixture', cutoff);
  sql
    .prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)")
    .run(company, 'drink', 'drink-v1', 'Latte', 'fixture', cutoff);
  sql
    .prepare(
      "INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)",
    )
    .run(company, 'drink', 'drink-v1', 0, 'cup', 'count', '1', '1');
  sql
    .prepare(
      "UPDATE recipe_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id='drink'",
    )
    .run(cutoff, company);
}
const token = {
  access_token: 'access',
  refresh_token: 'refresh',
  access_token_expiration: Math.floor(now / 1000) + 3600,
  refresh_token_expiration: Math.floor(now / 1000) + 86400,
};
const merchants = { a: 'ma', b: 'mb', c: 'mc', d: 'md' };
for (const [company, merchant] of Object.entries(merchants)) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, cutoff);
  stock(company);
  sql
    .prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)')
    .run(company, company === 'd' ? 'production' : 'sandbox', merchant, 'LATTE', 'drink');
  if (company !== 'c')
    sql
      .prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)')
      .run(
        company,
        merchant,
        company === 'd' ? 'production' : 'sandbox',
        await encrypt(JSON.stringify(token), 'clover:' + company),
        cutoff,
        null,
      );
  sql
    .prepare(
      'INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)',
    )
    .run(
      company,
      company === 'd' ? 'production' : 'sandbox',
      merchant,
      now - 3 * day,
      company === 'a' ? now - 3 * day : now - 30 * 60_000,
    );
}
const orders = { ma: [], mb: [], mc: [], md: [] };
let n = 0;
function sell(merchant, at) {
  const id = `o${++n}`;
  orders[merchant].push({
    id,
    createdTime: at - 1000,
    modifiedTime: at,
    total: 500,
    paymentState: 'PAID',
    payments: { elements: [{ id: 'p' + id, createdTime: at - 500 }] },
    lineItems: {
      elements: [{ id: 'l' + id, item: { id: 'LATTE' }, modifications: { elements: [] } }],
    },
  });
}
// Café a sold a latte 2.5 days ago, 1.5 days ago and 20 minutes ago.
sell('ma', now - 2.5 * day);
sell('ma', now - 1.5 * day);
sell('ma', now - 20 * 60_000);
sell('mb', now - 10 * 60_000);
sell('mc', now - 10 * 60_000);
sell('md', now - 10 * 60_000);
const contacted = new Set();
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (!u.hostname.endsWith('clover.com')) throw new Error('Only the mocked Clover may be called.');
  const merchant = u.pathname.split('/')[3];
  contacted.add(merchant);
  if (merchant === 'mb') throw new Error('Mock Clover outage for café b.');
  // Short pause so overlapping runs really interleave.
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (u.pathname.endsWith('/orders')) {
    if (u.searchParams.getAll('filter').some((value) => value.startsWith('deletedTime')))
      return Response.json({ elements: [] });
    return Response.json({
      elements: orders[merchant].map((o) => ({ id: o.id, modifiedTime: o.modifiedTime })),
    });
  }
  const id = decodeURIComponent(u.pathname.split('/').pop());
  return Response.json(orders[merchant].find((o) => o.id === id));
};
const cups = (company) =>
  sql
    .prepare(
      "SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id=? AND product_id='cup'",
    )
    .get(company).on_hand_minor;
const syncState = (company) =>
  sql
    .prepare('SELECT checkpoint,last_error,lease_until FROM clover_sync_state WHERE company_id=?')
    .get(company);

// Two triggers and a webhook (or Sync now) at the same moment.
const settled = await Promise.allSettled([
  runScheduledCloverSync(),
  runScheduledCloverSync(),
  syncClover('a'),
]);
assert.equal(settled[0].status, 'fulfilled', 'a trigger never throws');
assert.equal(settled[1].status, 'fulfilled');
const outcomes = [settled[0].value, settled[1].value].flatMap((run) =>
  run.cafes.map((c) => `${c.companyId}:${c.outcome}`),
);
assert.ok(outcomes.includes('b:failed'), "café b's Clover error is reported");
assert.ok(outcomes.includes('a:busy'), 'overlapping checks of café a step aside, not double up');
assert.ok(
  outcomes.filter((o) => o.startsWith('a:')).every((o) => /synced|busy/.test(o)),
  'café a is synced or skipped as busy, never failed',
);
assert.ok(
  !outcomes.some((o) => /^[cd]:/.test(o)),
  'a disconnected café and another environment are skipped',
);
assert.ok(!contacted.has('mc') && !contacted.has('md'), 'Clover is not read for them');
// Catch up whatever the webhook or other trigger left, as the next trigger would.
await runScheduledCloverSync();
assert.equal(cups('a'), '17', 'each of café a’s three sales came off stock once');
assert.ok(now - syncState('a').checkpoint < 15 * 60_000, 'café a caught up to now');
assert.equal(syncState('a').last_error, null);
assert.equal(syncState('a').lease_until, 0, 'no lease is left behind');
assert.match(syncState('b').last_error, /outage/, "café b's error is recorded on café b");
assert.equal(cups('b'), '20');
assert.equal(cups('c'), '20');
assert.equal(
  sql
    .prepare("SELECT COUNT(*) AS n FROM sales_events WHERE company_id='a' AND provider='clover'")
    .get().n,
  3,
  'three sales, each received once',
);
// A later trigger with nothing new changes nothing.
const quiet = await runScheduledCloverSync();
assert.deepEqual(
  quiet.cafes.find((c) => c.companyId === 'a'),
  { companyId: 'a', outcome: 'synced', passes: 1, created: 0, paused: 0 },
);
assert.equal(cups('a'), '17');
console.log(
  'PASS: Clover P3 — the 10-minute check syncs each café once, catches up, and isolates errors.',
);
