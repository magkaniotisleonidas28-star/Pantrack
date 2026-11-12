import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AiBudgetLedger } from '../scripts/cart-preview/ai-budget.mjs';
import { readPrivate, writePrivate } from '../scripts/po-cart-worker/private-files.mjs';
import { reservationMicros } from '../scripts/cart-preview/ai-request-budget.mjs';
import {
  planRehearsal,
  validateManifest,
  canonicalText,
  groupKey,
  metadataForExtraction,
  requestHash,
  rehearsalCases,
} from '../scripts/po-cart-worker/rehearsal-manifest.mjs';
import { runRehearsal } from '../scripts/po-cart-worker/rehearsal-runner.mjs';
import {
  createRehearsalAuthorization,
  consumeRehearsalAuthorization,
} from '../scripts/po-cart-worker/rehearsal-authorization.mjs';
import { syntheticRecording, metadataRequest } from './helpers/rehearsal-recording.mjs';

Object.assign(process.env, {
  OPENAI_API_KEY: 'fictional-test-only',
  PANTRACK_CART_AI_MODEL: 'gpt-5.4-mini-2026-03-17',
  PANTRACK_CART_INPUT_USD_PER_MILLION: '0.75',
  PANTRACK_CART_OUTPUT_USD_PER_MILLION: '4.50',
});
await build({
  stdin: {
    contents:
      "export * from './scripts/cart-preview/ai-provider';export { discoverySchema, cartSchema } from './scripts/po-cart-worker/ai-reader';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: '.sites-runtime/ai-rehearsal-test.mjs',
  logLevel: 'silent',
});
const { BoundedAiProvider, discoverySchema, cartSchema } =
  await import('../.sites-runtime/ai-rehearsal-test.mjs');
const root = mkdtempSync(join(tmpdir(), 'pantrack-rehearsal-test-')),
  source = { files: 3, sha256: 'a'.repeat(64) },
  rates = { model: 'gpt-5.4-mini-2026-03-17', inputRate: 0.75, outputRate: 4.5 },
  plan = () =>
    planRehearsal(syntheticRecording(source), { recordingSha256: 'b'.repeat(64), ...rates }),
  pricing = () => ({
    model: 'gpt-5.4-mini-2026-03-17',
    reasoning: 'none',
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 4.5,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
    checkedAt: new Date().toISOString(),
  }),
  floor = 1_959_552;
let count = 0;
const totalsOf = (m) => ({
    requests: m.operations.reduce((s, o) => s + (o.kind === 'pair' ? 2 : 1), 0),
    maxReservationMicros: m.operations.reduce(
      (s, o) =>
        s +
        (o.kind === 'pair'
          ? o.extractionReservationMicros + o.metadataMaxMicros
          : o.reservationMicros),
      0,
    ),
  }),
  diff = (a, b) =>
    Object.fromEntries(
      Object.keys(b)
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        .map((k) => [k, true]),
    );
const reply = (value) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 10 },
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    }),
  );
// Finds the planned operation a sent request belongs to, by its snapshot text.
const operationFor = (manifest, body) =>
  manifest.operations.find((o) =>
    o.kind === 'pair'
      ? (body.text.format.name === 'Extraction' ? o.extractionRequest : o.metadataTemplate).input[0]
          .content[0].text === body.input[0].content[0].text
      : JSON.stringify(o.request.input) === JSON.stringify(body.input),
  );

