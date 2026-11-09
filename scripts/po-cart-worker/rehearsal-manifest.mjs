import { createHash } from 'node:crypto';
import { reservationMicros, maximumReservationMicros } from '../cart-preview/ai-request-budget.mjs';

// The paid matrix's twelve cases, as recorded by the real worker.
export const rehearsalCases = ['rows', 'compact'].flatMap((layout) =>
  ['normal', 'malicious', 'unavailable', 'price_changed', 'wrong_pack', 'ambiguous'].map(
    (scenario) => layout + '/' + scenario,
  ),
);
// Each ready case reads five snapshots; each review case reads the baseline and
// its changed first product before the deterministic hold.
export const caseMetadataCount = 36;
// Real extraction replays: the field-name, label-shape, duplicate/availability
// and whole-cart cases.
export const replayPairs = [
  ['rows/normal', 'product:DEMO-COFFEE'],
  ['rows/normal', 'product:DEMO-CUPS'],
  ['compact/ambiguous', 'product:DEMO-COFFEE'],
  ['compact/normal', 'final'],
];
export const repeatsPerGroup = 2;
const sha = (value) => createHash('sha256').update(value).digest('hex');
export const requestHash = (request) => sha(JSON.stringify(request));

// Stagehand numbers DOM nodes per browser launch, as `[frame-node]` at the start
// of each snapshot line. Only those tokens are ignored, and only for grouping;
// sent requests are always the raw recorded bytes.
export function canonicalText(text) {
  const at = text.indexOf('\nDOM: ');
  if (at < 0) return text;
  return (
    text.slice(0, at) +
    text.slice(at).replace(/^(DOM: |\s*)\[\d+-\d+\](?= )/gm, (_, lead) => lead + '[#]')
  );
}
export const groupKey = (request) =>
  sha(
    JSON.stringify({
      ...request,
      input: request.input.map((m) => ({
        ...m,
        content: m.content.map((c) => ({ ...c, text: canonicalText(c.text) })),
      })),
    }),
  );

const extractedMarker = (value) => 'Extracted content: ' + JSON.stringify(value, null, 2);
// The SDK builds Metadata from the extracted JSON. A replay substitutes the real
// extraction for the recorded one at its single marker; nothing else changes.
export function metadataForExtraction(template, recordedValue, actualValue) {
  const from = extractedMarker(recordedValue),
    to = extractedMarker(actualValue);
  let found = 0;
  const input = template.input.map((m) => ({
    ...m,
    content: m.content.map((c) => {
      const n = c.text.split(from).length - 1;
      found += n;
      return n ? { ...c, text: c.text.replace(from, () => to) } : c;
    }),
  }));
  if (found !== 1) throw Error('Recorded extraction marker not found exactly once.');
  return { ...template, input };
}

const isMetadata = (r) =>
  r?.format?.type === 'json_schema' &&
  r.format.name === 'Metadata' &&
  r.format.strict === true &&
  ['completed', 'progress'].every((k) => r.format.schema?.properties?.[k]) &&
  typeof r.instructions === 'string' &&
  r.instructions.includes("Pantrack's Metadata verifier") &&
  Array.isArray(r.input);
const isExtraction = (r) =>
  r?.format?.type === 'json_schema' &&
  r.format.name === 'Extraction' &&
  r.format.strict === true &&
  typeof r.instructions === 'string' &&
  Array.isArray(r.input);

export function validateRecording(recording) {
  if (
    recording?.version !== 2 ||
    recording.evidence !== 'offline-recorded-worker-requests' ||
    !recording.cleanupVerified ||
    !Array.isArray(recording.captures)
  )
    throw Error('Recorded worker requests required.');
  const seen = new Set();
  for (const c of recording.captures) {
    const key = c.case + ' ' + c.phase;
    if (
      !rehearsalCases.includes(c.case) ||
      typeof c.phase !== 'string' ||
      seen.has(key) ||
      !isExtraction(c.extraction?.request) ||
      !isMetadata(c.metadata?.request) ||
      c.extraction.id !== requestHash(c.extraction.request) ||
      c.metadata.id !== requestHash(c.metadata.request)
    )
      throw Error('Recorded worker request invalid.');
    seen.add(key);
  }
  const cases = new Set(recording.captures.map((c) => c.case));
  if (recording.captures.length !== caseMetadataCount || rehearsalCases.some((c) => !cases.has(c)))
    throw Error('Recorded worker coverage incomplete.');
  return recording;
}

