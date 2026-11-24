import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
await build({
  entryPoints: ['src/lib/clover-unlinked.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/clover-unlinked.mjs',
});
const { findUnlinkedClover, heldCloverSale, timeAgo, cloverPill, unlinkedHeadline } =
  await import('../.sites-runtime/clover-unlinked.mjs');

// Rules: an unlinked item pauses its sale; an option is only reported once its item is linked.
const linkedItems = new Set(['latte']);
const linkedOptions = new Set(['latte/shot']);
const calls = [];
const port = {
  async resolveLine({ externalItemId }) {
    calls.push('item:' + externalItemId);
    return linkedItems.has(externalItemId)
      ? { status: 'mapped', recipeId: 'r-' + externalItemId }
      : { status: 'unknown_item' };
  },
  async resolveModifier({ externalItemId, externalModifierId }) {
    calls.push('option:' + externalItemId + '/' + externalModifierId);
    return linkedOptions.has(externalItemId + '/' + externalModifierId)
      ? { status: 'mapped', modifierId: 'm' }
      : { status: 'unknown_modifier' };
  },
};
const line = (item, ...modifiers) => ({
  externalLineId: item + Math.random(),
  externalItemId: item,
  quantity: '1',
  modifiers: modifiers.map((id) => ({
    externalModifierLineId: id,
    externalModifierId: id,
    quantity: '1',
  })),
});
const source = { kind: 'native', provider: 'clover', environment: 'sandbox' };
const summary = await findUnlinkedClover(
  [
    {
      occurredAt: '2026-11-23T10:00:00Z',
      lines: [line('latte', 'oat'), line('muffin')],
      reasons: ['unknown_item', 'unknown_modifier'],
    },
    {
      occurredAt: '2026-11-23T09:00:00Z',
      lines: [line('muffin', 'warm'), line('muffin')],
      reasons: ['unknown_item'],
    },
    {
      occurredAt: '2026-11-23T08:00:00Z',
      lines: [line('gift')],
      reasons: ['opening_count_required'],
    },
    {
      occurredAt: '2026-11-23T07:00:00Z',
      lines: [line('latte', 'shot')],
      reasons: ['unknown_item'],
    },
    { occurredAt: '2026-11-23T06:00:00Z', lines: [line('latte')], reasons: ['unknown_variation'] },
    {
      occurredAt: '2026-11-23T05:00:00Z',
      lines: [line('latte')],
      reasons: ['unknown_item', 'unit_incompatible'],
    },
    { occurredAt: '2026-11-23T04:00:00Z', lines: [line('latte')], reasons: [] },
  ],
  port,
  { companyId: 'c', source },
);
assert.deepEqual(summary.entries, [
  { kind: 'item', itemId: 'muffin', pausedSales: 2, lastSeen: '2026-11-23T10:00:00Z' },
  {
    kind: 'option',
    itemId: 'latte',
    modifierId: 'oat',
    pausedSales: 1,
    lastSeen: '2026-11-23T10:00:00Z',
  },
  { kind: 'item', itemId: 'gift', pausedSales: 1, lastSeen: '2026-11-23T08:00:00Z' },
]);
assert.equal(summary.waitingSales, 3, 'three sales wait on a link');
assert.equal(summary.readySales, 2, 'fully linked paused sales are ready to try again');
// The 05:00 sale also has a unit problem and the 04:00 one has no stored reason: neither is "ready".
assert.equal(summary.more, false);
assert.ok(!calls.includes('option:muffin/warm'), 'options on an unlinked item are not checked');
assert.equal(new Set(calls).size, calls.length, 'each item and option is looked up once');

assert.equal(heldCloverSale({ occurred_at: 'x', normalized_json: '{', last_reason: null }), null);
assert.equal(heldCloverSale({ occurred_at: 'x', normalized_json: '{}', last_reason: null }), null);
assert.deepEqual(
  heldCloverSale({
    occurred_at: 'x',
    normalized_json: '{"lines":[]}',
    last_reason: 'unknown_item,unknown_modifier',
  }).reasons,
  ['unknown_item', 'unknown_modifier'],
);
assert.deepEqual(
  heldCloverSale({
    occurred_at: 'x',
    normalized_json: JSON.stringify({ lines: [line('a'), { externalItemId: 1 }, null] }),
  }).lines.map((l) => l.externalItemId),
  ['a'],
  'unreadable lines are skipped',
);

const now = Date.parse('2026-11-23T12:00:00Z');
const ago = (ms) => new Date(now - ms).toISOString();
assert.equal(timeAgo(null, now), null);
assert.equal(timeAgo('not a date', now), null);
assert.equal(timeAgo(ago(20_000), now), 'just now');
assert.equal(timeAgo(ago(4 * 60_000), now), '4 min ago');
assert.equal(timeAgo(ago(3 * 3_600_000), now), '3 h ago');
assert.equal(timeAgo(ago(86_400_000), now), '1 day ago');
assert.equal(timeAgo(ago(3 * 86_400_000), now), '3 days ago');
assert.deepEqual(cloverPill({ connected: false, syncEnabled: true }, now), {
  tone: 'neutral',
  label: 'Clover not connected',
});
assert.deepEqual(cloverPill({ connected: true, syncEnabled: false }, now), {
  tone: 'neutral',
  label: 'Clover connected · sync off',
});
assert.deepEqual(
  cloverPill(
    { connected: true, syncEnabled: true, sync: { lastSuccess: ago(60_000), lastError: 'x' } },
    now,
  ),
  { tone: 'bad', label: 'Clover sync problem' },
);
assert.deepEqual(
  cloverPill({ connected: true, syncEnabled: true, sync: { lastSuccess: ago(4 * 60_000) } }, now),
  { tone: 'good', label: 'Clover · checked 4 min ago' },
);
assert.deepEqual(cloverPill({ connected: true, syncEnabled: true, sync: null }, now), {
  tone: 'neutral',
  label: 'Clover · not checked yet',
});
assert.equal(unlinkedHeadline(summary.entries), "2 Clover items and 1 option aren't linked yet");
assert.equal(unlinkedHeadline(summary.entries.slice(0, 1)), "1 Clover item isn't linked yet");
assert.equal(unlinkedHeadline(summary.entries.slice(1, 2)), "1 Clover option isn't linked yet");

// The owner's Clover status includes the summary; others can't read it.
const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort())
  sql.exec(readFileSync('drizzle/' + f, 'utf8'));
