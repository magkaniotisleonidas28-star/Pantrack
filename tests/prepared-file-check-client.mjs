import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync('.sites-runtime', { recursive: true });
await build({
  stdin: {
    contents: "export * from './src/lib/prepared-file-check-client.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/prepared-check-client.mjs',
});
const { PreparedFileCheckClient } = await import('../.sites-runtime/prepared-check-client.mjs');
const selection = {
  companyId: 'a',
  documentId: crypto.randomUUID(),
  kind: 'draft',
  orderId: 'draft-1',
};
const detail = () => ({
  viewerId: 'manager',
  item: {
    id: selection.documentId,
    companyId: 'a',
    format: 'pdf',
    source: { kind: 'draft', orderId: 'draft-1', revision: 1 },
    requestedAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:01.000Z',
    status: 'held',
    reason: 'held',
    issued: false,
    lastCheckedAt: null,
  },
  canContinue: true,
  events: [],
  hasMore: false,
});
const result = (command) => ({
  viewerId: 'manager',
  replayed: false,
  check: {
    contract: 'pantrack.prepared-file-check.v1',
    ...command,
    actorId: 'manager',
    manifestFingerprint: 'a'.repeat(64),
    checkedAt: '2026-11-02T00:00:01.000Z',
    outcome: 'verified',
  },
});
const deferred = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve: (value) => resolve(value) };
};
function fixture(overrides = {}, map = new Map(), chosen = selection, viewer = 'manager') {
  const states = [],
    calls = [],
    commands = [];
  let recorded = 0,
    refused = 0;
  const deps = {
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    },
    uuid: () => crypto.randomUUID(),
    recorded: () => recorded++,
    refused: () => refused++,
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      if (options.method === 'POST') {
        assert.equal(url, '/api/purchase-order-documents/check-prepared');
        assert.equal(map.size, 1, 'Persist before dispatch');
        assert.equal(options.headers['X-Pantrack-Archive-Viewer'], 'manager');
        const command = JSON.parse(options.body);
        commands.push(command);
        return Response.json(result(command));
      }
      const params = new URL(url, 'http://app.test').searchParams;
      assert.equal(params.get('view'), 'review-detail');
      assert.equal(params.get('id'), chosen.documentId);
      assert.equal(params.get('kind'), chosen.kind);
      assert.equal(params.has('documentId'), false);
      return Response.json(detail());
    },
    ...overrides,
  };
  const client = new PreparedFileCheckClient(chosen, viewer, deps, (state) => states.push(state));
  return {
    client,
    states,
    calls,
    commands,
    deps,
    map,
    recorded: () => recorded,
    refused: () => refused,
  };
}
const good = fixture();
await good.client.check();
assert.equal(good.states.at(-1).check.outcome, 'verified');
assert.equal(good.states.at(-1).pending, false);
assert.equal(good.map.size, 0);
assert.equal(good.recorded(), 1);
await good.client.check();
assert.notEqual(good.commands[0].operationId, good.commands[1].operationId);
good.client.dispose();
const map = new Map(),
  lost = fixture(
    {
      fetch: async () => {
        throw Error('PRIVATE_LOST');
      },
    },
    map,
  );