// The real bounded provider, ledger and one-use authorization, with the transport,
// source reader and evidence writer injected.
async function rehearse({
  manifest = plan(),
  answer = (body, op) =>
    body.text.format.name === 'Extraction' ? op.expected : { completed: true, progress: 'ok' },
  status = 200,
  reserve = 0,
  sources = () => source,
  failSaveAt,
  authorize = true,
  authorization,
  manifestSha256 = 'c'.repeat(64),
} = {}) {
  const dir = join(root, String(++count)),
    ledgerPath = join(dir, 'ledger.json'),
    ledger = new AiBudgetLedger(ledgerPath, join(dir, 'absent.json')),
    sent = [],
    file = join(dir, 'report.json'),
    report = {},
    authorizationPath = authorization ?? join(dir, 'authorization.json');
  if (reserve) await ledger.reserve(reserve);
  if (authorize && !authorization)
    createRehearsalAuthorization(
      {
        authorizationReference: 'Owner authorization for a fictional test rehearsal',
        pricing: pricing(),
        manifestSha256,
        source: manifest.source,
        requests: manifest.requests,
        maxReservationMicros: manifest.maxReservationMicros,
        ledgerPath,
      },
      authorizationPath,
    );
  const transport = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (status !== 200) return new Response('{}', { status });
    return reply(answer(body, operationFor(manifest, body), sent.length));
  };
  let saves = 0,
    error;
  try {
    await runRehearsal({
      manifest,
      manifestSha256,
      authorizationPath,
      ledgerPath,
      rates,
      runId: 'run-' + count,
      sourceNow: () => sources(sent.length),
      consume: consumeRehearsalAuthorization,
      provider: new BoundedAiProvider(ledger, transport, 45000, floor),
      schemas: { catalog: discoverySchema, cart: cartSchema },
      report,
      save: () => {
        if (++saves === failSaveAt) throw Error('evidence write failed');
        writePrivate(file, report);
      },
    });
  } catch (e) {
    error = e.message;
  }
  let saved = null;
  try {
    saved = readPrivate(file);
  } catch {}
  return { error, sent, saved, ledger: await ledger.snapshot(), authorizationPath };
}

