// Clover pilot step P1: one order Pantrack can't read is paused on its own and
// syncing moves on (decision 0012). Fictional sandbox data only; fetch is mocked.
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
  ['runtime', 'src/lib/d1-sales-runtime.ts'],
  ['labels', 'src/lib/sales-hold-labels.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-p1-${name}.mjs`,
    plugins: [plugin],
  });
const { syncClover } = await import('../.sites-runtime/clover-p1-sync.mjs');
const { readCloverOrder, pausedCloverOrder, normalizeCloverOrder } =
  await import('../.sites-runtime/clover-p1-orders.mjs');
const { encrypt } = await import('../.sites-runtime/clover-p1-crypto.mjs');
const { d1SalesService } = await import('../.sites-runtime/clover-p1-runtime.mjs');
const { holdReasonText, isUnreadableClover } =
  await import('../.sites-runtime/clover-p1-labels.mjs');

const now = Date.now(),
  cutoff = new Date(now - 600_000).toISOString(),
  started = now - 300_000;

// --- How each unusual order is read -------------------------------------------
const paid = (id, modifiedTime, lines, extra = {}) => ({
  id,
  createdTime: started + 1000,
  modifiedTime,
  total: 500,
  paymentState: 'PAID',
  payments: { elements: [{ id: 'pay-' + id, createdTime: modifiedTime - 1000 }] },
  lineItems: { elements: lines },
  ...extra,
});
const drink = (id) => ({ id, item: { id: 'item' }, modifications: { elements: [] } });
const t = now - 200_000;
const reasonOf = (order) => readCloverOrder(order, order, started)?.unreadable;
assert.equal(reasonOf(paid('ok', t, [drink('l1')])), undefined, 'a normal order is read as usual');
assert.equal(
  reasonOf(paid('custom', t, [drink('l1'), { id: 'l2', modifications: { elements: [] } }])),
  'clover_custom_amount',
);
assert.equal(
  reasonOf(paid('weigh', t, [{ ...drink('l1'), unitQty: 1500 }])),
  'clover_sold_by_weight',
);
assert.equal(
  reasonOf(
    paid(
      'big',
      t,
      Array.from({ length: 100 }, (_, i) => drink('l' + i)),
    ),
  ),
  'clover_order_too_large',
);
assert.equal(
  reasonOf(
    paid('mods', t, [
      {
        ...drink('l1'),
        modifications: {
          elements: Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, modifier: { id: 'x' } })),
        },
      },
    ]),
  ),
  'clover_order_too_large',
);
assert.equal(
  reasonOf(paid('refund', t, [drink('l1')], { refunds: { elements: [{ id: 'r', amount: 900 }] } })),
  'clover_refund_mismatch',
);
assert.equal(
  reasonOf(paid('nolines', t, undefined, { lineItems: undefined })),
  'clover_unreadable_order',
);
assert.equal(
  reasonOf(
    paid('nopay', t, [drink('l1')], { payments: { elements: [{ id: 'p', createdTime: -1 }] } }),
  ),
  'clover_unreadable_order',
);
assert.equal(
  readCloverOrder(
    { id: 'open', modifiedTime: t },
    { ...paid('open', t, [{ id: 'l' }]), paymentState: 'OPEN' },
    started,
  ),
  null,
  'an unpaid open order is still ignored, even with a custom amount',
);
assert.equal(
  readCloverOrder(
    { id: 'old', modifiedTime: t },
    { ...paid('old', t, [{ id: 'l' }]), createdTime: started - 1 },
    started,
  ),
  null,
  'orders from before connecting are still ignored',
);
const paused = pausedCloverOrder({ id: 'custom', modifiedTime: t }, 'clover_custom_amount');
assert.deepEqual(
  {
    id: paused.externalEventId,
    revision: paused.revision,
    lines: paused.lines,
    quality: paused.timeQuality,
  },
  { id: `custom:${t}`, revision: t, lines: [], quality: 'inferred' },
  'a paused order has no lines, so nothing can come off stock',
);
const refundPause = pausedCloverOrder({ id: 'refund', modifiedTime: t }, 'clover_refund_mismatch');
assert.equal(refundPause.revision, t + 1, 'a refund pause takes the next revision, like a refund');
assert.equal(refundPause.externalEventId, `refund:refund-review:${t}`);
assert.equal(
  pausedCloverOrder({ id: 'future', modifiedTime: now + 60_000 }, 'clover_unreadable_order', now)
    .occurredAt,
  new Date(now).toISOString(),
  'a slightly future Clover time is not accepted as the sale time',
);
const deletedBig = readCloverOrder(
  { id: 'gone', modifiedTime: t },
  {
    id: 'gone',
    createdTime: started + 1,
    modifiedTime: t,
    lineItems: { elements: Array.from({ length: 120 }, (_, i) => drink('d' + i)) },
  },
  started,
  true,
);
assert.deepEqual(
  [deletedBig.eventType, deletedBig.lines.length, deletedBig.unreadable],
  ['cancellation', 0, undefined],
  'an unreadable deleted order becomes a plain deletion with no lines',
);
assert.throws(
  () => normalizeCloverOrder(paid('custom', t, [{ id: 'l2' }]), started),
  (error) => error.reason === 'clover_custom_amount',
  'the plain reader still refuses the order, with a reason',
);
assert.equal(holdReasonText('clover_custom_amount'), 'Custom amount with no menu item');
assert.equal(
  holdReasonText('unknown_item,clover_sold_by_weight'),
  'unknown_item · Item sold by weight or a part quantity',
);
assert.equal(isUnreadableClover('clover_order_too_large'), true);
assert.equal(isUnreadableClover('unknown_item'), false);

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