await lost.client.check();
assert.equal(lost.states.at(-1).pending, true);
const original = JSON.parse([...map.values()][0]);
lost.client.dispose();
const retry = fixture({}, map);
await retry.client.check();
assert.equal(retry.calls.length, 0);
await retry.client.retry();
assert.deepEqual(retry.commands[0], original);
assert.equal(map.size, 0);
retry.client.dispose();
for (const mode of [
  'denied',
  'server',
  'viewer',
  'actor',
  'company',
  'document',
  'operation',
  'contract',
  'hash',
  'outcome',
  'malformed',
  'metadata-denied',
  'metadata-viewer',
  'metadata-company',
  'metadata-document',
  'metadata-source',
  'metadata-malformed',
]) {
  const f = fixture({
    fetch: async (url, options) => {
      if (options.method === 'POST') {
        if (['denied', 'server'].includes(mode))
          return Response.json(
            { error: 'PRIVATE_ERROR' },
            { status: mode === 'denied' ? 403 : 503 },
          );
        const value = result(JSON.parse(options.body));
        if (mode === 'viewer') value.viewerId = 'other';
        if (mode === 'actor') value.check.actorId = 'other';
        if (mode === 'company') value.check.companyId = 'b';
        if (mode === 'document') value.check.documentId = crypto.randomUUID();
        if (mode === 'operation') value.check.operationId = crypto.randomUUID();
        if (mode === 'contract') value.check.contract = 'pantrack.issued-file-check.v1';
        if (mode === 'hash') value.check.manifestFingerprint = 'PRIVATE_HASH';
        if (mode === 'outcome') value.check.outcome = 'approved';
        return Response.json(mode === 'malformed' ? { PRIVATE: 'value' } : value);
      }
      if (mode === 'metadata-denied') return Response.json({}, { status: 403 });
      const value = detail();
      if (mode === 'metadata-viewer') value.viewerId = 'other';
      if (mode === 'metadata-company') value.item.companyId = 'b';
      if (mode === 'metadata-document') value.item.id = crypto.randomUUID();
      if (mode === 'metadata-source') value.item.source.orderId = 'different';
      return Response.json(mode === 'metadata-malformed' ? { PRIVATE: 'metadata' } : value);
    },
  });
  await f.client.check();
  assert.equal(f.recorded(), 0);
  assert.equal(f.states.at(-1).pending, true);
  assert.equal(
    f.refused(),
    ['denied', 'metadata-denied'].includes(mode) ? 1 : 0,
    'Access refusal asks the parent to refresh and clear private evidence',
  );
  assert.equal(f.states.at(-1).check, undefined);
  assert.ok(!f.states.at(-1).message.includes('PRIVATE'));
  f.client.dispose();
}
const blocked = fixture({
  storage: {
    getItem: () => null,
    setItem: () => {
      throw Error('PRIVATE_STORAGE');
    },
    removeItem: () => {},
  },
});
await blocked.client.check();
assert.equal(blocked.calls.length, 0);
assert.equal(blocked.states.at(-1).retryable, false);
blocked.client.dispose();
const remove = fixture({
  storage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {
      throw Error('PRIVATE_REMOVE');
    },
  },
  fetch: async (url, options) =>
    Response.json(options.method === 'POST' ? result(JSON.parse(options.body)) : detail()),
});
await remove.client.check();
assert.equal(remove.states.at(-1).pending, true);
assert.equal(remove.states.at(-1).retryable, false);
remove.client.dispose();
for (const stored of [
  'broken JSON',
  JSON.stringify({ ...original, companyId: 'b' }),
  JSON.stringify({ ...original, documentId: crypto.randomUUID() }),
]) {
  const f = fixture({}, new Map([[lost.client.storageKey, stored]]));
  await f.client.check();
  await f.client.retry();
  assert.equal(f.calls.length, 0);
  assert.equal(f.states.at(-1).retryable, false);
  f.client.dispose();
}
const other = fixture(
  {},
  new Map([[lost.client.storageKey, JSON.stringify(original)]]),
  { ...selection, companyId: 'b' },
  'other',
);
assert.notEqual(other.client.storageKey, lost.client.storageKey);
other.client.dispose();
const pending = deferred(),
  stopped = fixture({ fetch: async () => pending.promise }),
  waiting = stopped.client.check();
stopped.client.cancel();
assert.equal(stopped.states.at(-1).pending, true);
assert.equal(stopped.states.at(-1).working, false);
let canceled = 0;
pending.resolve(
  new Response(
    new ReadableStream(
      {
        cancel() {
          canceled++;
        },
      },
      { highWaterMark: 0 },
    ),
  ),
);
await waiting;
assert.equal(canceled, 1);
assert.equal(stopped.recorded(), 0);
stopped.client.dispose();
for (const stop of ['cancel', 'dispose']) {
  const metadata = deferred(),
    entered = deferred(),
    f = fixture({
      fetch: async (url, options) => {
        if (options.method === 'GET') {
          entered.resolve();
          return metadata.promise;
        }
        return Response.json(result(JSON.parse(options.body)));
      },
    }),
    running = f.client.check();
  await entered.promise;
  f.client[stop]();
  const count = f.states.length;
  metadata.resolve(Response.json(detail()));
  await running;
  assert.equal(f.states.length, count);
  assert.equal(f.recorded(), 0);
  assert.equal(f.map.size, 1);
  f.client.dispose();
}
console.log(
  'PASS: actual prepared-check client request/storage/abort lifecycle, persist-before-send, exact recovery/new identity, current final review authorization, company/document/source/viewer binding, strict DTOs, private-data clearing and stale canceled/disposed resource refusal.',
);
