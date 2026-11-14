import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
await build({
  stdin: {
    contents: `
      import * as legacy from './src/lib/sales-ingestion';
      import * as model from './src/lib/sales-event-model';
      import { InMemorySalesEventStore } from './src/lib/in-memory-sales-event-store';
      import { FakeSalesMappingPort } from './src/lib/fake-sales-mapping';
      export { legacy, model, InMemorySalesEventStore, FakeSalesMappingPort };
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/sales-module-compatibility.mjs',
});
const { legacy, model, InMemorySalesEventStore, FakeSalesMappingPort } =
  await import('../.sites-runtime/sales-module-compatibility.mjs');

assert.deepEqual(Object.keys(legacy).sort(), [
  'FakeSalesMappingPort',
  'InMemorySalesEventStore',
  'SALES_EVENT_CONTRACT',
  'SalesIngestionError',
  'SalesIngestionService',
  'canonicalSalesEvent',
  'leaseRecoveryOptions',
  'salesEventAuditFragment',
]);
assert.equal(legacy.InMemorySalesEventStore, InMemorySalesEventStore);
assert.equal(legacy.FakeSalesMappingPort, FakeSalesMappingPort);
assert.equal(legacy.SalesIngestionError, model.SalesIngestionError);
for (const name of ['canonicalSalesEvent', 'leaseRecoveryOptions', 'salesEventAuditFragment'])
  assert.equal(legacy[name], model[name]);

// Mix the public processing entry point with direct store/mapping imports. A
// restored store must remain compatible with both paths and preserve duplicates.
const source = {
  kind: 'manual',
  provider: 'fictional-pos',
  environment: 'internal',
  connectionId: 'fictional-connection',
  merchantId: 'fictional-company',
  locationId: 'default',
};
const actor = {
  kind: 'user',
  userId: 'fictional-manager',
  companyId: 'fictional-company',
  role: 'manager',
};
const draft = {
  schemaVersion: legacy.SALES_EVENT_CONTRACT,
  externalEventId: 'sale-1',
  externalOrderId: 'order-1',
  revision: 1,
  eventType: 'sale',
  orderStatus: 'completed',
  preparationStatus: 'prepared',
  occurredAt: '2026-01-01T10:00:00.000Z',
  timeQuality: 'confirmed',
  lines: [
    { externalLineId: 'line-1', externalItemId: 'item-1', quantity: '1', modifiers: [] },
  ],
};
const clock = { now: () => new Date('2026-01-01T11:00:00.000Z') };
let attempts = 0;
const inventory = {
  async consume(request) {
    attempts++;
    assert.equal(request.companyId, actor.companyId);
    assert.equal(request.lines[0].recipeId, 'recipe-1');
    return {
      contract: request.contract,
      companyId: request.companyId,
      idempotencyKey: request.idempotencyKey,
      occurredAt: request.occurredAt,
      status: 'applied',
      replayed: false,
      selectedVersions: [],
      changes: [],
    };
  },
};
const mappings = new FakeSalesMappingPort([
  {
    companyId: actor.companyId,
    provider: source.provider,
    externalItemId: 'item-1',
    recipeId: 'recipe-1',
  },
]);
const store = new InMemorySalesEventStore();
const service = new legacy.SalesIngestionService(store, mappings, inventory, { clock });
const context = { companyId: actor.companyId, source, actor };
const receipt = await service.receive(context, draft);
assert.equal((await service.process(actor.companyId, receipt.eventKey)).state, 'applied');

const restored = new legacy.InMemorySalesEventStore(store.snapshot());
const restarted = new legacy.SalesIngestionService(restored, mappings, inventory, { clock });
const duplicate = await restarted.receive(context, draft);
assert.equal(duplicate.kind, 'duplicate');
assert.equal(duplicate.state, 'applied');
assert.equal(attempts, 1);
assert.equal(await restored.event('another-company', receipt.eventKey), null);
await assert.rejects(
  () => restarted.process(actor.companyId, receipt.eventKey),
  (error) => error instanceof model.SalesIngestionError && error.code === 'claim_conflict',
);
await assert.rejects(
  () => restored.history('another-company', receipt.eventKey, 10),
  (error) => error instanceof legacy.SalesIngestionError && error.code === 'not_found',
);

console.log(
  'PASS: legacy sales exports retain constructor/error identity and interoperate with direct modules through application, snapshot restore and duplicate receipt.',
);
