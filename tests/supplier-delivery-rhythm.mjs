import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture } from './helpers/supplier-simulation.mjs';

// R1d (decision 0011): each supplier's delivery rhythm is an optional, versioned supplier detail.
await build({
  stdin: {
    contents:
      "export * from './src/lib/d1-purchasing-suppliers'; export * from './src/lib/purchasing-supplier-contract';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/delivery-rhythm-tests.mjs',
});
const { D1PurchasingSuppliers, supplierProfileSchema, deliveryRhythmText } =
  await import('../.sites-runtime/delivery-rhythm-tests.mjs');

const profile = {
  name: 'Fictional Dairy',
  email: null,
  telephone: '',
  paymentTerms: '',
  minimumOrderMinor: null,
  deliveryFeeMinor: null,
  orderingInstructions: '',
  notes: '',
  emailAcceptance: { status: 'unknown', note: '' },
  accounts: [{ id: 'account', reference: 'A-1', status: 'active' }],
  locations: [
    {
      id: 'location',
      accountId: 'account',
      reference: 'Café',
      address: '1 Fictional St',
      status: 'active',
    },
  ],
};

// --- Shape: optional, whole days, ordering every 1–60 days, delivery in 0–60 days.
const parses = (rhythm) =>
  supplierProfileSchema.safeParse(
    rhythm === undefined ? profile : { ...profile, deliveryRhythm: rhythm },
  ).success;
assert.equal(parses(undefined), true, 'Profiles saved before R1d have no rhythm');
assert.equal(parses(null), true);
assert.equal(parses({ orderEveryDays: 7, deliveryDays: 2 }), true);
assert.equal(parses({ orderEveryDays: 1, deliveryDays: 0 }), true, 'Same-day delivery');
assert.equal(parses({ orderEveryDays: 60, deliveryDays: 60 }), true);
for (const bad of [
  { orderEveryDays: 0, deliveryDays: 2 },
  { orderEveryDays: 61, deliveryDays: 2 },
  { orderEveryDays: 7, deliveryDays: -1 },
  { orderEveryDays: 7, deliveryDays: 61 },
  { orderEveryDays: 7.5, deliveryDays: 2 },
  { orderEveryDays: '7', deliveryDays: 2 },
  { orderEveryDays: 7 },
  { orderEveryDays: 7, deliveryDays: 2, cutoff: 'Tue' },
])
  assert.equal(parses(bad), false, JSON.stringify(bad));
assert.equal(deliveryRhythmText(null), 'Delivery schedule not set');
assert.equal(
  deliveryRhythmText({ orderEveryDays: 7, deliveryDays: 2 }),
  'Order every 7 days · delivery takes 2 days',
);
assert.equal(
  deliveryRhythmText({ orderEveryDays: 1, deliveryDays: 0 }),
  'Order every 1 day · delivery the same day',
);
assert.equal(
  deliveryRhythmText({ orderEveryDays: 3, deliveryDays: 1 }),
  'Order every 3 days · delivery takes 1 day',
);

// --- Saving: each change is a new version, older versions keep what they said.
const f = await fixture();
let actor = 'manager';
const registry = new D1PurchasingSuppliers(f.db, {
  identity: async () => actor,
  clock: { now: () => new Date('2026-11-20T12:00:00.000Z') },
});
const save = (version, extra = {}, company = 'a') =>
  registry.saveProfile({
    action: 'save_profile',
    companyId: company,
    operationId: crypto.randomUUID(),
    reason: 'Delivery schedule from the supplier',
    supplierId: 'dairy',
    expectedVersion: version,
    profile: { ...profile, ...extra },
  });
const v1 = await save(0);
assert.equal(v1.profile.deliveryRhythm, undefined);
const v2 = await save(1, { deliveryRhythm: { orderEveryDays: 7, deliveryDays: 2 } });
assert.equal(v2.version, 2);
assert.deepEqual(v2.profile.deliveryRhythm, { orderEveryDays: 7, deliveryDays: 2 });
assert.deepEqual((await registry.profile('a', 'dairy')).profile.deliveryRhythm, {
  orderEveryDays: 7,
  deliveryDays: 2,
});
assert.equal(
  (await registry.profile('a', 'dairy', 1)).profile.deliveryRhythm,
  undefined,
  'Version 1 is unchanged',
);
const v3 = await save(2, { deliveryRhythm: null });
assert.equal(v3.profile.deliveryRhythm, null, 'The schedule can be cleared again');
const history = await registry.history('a', 'dairy', 'profile');
assert.deepEqual(
  history.versions.map((v) => [
    v.version,
    'deliveryRhythm' in v.profile ? v.profile.deliveryRhythm : 'none',
  ]),
  [
    [3, null],
    [2, { orderEveryDays: 7, deliveryDays: 2 }],
    [1, 'none'],
  ],
);
await assert.rejects(
  save(3, { deliveryRhythm: { orderEveryDays: 0, deliveryDays: 2 } }),
  (e) => e.code === 'invalid_request',
);
await assert.rejects(
  save(1, { deliveryRhythm: { orderEveryDays: 5, deliveryDays: 1 } }),
  (e) => e.code === 'conflict',
  'A stale version is refused',
);

// --- Only owners and managers of the company may change it.
for (const who of [null, 'employee', 'b-manager']) {
  actor = who;
  await assert.rejects(
    save(3, { deliveryRhythm: { orderEveryDays: 5, deliveryDays: 1 } }),
    (e) => e.code === 'forbidden',
    String(who),
  );
}
actor = 'owner';
const v4 = await save(3, { deliveryRhythm: { orderEveryDays: 14, deliveryDays: 0 } });
assert.equal(v4.actor, 'owner');
assert.deepEqual(v4.profile.deliveryRhythm, { orderEveryDays: 14, deliveryDays: 0 });
console.log('Supplier delivery rhythm passed.');
