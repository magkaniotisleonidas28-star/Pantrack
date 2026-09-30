import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';

mkdirSync('.sites-runtime', {recursive: true});
globalThis.posContractEnv = {};
globalThis.posContractDB = {prepare() { throw new Error('Pure adapter contract must not query D1.'); }};
globalThis.fetch = async () => { throw new Error('Adapter contract must not contact a provider.'); };
const plugin = {name: 'pos-contract-runtime', setup(b) {
  b.onResolve({filter: /^cloudflare:workers$|db\/raw$/}, args => ({path: args.path, namespace: 'pos-contract'}));
  b.onLoad({filter: /.*/, namespace: 'pos-contract'}, args => ({contents: args.path === 'cloudflare:workers'
    ? 'export const env=globalThis.posContractEnv' : 'export function database(){return globalThis.posContractDB}'}));
}};
for (const [name, path] of Object.entries({adapter: 'pos-adapter', clover: 'clover-pos-adapter', sales: 'sales-ingestion', inventory: 'inventory-consumption-fake'})) {
  await build({entryPoints: [`src/lib/${path}.ts`], outfile: `.sites-runtime/pos-contract-${name}.mjs`, bundle: true, platform: 'node', format: 'esm', plugins: [plugin]});
}
const {supported, unavailablePosAdapter, requireSupported, receivePosEvent} = await import('../.sites-runtime/pos-contract-adapter.mjs');
const {cloverPosAdapter} = await import('../.sites-runtime/pos-contract-clover.mjs');
const {SalesIngestionService, InMemorySalesEventStore, FakeSalesMappingPort} = await import('../.sites-runtime/pos-contract-sales.mjs');
const {FakeInventoryConsumptionPort} = await import('../.sites-runtime/pos-contract-inventory.mjs');

// A deliberately fictional provider; this is not a Toast parser or provider acceptance.
const fictional = {...unavailablePosAdapter('fictional-second-pos'),
  source(companyId, environment, locationId) {
    return supported({kind: 'native', provider: this.providerId, environment, connectionId: `fictional:${companyId}`, merchantId: locationId, locationId});
  },
  normalizeOrder(payload, startedAt) {
    if (payload.createdAt < startedAt) return supported(null);
    return supported({schemaVersion: 'pantrack.sales.v1', externalEventId: `${payload.orderKey}:${payload.changedAt}`, externalOrderId: payload.orderKey,
      revision: payload.changedAt, eventType: payload.action, orderStatus: payload.action === 'refund' ? 'refunded' : payload.action === 'cancellation' ? 'canceled' : 'completed',
      preparationStatus: payload.action === 'refund' ? 'unknown' : payload.action === 'cancellation' ? 'not_started' : 'fulfilled',
      occurredAt: new Date(payload.changedAt).toISOString(), timeQuality: 'provider',
      lines: payload.items.map(item => ({externalLineId: item.key, externalItemId: item.menuKey, quantity: '1',
        modifiers: item.modifiers.map((id, index) => ({externalModifierLineId: `modifier-${index}`, externalModifierId: id, quantity: '1'}))}))});
  },
};
const now = Date.now(), startedAt = now - 500000, activeFrom = new Date(now - 600000).toISOString();
function payload(adapter, {order = 'same-order', revision = now - 100000, item = 'latte', modifier, lines = 1, action = 'sale', created = now - 300000} = {}) {
  if (adapter.providerId === 'clover') return {id: order, createdTime: created, modifiedTime: revision, total: 500, paymentState: action === 'refund' ? 'REFUNDED' : action === 'cancellation' ? 'OPEN' : 'PAID',
    state: action === 'cancellation' ? 'CANCELED' : 'OPEN', payments: {elements: [{id: 'payment', createdTime: revision}]},
    lineItems: {elements: Array.from({length: lines}, (_, i) => ({id: `line-${i}`, item: {id: item}, modifications: {elements: modifier ? [{id: 'modifier-0', modifier: {id: modifier}}] : []}}))}};
  return {orderKey: order, createdAt: created, changedAt: revision, action,
    items: Array.from({length: lines}, (_, i) => ({key: `line-${i}`, menuKey: item, modifiers: modifier ? [modifier] : []}))};
}
function harness() {
  const companies = ['company-a', 'company-b'];
  const providers = ['clover', fictional.providerId];
  const store = new InMemorySalesEventStore();
  const mappings = new FakeSalesMappingPort(companies.flatMap(companyId => providers.map(provider => ({companyId, provider, externalItemId: 'latte', recipeId: 'latte-recipe'}))),
    companies.flatMap(companyId => providers.map(provider => ({companyId, provider, externalItemId: 'latte', recipeId: 'latte-recipe', externalModifierId: 'shot', modifierId: 'shot-recipe'}))));
  const inventory = new FakeInventoryConsumptionPort({now: new Date(now).toISOString(),
    balances: companies.flatMap(companyId => [{companyId, productId: 'cup', dimension: 'count', onHandMinor: '100', version: 1, classified: true, openingCountAt: activeFrom}]),
    recipes: companies.map(companyId => ({companyId, recipeId: 'latte-recipe', versionId: 'latte-v1', status: 'active', activeFrom, activeTo: null, ingredients: [{productId: 'cup', quantity: {dimension: 'count', minor: '1'}}]})),
    modifiers: companies.map(companyId => ({companyId, recipeId: 'latte-recipe', modifierId: 'shot-recipe', versionId: 'shot-v1', status: 'active', activeFrom, activeTo: null, deltas: [{productId: 'cup', quantity: {dimension: 'count', minor: '1'}}]})),
  });
  const service = new SalesIngestionService(store, mappings, inventory);
  const balance = companyId => inventory.getBalance(companyId, 'cup').onHandMinor;
  async function receive(adapter, options = {}, companyId = 'company-a') {
    const source = requireSupported(adapter.source(companyId, 'sandbox', 'same-location'));
    const draft = requireSupported(adapter.normalizeOrder(payload(adapter, options), startedAt));
    if (!draft) return null;
    const receipt = await receivePosEvent(service, companyId, source, draft);
    if (receipt.kind === 'created') await service.process(companyId, receipt.eventKey);
    return {...receipt, status: {state: await store.state(companyId, receipt.eventKey)}};
  }
  return {receive, balance, store, service, mappings};
}