// Good orders sit on both sides of every kind of unusual order.
const at = (n) => now - 200_000 + n * 1000;
let orders = [
  paid('good-1', at(1), [drink('g1')]),
  paid('custom', at(2), [drink('c1'), { id: 'c2', modifications: { elements: [] } }]),
  paid('weighed', at(3), [{ ...drink('w1'), unitQty: 250 }]),
  paid(
    'large',
    at(4),
    Array.from({ length: 100 }, (_, i) => drink('big' + i)),
  ),
  paid('refund', at(5), [drink('r1')], { refunds: { elements: [{ id: 'r', amount: 999 }] } }),
  paid('badline', at(6), [{ ...drink('bad line id with spaces and more'.repeat(10)) }]),
  paid('swapped', at(7), [drink('s1')]),
  paid('good-2', at(8), [drink('g2')]),
];
const details = (id) => (id === 'swapped' ? { ...orders[0] } : orders.find((o) => o.id === id));
let requests = 0;
globalThis.fetch = async (url) => {
  requests++;
  const u = new URL(String(url));
  if (u.hostname !== 'apisandbox.dev.clover.com' && !u.hostname.endsWith('clover.com'))
    throw new Error('Only the mocked Clover sandbox may be called.');
  if (u.pathname.endsWith('/orders')) {
    if (u.searchParams.getAll('filter').some((value) => value.startsWith('deletedTime')))
      return Response.json({ elements: [] });
    return Response.json({
      elements: orders
        .map((o) => ({ id: o.id, modifiedTime: o.modifiedTime }))
        .sort((x, y) => x.modifiedTime - y.modifiedTime || (x.id < y.id ? -1 : 1)),
    });
  }
  const id = decodeURIComponent(u.pathname.split('/').pop());
  return Response.json(details(id));
};
const cups = () =>
  sql
    .prepare(
      "SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id='cup'",
    )
    .get().on_hand_minor;
const states = () =>
  Object.fromEntries(
    sql
      .prepare(
        "SELECT e.external_order_id AS id,s.state,s.last_reason FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a' ORDER BY e.external_order_id,e.revision",
      )
      .all()
      .map((row) => [row.id, `${row.state}${row.last_reason ? ':' + row.last_reason : ''}`]),
  );
const syncState = () =>
  sql
    .prepare(
      "SELECT checkpoint,last_error,last_success FROM clover_sync_state WHERE company_id='a'",
    )
    .get();

const first = await syncClover('a');
assert.equal(cups(), '8', 'the two good orders each took one cup, once');
assert.deepEqual(states(), {
  'good-1': 'applied:inventory_applied',
  'good-2': 'applied:inventory_applied',
  custom: 'held:clover_custom_amount',
  weighed: 'held:clover_sold_by_weight',
  large: 'held:clover_order_too_large',
  refund: 'held:clover_refund_mismatch',
  badline: 'held:clover_unreadable_order',
  swapped: 'held:clover_unreadable_order',
});
assert.equal(first.paused, 6, 'six unusual orders were paused');
assert.equal(first.created, 8);
assert.equal(syncState().last_error, null, 'the sync finished without an error');
assert.ok(syncState().checkpoint > started, 'the checkpoint moved past the unusual orders');
assert.ok(syncState().last_success, 'the sync is recorded as successful');

