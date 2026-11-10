import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
  chmodSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Stagehand } from '@browserbasehq/stagehand';
await build({
  stdin: {
    contents:
      "export * from './scripts/po-cart-worker/extraction-evidence';export * from './scripts/po-cart-worker/metadata-evidence';export * from './scripts/po-cart-worker/ai-reader';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: '.sites-runtime/extraction-evidence-test.mjs',
  logLevel: 'silent',
});
const {
  extractionEvidence,
  verifyExtractionEvidence,
  extractionEvidenceLimit,
  metadataEvidence,
  StagehandCartReader,
  cartSchema,
  discoverySchema,
} = await import('../.sites-runtime/extraction-evidence-test.mjs');
const root = mkdtempSync(join(tmpdir(), 'pantrack-extraction-')),
  create = Stagehand.create;
const session = (kind) => {
  const page = {
    url: () => 'http://127.0.0.1/' + kind,
    locator: () => ({ count: async () => 0 }),
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({ targetInfo: { targetId: 'fixture' } }),
        detach: async () => {},
      }),
    }),
  };
  return {
    page,
    browser: { context: { pages: async () => [{ pageId: 'fixture', locator: () => ({}) }] } },
  };
};
Stagehand.create = async ({ model }) => ({
  extract: async () => {
    const params = (name) => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'private DOM and prompt' } }],
      responseFormat: { type: 'json_schema', name, schema: {} },
    });
    const result = await model.generate(params('Extraction'));
    await model.generate(params('Metadata'));
    return { data: result.structuredContent };
  },
});
const ids = {
  baseline: 0,
  'product:DEMO-COFFEE': 2,
  'product:DEMO-OAT': 4,
  'product:DEMO-CUPS': 6,
  final: 8,
};
const product = (index) => ({
    index,
    sku: 'DEMO-COFFEE',
    unitLabel: 'case of 6 × 1 lb',
    unitMinor: '5400',
    available: true,
  }),
  row = { sku: 'DEMO-OAT', unitLabel: 'case of 12', packs: '2', unitMinor: '3200' };
