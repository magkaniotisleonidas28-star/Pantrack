import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { readPrivate, writePrivate, profileLock } from './private-files.mjs';
import { validatePricing } from './metadata-allowance.mjs';

const hex = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const positive = (n) => Number.isSafeInteger(n) && n > 0;
function binding(b) {
  if (
    !hex(b?.manifestSha256) ||
    !hex(b.source?.sha256) ||
    !positive(b.source?.files) ||
    !positive(b.requests) ||
    !positive(b.maxReservationMicros) ||
    typeof b.ledgerPath !== 'string' ||
    !isAbsolute(b.ledgerPath)
  )
    throw Error('Rehearsal authorization binding invalid.');
  return {
    manifestSha256: b.manifestSha256,
    source: { files: b.source.files, sha256: b.source.sha256 },
    requests: b.requests,
    maxReservationMicros: b.maxReservationMicros,
    ledgerPath: b.ledgerPath,
  };
}

// Only after a separate explicit owner authorization of this exact manifest.
// Creation is exclusive: a partial or failed write is retained and can never be
// replaced or reauthorized.
export function createRehearsalAuthorization({ authorizationReference, pricing, ...b }, path) {
  if (typeof authorizationReference !== 'string' || !authorizationReference.trim())
    throw Error('Explicit rehearsal authorization reference required.');
  if (!isAbsolute(path)) throw Error('Absolute authorization path required.');
  validatePricing(pricing);
  const a = {
    version: 1,
    kind: 'verifier-rehearsal',
    state: 'authorized',
    authorizationReference,
    authorizedAt: new Date().toISOString(),
    ...binding(b),
    pricing,
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(a) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (process.platform !== 'win32') {
    const dir = openSync(dirname(path), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
  return a;
}

// Consumed once, under its ownership lock, before any spending. A consumed
// authorization is never reused or resumed, even when the run then fails.
export function consumeRehearsalAuthorization(path, expected, runId) {
  if (typeof runId !== 'string' || !runId.trim()) throw Error('Run identifier required.');
  const want = binding(expected),
    release = profileLock(path + '.ownership');
  try {
    const a = readPrivate(path);
    if (
      a.version !== 1 ||
      a.kind !== 'verifier-rehearsal' ||
      a.state !== 'authorized' ||
      a.runId ||
      a.consumedAt ||
      typeof a.authorizationReference !== 'string' ||
      !a.authorizationReference.trim()
    )
      throw Error('rehearsal_authorization_unavailable');
    if (JSON.stringify(binding(a)) !== JSON.stringify(want))
      throw Error('rehearsal_authorization_mismatch');
    validatePricing(a.pricing);
    writePrivate(path, { ...a, state: 'consumed', runId, consumedAt: new Date().toISOString() });
    return a;
  } finally {
    release();
  }
}
