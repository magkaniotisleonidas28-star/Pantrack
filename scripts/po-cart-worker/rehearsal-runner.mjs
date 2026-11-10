import { isDeepStrictEqual } from 'node:util';
import { validateManifest, metadataForExtraction } from './rehearsal-manifest.mjs';
import { inputCeiling } from '../cart-preview/ai-request-budget.mjs';

const sameSource = (a, b) => a?.files === b?.files && a?.sha256 === b?.sha256;
const verdict = (v) =>
  v && typeof v === 'object' && typeof v.completed === 'boolean' && typeof v.progress === 'string'
    ? { completed: v.completed, progress: v.progress.slice(0, 500) }
    : { completed: null, invalidVerdict: true };
// Fixed categories only; provider and ledger messages never reach the report.
const category = (e) =>
  ['AI_BUDGET_FLOOR', 'AI_INPUT_TOO_LARGE', 'AI_READER_FAILED'].includes(e?.message)
    ? e.message
    : /cumulative \$5/.test(e?.message ?? '')
      ? 'AI_BUDGET_EXHAUSTED'
      : 'AI_REQUEST_FAILED';
// Extraction order is not part of its meaning; values and duplicates are.
const canonical = (v) =>
  JSON.stringify(
    v.candidates
      ? [...v.candidates].sort(
          (a, b) => a.index - b.index || JSON.stringify(a).localeCompare(JSON.stringify(b)),
        )
      : [...v.entries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );

// Sends one owner-authorized manifest once, in order. Every input is saved before
// it is evaluated, every attempt before its request, and every outcome after it.
// A provider, budget, evidence or source failure stops the run; a semantic
// failure is recorded and the planned run continues. Never acceptance evidence.
export async function runRehearsal({
  manifest,
  manifestSha256,
  authorizationPath,
  ledgerPath,
  rates,
  runId,
  sourceNow,
  consume,
  provider,
  schemas,
  report,
  save,
}) {
  Object.assign(report, {
    evidence: 'local-real-verifier-rehearsal',
    acceptanceComplete: false,
    runId,
    manifestSha256,
    authorizationPath,
    ledgerPath,
    model: rates.model,
    stage: 'validating',
    results: [],
  });
  save();
  validateManifest(manifest, rates);
  const source = sourceNow();
  Object.assign(report, {
    source,
    manifestSource: manifest.source,
    requests: manifest.requests,
    maxReservationMicros: manifest.maxReservationMicros,
  });
  save();
  if (!sameSource(source, manifest.source))
    throw Error('Manifest does not match the current source.');
  const binding = {
    manifestSha256,
    source: manifest.source,
    requests: manifest.requests,
    maxReservationMicros: manifest.maxReservationMicros,
    ledgerPath,
  };
  report.authorizationReference = consume(authorizationPath, binding, runId).authorizationReference;
  report.stage = 'sending';
  save();
  const send = async (request, phase, result, key) => {
    if (!sameSource(sourceNow(), manifest.source)) {
      result[key + 'Status'] = 'source_changed';
      save();
      throw Error('Source changed during the rehearsal.');
    }
    try {
      inputCeiling(request);
    } catch (e) {
      result[key + 'Status'] = 'refused';
      result.error = category(e);
      save();
      throw e;
    }
    result[key + 'Status'] = 'attempting';
    save();
    try {
      const r = await provider.request(request, { caseId: runId, phase: 'rehearsal:' + phase });
      Object.assign(result, { [key + 'Status']: 'completed', [key + 'Usage']: r.usage });
      save();
      return r.value;
    } catch (e) {
      Object.assign(result, { [key + 'Status']: 'failed', error: category(e) });
      save();
      throw e;
    }
  };
  for (const op of manifest.operations) {
    const result = {
      ordinal: op.ordinal,
      kind: op.kind,
      phase: op.phase,
      cases: op.cases,
      id: op.id,
    };
    if (op.kind === 'metadata')
      Object.assign(result, { repeat: op.repeat, variantCases: op.variantCases });
    report.results.push(result);
    save();
    if (op.kind === 'metadata') {
      Object.assign(
        result,
        verdict(await send(op.request, op.phase + ':Metadata', result, 'metadata')),
      );
    } else {
      const value = await send(
          op.extractionRequest,
          op.phase + ':Extraction',
          result,
          'extraction',
        ),
        parsed = schemas[op.phase.startsWith('product:') ? 'catalog' : 'cart'].safeParse(value);
      result.extractionValid = parsed.success;
      // Private evidence of what the reader returned, so a false verdict can be judged.
      if (parsed.success) result.extraction = parsed.data;
      result.extractionCorrect =
        parsed.success && isDeepStrictEqual(canonical(parsed.data), canonical(op.expected));
      if (!parsed.success) {
        result.metadataStatus = 'skipped_invalid_extraction';
        save();
        continue;
      }
      // The verifier sees the real extraction, exactly as the reader would send it.
      const request = metadataForExtraction(op.metadataTemplate, op.expected, value);
      Object.assign(
        result,
        verdict(await send(request, op.phase + ':Metadata', result, 'metadata')),
      );
    }
    save();
  }
  const final = sourceNow();
  report.finalSource = final;
  if (!sameSource(final, manifest.source)) {
    save();
    throw Error('Source changed during the rehearsal.');
  }
  const r = report.results,
    metadata = r.filter((x) => x.kind === 'metadata'),
    pairs = r.filter((x) => x.kind === 'pair');
  Object.assign(report, {
    stage: 'finished',
    metadataCalls: metadata.length,
    metadataComplete: metadata.filter((x) => x.completed === true).length,
    pairs: pairs.length,
    pairExtractionCorrect: pairs.filter((x) => x.extractionCorrect).length,
    pairMetadataComplete: pairs.filter((x) => x.completed === true).length,
    incomplete: r
      .filter((x) => x.completed !== true || (x.kind === 'pair' && !x.extractionCorrect))
      .map(({ ordinal, kind, phase, cases, repeat, progress, extractionCorrect }) => ({
        ordinal,
        kind,
        phase,
        cases,
        repeat,
        progress,
        extractionCorrect,
      })),
  });
  report.passed = report.incomplete.length === 0;
  save();
  return report;
}
