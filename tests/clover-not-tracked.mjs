// Clover pilot step P2: Not tracked items and options (decision 0012).
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
  APP_ORIGIN: 'https://test',
};
globalThis.testUser = null;
const plugin = {
  name: 'mocks',
  setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$|^@\/db\/raw$|chatgpt-auth/ }, (args) => ({
      path: args.path,
      namespace: 'mock',
    }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
      contents:
        args.path === 'cloudflare:workers'
          ? 'export const env=globalThis.testEnv'
          : args.path.includes('chatgpt-auth')
            ? 'export async function getChatGPTUser(){return globalThis.testUser}'
            : 'export function database(){return globalThis.testDB}',
    }));
  },
};
for (const [name, path] of [
  ['sync', 'src/lib/clover-sync.ts'],
  ['crypto', 'src/lib/vendor-adapter.ts'],
  ['runtime', 'src/lib/d1-sales-runtime.ts'],
  ['route', 'src/app/api/clover/not-tracked/route.ts'],
  ['clover', 'src/app/api/clover/route.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-p2-${name}.mjs`,
    plugins: [plugin],
    alias: { '@': './src' },
    logLevel: 'silent',
  });
const { syncClover } = await import('../.sites-runtime/clover-p2-sync.mjs');
const { encrypt } = await import('../.sites-runtime/clover-p2-crypto.mjs');
const { d1SalesService } = await import('../.sites-runtime/clover-p2-runtime.mjs');
const notTracked = await import('../.sites-runtime/clover-p2-route.mjs');
const cloverApi = await import('../.sites-runtime/clover-p2-clover.mjs');

const now = Date.now(),
  cutoff = new Date(now - 600_000).toISOString(),
  started = now - 300_000;

// --- Fixture café: a latte takes one cup -------------------------------------
for (const id of ['a', 'b'])
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(id, id, cutoff);
for (const [user, company, role] of [
  ['owner', 'a', 'owner'],
  ['manager', 'a', 'manager'],
  ['employee', 'a', 'employee'],
  ['owner-b', 'b', 'owner'],
])
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(user, company, role);
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
  .run('a', 'drink', 'drink-v1', 'Latte', 'fixture', cutoff);
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
  .run('a', 'sandbox', 'merchant', 'LATTE', 'drink');
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

// --- Mocked Clover ------------------------------------------------------------
let tick = 0;
const orders = [];
const line = (id, item, ...mods) => ({
  id,
  item: { id: item },
  modifications: { elements: mods.map((m, i) => ({ id: `${id}-m${i}`, modifier: { id: m } })) },
});
function sell(id, ...lines) {
  const modifiedTime = now - 200_000 + ++tick * 1000;
  orders.push({
    id,
    createdTime: started + 1000,
    modifiedTime,
    total: 500,
    paymentState: 'PAID',
    payments: { elements: [{ id: 'pay-' + id, createdTime: modifiedTime - 500 }] },
    lineItems: { elements: lines },
  });
}
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (!u.hostname.endsWith('clover.com')) throw new Error('Only the mocked Clover may be called.');
  if (u.pathname.endsWith('/orders')) {
    if (u.searchParams.getAll('filter').some((value) => value.startsWith('deletedTime')))
      return Response.json({ elements: [] });
    return Response.json({
      elements: orders
        .map((o) => ({ id: o.id, modifiedTime: o.modifiedTime }))
        .sort((x, y) => x.modifiedTime - y.modifiedTime || (x.id < y.id ? -1 : 1)),
    });
  }
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
const state = (id) => {
  const row = sql
    .prepare(
      "SELECT s.state,s.last_reason FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id='a' AND e.external_order_id=? ORDER BY e.revision DESC",
    )
    .get(id);
  return row && `${row.state}:${row.last_reason}`;
};
const key = (id) =>
  sql
    .prepare("SELECT event_key FROM sales_events WHERE company_id='a' AND external_order_id=?")
    .get(id).event_key;

// --- Route helpers --------------------------------------------------------------
const as = (user) => {
  globalThis.testUser = user ? { userId: user, email: `${user}@example.test` } : null;
};
const read = async (companyId = 'a') => {
  const response = await notTracked.GET(
    new Request('https://test/api/clover/not-tracked?companyId=' + companyId),
  );
  return { status: response.status, body: await response.json() };
};
const post = async (body, url = 'https://test/api/clover/not-tracked', api = notTracked) => {
  const response = await api.POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://test' },
      body: JSON.stringify({ companyId: 'a', ...body }),
    }),
  );
  return { status: response.status, body: await response.json() };
};
const mark = (kind, externalId, extra = {}) => post({ action: 'mark', kind, externalId, ...extra });
const unmark = (kind, externalId) => post({ action: 'unmark', kind, externalId });
const changes = () =>
  sql
    .prepare(
      "SELECT kind,external_id,action,actor FROM clover_not_tracked_changes WHERE company_id='a' ORDER BY at,rowid",
    )
    .all()
    .map((row) => `${row.action} ${row.kind} ${row.external_id} by ${row.actor}`);

// --- Before any marks, a gift card or "to go" pauses the sale -------------------
sell('mixed', line('l1', 'LATTE', 'TOGO'), line('l2', 'GIFT'));
sell('gift-only', line('l3', 'GIFT'));
await syncClover('a');
assert.equal(state('mixed'), 'held:unknown_modifier,unknown_item');
assert.equal(state('gift-only'), 'held:unknown_item');
assert.equal(cups(), '10');
as('owner');
let view = (await read()).body;
assert.deepEqual(
  view.unlinked.entries.map(
    (e) => `${e.kind}:${e.itemId}${e.modifierId ? '/' + e.modifierId : ''}`,
  ),
  ['item:GIFT', 'option:LATTE/TOGO'],
);

