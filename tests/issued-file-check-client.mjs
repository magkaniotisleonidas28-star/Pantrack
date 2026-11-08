import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync('.sites-runtime', { recursive: true });
await build({
  stdin: {
    contents:
      "export * from './src/lib/issued-file-check-client.ts';export * from './src/lib/purchase-order-document-archive-contract.ts';export * from './src/lib/purchase-order-export-contract.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/issued-check-client.mjs',
});
const core = await import('../.sites-runtime/issued-check-client.mjs'),
  selection = { companyId: 'a', documentId: crypto.randomUUID() };
const artifact = core.captureArchiveArtifact({
  contract: 'pantrack.document-archive.v1',
  id: selection.documentId,
  companyId: 'a',
  actorId: 'original-manager',
  format: 'pdf',
  template: core.archiveTemplate('draft', 'pdf'),
  label: core.PURCHASE_ORDER_EXPORT_LABEL,
  sha256: 'a'.repeat(64),
  size: 20,
  source: {
    kind: 'draft',
    fingerprint: 'b'.repeat(64),
    records: [{ id: 'draft-1', revision: 1, status: 'draft' }],
  },
  requestedAt: '2026-11-01T00:00:00.000Z',
  issuedAt: '2026-11-01T00:00:01.000Z',
  retention: 'retain-until-explicit-policy',
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(overrides = {}, map = new Map()) {
  const states = [],
    calls = [],
    commands = [];
  let recorded = 0;
  const deps = {
    storage: {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    },
    uuid: () => crypto.randomUUID(),
    recorded: () => recorded++,
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'same-origin');
      if (options.method === 'POST') {
        assert.equal(map.size, 1, 'Persist before dispatch');
        assert.equal(options.headers['X-Pantrack-Archive-Viewer'], 'manager');
        const command = JSON.parse(options.body);
        commands.push(command);
        return Response.json({
          viewerId: 'manager',
          replayed: false,
          check: {
            contract: 'pantrack.issued-file-check.v1',
            ...command,
            actorId: 'manager',
            checkedAt: '2026-11-01T01:00:00.000Z',
            outcome: 'verified',
          },
        });
      }
      return Response.json({ viewerId: 'manager', artifact });
    },
    ...overrides,
  };
  const client = new core.IssuedFileCheckClient(selection, 'manager', deps, (state) =>
    states.push(state),
  );
  return { client, states, calls, commands, map, deps, recorded: () => recorded };
}
const good = fixture();
await good.client.check();
assert.equal(good.states.at(-1).pending, false);
assert.equal(good.states.at(-1).check.outcome, 'verified');
assert.equal(good.recorded(), 1);
assert.equal(good.map.size, 0);
await good.client.check();
assert.notEqual(good.commands[0].operationId, good.commands[1].operationId);
good.client.dispose();
const lostMap = new Map(),
  lost = fixture(
    {
      fetch: async () => {
        throw Error('PRIVATE_REPLY_LOST');
      },
    },
    lostMap,
  );
await lost.client.check();
assert.equal(lost.states.at(-1).pending, true);
const original = JSON.parse([...lostMap.values()][0]);
lost.client.dispose();
const retry = fixture({}, lostMap);
await retry.client.check();
assert.equal(retry.calls.length, 0);
await retry.client.retry();
assert.deepEqual(retry.commands[0], original);
assert.equal(lostMap.size, 0);
retry.client.dispose();
for (const mode of [
  'denied',
  'server',
  'viewer',
  'actor',
  'company',
  'document',
  'operation',
  'malformed',
  'metadata-denied',
  'metadata-viewer',
  'metadata-record',
]) {
  const map = new Map();
  let f;
  f = fixture(
    {
      fetch: async (url, options) => {
        if (options.method === 'POST') {
          if (mode === 'denied' || mode === 'server')
            return Response.json(
              { error: 'PRIVATE_PROVIDER_MESSAGE' },
              { status: mode === 'denied' ? 403 : 503 },
            );
          const command = JSON.parse(options.body),
            check = {
              contract: 'pantrack.issued-file-check.v1',
              ...command,
              actorId: 'manager',
              checkedAt: '2026-11-01T01:00:00.000Z',
              outcome: 'verified',
            };
          if (mode === 'actor') check.actorId = 'owner';
          if (mode === 'company') check.companyId = 'b';
          if (mode === 'document') check.documentId = crypto.randomUUID();
          if (mode === 'operation') check.operationId = crypto.randomUUID();
          return Response.json(
            mode === 'malformed'
              ? { error: 'PRIVATE' }
              : { viewerId: mode === 'viewer' ? 'owner' : 'manager', replayed: false, check },
          );
        }
        if (mode === 'metadata-denied') return Response.json({}, { status: 403 });
        return Response.json({
          viewerId: mode === 'metadata-viewer' ? 'owner' : 'manager',
          artifact:
            mode === 'metadata-record' ? { ...artifact, id: crypto.randomUUID() } : artifact,
        });
      },
    },
    map,
  );
  await f.client.check();
  assert.equal(f.recorded(), 0);
  assert.equal(f.states.at(-1).pending, true);
  assert.equal(f.states.at(-1).check, undefined);
  assert.ok(!f.states.at(-1).message.includes('PRIVATE'));
  f.client.dispose();
}
const writeBlocked = fixture({
  storage: {
    getItem: () => null,
    setItem: () => {
      throw Error('PRIVATE_STORAGE');
    },
    removeItem: () => {},
  },
});
await writeBlocked.client.check();
assert.equal(writeBlocked.calls.length, 0);
assert.equal(writeBlocked.states.at(-1).retryable, false);
writeBlocked.client.dispose();
const removeBlocked = fixture({
  storage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {
      throw Error('PRIVATE_STORAGE');
    },
  },
  fetch: async (url, options) =>
    options.method === 'POST'
      ? Response.json({
          viewerId: 'manager',
          replayed: false,
          check: {
            contract: 'pantrack.issued-file-check.v1',
            ...JSON.parse(options.body),
            actorId: 'manager',
            checkedAt: '2026-11-01T01:00:00.000Z',
            outcome: 'verified',
          },
        })
      : Response.json({ viewerId: 'manager', artifact }),
});
await removeBlocked.client.check();
assert.equal(removeBlocked.states.at(-1).pending, true);
assert.equal(removeBlocked.states.at(-1).retryable, false);
removeBlocked.client.dispose();
for (const stored of [
  'not JSON',
  JSON.stringify({ ...original, companyId: 'b' }),
  JSON.stringify({ ...original, documentId: crypto.randomUUID() }),
]) {
  const map = new Map([[lost.client.storageKey, stored]]),
    f = fixture({}, map);
  await f.client.check();
  await f.client.retry();
  assert.equal(f.calls.length, 0);
  assert.equal(f.states.at(-1).retryable, false);
  f.client.dispose();
}
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
const metadataWait = deferred(),
  entered = deferred(),
  late = fixture({
    fetch: async (url, options) => {
      if (options.method === 'GET') {
        entered.resolve();
        return metadataWait.promise;
      }
      return Response.json({
        viewerId: 'manager',
        replayed: false,
        check: {
          contract: 'pantrack.issued-file-check.v1',
          ...JSON.parse(options.body),
          actorId: 'manager',
          checkedAt: '2026-11-01T01:00:00.000Z',
          outcome: 'verified',
        },
      });
    },
  }),
  checking = late.client.check();
await entered.promise;
late.client.dispose();
const emissions = late.states.length;
metadataWait.resolve(Response.json({ viewerId: 'manager', artifact }));
await checking;
assert.equal(late.states.length, emissions);
assert.equal(late.recorded(), 0);
console.log(
  'PASS: persistent issued-check command lifecycle, exact retry, new-check identity, storage refusal before dispatch, DTO/viewer/company/document binding, final access read and late response disposal.',
);
