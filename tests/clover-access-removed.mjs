// Clover pilot step P4: Pantrack notices when its Clover access ends (decision 0012).
// Fictional sandbox data only; Clover is mocked and never contacted.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
const sql = new DatabaseSync(':memory:');
for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries)
  sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
globalThis.testDB = {
  prepare(query) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      async run() {
        const result = sql.prepare(query).run(...values);
        return { results: [], meta: { changes: Number(result.changes) } };
      },
      async first() {
        return sql.prepare(query).get(...values) ?? null;
      },
      async all() {
        return { results: sql.prepare(query).all(...values) };
      },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
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
  CLOVER_CLIENT_ID: 'APPID',
  CLOVER_CLIENT_SECRET: 'fictional-secret',
  CLOVER_WEBHOOK_AUTH_CODE: 'fictional-hook-code',
  VENDOR_ENCRYPTION_KEY: btoa('a'.repeat(32)),
  PANTRACK_CLOVER_SYNC_ENABLED: 'disabled',
};
const plugin = {
  name: 'mocks',
  setup(b) {
    b.onResolve({ filter: /chatgpt-auth|db\/raw|^cloudflare:workers$/ }, (args) => ({
      path: args.path,
      namespace: 'mock',
    }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
      contents: args.path.includes('chatgpt-auth')
        ? 'export async function getChatGPTUser(){return globalThis.testUser}'
        : args.path.includes('cloudflare:')
          ? 'export const env=globalThis.testEnv'
          : 'export function database(){return globalThis.testDB}',
    }));
  },
};
for (const [name, path] of [
  ['clover', 'src/app/api/clover/route.ts'],
  ['callback', 'src/app/api/clover/callback/route.ts'],
  ['webhook', 'src/app/api/clover/webhook/route.ts'],
  ['scheduled', 'src/lib/clover-scheduled.ts'],
  ['crypto', 'src/lib/vendor-adapter.ts'],
])
  await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `.sites-runtime/clover-p4-${name}.mjs`,
    plugins: [plugin],
    alias: { '@': './src' },
    logLevel: 'silent',
  });
const api = await import('../.sites-runtime/clover-p4-clover.mjs');
const callback = await import('../.sites-runtime/clover-p4-callback.mjs');
const webhook = await import('../.sites-runtime/clover-p4-webhook.mjs');
const { runScheduledCloverSync } = await import('../.sites-runtime/clover-p4-scheduled.mjs');
const { encrypt } = await import('../.sites-runtime/clover-p4-crypto.mjs');
console.error = () => {};

const now = Date.now(),
  cutoff = new Date(now - 86_400_000).toISOString();
for (const id of ['cafe', 'other'])
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(id, id, cutoff);
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('owner', 'cafe', 'owner');
const tokens = (access = 'fictional-access') => ({
  access_token: access,
  refresh_token: 'fictional-refresh',
  access_token_expiration: Math.floor(Date.now() / 1000) + 3600,
  refresh_token_expiration: Math.floor(Date.now() / 1000) + 86400,
});
async function connect(company, merchant, token = tokens()) {
  sql
    .prepare(
      'INSERT OR REPLACE INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)',
    )
    .run(
      company,
      merchant,
      'sandbox',
      await encrypt(JSON.stringify(token), 'clover:' + company),
      cutoff,
      cutoff,
    );
  sql
    .prepare(
      'INSERT OR IGNORE INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)',
    )
    .run(company, 'sandbox', merchant, now - 3_600_000, now - 600_000);
}
await connect('cafe', 'MERCHANT1');
await connect('other', 'MERCHANT2');
// History and links that must survive: a recipe link, a Not tracked mark and a sale.
sql
  .prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)')
  .run('cafe', 'sandbox', 'MERCHANT1', 'LATTE', 'drink');
sql
  .prepare(
    "INSERT INTO clover_not_tracked VALUES ('cafe','sandbox','MERCHANT1','item','GIFT','Gift card','owner@example.test',?)",
  )
  .run(cutoff);
sql
  .prepare(
    'INSERT INTO sales_events(company_id,event_key,lineage_key,application_key,provider,environment,merchant_id,external_event_id,external_order_id,revision,occurred_at,received_at,source_payload_sha256,normalized_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  .run(
    'cafe',
    'k',
    'l',
    'a',
    'clover',
    'sandbox',
    'MERCHANT1',
    'e',
    'o',
    1,
    cutoff,
    cutoff,
    'd',
    '{}',
  );
