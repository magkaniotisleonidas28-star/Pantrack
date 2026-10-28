import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['src/lib/waste-browser-recovery.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { recoverIngredientWaste, recoverMenuWaste } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const common = {
  companyId: 'company',
  operationId: crypto.randomUUID(),
  effectiveAt: '2026-10-27T12:00:00Z',
  reason: 'spilled',
  note: 'Preserve this entry',
};
for (const [recover, pending] of [
  [
    recoverIngredientWaste,
    {
      kind: 'waste',
      request: { ...common, productId: 'milk', expectedVersion: 1, amount: '20', unitId: 'mL' },
    },
  ],
  [
    recoverIngredientWaste,
    {
      kind: 'shortcuts',
      request: {
        companyId: 'company',
        productId: 'milk',
        configId: 'config',
        operationId: crypto.randomUUID(),
        expectedRevision: 1,
        shortcuts: [],
      },
    },
  ],
  [
    recoverMenuWaste,
    {
      kind: 'entry',
      request: {
        ...common,
        sourceKind: 'product',
        sourceId: 'milk',
        sourceVersion: 'v1',
        quantity: 1,
        mode: 'unsold',
        modifiers: [],
      },
    },
  ],
]) {
  const reads = {
    preferences: () => {
      throw new Error('Unavailable preferences');
    },
    pending: () => JSON.stringify(pending),
  };
  const restored = recover('key', 'company', reads);
  assert.deepEqual(restored.pending.request, pending.request);
  assert.equal(restored.pending.request.operationId, pending.request.operationId);
  assert.equal(recover('key', 'other-company', reads).pending, null);
  assert.equal(recover('key', 'company', { ...reads, pending: () => '{broken' }).pending, null);
  assert.equal(
    recover('key', 'company', {
      ...reads,
      pending: () => JSON.stringify({ ...pending, request: {} }),
    }).pending,
    null,
  );
}
const preferences = recoverIngredientWaste('key', 'company', {
  preferences: () =>
    JSON.stringify({
      favorites: Array.from({ length: 55 }, (_, n) => String(n)),
      recent: ['a', 1, 'b'],
    }),
  pending: () => null,
});
assert.equal(preferences.favorites.length, 50);
assert.deepEqual(preferences.recent, ['a', 'b']);
console.log(
  'PASS: browser waste recovery preserves exact operations independently of preferences, refuses corrupt/foreign drafts, and bounds saved lists.',
);

const client = await build({
  entryPoints: ['src/lib/waste-client.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { wasteEffectiveAt } = await import(
  'data:text/javascript;base64,' + Buffer.from(client.outputFiles[0].text).toString('base64')
);
assert.equal(
  wasteEffectiveAt({ at: Date.parse('2026-10-27T12:00:00Z'), received: 100 }, () => 1100),
  '2026-10-27T12:00:01.000Z',
);
assert.equal(
  wasteEffectiveAt({ at: Date.parse('2026-10-27T12:00:00Z'), received: 100 }, () => 50),
  '2026-10-27T12:00:00.000Z',
);
