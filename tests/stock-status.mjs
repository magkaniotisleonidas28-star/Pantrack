import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.sites-runtime', { recursive: true });
await build({
  entryPoints: ['src/lib/stock-status.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/stock-status.mjs',
});
const { stockState, STOCK_STATE_LABEL, STOCK_STATE_TONE } =
  await import('../.sites-runtime/stock-status.mjs');

const now = Date.parse('2026-11-23T12:00:00Z');
const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString();
const record = (minor, counted = daysAgo(1)) => ({
  onHand: { minor: String(minor) },
  latestCountEffectiveAt: counted,
});

assert.equal(stockState(undefined, null, now), 'setup', 'no stock record needs setup');
assert.equal(stockState(record(0), { minor: '100' }, now), 'out', 'nothing on hand is out');
assert.equal(stockState(record(-5), null, now), 'out', 'a negative estimate is out');
assert.equal(stockState(record(29), { minor: '100' }, now), 'low', 'under 30% of the level is low');
assert.equal(stockState(record(30), { minor: '100' }, now), 'ok', 'exactly 30% is not low');
assert.equal(stockState(record(50), null, now), 'ok', 'without a level it is never low');
assert.equal(stockState(record(50, daysAgo(8)), null, now), 'count_due', 'not counted in 7 days');
assert.equal(stockState(record(50, daysAgo(7)), null, now), 'ok', 'counted exactly 7 days ago');
assert.equal(stockState(record(50, null), null, now), 'count_due', 'never counted is due');
assert.equal(
  stockState(record(10, daysAgo(30)), { minor: '100' }, now),
  'low',
  'low wins over count due',
);
for (const state of ['setup', 'out', 'low', 'count_due', 'ok']) {
  assert.ok(STOCK_STATE_LABEL[state], 'every state has a label');
  assert.ok(['good', 'warn', 'bad', 'neutral'].includes(STOCK_STATE_TONE[state]));
}

// The stock list and home page read the same rule; the old row button names stay reachable.
const panel = readFileSync('src/components/workspace/exact-inventory-panel.tsx', 'utf8'),
  home = readFileSync('src/components/workspace/home-panel.tsx', 'utf8');
assert.match(panel, /stockState\(record\(id\),targets\[id\],now\)/);
assert.match(home, /stockState\(record, targets\[product\.id\], now\)/);
assert.match(
  panel,
  /aria-label=\{`\$\{value\?'Update stock':'Set up stock'\} for \$\{item\.name\}`\}/,
);
console.log(
  'PASS: stock status rule (setup, out, running low under 30% of the level, count due after 7 days) shared by the stock list and home page.',
);
