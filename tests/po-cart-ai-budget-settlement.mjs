import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AiBudgetLedger,
  billingLagMs,
  budgetCeilingMicros,
  usageMicros,
} from '../scripts/cart-preview/ai-budget.mjs';
import { readPrivate, writePrivate } from '../scripts/po-cart-worker/private-files.mjs';

const root = mkdtempSync(join(tmpdir(), 'pantrack-settle-')),
  model = 'gpt-5.4-mini-2026-03-17',
  rates = { model, inputRate: 0.75, outputRate: 4.5 },
  now = Date.now(),
  old = (h) => new Date(now - billingLagMs - h * 3600_000).toISOString(),
  hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
  usage = (inputTokens, outputTokens) => ({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  });
// Settled: two completed calls. Kept at full amount: unanswered reservations, even
// one carrying usage, a call within the billing lag, another model, and unusable usage.
const reservations = [
  { id: 'a', model, micros: 900_000, at: old(3), status: 'completed', usage: usage(618, 32) },
  { id: 'b', model, micros: 900_000, at: old(2), status: 'completed', usage: usage(2021, 38) },
  { id: 'c', model, micros: 100_000, at: old(2), status: 'reserved' },
  {
    id: 'd',
    model,
    micros: 50_000,
    at: new Date(now - 60_000).toISOString(),
    status: 'completed',
    usage: usage(1, 1),
  },
  { id: 'e', model: 'other', micros: 40_000, at: old(1), status: 'completed', usage: usage(1, 1) },
  { id: 'f', model, micros: 30_000, at: old(1), status: 'completed', usage: { inputTokens: -1 } },
  { id: 'g', model, micros: 10_000, at: old(1), status: 'reserved', usage: usage(1, 1) },
];
const fresh = (name, extra = {}) => {
  const file = join(root, name + '.json');
  writePrivate(file, {
    version: 1,
    legacyReservedMicros: 20_000,
    legacyCalls: 1,
    reservations: structuredClone(reservations),
    ...extra,
  });
  return { file, ledger: new AiBudgetLedger(file, join(root, 'absent.json')) };
};
const checkedAt = new Date(now).toISOString(),
  ok = { authorizationReference: 'Owner authorization (test)', checkedAt, ...rates };