globalThis.testDB = {
  prepare(query) {
    let v = [];
    return {
      bind(...values) {
        v = values;
        return this;
      },
      async run() {
        const result = sql.prepare(query).run(...v);
        return { ...result, meta: { changes: Number(result.changes) } };
      },
      async first() {
        return sql.prepare(query).get(...v) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...v) };
      },
    };
  },
  async batch(statements) {
    for (const statement of statements) await statement.run();
  },
};
globalThis.testEnv = {
  APP_ORIGIN: 'https://test',
  CLOVER_CLIENT_ID: 'test-client',
  CLOVER_CLIENT_SECRET: 'test-secret',
  CLOVER_ENVIRONMENT: 'sandbox',
  VENDOR_ENCRYPTION_KEY: btoa('a'.repeat(32)),
};
const plugin = {
  name: 'mocks',
  setup(b) {
    b.onResolve({ filter: /chatgpt-auth|db\/raw|^cloudflare:workers$/ }, (a) => ({
      path: a.path,
      namespace: 'mock',
    }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
      contents: a.path.includes('chatgpt-auth')
        ? 'export async function getChatGPTUser(){return globalThis.testUser}'
        : a.path.includes('cloudflare:')
          ? 'export const env=globalThis.testEnv'
          : 'export function database(){return globalThis.testDB}',
    }));
  },
};
for (const [name, path] of [
  ['clover-unlinked-route', 'src/app/api/clover/route.ts'],
  ['clover-unlinked-crypto', 'src/lib/vendor-adapter.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: `.sites-runtime/${name}.mjs`,
    plugins: [plugin],
    alias: { '@': './src' },
    logLevel: 'silent',
  });
const api = await import('../.sites-runtime/clover-unlinked-route.mjs');
const { encrypt } = await import('../.sites-runtime/clover-unlinked-crypto.mjs');

for (const id of ['cafe', 'other'])
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(id, id, 'now');
for (const [user, company, role] of [
  ['owner', 'cafe', 'owner'],
  ['manager', 'cafe', 'manager'],
  ['other-owner', 'other', 'owner'],
])
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(user, company, role);
const expires = Math.floor(Date.now() / 1000) + 3600;
sql
  .prepare(
    'INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)',
  )
  .run(
    'cafe',
    'merchant1',
    'sandbox',
    await encrypt(
      JSON.stringify({
        access_token: 'fictional-access',
        refresh_token: 'fictional-refresh',
        access_token_expiration: expires,
        refresh_token_expiration: expires,
      }),
      'clover:cafe',
    ),
    'now',
    'now',
  );
sql
  .prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)')
  .run('cafe', 'sandbox', 'merchant1', 'latte', 'recipe-latte');