try {
  // Grouping ignores only line-leading node IDs inside the DOM section.
  assert.equal(
    canonicalText(
      'Instruction: keep [0-1] here\nDOM: [3-4] main\n  [3-5] StaticText: $54.00 · [1-2] index 3',
    ),
    'Instruction: keep [0-1] here\nDOM: [#] main\n  [#] StaticText: $54.00 · [1-2] index 3',
  );
  assert.equal(canonicalText('no snapshot [0-1] x'), 'no snapshot [0-1] x');
  // A replay substitutes the real extraction at its single recorded marker.
  const recorded = {
      entries: [{ sku: 'EXISTING', unitLabel: 'box', packs: '1', unitMinor: '350' }],
    },
    template = metadataRequest('rows/normal', 'final'),
    real = { entries: [{ sku: 'X', unitLabel: 'y', packs: '1', unitMinor: '1' }] },
    derived = metadataForExtraction(template, recorded, real);
  assert.ok(derived.input[1].content[0].text.includes('"sku": "X"'));
  assert.deepEqual(derived.input[0], template.input[0]);
  assert.throws(() => metadataForExtraction(template, real, real), /exactly once/);

  // Every group four times, plus 23 replay pairs; totals are exact.
  const manifest = plan();
  assert.equal(manifest.groups, 12);
  assert.equal(manifest.operations.filter((o) => o.kind === 'metadata').length, 48);
  assert.equal(manifest.operations.filter((o) => o.kind === 'pair').length, 23);
  assert.equal(manifest.requests, 94);
  // Each review case's changed product is replayed in both layouts.
  for (const layout of ['rows', 'compact'])
    for (const scenario of ['unavailable', 'price_changed', 'wrong_pack', 'ambiguous'])
      assert.ok(
        manifest.operations.some(
          (o) =>
            o.kind === 'pair' &&
            o.phase === 'product:DEMO-COFFEE' &&
            o.cases[0] === layout + '/' + scenario,
        ),
        layout + '/' + scenario,
      );
  // Every case's baseline cart is replayed.
  assert.deepEqual(
    manifest.operations
      .filter((o) => o.kind === 'pair' && o.phase === 'baseline')
      .map((o) => o.cases[0]),
    rehearsalCases,
  );
  assert.equal(
    manifest.maxReservationMicros,
    manifest.operations.reduce(
      (s, o) =>
        s + (o.kind === 'pair' ? o.extractionReservationMicros + 27216 : o.reservationMicros),
      0,
    ),
  );
  // Where a group has two raw variants, each is sent twice of the four checks.
  const coffee = manifest.operations.filter(
    (o) =>
      o.kind === 'metadata' && o.phase === 'product:DEMO-COFFEE' && o.cases.includes('rows/normal'),
  );
  assert.equal(new Set(coffee.map((o) => o.id)).size, 2);
  assert.equal(coffee.length, 4);
  assert.equal(coffee.filter((o) => o.id === coffee[0].id).length, 2);
  assert.equal(validateManifest(manifest, rates), manifest);
  // Strict admission.
  for (const edit of [
    (m) => {
      // An Extraction request rehashed to pose as Metadata.
      const op = m.operations[0];
      op.request = m.operations.find((o) => o.kind === 'pair').extractionRequest;
      op.id = requestHash(op.request);
      op.group = groupKey(op.request);
      op.reservationMicros = reservationMicros(op.request, 0.75, 4.5);
    },
    (m) => {
      // Coverage removed with totals kept consistent.
      m.operations = m.operations.filter((o) => o.phase !== 'final' || o.kind === 'pair');
      m.operations.forEach((o, i) => (o.ordinal = i + 1));
    },
    (m) => (m.operations[1].reservationMicros -= 1),
    (m) => (m.maxReservationMicros -= 1),
    (m) => (m.requests += 1),
    (m) => (m.model = 'other'),
    (m) => (m.rates.outputRate = 9),
    (m) => (m.operations[2].kind = 'extraction'),
    (m) => (m.operations[3].ordinal = 9),
    (m) => m.operations.pop(),
    (m) => (m.operations.at(-1).metadataMaxMicros = 1),
    (m) => (m.operations[0].cases = ['rows/other']),
  ]) {
    const m = structuredClone(manifest);
    edit(m);
    // Only the edited property is wrong; totals are recomputed unless edited.
    if (!('requests' in diff(manifest, m)) && !('maxReservationMicros' in diff(manifest, m)))
      Object.assign(m, totalsOf(m));
    assert.throws(() => validateManifest(m, rates), /manifest invalid/);
  }

  // A complete run: every planned request once, within its reservation, with the
  // one-use authorization consumed.
  const pass = await rehearse();
  assert.equal(pass.error, undefined);
  assert.equal(pass.sent.length, 94);
  assert.equal(pass.saved.passed, true);
  assert.equal(pass.saved.metadataComplete, 48);
  assert.equal(pass.saved.pairExtractionCorrect, 23);
  assert.equal(pass.saved.pairMetadataComplete, 23);
  // Each pair keeps the extraction it sent to the verifier.
  for (const r of pass.saved.results.filter((x) => x.kind === 'pair'))
    assert.deepEqual(
      r.extraction,
      manifest.operations.find((o) => o.ordinal === r.ordinal).expected,
    );
  assert.equal(pass.saved.acceptanceComplete, false);
  assert.ok(pass.ledger.reservedMicros <= manifest.maxReservationMicros);
  assert.equal(pass.ledger.reservations.length, 94);
  assert.ok(pass.saved.results.every((r) => r.metadataStatus === 'completed'));
  assert.equal(readPrivate(pass.authorizationPath).state, 'consumed');
  // The replayed Metadata carries the real extraction, not the recorded oracle.
  const changed = await rehearse({
    answer: (body, op) =>
      body.text.format.name === 'Extraction'
        ? op.expected.candidates
          ? { candidates: [{ ...op.expected.candidates[0], unitMinor: '1' }] }
          : op.expected
        : {
            completed: !body.input
              .flatMap((m) => m.content.map((c) => c.text))
              .join('\n')
              .includes('"unitMinor": "1"'),
            progress: 'p',
          },
  });
  // Only the thirteen cart pairs keep their extraction.
  assert.equal(changed.saved.pairExtractionCorrect, 13);
  assert.equal(changed.saved.pairMetadataComplete, 13);
  assert.equal(changed.saved.passed, false);
  // A semantic false is reported and the planned run continues.
  const incomplete = await rehearse({
    answer: (body, op, n) =>
      body.text.format.name === 'Extraction'
        ? op.expected
        : { completed: n !== 3, progress: 'checked ' + n },
  });
  assert.equal(incomplete.sent.length, 94);
  assert.equal(incomplete.saved.passed, false);
  assert.deepEqual(
    incomplete.saved.incomplete.map((r) => [r.ordinal, r.progress]),
    [[3, 'checked 3']],
  );
  // An invalid verdict or extraction is never counted as complete or correct.
  const invalid = await rehearse({
    answer: (body) =>
      body.text.format.name === 'Extraction'
        ? { entries: 'x' }
        : { completed: 'true', progress: 'p' },
  });
  assert.equal(invalid.saved.metadataComplete, 0);
  assert.ok(
    invalid.saved.results.filter((r) => r.kind === 'metadata').every((r) => r.invalidVerdict),
  );
  assert.equal(invalid.saved.pairExtractionCorrect, 0);
  assert.ok(
    invalid.saved.results
      .filter((r) => r.kind === 'pair')
      .every((r) => r.metadataStatus === 'skipped_invalid_extraction'),
  );
  assert.equal(invalid.sent.length, 71);
  assert.ok(invalid.saved.results.every((r) => r.extraction === undefined));
  // A provider failure stops at once, recorded, without retry.
  const failed = await rehearse({ status: 500 });
  assert.equal(failed.error, 'AI_READER_FAILED');
  assert.equal(failed.sent.length, 1);
  assert.deepEqual(
    failed.saved.results.map((r) => [r.metadataStatus, r.error]),
    [['failed', 'AI_READER_FAILED']],
  );
  // A source change stops before the next request.
  const drift = await rehearse({
    sources: (n) => (n < 5 ? source : { ...source, sha256: 'd'.repeat(64) }),
  });
  assert.match(drift.error, /Source changed/);
  assert.equal(drift.sent.length, 5);
  assert.equal(drift.saved.results.at(-1).metadataStatus, 'source_changed');
  // A failed attempt record prevents its request.
  const unsaved = await rehearse({ failSaveAt: 5 });
  assert.equal(unsaved.error, 'evidence write failed');
  assert.equal(unsaved.sent.length, 0);
  assert.equal(unsaved.ledger.reservedMicros, 0);
  // The matrix reserve is enforced under the ledger lock for every request.
  const short = await rehearse({ reserve: 5_000_000 - floor - 1000 });
  assert.equal(short.error, 'AI_BUDGET_FLOOR');
  assert.equal(short.sent.length, 0);
  assert.equal(short.ledger.reservedMicros, 5_000_000 - floor - 1000);
  assert.equal(short.saved.results[0].error, 'AI_BUDGET_FLOOR');
  // Authorization is single-use and bound to the exact manifest and ledger.
  const reused = await rehearse({ authorization: pass.authorizationPath });
  assert.match(reused.error, /rehearsal_authorization_(unavailable|mismatch)/);
  assert.equal(reused.sent.length, 0);
  assert.equal(reused.saved.manifestSha256, 'c'.repeat(64));
  const none = await rehearse({ authorize: false });
  assert.equal(none.sent.length, 0);
  assert.ok(none.saved.source);
  // A stale manifest is refused after its inputs are saved, leaving approval unused.
  const stale = await rehearse({ sources: () => ({ ...source, sha256: 'e'.repeat(64) }) });
  assert.match(stale.error, /does not match the current source/);
  assert.equal(stale.sent.length, 0);
  assert.equal(stale.saved.source.sha256, 'e'.repeat(64));
  assert.equal(readPrivate(stale.authorizationPath).state, 'authorized');
  const tampered = await rehearse({ manifest: { ...plan(), requests: 1 } });
  assert.match(tampered.error, /manifest invalid/);
  assert.equal(tampered.sent.length, 0);
  assert.ok(tampered.saved.runId);

  // The command refuses anything but its exact modes and absolute paths.
  for (const args of [
    [],
    ['send'],
    ['run', '--manifest', '/a', '--authorization-file', '/b'],
    ['run', '--ai', '--manifest', 'relative', '--authorization-file', '/b'],
    ['plan', '--recording', '/a', '--ledger', '/b'],
    ['plan', '--recording', '/a', '--recording', '/a', '--ledger', '/b', '--output', '/c'],
    [
      'authorize',
      '--manifest',
      '/a',
      '--approval-file',
      '/b',
      '--pricing-file',
      '/c',
      '--output',
      '/d',
      '--extra',
      '/e',
    ],
  ]) {
    const r = spawnSync(process.execPath, ['scripts/po-cart-ai-rehearsal.mjs', ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Use `record`, `plan`, `authorize`, or `run --ai`/);
  }
  console.log(
    'PASS verifier rehearsal: strict manifests, exact reservations and matrix reserve through the real provider and ledger, one-use authorization, real-extraction replay, saved attempts and refusals, continuing semantic results, and stopping provider, source and evidence failures.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