let n = 0;
const read = async (phase, value, sink, metadata = { completed: true, progress: 'done' }) => {
  const kind = phase.startsWith('product:') ? 'catalog' : 'cart',
    calls = [];
  const reader = new StagehandCartReader(
    {
      request: async (_request, context) => {
        calls.push(context.phase);
        return { value: context.phase.endsWith(':Metadata') ? metadata : value, usage: {} };
      },
    },
    undefined,
    sink,
  );
  const promise = reader.extract(
    session(kind),
    kind,
    'private instruction',
    kind === 'catalog' ? discoverySchema : cartSchema,
    { caseId: 'private identifier', phase },
  );
  return { promise, calls };
};
try {
  for (const phase of Object.keys(ids)) {
    const catalog = phase.startsWith('product:');
    for (const [label, value, valid] of [
      ['valid', catalog ? { candidates: [product(0), product(1)] } : { entries: [row] }, true],
      ['empty', catalog ? { candidates: [] } : { entries: [] }, true],
      [
        'invalid',
        catalog
          ? { candidates: [{ ...product(0), note: 'private Extraction output' }] }
          : { entries: [{ ...row, packs: 2 }], extra: 'private Extraction output' },
        false,
      ],
    ]) {
      const sink = extractionEvidence(join(root, String(n++))),
        { promise, calls } = await read(phase, value, sink);
      await promise;
      sink.close();
      assert.equal(sink.healthy(), true, label);
      assert.deepEqual(calls, [phase + ':Extraction', phase + ':Metadata']);
      for (const file of sink.files()) {
        if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
        const raw = readFileSync(file, 'utf8');
        assert.ok(!/private|DOM|prompt|instruction/.test(raw), label + ' retains only the value');
        if (!file.endsWith('/' + ids[phase] + '.json')) {
          assert.equal(raw, '');
          continue;
        }
        assert.deepEqual(
          JSON.parse(raw),
          valid
            ? { version: 1, untrusted: true, phaseId: ids[phase], valid: true, value }
            : { version: 1, untrusted: true, phaseId: ids[phase], valid: false },
          phase + ' ' + label,
        );
      }
      assert.equal(verifyExtractionEvidence(sink.files(), [phase + ':Extraction']), true);
      assert.equal(verifyExtractionEvidence(sink.files(), [phase + ':Metadata']), false);
    }
  }
  // An incomplete verdict still leaves the extraction it judged.
  {
    const sink = extractionEvidence(join(root, 'incomplete')),
      value = { candidates: [product(0), product(1)] },
      { promise } = await read('product:DEMO-COFFEE', value, sink, {
        completed: false,
        progress: 'indices need checking',
      });
    await assert.rejects(promise, /AI_INCOMPLETE_EXTRACTION/);
    sink.close();
    assert.deepEqual(JSON.parse(readFileSync(sink.files()[1], 'utf8')).value, value);
  }
  // Both sinks together: each keeps only its own phase kind.
  {
    const ex = extractionEvidence(join(root, 'both/extraction')),
      md = metadataEvidence(join(root, 'both/metadata'));
    const reader = new StagehandCartReader(
      {
        request: async (_r, c) => ({
          value: c.phase.endsWith(':Metadata')
            ? { completed: true, progress: 'ok' }
            : { entries: [] },
          usage: {},
        }),
      },
      md,
      ex,
    );
    await reader.extract(session('cart'), 'cart', 'i', cartSchema, { caseId: 'x', phase: 'final' });
    ex.close();
    md.close();
    assert.equal(verifyExtractionEvidence(ex.files(), ['final:Extraction']), true);
    assert.ok(readFileSync(md.files()[4], 'utf8').includes('"completed"'));
  }
  // Tampered, missing or loosened files fail acceptance.
  const base = extractionEvidence(join(root, 'verify'));
  base.capture({ entries: [] }, 'baseline:Extraction');
  base.close();
  const files = base.files(),
    original = readFileSync(files[0], 'utf8');
  for (const [label, mutate] of [
    ['extra key', () => writeFileSync(files[0], JSON.stringify({ ...JSON.parse(original), x: 1 }))],
    [
      'wrong phase',
      () => writeFileSync(files[0], JSON.stringify({ ...JSON.parse(original), phaseId: 2 })),
    ],
    [
      'invalid with value',
      () => writeFileSync(files[0], JSON.stringify({ ...JSON.parse(original), valid: false })),
    ],
    [
      'trusted',
      () => writeFileSync(files[0], JSON.stringify({ ...JSON.parse(original), untrusted: false })),
    ],
    ['missing', () => writeFileSync(files[0], '')],
    ...(process.platform === 'win32' ? [] : [['mode', () => chmodSync(files[0], 0o644)]]),
  ]) {
    mutate();
    assert.equal(verifyExtractionEvidence(files, ['baseline:Extraction']), false, label);
    writeFileSync(files[0], original);
    chmodSync(files[0], 0o600);
  }
  assert.equal(verifyExtractionEvidence(files, ['baseline:Extraction']), true);
  assert.equal(verifyExtractionEvidence(files.slice(1), ['baseline:Extraction']), false);
  assert.equal(verifyExtractionEvidence(files, ['baseline:Extraction', 'final:Extraction']), false);
  // Exclusive setup, write failures, bound, unknown phase and a second capture.
  const exclusive = join(root, 'exclusive'),
    sink = extractionEvidence(exclusive);
  assert.throws(() => extractionEvidence(exclusive), /SETUP_FAILED/);
  sink.close();
  for (const fail of ['write', 'sync', 'close']) {
    let closes = 0;
    const s = extractionEvidence(join(root, 'fail-' + fail), {
      write: (...args) => {
        if (fail === 'write') throw Error('private write failure');
        writeFileSync(...args);
      },
      sync: () => {
        if (fail === 'sync') throw Error('private sync failure');
      },
      close: (fd) => {
        closeSync(fd);
        closes++;
        if (fail === 'close') throw Error('private close failure');
      },
    });
    const { promise, calls } = await read('baseline', { entries: [] }, s);
    // A failed capture stops before the verifier is asked.
    await assert.rejects(promise, /^Error: AI_EXTRACTION_EVIDENCE_FAILED$/);
    assert.deepEqual(calls, ['baseline:Extraction']);
    assert.equal(s.healthy(), false);
    s.close();
    assert.equal(closes, 5);
  }
  const bound = extractionEvidence(join(root, 'bound'));
  assert.throws(
    () => bound.capture({ entries: ['x'.repeat(extractionEvidenceLimit)] }, 'final:Extraction'),
    /EVIDENCE_FAILED/,
  );
  assert.equal(bound.healthy(), false);
  bound.close();
  const badPhase = extractionEvidence(join(root, 'phase'));
  assert.throws(() => badPhase.capture({}, 'baseline:Metadata'), /EVIDENCE_FAILED/);
  badPhase.close();
  const twice = extractionEvidence(join(root, 'twice'));
  twice.capture({ entries: [] }, 'baseline:Extraction');
  const saved = readFileSync(twice.files()[0], 'utf8');
  assert.throws(() => twice.capture(undefined, 'baseline:Extraction'), /EVIDENCE_FAILED/);
  assert.equal(readFileSync(twice.files()[0], 'utf8'), saved);
  twice.close();
  console.log(
    'PASS: private schema-valid Extraction values across all five phases, invalid values recorded without content, incomplete verdicts keep their extraction, tamper refusal, exclusive files, 64 KiB bound and capture failure before the verifier.',
  );
} finally {
  Stagehand.create = create;
  rmSync(root, { recursive: true, force: true });
}