const again = await syncClover('a');
assert.equal(again.created, 0, 'a second sync adds nothing');
assert.equal(again.duplicates, 8);
assert.equal(cups(), '8', 'and takes nothing more from stock');

// Review: trying a paused order again keeps it paused; dismissing it is the review.
const service = d1SalesService(globalThis.testDB);
const owner = { kind: 'user', userId: 'owner', companyId: 'a', role: 'owner' };
const key = (id) =>
  sql
    .prepare("SELECT event_key FROM sales_events WHERE company_id='a' AND external_order_id=?")
    .get(id).event_key;
await service.replay('a', key('custom'), owner, 'Checked in Clover');
await service.process('a', key('custom'));
assert.equal(states().custom, 'held:clover_custom_amount', 'trying again keeps it paused');
assert.equal(cups(), '8');
await service.dismiss('a', key('weighed'), owner, 'Weighed bakery item, not tracked');
assert.ok(states().weighed.startsWith('dismissed'), 'a person can dismiss a paused order');
assert.equal(cups(), '8');

// A later change in Clover makes the custom-amount order readable: it is applied once.
orders = orders.map((o) => (o.id === 'custom' ? paid('custom', now - 50_000, [drink('c1')]) : o));
const later = await syncClover('a');
assert.equal(later.created, 1);
assert.equal(cups(), '7', 'the corrected order took its cup once');
const customRows = sql
  .prepare(
    "SELECT s.state FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a' AND e.external_order_id='custom' ORDER BY e.revision",
  )
  .all()
  .map((row) => row.state);
assert.equal(customRows.at(-1), 'applied', 'the new revision of the order was applied');
assert.equal((await syncClover('a')).created, 0);
assert.equal(cups(), '7', 'and only once');

// A payment time a little ahead of this clock is not paused for good: the run
// stops as before, and the next sync reads the order once the time has passed.
const skewed = paid('skewed', now - 40_000, [drink('k1')]);
skewed.payments = { elements: [{ id: 'pay-skewed', createdTime: Date.now() + 120_000 }] };
orders = [...orders, skewed];
await assert.rejects(() => syncClover('a'), /future/);
assert.equal(states().skewed, undefined, 'a clock-skewed order is not paused');
orders = orders.filter((o) => o.id !== 'skewed');

// Intake accepts a paused order only from Clover, and only with no lines.
const manual = {
  kind: 'manual',
  provider: 'pantrack-manual',
  environment: 'internal',
  connectionId: 'manual-entry',
  merchantId: 'a',
  locationId: 'default',
};
await assert.rejects(
  service.receive(
    { companyId: 'a', source: manual, actor: owner },
    pausedCloverOrder({ id: 'x', modifiedTime: t }, 'clover_custom_amount'),
  ),
  (error) => error.code === 'invalid_unreadable',
  'a non-Clover source cannot send a paused order',
);
const clover = {
  kind: 'native',
  provider: 'clover',
  environment: 'sandbox',
  connectionId: 'clover:a',
  merchantId: 'merchant',
  locationId: 'merchant',
};
const machine = { kind: 'machine', machineId: 'clover:a', companyId: 'a', source: clover };
await assert.rejects(
  service.receive(
    { companyId: 'a', source: clover, actor: machine },
    {
      ...pausedCloverOrder({ id: 'y', modifiedTime: t }, 'clover_custom_amount'),
      lines: [drink('l')].map((l) => ({
        externalLineId: l.id,
        externalItemId: 'item',
        quantity: '1',
        modifiers: [],
      })),
    },
  ),
  (error) => error.code === 'invalid_lines',
  'a paused order cannot carry lines',
);
await assert.rejects(
  service.receive(
    { companyId: 'a', source: clover, actor: machine },
    {
      ...pausedCloverOrder({ id: 'z', modifiedTime: t }, 'clover_custom_amount'),
      unreadable: 'made_up',
    },
  ),
  (error) => error.code === 'invalid_unreadable',
  'only known pause reasons are accepted',
);
assert.ok(requests > 0);
console.log('PASS: Clover P1 — unusual orders are paused on their own and syncing moves on.');
