import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPrivate, writePrivate } from '../scripts/po-cart-worker/private-files.mjs';
import {
  createRehearsalAuthorization,
  consumeRehearsalAuthorization,
} from '../scripts/po-cart-worker/rehearsal-authorization.mjs';

const root = mkdtempSync(join(tmpdir(), 'pantrack-rehearsal-auth-')),
  pricing = (at = new Date()) => ({
    model: 'gpt-5.4-mini-2026-03-17',
    reasoning: 'none',
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 4.5,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
    checkedAt: at.toISOString(),
  }),
  binding = {
    manifestSha256: 'a'.repeat(64),
    source: { files: 795, sha256: 'b'.repeat(64) },
    requests: 32,
    maxReservationMicros: 650000,
    ledgerPath: '/fictional/.sites-runtime/cart-ai-budget/ledger.json',
  };
let n = 0;
const create = (edit = {}) => {
  const path = join(root, ++n + '.json');
  createRehearsalAuthorization(
    {
      authorizationReference: 'Owner approval of this fictional manifest',
      pricing: pricing(),
      ...binding,
      ...edit,
    },
    path,
  );
  return path;
};
try {
  // Created exclusively; never replaced.
  const path = create();
  assert.equal(readPrivate(path).state, 'authorized');
  assert.throws(
    () =>
      createRehearsalAuthorization(
        { authorizationReference: 'again', pricing: pricing(), ...binding },
        path,
      ),
    /EEXIST/,
  );
  // Creation refusals leave no file.
  for (const [edit, error] of [
    [{ authorizationReference: ' ' }, /authorization reference required/],
    [{ pricing: pricing(new Date(Date.now() - 600000)) }, /pricing verification required/],
    [{ pricing: { ...pricing(), model: 'other' } }, /pricing verification required/],
    [{ manifestSha256: 'short' }, /binding invalid/],
    [{ requests: 0 }, /binding invalid/],
    [{ maxReservationMicros: 1.5 }, /binding invalid/],
    [{ ledgerPath: 'relative/ledger.json' }, /binding invalid/],
    [{ source: { files: 1, sha256: 'x' } }, /binding invalid/],
  ]) {
    const target = join(root, 'refused-' + ++n + '.json');
    assert.throws(
      () =>
        createRehearsalAuthorization(
          { authorizationReference: 'Owner approval', pricing: pricing(), ...binding, ...edit },
          target,
        ),
      error,
    );
    assert.equal(existsSync(target), false);
  }
  assert.throws(
    () =>
      createRehearsalAuthorization(
        { authorizationReference: 'Owner approval', pricing: pricing(), ...binding },
        'relative.json',
      ),
    /Absolute authorization path/,
  );

  // Consumed exactly once, only with the exact binding.
  for (const [field, value] of [
    ['manifestSha256', 'c'.repeat(64)],
    ['source', { files: 795, sha256: 'd'.repeat(64) }],
    ['source', { files: 796, sha256: 'b'.repeat(64) }],
    ['requests', 33],
    ['maxReservationMicros', 650001],
    ['ledgerPath', '/other/ledger.json'],
  ]) {
    const p = create();
    assert.throws(
      () => consumeRehearsalAuthorization(p, { ...binding, [field]: value }, 'run'),
      /rehearsal_authorization_mismatch/,
    );
    assert.equal(readPrivate(p).state, 'authorized');
  }
  const a = consumeRehearsalAuthorization(path, binding, 'run-1');
  assert.equal(a.authorizationReference, 'Owner approval of this fictional manifest');
  const consumed = readPrivate(path);
  assert.equal(consumed.state, 'consumed');
  assert.equal(consumed.runId, 'run-1');
  assert.throws(
    () => consumeRehearsalAuthorization(path, binding, 'run-2'),
    /rehearsal_authorization_unavailable/,
  );
  assert.throws(() => consumeRehearsalAuthorization(path, binding, ' '), /Run identifier/);
  // An expired pricing check cannot be consumed.
  const late = create();
  writePrivate(late, { ...readPrivate(late), pricing: pricing(new Date(Date.now() - 600000)) });
  assert.throws(() => consumeRehearsalAuthorization(late, binding, 'run'), /pricing verification/);
  assert.equal(readPrivate(late).state, 'authorized');
  // Corrupt, foreign-kind, or partially written files are never consumed.
  const corrupt = join(root, 'corrupt.json');
  writeFileSync(corrupt, '{"version":1', { mode: 0o600 });
  assert.throws(() => consumeRehearsalAuthorization(corrupt, binding, 'run'));
  const foreign = create();
  writePrivate(foreign, { ...readPrivate(foreign), kind: 'paid-matrix' });
  assert.throws(
    () => consumeRehearsalAuthorization(foreign, binding, 'run'),
    /rehearsal_authorization_unavailable/,
  );
  // A concurrent consumer holding the ownership lock blocks a second one.
  const held = create();
  writeFileSync(held + '.ownership.lock', String(process.pid), { mode: 0o600 });
  assert.throws(() => consumeRehearsalAuthorization(held, binding, 'run'), /actively owned/);
  assert.equal(readPrivate(held).state, 'authorized');
  console.log(
    'PASS rehearsal authorization: exclusive creation, fresh pricing, exact binding, single consumption, and refused reuse, corruption and concurrent consumers.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
