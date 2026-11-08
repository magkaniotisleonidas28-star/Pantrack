import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/lib/purchase-order-archive-client.ts';export * from './src/lib/purchase-order-document-archive-contract.ts';export * from './src/lib/document-byte-digest.ts';export * from './src/lib/purchase-order-export-contract.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const core = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const request = {
    companyId: 'a',
    operationId: crypto.randomUUID(),
    format: 'pdf',
    source: { kind: 'draft', orderId: 'draft-1', revision: 1 },
  },
  id = crypto.randomUUID();
const item = {
  id,
  companyId: 'a',
  format: 'pdf',
  source: request.source,
  requestedAt: '2026-10-26T12:00:00.000Z',
  updatedAt: '2026-10-26T12:00:01.000Z',
  status: 'held',
  reason: 'held',
  issued: false,
  lastCheckedAt: null,
};
const artifact = core.captureArchiveArtifact({
  contract: 'pantrack.document-archive.v1',
  id,
  companyId: 'a',
  actorId: 'manager',
  format: 'pdf',
  template: core.archiveTemplate('draft', 'pdf'),
  label: core.PURCHASE_ORDER_EXPORT_LABEL,
  sha256: await core.documentByteDigest(new Uint8Array([1])),
  size: 1,
  source: {
    kind: 'draft',
    fingerprint: 'a'.repeat(64),
    records: [{ id: 'draft-1', revision: 1, status: 'draft' }],
  },
  requestedAt: item.requestedAt,
  issuedAt: item.updatedAt,
  retention: 'retain-until-explicit-policy',
});
const selection = { companyId: 'a', source: { ...request.source, revision: 2 } },
  context = () => ({ viewerId: 'manager', documentId: id, request });
function fixture(overrides = {}, store = new Map(), selected = selection) {
  const calls = [],
    states = [];
  let saved = 0,
    uuids = 0;
  const deps = {
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    uuid: () => {
      uuids++;
      return crypto.randomUUID();
    },
    download: () => assert.fail('Continuation does not download'),
    saved: () => saved++,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        const stored = JSON.parse(store.values().next().value);
        assert.equal(stored.documentId, id);
        assert.deepEqual(stored.request, JSON.parse(options.body));
        return Response.json({ artifact });
      }
      return Response.json(
        url.includes('view=continuation') ? context() : { artifact, viewerId: 'manager' },
      );
    },
    ...overrides,
  };
  const client = new core.PurchaseOrderArchiveClient(selected, 'manager', deps, (state) =>
    states.push(state),
  );
  return {
    client,
    store,
    calls,
    states,
    deps,
    get saved() {
      return saved;
    },
    get uuids() {
      return uuids;
    },
  };
}
const success = fixture();
await success.client.continueSave(item);
assert.equal(success.saved, 1);
assert.equal(success.uuids, 0);
assert.equal(success.store.size, 0);
assert.equal(success.calls.length, 3);
assert.ok(success.calls[0].url.includes('view=continuation'));
assert.equal(success.calls[0].options.headers['X-Pantrack-Archive-Viewer'], 'manager');
assert.deepEqual(JSON.parse(success.calls[1].options.body), request);
success.client.dispose();
let posts = [];
const lost = fixture({
  fetch: async (url, options) => {
    if (options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      throw Error('PRIVATE_LOST_RESPONSE');
    }
    return Response.json(context());
  },
});
await lost.client.continueSave(item);
assert.equal(lost.states.at(-1).pending, true);
assert.equal(lost.store.size, 1);
lost.client.dispose();
const restarted = fixture({}, lost.store, {
  companyId: 'a',
  source: { ...request.source, revision: 999 },
});
await restarted.client.retry();
assert.deepEqual(JSON.parse(restarted.calls[0].options.body), posts[0]);
assert.equal(restarted.saved, 1);
assert.equal(restarted.store.size, 0);
assert.equal(restarted.uuids, 0);
restarted.client.dispose();
const originalSlot = JSON.stringify({ ...request, operationId: crypto.randomUUID() }),
  busyStore = new Map([[lost.client.storageKey, originalSlot]]),
  busy = fixture({}, busyStore);