// Deterministic: every group is sent twice, using another raw variant when one
// exists, and the four pairs replay real extraction into the same Metadata.
export function planRehearsal(recording, { recordingSha256, model, inputRate, outputRate }) {
  validateRecording(recording);
  const groups = new Map();
  for (const c of recording.captures) {
    const key = groupKey(c.metadata.request),
      g = groups.get(key) ?? { key, phase: c.phase, variants: new Map() };
    if (g.phase !== c.phase) throw Error('Grouped phases differ.');
    const v = g.variants.get(c.metadata.id) ?? { capture: c, cases: [] };
    v.cases.push(c.case);
    g.variants.set(c.metadata.id, v);
    groups.set(key, g);
  }
  const operations = [];
  for (const g of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const variants = [...g.variants.values()].sort((a, b) =>
      a.capture.metadata.id.localeCompare(b.capture.metadata.id),
    );
    for (let repeat = 0; repeat < repeatsPerGroup; repeat++) {
      const v = variants[repeat % variants.length];
      operations.push({
        kind: 'metadata',
        group: g.key,
        repeat: repeat + 1,
        phase: g.phase,
        cases: [...g.variants.values()].flatMap((x) => x.cases).sort(),
        variantCases: v.cases.sort(),
        id: v.capture.metadata.id,
        request: v.capture.metadata.request,
        reservationMicros: reservationMicros(v.capture.metadata.request, inputRate, outputRate),
      });
    }
  }
  for (const [kase, phase] of replayPairs) {
    const c = recording.captures.find((x) => x.case === kase && x.phase === phase);
    if (!c) throw Error('Replay capture missing.');
    operations.push({
      kind: 'pair',
      phase,
      cases: [kase],
      id: c.extraction.id,
      extractionRequest: c.extraction.request,
      extractionReservationMicros: reservationMicros(c.extraction.request, inputRate, outputRate),
      metadataTemplate: c.metadata.request,
      expected: c.extraction.expected,
      // The real extraction is unknown until sent, so its Metadata reserves the cap.
      metadataMaxMicros: maximumReservationMicros(inputRate, outputRate),
    });
  }
  operations.forEach((op, i) => (op.ordinal = i + 1));
  const manifest = {
    version: 2,
    evidence: 'verifier-rehearsal-manifest',
    source: recording.source,
    recordingSha256,
    sdk: recording.sdk,
    model,
    rates: { inputRate, outputRate },
    groups: groups.size,
    operations,
  };
  return { ...manifest, ...totals(manifest) };
}

function totals(m) {
  let requests = 0,
    maxReservationMicros = 0;
  for (const op of m.operations) {
    requests += op.kind === 'pair' ? 2 : 1;
    maxReservationMicros +=
      op.kind === 'pair'
        ? op.extractionReservationMicros + op.metadataMaxMicros
        : op.reservationMicros;
  }
  return { requests, maxReservationMicros };
}

// Strict admission: only the declared operation kinds, request types, exact
// reservations, complete case coverage and consistent totals.
export function validateManifest(m, { model, inputRate, outputRate }) {
  const fail = () => {
    throw Error('Rehearsal manifest invalid.');
  };
  if (
    m?.version !== 2 ||
    m.evidence !== 'verifier-rehearsal-manifest' ||
    !/^[0-9a-f]{64}$/.test(m.source?.sha256 ?? '') ||
    !Number.isSafeInteger(m.source?.files) ||
    !/^[0-9a-f]{64}$/.test(m.recordingSha256 ?? '') ||
    m.model !== model ||
    m.rates?.inputRate !== inputRate ||
    m.rates?.outputRate !== outputRate ||
    !Array.isArray(m.operations) ||
    !m.operations.length
  )
    fail();
  const covered = new Set(),
    pairs = [];
  m.operations.forEach((op, i) => {
    if (op.ordinal !== i + 1 || !Array.isArray(op.cases) || !op.cases.length) fail();
    if (op.cases.some((c) => !rehearsalCases.includes(c))) fail();
    if (op.kind === 'metadata') {
      if (
        !isMetadata(op.request) ||
        op.id !== requestHash(op.request) ||
        op.group !== groupKey(op.request) ||
        op.reservationMicros !== reservationMicros(op.request, inputRate, outputRate)
      )
        fail();
      op.cases.forEach((c) => covered.add(c + ' ' + op.phase));
    } else if (op.kind === 'pair') {
      if (
        !isExtraction(op.extractionRequest) ||
        !isMetadata(op.metadataTemplate) ||
        op.id !== requestHash(op.extractionRequest) ||
        op.extractionReservationMicros !==
          reservationMicros(op.extractionRequest, inputRate, outputRate) ||
        op.metadataMaxMicros !== maximumReservationMicros(inputRate, outputRate) ||
        op.expected === undefined
      )
        fail();
      metadataForExtraction(op.metadataTemplate, op.expected, op.expected);
      pairs.push(op.cases[0] + ' ' + op.phase);
    } else fail();
  });
  const t = totals(m);
  if (
    covered.size !== caseMetadataCount ||
    JSON.stringify(pairs) !== JSON.stringify(replayPairs.map(([c, p]) => c + ' ' + p)) ||
    t.requests !== m.requests ||
    t.maxReservationMicros !== m.maxReservationMicros
  )
    fail();
  return m;
}
