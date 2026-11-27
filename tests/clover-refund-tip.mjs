// P5 finding: a Clover refund amount includes the tip given back with it. A
// full refund of a tipped order must read as a refund, not be paused as a
// mismatch. Fictional sandbox data only; fetch is mocked.
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
  ['sync', 'src/lib/clover-sync.ts'],
  ['orders', 'src/lib/clover-orders.ts'],
  ['crypto', 'src/lib/vendor-adapter.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-tip-${name}.mjs`,
    plugins: [plugin],
  });
const { syncClover } = await import('../.sites-runtime/clover-tip-sync.mjs');
const { readCloverOrder, normalizeCloverOrder } =
  await import('../.sites-runtime/clover-tip-orders.mjs');
const { encrypt } = await import('../.sites-runtime/clover-tip-crypto.mjs');

const now = Date.now(),
  cutoff = new Date(now - 600_000).toISOString(),
  started = now - 300_000;

// The sandbox order 4H2AW0KE5DR9G: a $5 latte paid in cash with a $1 tip.
const t = now - 200_000;
const tipped = (refunds, extra = {}) => ({
  id: 'tipped',
  createdTime: started + 1000,
  modifiedTime: t,
  total: 500,
  paymentState: 'PAID',
  payments: { elements: [{ id: 'pay', createdTime: t - 1000 }] },
  lineItems: { elements: [{ id: 'l1', item: { id: 'item' }, modifications: { elements: [] } }] },
  ...(refunds ? { refunds: { elements: refunds } } : {}),
  ...extra,
});
const read = (order) => readCloverOrder(order, order, started);

// --- How each refund is read ------------------------------------------------
const full = read(tipped([{ id: 'r', amount: 600, tipAmount: 100 }], { paymentState: 'REFUNDED' }));
assert.deepEqual(
  [full.unreadable, full.eventType, full.orderStatus, full.revision],
  [undefined, 'refund', 'refunded', t + 1],
  'a full refund with its tip is a full refund, as seen in the sandbox',
);
assert.equal(full.externalEventId, 'tipped:refund:r');
assert.deepEqual(
  read(tipped([{ id: 'r', amount: 600, tipAmount: 100 }])),
  full,
  'the same refund reads the same before Clover marks the order refunded',
);
assert.equal(
  read(tipped([{ id: 'r', amount: 300, tipAmount: 100 }])).orderStatus,
  'partially_refunded',
  'part of the items with the tip is a partial refund',
);
assert.equal(
  read(tipped([{ id: 'r', amount: 500, tipAmount: 0 }])).orderStatus,
  'refunded',
  'a refund that keeps the tip still covers the whole order',
);
assert.equal(
  read(
    tipped([
      { id: 'r1', amount: 300, tipAmount: 100 },
      { id: 'r2', amount: 300 },
    ]),
  ).orderStatus,
  'refunded',
  'two refunds that together give back the items and tip are a full refund',
);
assert.equal(
  read(tipped([{ id: 'r', amount: 500 }])).orderStatus,
  'refunded',
  'a refund with no tip field reads as before',
);
const tipOnly = read(tipped([{ id: 'r', amount: 100, tipAmount: 100 }]));
assert.deepEqual(
  [tipOnly.unreadable, tipOnly.eventType, tipOnly.revision],
  [undefined, 'sale', t],
  'giving back only the tip gives nothing back for the items, so the order stays a sale',
);
assert.deepEqual(tipOnly, read(tipped()), 'and reads exactly like the paid order');

// Refunds that still don't add up stay paused for review.
for (const [refunds, why] of [
  [[{ id: 'r', amount: 700, tipAmount: 100 }], 'more than the order and tip'],
  [[{ id: 'r', amount: 600 }], 'more than the order, with no tip given'],
  [[{ id: 'r', amount: 100, tipAmount: 200 }], 'a tip larger than the refund'],
  [[{ id: 'r', amount: 600, tipAmount: -100 }], 'a negative tip'],
  [[{ id: 'r', amount: 600, tipAmount: 99.5 }], 'a tip in part cents'],
  [[{ id: 'r', amount: 600, tipAmount: '100' }], 'a tip that is not a number'],
  [
    [
      { id: 'r1', amount: 400, tipAmount: 100 },
      { id: 'r2', amount: 400, tipAmount: 100 },
    ],
    'two refunds giving back more than the order',
  ],
])
  assert.equal(read(tipped(refunds)).unreadable, 'clover_refund_mismatch', why);
assert.throws(
  () => normalizeCloverOrder(tipped([{ id: 'r', amount: 700, tipAmount: 100 }]), started),
  (error) => error.reason === 'clover_refund_mismatch',
);

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
  .run('a', 'cup', 'active', 'count', '10', 1, cutoff, cutoff);
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

// --- The sandbox case through the real sync ---------------------------------
let order = tipped();
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== 'apisandbox.dev.clover.com')
    throw new Error('Only the mocked Clover sandbox may be called.');
  if (u.pathname.endsWith('/orders'))
    return Response.json({
      elements: u.searchParams.getAll('filter').some((value) => value.startsWith('deletedTime'))
        ? []
        : [{ id: order.id, modifiedTime: order.modifiedTime }],
    });
  return Response.json(order);
};
const cups = () =>
  sql
    .prepare(
      "SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id='cup'",
    )
    .get().on_hand_minor;
const states = () =>
  sql
    .prepare(
      "SELECT e.revision,json_extract(e.normalized_json,'$.eventType') AS event_type,s.state,s.last_reason FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a' ORDER BY e.revision",
    )
    .all()
    .map((row) => `${row.event_type}@${row.revision - t}:${row.state}:${row.last_reason ?? ''}`);
const lastError = () =>
  sql.prepare("SELECT last_error FROM clover_sync_state WHERE company_id='a'").get().last_error;

const sold = await syncClover('a');
assert.equal(sold.created, 1);
assert.equal(cups(), '9', 'the tipped latte took its cup');

// The owner refunds it in full in the Clover dashboard: $6, of which $1 tip.
// Clover keeps the same modified time, as in the sandbox.
order = tipped([{ id: 'r', amount: 600, tipAmount: 100 }], { paymentState: 'REFUNDED' });
const refunded = await syncClover('a');
assert.equal(refunded.paused, 0, 'the refund is not paused');
assert.equal(refunded.created, 1, 'the refund is received as its own revision');
assert.equal(lastError(), null);
const after = states();
assert.equal(after.length, 2);
assert.match(after[0], /^sale@0:/);
assert.match(after[1], /^refund@1:/, 'the refund takes the next revision');
assert.doesNotMatch(after[1], /:held:/, 'nothing asks for review');
assert.doesNotMatch(after[1], /clover_refund_mismatch/);
assert.equal(cups(), '9', 'a refund puts nothing back on the shelf (decision 0003)');

const again = await syncClover('a');
assert.equal(again.created, 0, 'reading it again adds nothing');
assert.equal(cups(), '9');

console.log('clover refund with tip: ok');
