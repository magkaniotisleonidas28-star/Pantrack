// P5 finding: looking up Clover menu names while a sales check held the
// Clover lease failed at once, so the owner saw item codes. A name lookup now
// waits briefly for the lease. Fictional sandbox data only; fetch is mocked.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
const sql = new DatabaseSync(':memory:');
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
globalThis.testUser = { userId: 'owner', email: 'owner@example.test' };
globalThis.testEnv = {
  APP_ORIGIN: 'https://test',
  CLOVER_ENVIRONMENT: 'sandbox',
  CLOVER_CLIENT_ID: 'app',
  CLOVER_CLIENT_SECRET: 'secret',
  VENDOR_ENCRYPTION_KEY: btoa('a'.repeat(32)),
  PANTRACK_CLOVER_SYNC_ENABLED: 'enabled',
};
const plugin = {
  name: 'mocks',
  setup(b) {
    b.onResolve({ filter: /chatgpt-auth|^@\/db\/raw$|^cloudflare:workers$/ }, (args) => ({
      path: args.path,
      namespace: 'mock',
    }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
      contents: args.path.includes('chatgpt-auth')
        ? 'export async function getChatGPTUser(){return globalThis.testUser}'
        : args.path === 'cloudflare:workers'
          ? 'export const env=globalThis.testEnv'
          : 'export function database(){return globalThis.testDB}',
    }));
  },
};
for (const [name, path] of [
  ['route', 'src/app/api/clover/route.ts'],
  ['clover', 'src/lib/clover.ts'],
  ['sync', 'src/lib/clover-sync.ts'],
  ['crypto', 'src/lib/vendor-adapter.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-names-${name}.mjs`,
    plugins: [plugin],
  });
const api = await import('../.sites-runtime/clover-names-route.mjs');
const { withClover, CLOVER_NAME_LOOKUP_WAIT_MS } =
  await import('../.sites-runtime/clover-names-clover.mjs');
const { syncClover } = await import('../.sites-runtime/clover-names-sync.mjs');
const { encrypt } = await import('../.sites-runtime/clover-names-crypto.mjs');

const now = Date.now();
sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('a', 'Cafe', 'now');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('owner', 'a', 'owner');
const token = {
  access_token: 'access',
  refresh_token: 'refresh',
  access_token_expiration: Math.floor(now / 1000) + 3600,
  refresh_token_expiration: Math.floor(now / 1000) + 86400,
};
sql
  .prepare(
    'INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)',
  )
  .run('a', 'merchant', 'sandbox', await encrypt(JSON.stringify(token), 'clover:a'), 'now', null);
sql
  .prepare(
    'INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)',
  )
  .run('a', 'sandbox', 'merchant', now - 300_000, now - 300_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let log = [],
  ordersDelay = 0;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== 'apisandbox.dev.clover.com')
    throw new Error('Only the mocked Clover sandbox may be called.');
  if (u.pathname.endsWith('/items')) {
    log.push(['items', Date.now()]);
    return Response.json({ elements: [{ id: 'RGRE8QX46R5PA', name: 'Latte' }] });
  }
  if (u.pathname.endsWith('/orders')) {
    log.push(['orders', Date.now()]);
    await sleep(ordersDelay);
    return Response.json({ elements: [] });
  }
  throw new Error('Unexpected Clover request ' + u.pathname);
};
const menu = async () => {
  const response = await api.POST(
    new Request('https://test/api/clover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://test' },
      body: JSON.stringify({ companyId: 'a', action: 'menu', offset: 0 }),
    }),
  );
  return { status: response.status, body: await response.json() };
};
const lease = () =>
  sql.prepare("SELECT lease_until FROM clover_connections WHERE company_id='a'").get().lease_until;
const holdLease = () =>
  sql
    .prepare("UPDATE clover_connections SET lease_until=? WHERE company_id='a'")
    .run(Date.now() + 120_000);