for (const adapter of [cloverPosAdapter, fictional]) {
  const h = harness();
  const first = await h.receive(adapter);
  assert.equal(first.status.state, 'applied'); assert.equal(h.balance('company-a'), '99');
  assert.equal((await h.receive(adapter)).kind, 'duplicate'); assert.equal(h.balance('company-a'), '99');
  await h.receive(adapter, {revision: now - 90000, lines: 2}); assert.equal(h.balance('company-a'), '98', 'Only the added line consumes.');
  await h.receive(adapter, {revision: now - 80000, lines: 2, action: 'refund'}); assert.equal(h.balance('company-a'), '98', 'Refund does not restore prepared stock.');
  await h.receive(adapter, {order: 'unpaid-cancel', action: 'cancellation'}); assert.equal(h.balance('company-a'), '98');
  const unknownItem = await h.receive(adapter, {order: 'unknown-item', item: 'unmapped'});
  assert.equal(unknownItem.status.state, 'held'); assert.equal(h.balance('company-a'), '98');
  const unknownModifier = await h.receive(adapter, {order: 'unknown-modifier', modifier: 'unmapped'});
  assert.equal(unknownModifier.status.state, 'held'); assert.equal(h.balance('company-a'), '98', 'Unknown modifier holds the entire event.');
  const withModifier = await h.receive(adapter, {order: 'mapped-modifier', modifier: 'shot'});
  assert.equal(withModifier.status.state, 'applied'); assert.equal(h.balance('company-a'), '96');
  assert.equal(await h.receive(adapter, {created: startedAt - 1}), null, 'Connection cutoff skips history.');
  assert.equal(h.balance('company-b'), '100');
}

const isolation = harness();
const clover = await isolation.receive(cloverPosAdapter);
const second = await isolation.receive(fictional);
const otherCompany = await isolation.receive(cloverPosAdapter, {}, 'company-b');
assert.notEqual(clover.eventKey, second.eventKey); assert.notEqual(clover.eventKey, otherCompany.eventKey);
assert.equal(isolation.balance('company-a'), '98'); assert.equal(isolation.balance('company-b'), '99');
const source = requireSupported(cloverPosAdapter.source('company-a', 'sandbox', 'same-location'));
const draft = requireSupported(cloverPosAdapter.normalizeOrder(payload(cloverPosAdapter), startedAt));
assert.throws(() => receivePosEvent(isolation.service, 'company-a', {...source, kind: 'bridge'}, draft), /native POS source/);

const toast = unavailablePosAdapter('toast');
assert.equal(toast.capabilities.authorization, 'unsupported');
for (const result of [await toast.authorizationStatus('company-a'), await toast.locations('company-a'), await toast.catalog('company-a', 'items', 0),
  await toast.sync('company-a'), await toast.webhook(new Request('https://test')), await toast.health('company-a'),
  toast.source('company-a', 'sandbox', 'location'), toast.normalizeOrder({}, startedAt)]) {
  assert.deepEqual(result, {kind: 'unsupported', reason: 'adapter_not_implemented'});
  assert.throws(() => requireSupported(result), /not implemented/);
}
console.log('PASS: Clover and a fictional adapter share M4 receipt, revision, duplicate, mapping holds, refund/cancellation and company/provider identity contracts; Toast operations are unsupported and make no external calls.');