let n = 0;
function sale(state, lines, { merchant = 'merchant1', json, reason = 'unknown_item' } = {}) {
  const key = 'event-' + ++n;
  sql
    .prepare(
      'INSERT INTO sales_events(company_id,event_key,lineage_key,application_key,provider,environment,merchant_id,external_event_id,external_order_id,revision,occurred_at,received_at,source_payload_sha256,normalized_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'cafe',
      key,
      'lineage-' + n,
      'application-' + n,
      'clover',
      'sandbox',
      merchant,
      'external-' + n,
      'order-' + n,
      1,
      `2026-11-23T0${n}:00:00.000Z`,
      'now',
      'digest',
      json ?? JSON.stringify({ lines }),
    );
  sql
    .prepare(
      'INSERT INTO sales_event_states(company_id,event_key,lineage_key,revision,state,last_reason,transition_actor,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run('cafe', key, 'lineage-' + n, 1, state, state === 'held' ? reason : null, 'worker', 'now');
}
sale('held', [line('muffin')]);
sale('held', [line('latte', 'oat')], { reason: 'unknown_modifier' });
sale('applied', [line('scone')]);
sale('held', [line('cookie')], { merchant: 'old-merchant' });
sale('held', [], { json: 'not json' });
sale('held', [line('latte')]);
sale('held', [line('latte')], { reason: 'opening_count_required' });

const status = (companyId = 'cafe') =>
  api.GET(new Request('https://test/api/clover?companyId=' + companyId));
globalThis.testUser = { userId: 'owner', email: 'owner@example.test' };
let body = await (await status()).json();
assert.deepEqual(body.unlinked, {
  entries: [
    {
      kind: 'option',
      itemId: 'latte',
      modifierId: 'oat',
      pausedSales: 1,
      lastSeen: '2026-11-23T02:00:00.000Z',
    },
    { kind: 'item', itemId: 'muffin', pausedSales: 1, lastSeen: '2026-11-23T01:00:00.000Z' },
  ],
  waitingSales: 2,
  readySales: 1,
  more: false,
});
sql
  .prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)')
  .run('cafe', 'sandbox', 'merchant1', 'muffin', 'recipe-muffin');
body = await (await status()).json();
assert.deepEqual(
  body.unlinked.entries.map(
    (entry) => entry.itemId + (entry.modifierId ? '/' + entry.modifierId : ''),
  ),
  ['latte/oat'],
  'a new link takes effect at once',
);
assert.equal(body.unlinked.readySales, 2);

globalThis.testUser = { userId: 'manager', email: 'manager@example.test' };
assert.equal((await status()).status, 403, 'managers cannot read the owner Clover status');
globalThis.testUser = { userId: 'other-owner', email: 'other@example.test' };
assert.equal((await status()).status, 403, 'another company cannot read it');
body = await (await status('other')).json();
assert.equal(body.connected, false);
assert.equal(body.unlinked, null, 'a company without Clover has no summary');
globalThis.testUser = null;
assert.equal((await status()).status, 401, 'signed-out visitors cannot read it');
console.log('Clover unlinked items tests passed.');
