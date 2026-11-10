import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { readPrivate, writePrivate, profileLock } from './private-files.mjs';
import { gatePolicy, validateGate, fileHash } from './acceptance-gate.mjs';
import { budgetFile } from '../cart-preview/ai-budget.mjs';

// The prior is the allowance consumed by the 2026-11-10 matrix.
export const priorPaidAllowanceFile =
  '.sites-runtime/po-cart-workers/metadata-repair-acceptance-20261110/allowance.json';
export const paidAllowanceFile =
  '.sites-runtime/po-cart-workers/metadata-repair-acceptance-20261111/allowance.json';
// The 2026-11-01 allowance was authorized, but its run stopped before any request
// and its pricing check expired. Only that exact file could retire unused.
export const retiredPriorAllowance = Object.freeze({
  sha256: '0b2eb16de5e9d1032688519e0c527a807d3e0aa8f0af7b44e4f95663611ede27',
  ledger: budgetFile,
});
const pricingWindowMs = 300000;

export function validatePricing(p) {
  if (
    p?.model !== 'gpt-5.4-mini-2026-03-17' ||
    p.reasoning !== 'none' ||
    p.inputUsdPerMillion !== 0.75 ||
    p.outputUsdPerMillion !== 4.5 ||
    p.source !== 'https://developers.openai.com/api/docs/models/gpt-5.4-mini' ||
    !Number.isFinite(Date.parse(p.checkedAt)) ||
    Math.abs(Date.now() - Date.parse(p.checkedAt)) > pricingWindowMs
  )
    throw Error('Immediate official model/settings/pricing verification required.');
}

// A prior allowance is consumed, or is the pinned one that can never validate:
// authorized, never consumed, with its pricing check expired.
function priorFingerprint(path, retired) {
  const a = readPrivate(path),
    sha256 = fileHash(path);
  const consumed =
    (a.version === 1 || a.version === 2) &&
    a.matrices === 1 &&
    a.state === 'consumed' &&
    a.runId &&
    a.consumedAt;
  const unused =
    sha256 === retired?.sha256 &&
    a.version === 2 &&
    a.matrices === 1 &&
    a.state === 'authorized' &&
    !a.runId &&
    !a.consumedAt &&
    Date.now() - Date.parse(a.pricing?.checkedAt) > pricingWindowMs &&
    Number.isFinite(Date.parse(a.authorizedAt));
  if (!consumed && !unused) throw Error('Prior consumed allowance required.');
  return { path, sha256, retiredUnused: !consumed, authorizedAt: a.authorizedAt };
}
// Only invoke after separate explicit user authorization. Creation is single-use:
// even a partial failed write is retained and cannot be replaced or reauthorized.
export function createMetadataAllowance(
  { gateReport, pricing, authorizationReference },
  path = paidAllowanceFile,
  priorPath = priorPaidAllowanceFile,
  retired = retiredPriorAllowance,
) {
  if (typeof authorizationReference !== 'string' || !authorizationReference.trim())
    throw Error('Explicit matrix authorization reference required.');
  if (path === priorPath) throw Error('A separate new allowance is required.');
  const gate = validateGate(gateReport);
  validatePricing(pricing);
  const { retiredUnused, authorizedAt, ...previousAllowance } = priorFingerprint(
    priorPath,
    retired,
  );
  // Nothing may have been reserved since an unused prior was authorized.
  if (
    retiredUnused &&
    readPrivate(retired.ledger).reservations.some(
      (r) => !(Date.parse(r.at) < Date.parse(authorizedAt)),
    )
  )
    throw Error('Prior allowance has recorded spending.');
  const a = {
    version: 2,
    matrices: 1,
    maxRequests: 72,
    cumulativeCeilingMicros: 5_000_000,
    state: 'authorized',
    offlineGatePassed: true,
    policy: gatePolicy,
    authorizationReference,
    authorizedAt: new Date().toISOString(),
    previousAllowance,
    source: gate.source,
    gateReport,
    gateReportSha256: gate.sha256,
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

export function validateMetadataAllowance(
  path = paidAllowanceFile,
  priorPath = priorPaidAllowanceFile,
  retired = retiredPriorAllowance,
) {
  const a = readPrivate(path);
  if (
    a.version !== 2 ||
    a.matrices !== 1 ||
    a.maxRequests !== 72 ||
    a.cumulativeCeilingMicros !== 5_000_000 ||
    a.state !== 'authorized' ||
    a.consumedAt ||
    a.runId ||
    a.offlineGatePassed !== true ||
    a.policy !== gatePolicy ||
    typeof a.authorizationReference !== 'string' ||
    !a.authorizationReference.trim()
  )
    throw Error('paid_allowance_unavailable');
  const previous = priorFingerprint(priorPath, retired),
    gate = validateGate(a.gateReport);
  validatePricing(a.pricing);
  if (
    a.previousAllowance?.path !== previous.path ||
    a.previousAllowance.sha256 !== previous.sha256 ||
    gate.sha256 !== a.gateReportSha256 ||
    gate.source.sha256 !== a.source?.sha256
  )
    throw Error('paid_gate_unavailable');
  return a;
}

export function consumeMetadataAllowance(
  runId,
  path = paidAllowanceFile,
  priorPath = priorPaidAllowanceFile,
  retired = retiredPriorAllowance,
) {
  if (typeof runId !== 'string' || !runId.trim()) throw Error('Run identifier required.');
  const release = profileLock(path + '.ownership');
  try {
    const a = validateMetadataAllowance(path, priorPath, retired);
    writePrivate(path, { ...a, state: 'consumed', runId, consumedAt: new Date().toISOString() });
  } finally {
    release();
  }
}