try {
  // Per-call usage cost rounds up; output covers any unreported tokens.
  assert.equal(usageMicros(usage(618, 32), 0.75, 4.5), Math.ceil(618 * 0.75 + 32 * 4.5));
  assert.equal(
    usageMicros({ inputTokens: 10, outputTokens: 1, totalTokens: 20 }, 0.75, 4.5),
    Math.ceil(10 * 0.75 + 10 * 4.5),
  );
  assert.equal(usageMicros({ inputTokens: 1 }, 0.75, 4.5), null);
  const a = usageMicros(reservations[0].usage, 0.75, 4.5),
    b = usageMicros(reservations[1].usage, 0.75, 4.5),
    kept = 20_000 + 100_000 + 50_000 + 40_000 + 30_000 + 10_000;

  // The plan reads only; it names exactly the eligible reservations.
  const { file, ledger } = fresh('main'),
    before = hash(file);
  const plan = await ledger.plan(ok);
  assert.deepEqual(plan.reservationIds, ['a', 'b']);
  assert.equal(plan.reservedMicros, 1_800_000);
  assert.equal(plan.usageMicros, a + b);
  assert.equal(plan.excluded, 5);
  assert.equal(plan.reservedTotalMicros, 1_800_000 + kept);
  assert.equal(hash(file), before);

  // Refusals leave the ledger byte-for-byte unchanged.
  for (const [label, options, message] of [
    ['no authorization', { ...ok, authorizationReference: ' ' }, /authorization reference/],
    ['no total', { ...ok, billedUsd: Number.NaN }, /Billed total required/],
    ['negative', { ...ok, billedUsd: -1 }, /Billed total required/],
    ['above reservations', { ...ok, billedUsd: 1.9 }, /exceeds the settled reservations/],
    [
      'future check',
      { ...ok, billedUsd: 0, checkedAt: new Date(now + 600_000).toISOString() },
      /billing check time/,
    ],
    ['bad check', { ...ok, billedUsd: 0, checkedAt: 'yesterday' }, /billing check time/],
    ['too early', { ...ok, billedUsd: 0, checkedAt: old(5) }, /No completed reservations/],
  ]) {
    await assert.rejects(ledger.settle(options), message, label);
    assert.equal(hash(file), before, label);
  }

  // A billed total below recorded usage settles at the usage cost.
  const low = await ledger.settle({ ...ok, billedUsd: 0 });
  assert.equal(low.settledMicros, a + b);
  assert.equal(low.beforeMicros, 1_800_000 + kept);
  assert.equal(low.afterMicros, a + b + kept);
  assert.equal((await ledger.snapshot()).reservedMicros, a + b + kept);
  // Reservations stay listed; nothing settles twice.
  assert.equal(readPrivate(file).reservations.length, 7);
  await assert.rejects(ledger.settle({ ...ok, billedUsd: 0 }), /No completed reservations/);
  // The freed headroom is usable, still under the same ceiling.
  await ledger.reserve(budgetCeilingMicros - (a + b + kept));
  await assert.rejects(ledger.reserve(1), /cannot cover another call/);

  // A billed total above recorded usage settles at the billed amount.
  const high = fresh('high');
  const t = await high.ledger.settle({ ...ok, billedUsd: 0.25 });
  assert.equal(t.billedMicros, 250_000);
  assert.equal(t.settledMicros, 250_000);
  assert.equal(t.afterMicros, 250_000 + kept);

  // Altered settlements require local review before any budget use.
  const settled = readPrivate(file).settlements[0];
  for (const [label, edit] of [
    ['lowered', (s) => (s.settlements[0].settledMicros -= 1)],
    ['unknown reservation', (s) => s.settlements[0].reservationIds.push('zz')],
    ['repeated reservation', (s) => s.settlements.push({ ...settled, id: 'again' })],
    ['reserved mismatch', (s) => (s.settlements[0].reservedMicros += 1)],
    [
      'above replaced',
      (s) => {
        s.settlements[0].billedMicros = 2_000_000;
        s.settlements[0].settledMicros = 2_000_000;
      },
    ],
    ['no reference', (s) => (s.settlements[0].authorizationReference = '')],
    ['empty list', (s) => (s.settlements = [])],
  ]) {
    const x = fresh('tamper-' + label.replace(/ /g, '-'), {
        settlements: [structuredClone(settled)],
      }),
      state = readPrivate(x.file);
    edit(state);
    writePrivate(x.file, state);
    await assert.rejects(x.ledger.snapshot(), /requires local review/, label);
    await assert.rejects(x.ledger.reserve(1), /requires local review/, label);
  }
  // An unsettled ledger reads and totals exactly as before.
  const plain = fresh('plain');
  assert.equal((await plain.ledger.snapshot()).reservedMicros, 1_800_000 + kept);
  assert.equal(readPrivate(plain.file).settlements, undefined);

  // The command refuses malformed arguments before reading any ledger.
  for (const argv of [
    [],
    ['apply', '--billing-checked-at', checkedAt],
    ['plan', '--billing-checked-at'],
    [
      'apply',
      '--billing-checked-at',
      checkedAt,
      '--billed-usd',
      '1e3',
      '--approval-file',
      '/a',
      '--pricing-file',
      '/p',
    ],
    [
      'apply',
      '--billing-checked-at',
      checkedAt,
      '--billed-usd',
      '1',
      '--approval-file',
      'rel',
      '--pricing-file',
      '/p',
    ],
  ]) {
    const r = spawnSync(process.execPath, ['scripts/po-cart-ai-budget-settle.mjs', ...argv], {
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0, argv.join(' '));
    assert.match(r.stderr, /Use `plan` or `apply`/);
  }
  console.log(
    'PASS: budget settlement covers only completed, lagged, same-model reservations at the greater of recorded usage and billed total, refuses missing authorization and excess billing without change, never settles twice, and requires review of altered settlements.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