const releaseLease = () =>
  sql.prepare("UPDATE clover_connections SET lease_until=0 WHERE company_id='a'").run();

assert.ok(
  CLOVER_NAME_LOOKUP_WAIT_MS >= 10_000 && CLOVER_NAME_LOOKUP_WAIT_MS <= 25_000,
  'a name lookup waits long enough for a sales check, and less than a page timeout',
);

// --- Nothing else running: names come back at once -----------------------------
let started = Date.now();
let result = await menu();
assert.equal(result.status, 200);
assert.deepEqual(result.body.items, [{ id: 'RGRE8QX46R5PA', name: 'Latte' }]);
assert.ok(Date.now() - started < 400, 'no waiting when Clover is free');
assert.equal(lease(), 0);

// --- A sales check holds the lease, then finishes ------------------------------
log = [];
holdLease();
const released = sleep(1200).then(() => {
  log.push(['released', Date.now()]);
  releaseLease();
});
started = Date.now();
result = await menu();
await released;
assert.equal(result.status, 200, 'the lookup waited instead of failing');
assert.equal(result.body.items[0].name, 'Latte', 'the owner sees the name, not the code');
assert.ok(Date.now() - started >= 1200, 'it waited for the check to finish');
assert.deepEqual(
  log.map(([what]) => what),
  ['released', 'items'],
  'Clover was asked only after the other request let go: the lease stays exclusive',
);
assert.equal(lease(), 0, 'the lookup let go of the lease afterwards');

// --- The real sync and a lookup at the same time --------------------------------
log = [];
ordersDelay = 700;
const [synced, looked] = await Promise.all([syncClover('a'), sleep(100).then(menu)]);
ordersDelay = 0;
assert.equal(synced.created, 0);
assert.equal(looked.status, 200);
assert.equal(looked.body.items[0].name, 'Latte');
const firstItems = log.findIndex(([what]) => what === 'items');
assert.ok(firstItems > 0, 'the sync read its orders first');
assert.ok(
  log.slice(firstItems + 1).every(([what]) => what === 'items'),
  'the lookup ran after the sync, not in the middle of it',
);
assert.equal(
  sql.prepare("SELECT last_error FROM clover_sync_state WHERE company_id='a'").get().last_error,
  null,
  'the sync was not disturbed',
);
assert.equal(lease(), 0);

// --- A lease that isn't released: give up with a plain message ------------------
log = [];
holdLease();
started = Date.now();
await assert.rejects(
  withClover('a', async () => assert.fail('must not run'), { waitMs: 1200 }),
  /Clover is busy with another request\. Try again in a moment\./,
);
const waited = Date.now() - started;
assert.ok(waited >= 700 && waited < 2500, `gave up after about the wait (${waited} ms)`);
assert.deepEqual(log, [], 'Clover was not called');

// A sales check still doesn't wait: it steps aside at once and the next check
// carries on, so a Clover notice is answered quickly.
started = Date.now();
await assert.rejects(() => syncClover('a'), /Clover is busy/);
assert.ok(Date.now() - started < 400, 'a sync does not wait for the lease');
assert.equal(log.length, 0);
releaseLease();
await syncClover('a');
assert.equal(
  sql.prepare("SELECT last_error FROM clover_sync_state WHERE company_id='a'").get().last_error,
  null,
  'the next sync clears the error',
);

// --- No connection: say so at once, without waiting -----------------------------
sql.prepare("DELETE FROM clover_connections WHERE company_id='a'").run();
started = Date.now();
await assert.rejects(
  withClover('a', async () => assert.fail('must not run'), { waitMs: 5000 }),
  /Connect Clover first\./,
);
assert.ok(Date.now() - started < 400, 'a missing connection is not waited for');
result = await menu();
assert.equal(result.status, 400);
assert.equal(result.body.error, 'Connect Clover first.');

console.log('clover name lookup waits for a sales check: ok');