// --- Who can mark ----------------------------------------------------------------
as(null);
assert.equal((await read()).status, 401, 'signed out');
assert.equal((await mark('item', 'GIFT')).status, 401);
as('employee');
assert.equal((await read()).status, 403, 'staff cannot read the list');
assert.equal((await mark('item', 'GIFT')).status, 403, 'staff cannot mark');
as('owner-b');
assert.equal((await read()).status, 403, 'another company cannot read it');
assert.equal((await mark('item', 'GIFT')).status, 403, 'another company cannot mark');
assert.deepEqual((await read('b')).body, { connected: false, marks: [], unlinked: null });
assert.equal(
  (await post({ companyId: 'b', action: 'mark', kind: 'item', externalId: 'GIFT' })).body.error,
  'Connect Clover first.',
);
assert.equal(changes().length, 0, 'refused requests change nothing');

as('owner');
assert.equal((await mark('item', 'LATTE')).status, 400, 'a linked item is already tracked');
assert.equal((await mark('item', 'bad id!')).status, 400, 'IDs are checked');
assert.equal((await mark('thing', 'GIFT')).status, 400, 'only items and options');
let result = await mark('item', 'GIFT', { name: 'Gift card' });
assert.deepEqual([result.status, result.body.changed], [200, true]);
assert.equal((await mark('item', 'GIFT', { name: 'Gift card' })).body.changed, false);
as('manager');
assert.equal(
  (await mark('option', 'TOGO', { name: 'To go' })).body.changed,
  true,
  'managers can mark',
);
assert.deepEqual(changes(), [
  'mark item GIFT by owner@example.test',
  'mark option TOGO by manager@example.test',
]);
view = (await read()).body;
assert.deepEqual(view.marks.map((m) => [m.kind, m.externalId, m.name, m.markedBy]).sort(), [
  ['item', 'GIFT', 'Gift card', 'owner@example.test'],
  ['option', 'TOGO', 'To go', 'manager@example.test'],
]);
assert.deepEqual(view.unlinked.entries, [], 'marked items no longer wait');
assert.equal(view.unlinked.readySales, 2, 'both paused sales are ready to try again');

// --- Paused sales are applied once after marking ----------------------------------
const service = d1SalesService(globalThis.testDB);
const owner = { kind: 'user', userId: 'owner', companyId: 'a', role: 'owner' };
await service.replay('a', key('mixed'), owner, 'Gift card and to go are not tracked');
await service.process('a', key('mixed'));
assert.equal(state('mixed'), 'applied:inventory_applied');
assert.equal(cups(), '9', 'the mixed sale took exactly the latte’s cup');
await service.replay('a', key('gift-only'), owner, 'Gift card is not tracked');
await service.process('a', key('gift-only'));
assert.equal(state('gift-only'), 'applied:not_tracked_noop', 'a gift-card-only sale completes');
assert.equal(cups(), '9', 'and takes nothing');
await assert.rejects(
  service.replay('a', key('mixed'), owner, 'again'),
  /Only held or dismissed/,
  'an applied sale cannot be applied twice',
);
assert.equal(cups(), '9');

// --- New sales: marked lines take nothing, unmarked items still pause --------------
sell('mixed-2', line('l4', 'LATTE', 'TOGO'), line('l5', 'GIFT'), line('l6', 'LATTE'));
sell('cookie', line('l7', 'LATTE'), line('l8', 'COOKIE'));
await syncClover('a');
assert.equal(state('mixed-2'), 'applied:inventory_applied');
assert.equal(cups(), '7', 'two lattes, a gift card and to go: two cups');
assert.equal(state('cookie'), 'held:unknown_item', 'an unmarked item still pauses the sale');
assert.equal(cups(), '7', 'with nothing taken');
await syncClover('a');
assert.equal(cups(), '7', 'syncing again changes nothing');

// --- Undo: new sales with it pause again; who and when are kept ----------------------
as('manager');
assert.equal((await unmark('item', 'GIFT')).body.changed, true);
assert.equal((await unmark('item', 'GIFT')).body.changed, false, 'undoing twice changes nothing');
sell('gift-again', line('l9', 'GIFT'));
await syncClover('a');
assert.equal(state('gift-again'), 'held:unknown_item', 'after undo, it pauses again');
assert.equal(state('gift-only'), 'applied:not_tracked_noop', 'past sales are not changed');
assert.deepEqual(changes(), [
  'mark item GIFT by owner@example.test',
  'mark option TOGO by manager@example.test',
  'unmark item GIFT by manager@example.test',
]);
assert.ok(
  sql
    .prepare("SELECT at FROM clover_not_tracked_changes WHERE company_id='a'")
    .all()
    .every((row) => Number.isFinite(Date.parse(row.at))),
  'each change records when',
);

// --- Linking a marked item clears its mark ----------------------------------------
as('owner');
await mark('item', 'COOKIE');
result = await post(
  { action: 'mapItem', itemId: 'COOKIE', recipeId: 'drink' },
  'https://test/api/clover',
  cloverApi,
);
assert.equal(result.status, 200, JSON.stringify(result.body));
assert.deepEqual(
  (await read()).body.marks.map((m) => m.externalId),
  ['TOGO'],
  'the cookie is linked now, so its mark is gone',
);
assert.equal(changes().at(-1), 'unmark item COOKIE by owner@example.test');
console.log(
  'PASS: Clover P2 — Not tracked items and options take nothing; the rest still comes off stock.',
);