const kept = () => ({
  links: sql.prepare("SELECT COUNT(*) AS n FROM clover_item_mappings WHERE company_id='cafe'").get()
    .n,
  marks: sql.prepare("SELECT COUNT(*) AS n FROM clover_not_tracked WHERE company_id='cafe'").get()
    .n,
  sales: sql.prepare("SELECT COUNT(*) AS n FROM sales_events WHERE company_id='cafe'").get().n,
  checkpoint: sql.prepare("SELECT checkpoint FROM clover_sync_state WHERE company_id='cafe'").get()
    .checkpoint,
});
const history = kept();
const removal = (company = 'cafe') =>
  sql.prepare('SELECT reason FROM clover_access_removals WHERE company_id=?').get(company)
    ?.reason ?? null;
const connected = (company = 'cafe') =>
  !!sql.prepare('SELECT 1 FROM clover_connections WHERE company_id=?').get(company);
const status = async () =>
  (await api.GET(new Request('https://test/api/clover?companyId=cafe'))).json();

let cloverCalls = 0;
globalThis.fetch = async () => {
  cloverCalls++;
  throw new Error('Clover must not be called here.');
};
const notice = (body, auth = 'fictional-hook-code') =>
  webhook.POST(
    new Request('https://test/api/clover/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Clover-Auth': auth } : {}) },
      body: JSON.stringify(body),
    }),
  );
const removed = (merchant = 'MERCHANT1', appId = 'APPID', type = 'DELETE') => ({
  appId,
  merchants: { [merchant]: [{ objectId: 'A:APPID', type, ts: now }] },
});

// --- Notices that must change nothing ----------------------------------------------
assert.equal((await notice(removed(), 'wrong-code')).status, 404, 'unauthenticated, sync off');
assert.equal((await notice(removed(), null)).status, 404, 'no auth header, sync off');
globalThis.testEnv.PANTRACK_CLOVER_SYNC_ENABLED = 'enabled';
assert.equal((await notice(removed(), 'wrong-code')).status, 401, 'unauthenticated, sync on');
assert.equal((await notice(removed('MERCHANT1', 'OTHERAPP'))).status, 403, 'another app');
assert.equal((await notice(removed('UNKNOWN'))).status, 200, 'an unknown merchant is ignored');
assert.equal((await notice(removed('MERCHANT1', 'APPID', 'UPDATE'))).status, 200);
assert.equal(removal(), null, 'a subscription change is not a removal');
assert.ok(connected(), 'none of these disconnected the café');
assert.equal(
  sql.prepare("SELECT COUNT(*) AS n FROM security_audit WHERE action='clover.access_removed'").get()
    .n,
  0,
);
globalThis.testEnv.PANTRACK_CLOVER_SYNC_ENABLED = 'disabled';

// --- The café removes the app in Clover (sync still off) ---------------------------
assert.equal((await notice(removed())).status, 200);
assert.equal(removal(), 'app_removed');
assert.ok(!connected(), 'the stored Clover tokens are deleted');
assert.ok(connected('other'), "another café's connection is untouched");
assert.equal(removal('other'), null);
assert.deepEqual(kept(), history, 'links, marks, sales and the checkpoint are kept');
assert.equal(
  sql
    .prepare(
      "SELECT target FROM security_audit WHERE company_id='cafe' AND action='clover.access_removed'",
    )
    .get().target,
  'app_removed',
);
let shown = await status();
assert.equal(shown.connected, false);
assert.equal(shown.accessRemoved.reason, 'app_removed');
assert.ok(Date.parse(shown.accessRemoved.at) > 0);
assert.equal((await notice(removed())).status, 200, 'a repeated notice is harmless');
assert.equal(
  sql.prepare("SELECT COUNT(*) AS n FROM security_audit WHERE action='clover.access_removed'").get()
    .n,
  1,
);
globalThis.testEnv.PANTRACK_CLOVER_SYNC_ENABLED = 'enabled';
const run = await runScheduledCloverSync({ sync: async (id) => assert.fail('synced ' + id) });
assert.ok(!run.cafes.some((c) => c.companyId === 'cafe'), 'the 10-minute check skips the café');
assert.equal(cloverCalls, 0, 'Clover was not called');