await busy.client.continueSave(item);
assert.equal(busy.calls.length, 0);
assert.equal(busyStore.get(lost.client.storageKey), originalSlot);
busy.client.dispose();
for (const change of [
  (c) => ({ ...c, viewerId: 'owner' }),
  (c) => ({ ...c, documentId: crypto.randomUUID() }),
  (c) => ({ ...c, request: { ...request, companyId: 'b' } }),
  (c) => ({ ...c, request: { ...request, source: { ...request.source, revision: 3 } } }),
  (c) => ({ ...c, request: { ...request, format: 'xlsx' } }),
  (c) => ({ ...c, providerKey: 'PRIVATE_KEY' }),
]) {
  const f = fixture({ fetch: async () => Response.json(change(context())) });
  await f.client.continueSave(item);
  assert.equal(f.store.size, 0);
  assert.equal(f.saved, 0);
  assert.equal(f.uuids, 0);
  f.client.dispose();
}
for (const mode of ['set', 'conflict']) {
  const store = new Map();
  let first = true;
  const f = fixture(
    {
      storage: {
        getItem: (key) => {
          if (first) {
            first = false;
            return null;
          }
          return mode === 'conflict' ? originalSlot : null;
        },
        setItem: () => {
          throw Error('PRIVATE_STORAGE');
        },
        removeItem: () => {},
      },
      fetch: async (url, options) => {
        assert.equal(options.method, 'GET');
        return Response.json(context());
      },
    },
    store,
  );
  await f.client.continueSave(item);
  assert.equal(f.saved, 0);
  assert.equal(f.uuids, 0);
  f.client.dispose();
}
for (const mode of ['denied', 'actor', 'artifact']) {
  const f = fixture({
    fetch: async (url, options) =>
      options.method === 'POST'
        ? Response.json({ artifact })
        : url.includes('view=continuation')
          ? Response.json(context())
          : mode === 'denied'
            ? Response.json({}, { status: 403 })
            : Response.json({
                viewerId: mode === 'actor' ? 'owner' : 'manager',
                artifact: mode === 'artifact' ? { ...artifact, id: crypto.randomUUID() } : artifact,
              }),
  });
  await f.client.continueSave(item);
  assert.equal(f.saved, 0);
  assert.equal(f.states.at(-1).pending, true);
  assert.equal(f.store.size, 1);
  f.client.dispose();
}
const wrongId = fixture({
  fetch: async (url, options) =>
    Response.json(
      options.method === 'POST'
        ? { artifact: { ...artifact, id: crypto.randomUUID() } }
        : context(),
    ),
});
await wrongId.client.continueSave(item);
assert.equal(wrongId.saved, 0);
assert.equal(wrongId.store.size, 1);
wrongId.client.dispose();
const history = {
  companyId: 'a',
  operationId: crypto.randomUUID(),
  format: 'xlsx',
  source: {
    kind: 'history',
    filters: { q: 'original', supplier: '' },
    fingerprint: 'a'.repeat(64),
  },
};
const historyPosts = [],
  historyClient = fixture(
    {
      fetch: async (url, options) => {
        if (options.method === 'POST') {
          historyPosts.push(JSON.parse(options.body));
          return Response.json({ code: 'busy' }, { status: 409 });
        }
        assert.ok(url.includes('view=continuation'));
        return Response.json({ ...context(), request: history });
      },
    },
    new Map(),
    {
      companyId: 'a',
      source: { kind: 'history', filters: { q: 'different current filter', supplier: '' } },
    },
  );
await historyClient.client.continueSave({ ...item, format: 'xlsx', source: { kind: 'history' } });
assert.deepEqual(historyPosts, [history]);
assert.equal(historyClient.uuids, 0);
historyClient.client.dispose();
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const delayed = deferred();
let canceled = 0;
const stale = fixture({ fetch: async () => delayed.promise }),
  waiting = stale.client.continueSave(item);
stale.client.cancel();
const stateCount = stale.states.length;
delayed.resolve(
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
assert.equal(stale.states.length, stateCount);
assert.equal(stale.store.size, 0);
stale.client.dispose();
const post = deferred(),
  entered = deferred(),
  late = fixture({
    fetch: async (url, options) => {
      if (options.method === 'POST') {
        entered.resolve();
        return post.promise;
      }
      return Response.json(context());
    },
  }),
  saving = late.client.continueSave(item);
await entered.promise;
await late.client.save('xlsx');
late.client.cancel();
assert.equal(late.store.size, 1);
post.resolve(Response.json({ artifact }));
await saving;
assert.equal(late.saved, 0);
assert.equal(late.uuids, 0);
assert.equal(late.states.at(-1).pending, true);
late.client.dispose();
const changed = fixture({
  fetch: async (url, options) =>
    options.method === 'POST'
      ? Response.json({ code: 'source_changed' }, { status: 409 })
      : Response.json(context()),
});
await changed.client.continueSave(item);
assert.equal(changed.store.size, 0);
assert.equal(changed.states.at(-1).reload, true);
changed.client.dispose();
console.log(
  'PASS: original-command continuation, persisted document binding, no new UUID/snapshot, pending-slot conflicts, lost reply/reload, final access refusal, historical criteria, stale bodies and canceled POST recovery.',
);