// --- Reconnecting: a different merchant is refused, the same one restores ----------
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/oauth/v2/token')) return Response.json(tokens('fictional-new-access'));
  if (u.includes('/v3/merchants/')) return Response.json({ id: verifiedMerchant });
  throw new Error('Unexpected Clover request: ' + u);
};
let verifiedMerchant = 'SOMEONE_ELSE';
async function reconnect(merchant) {
  const start = await api.POST(
    new Request('https://test/api/clover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://test' },
      body: JSON.stringify({ companyId: 'cafe', action: 'connect' }),
    }),
  );
  const cookie = start.headers.get('Set-Cookie').split(';')[0];
  const state = new URL((await start.json()).url).searchParams.get('state');
  const done = await callback.GET(
    new Request(
      `https://test/api/clover/callback?code=code&merchant_id=${merchant}&state=${state}`,
      { headers: { cookie } },
    ),
  );
  return new URL(done.headers.get('Location')).searchParams;
}
assert.equal((await reconnect('MERCHANT1')).get('reason'), 'merchant_mismatch');
assert.equal(removal(), 'app_removed', 'a refused reconnect keeps the notice');
assert.ok(!connected());
verifiedMerchant = 'MERCHANT2';
assert.notEqual(
  (await reconnect('MERCHANT2')).get('clover'),
  'connected',
  "another café's Clover account can't be used",
);
assert.equal(removal(), 'app_removed');
verifiedMerchant = 'MERCHANT1';
assert.equal((await reconnect('MERCHANT1')).get('clover'), 'connected');
assert.equal(removal(), null, 'reconnecting clears the notice');
assert.ok(connected());
assert.deepEqual(kept(), history, 'the same merchant picks up where it left off');
shown = await status();
assert.equal(shown.accessRemoved, null);
assert.equal(shown.connected, true);

// --- Clover refuses the stored token ---------------------------------------------------
const menu = () =>
  api.POST(
    new Request('https://test/api/clover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://test' },
      body: JSON.stringify({ companyId: 'cafe', action: 'menu' }),
    }),
  );
globalThis.fetch = async () => new Response(null, { status: 401 });
let refused = await menu();
assert.equal(refused.status, 400);
assert.match((await refused.json()).error, /Clover access was removed/);
assert.equal(removal(), 'access_refused');
assert.ok(connected(), 'refused tokens are kept, so a working request can clear the notice');
assert.equal((await status()).accessRemoved.reason, 'access_refused');
const skipped = await runScheduledCloverSync({ sync: async (id) => assert.fail('synced ' + id) });
assert.ok(!skipped.cafes.some((c) => c.companyId === 'cafe'), 'automatic checks stop');
assert.equal(
  (
    await notice({
      appId: 'APPID',
      merchants: { MERCHANT1: [{ objectId: 'O:ORDER1', type: 'UPDATE', ts: now }] },
    })
  ).status,
  200,
  'an order notice is accepted but not synced',
);
assert.equal(
  sql.prepare("SELECT last_attempt FROM clover_sync_state WHERE company_id='cafe'").get()
    .last_attempt,
  null,
  'no sync was attempted',
);
// A request that works again clears a refused-access notice.
globalThis.fetch = async (url) =>
  String(url).includes('/items')
    ? Response.json({ elements: [{ id: 'LATTE', name: 'Latte' }] })
    : new Response(null, { status: 500 });
assert.equal((await menu()).status, 200);
assert.equal(removal(), null, 'Clover answered again, so the notice is cleared');

// A refresh token Clover refuses is a refused access too.
await connect('cafe', 'MERCHANT1', {
  ...tokens(),
  access_token_expiration: Math.floor(Date.now() / 1000) - 10,
});
globalThis.fetch = async (url) =>
  String(url).endsWith('/oauth/v2/refresh')
    ? new Response(null, { status: 401 })
    : assert.fail('Only the refresh may be tried.');
assert.equal((await menu()).status, 400);
assert.equal(removal(), 'access_refused');
// A Clover outage is not a refusal.
sql.prepare("DELETE FROM clover_access_removals WHERE company_id='cafe'").run();
await connect('cafe', 'MERCHANT1');
globalThis.fetch = async () => new Response(null, { status: 503 });
assert.equal((await menu()).status, 400);
assert.equal(removal(), null, 'a Clover outage does not count as removed access');

// --- Disconnecting clears the notice too -------------------------------------------------
await recordAgain();
async function recordAgain() {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  await menu();
  assert.equal(removal(), 'access_refused');
}
const disconnect = await api.POST(
  new Request('https://test/api/clover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://test' },
    body: JSON.stringify({ companyId: 'cafe', action: 'disconnect' }),
  }),
);
assert.equal(disconnect.status, 200);
assert.equal(removal(), null);
assert.deepEqual(
  { links: kept().links, marks: kept().marks, sales: kept().sales },
  { links: history.links, marks: history.marks, sales: history.sales },
);
console.log(
  'PASS: Clover P4 — removal and refused access stop syncing, keep history, and reconnect cleanly.',
);
