import { randomUUID, createHash } from 'node:crypto';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { isAbsolute, resolve, dirname } from 'node:path';
import { readPrivate, writePrivate } from './po-cart-worker/private-files.mjs';

// Verifier rehearsal. Practice evidence only; never acceptance.
//   record                              offline, feature worktree only (opens a browser)
//   plan --recording P --ledger P --output P      offline; reads the ledger only
//   authorize --manifest P --approval-file P --pricing-file P --output P
//                                       only after the owner's separate explicit
//                                       authorization of that exact manifest
//   run --ai --manifest P --authorization-file P  sends the manifest once
const usage = Error(
  'Use `record`, `plan`, `authorize`, or `run --ai` with the documented absolute paths.',
);
const modes = {
  record: [],
  plan: ['--recording', '--ledger', '--output'],
  authorize: ['--manifest', '--approval-file', '--pricing-file', '--output'],
  run: ['--manifest', '--authorization-file'],
};
const [mode, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(modes, mode)) throw usage;
const args = {};
for (let i = 0; i < rest.length; i++) {
  const flag = rest[i];
  if (mode === 'run' && flag === '--ai' && !args.ai) {
    args.ai = true;
    continue;
  }
  const value = rest[i + 1];
  if (!modes[mode].includes(flag) || Object.hasOwn(args, flag) || !value || !isAbsolute(value))
    throw usage;
  args[flag] = value;
  i++;
}
if (modes[mode].some((f) => !args[f]) || (mode === 'run' && !args.ai)) throw usage;

const root = resolve('.sites-runtime/cart-ai-rehearsal');
const exclusive = (path, value) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
const fileSha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (mode === 'record') {
  await import('./po-cart-worker/offline-boundary.mjs');
  // Recording opens a browser, so it runs only in a linked feature worktree.
  const { execFileSync } = await import('node:child_process');
  const git = (flag) =>
    resolve(execFileSync('git', ['rev-parse', flag], { encoding: 'utf8' }).trim());
  if (git('--git-dir') === git('--git-common-dir'))
    throw Error('Record only in a feature worktree, never the main checkout.');
}
const { build } = await import('esbuild');
await build({
  entryPoints: ['scripts/po-cart-worker/rehearsal-bundle.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: '.sites-runtime/ai-rehearsal.mjs',
  logLevel: 'silent',
});
const bundle = await import('../.sites-runtime/ai-rehearsal.mjs');
const { sourceSnapshot } = await import('./po-cart-worker/acceptance-gate.mjs');
const sourceNow = () => {
  const s = sourceSnapshot();
  return { files: s.files, sha256: s.sha256 };
};
const { budgetFile, budgetCeilingMicros, AiBudgetLedger } =
  await import('./cart-preview/ai-budget.mjs');
const { matrixReservationMicros } = await import('./po-cart-worker/evaluation-preflight.mjs');

if (mode === 'record') {
  const { recordWorkerRequests, freePort } =
    await import('./po-cart-worker/rehearsal-recorder.mjs');
  const { workerFixture } = await import('../tests/helpers/po-cart-worker.mjs');
  const { enqueue } = await import('../tests/helpers/po-cart-jobs.mjs');
  const { finishOfflineFixture } = await import('./po-cart-worker/offline-case-cleanup.mjs');
  const version = (name) =>
    JSON.parse(readFileSync('node_modules/' + name + '/package.json', 'utf8')).version;
  const r = await recordWorkerRequests({
    ...bundle,
    workerFixture,
    enqueue,
    finishOfflineFixture,
    freePort,
    sourceNow,
    workRoot: root,
    sdk: { stagehand: version('@browserbasehq/stagehand'), playwright: version('playwright-core') },
  });
  console.log(
    'Recorded ' +
      r.recording.captures.length +
      ' worker captures offline. Recording: ' +
      r.path +
      ' sha256 ' +
      r.sha256,
  );
} else if (mode === 'plan') {
  const { planRehearsal } = await import('./po-cart-worker/rehearsal-manifest.mjs');
  const recording = readPrivate(args['--recording']);
  if (recording.source?.sha256 !== sourceNow().sha256)
    throw Error('Recording does not match the current source.');
  // Read-only: the canonical ledger is inspected, never locked or rewritten.
  const ledger = new AiBudgetLedger(
    args['--ledger'],
    resolve(dirname(args['--ledger']), '../cart-ai-evaluation/state.json'),
  );
  const reservedMicros = ledger.total(ledger.read()),
    manifest = planRehearsal(recording, {
      recordingSha256: fileSha(args['--recording']),
      model: 'gpt-5.4-mini-2026-03-17',
      inputRate: 0.75,
      outputRate: 4.5,
    });
  manifest.budget = {
    ledgerPath: args['--ledger'],
    reservedMicros,
    matrixMicros: matrixReservationMicros,
    ceilingMicros: budgetCeilingMicros,
    fits:
      reservedMicros + manifest.maxReservationMicros + matrixReservationMicros <=
      budgetCeilingMicros,
  };
  exclusive(args['--output'], manifest);
  console.log(
    'Planned ' +
      manifest.requests +
      ' requests in ' +
      manifest.groups +
      ' groups; at most ' +
      manifest.maxReservationMicros +
      ' micros reserved; fits with the matrix reserve: ' +
      manifest.budget.fits +
      '. Manifest ' +
      args['--output'] +
      ' sha256 ' +
      fileSha(args['--output']),
  );
} else {
  const { loadAiConfig, modelConfig } = await import('./cart-preview/ai-config.mjs');
  const { validateManifest } = await import('./po-cart-worker/rehearsal-manifest.mjs');
  const runId = randomUUID(),
    file = resolve(root, 'runs', runId, 'report.json'),
    report = { stage: 'starting', mode, runId, startedAt: new Date().toISOString() };
  const save = () => writePrivate(file, report);
  save();
  try {
    loadAiConfig();
    const config = modelConfig(),
      rates = { model: config.model, inputRate: config.inputRate, outputRate: config.outputRate },
      manifestSha256 = fileSha(args['--manifest']),
      manifest = validateManifest(readPrivate(args['--manifest']), rates),
      ledgerPath = resolve(budgetFile);
    Object.assign(report, { manifestPath: args['--manifest'], manifestSha256, ledgerPath });
    save();
    if (mode === 'authorize') {
      const { createRehearsalAuthorization } =
        await import('./po-cart-worker/rehearsal-authorization.mjs');
      const ledger = new AiBudgetLedger();
      const reservedMicros = ledger.total(ledger.read());
      Object.assign(report, {
        reservedMicros,
        maxReservationMicros: manifest.maxReservationMicros,
      });
      save();
      if (manifest.source.sha256 !== sourceNow().sha256)
        throw Error('Manifest does not match the current source.');
      if (
        reservedMicros + manifest.maxReservationMicros + matrixReservationMicros >
        budgetCeilingMicros
      )
        throw Error('Rehearsal would leave too little budget for the paid matrix.');
      if (existsSync(args['--output'])) throw Error('Authorization path already exists.');
      createRehearsalAuthorization(
        {
          authorizationReference: readPrivate(args['--approval-file']).authorizationReference,
          pricing: readPrivate(args['--pricing-file']),
          manifestSha256,
          source: manifest.source,
          requests: manifest.requests,
          maxReservationMicros: manifest.maxReservationMicros,
          ledgerPath,
        },
        args['--output'],
      );
      report.stage = 'authorized';
      save();
      console.log('Rehearsal authorization created: ' + args['--output']);
    } else {
      const { runRehearsal } = await import('./po-cart-worker/rehearsal-runner.mjs');
      const { consumeRehearsalAuthorization } =
        await import('./po-cart-worker/rehearsal-authorization.mjs');
      const ledger = new AiBudgetLedger();
      await runRehearsal({
        manifest,
        manifestSha256,
        authorizationPath: args['--authorization-file'],
        ledgerPath,
        rates,
        runId,
        sourceNow,
        consume: consumeRehearsalAuthorization,
        provider: new bundle.BoundedAiProvider(ledger, fetch, 45000, matrixReservationMicros),
        schemas: { catalog: bundle.discoverySchema, cart: bundle.cartSchema },
        report,
        save,
      });
      console.log(
        (report.passed ? 'PASS' : 'INCOMPLETE') +
          ' verifier rehearsal: ' +
          report.metadataComplete +
          ' of ' +
          report.metadataCalls +
          ' checks complete; ' +
          report.pairExtractionCorrect +
          ' of ' +
          report.pairs +
          ' readings correct. Private report: ' +
          file,
      );
      if (!report.passed) process.exitCode = 1;
    }
  } catch (e) {
    report.stage = 'stopped';
    report.reason = e instanceof Error ? e.message.slice(0, 200) : 'stopped';
    save();
    console.error(
      'Verifier rehearsal ' + mode + ' stopped: ' + report.reason + '. Private report: ' + file,
    );
    process.exitCode = 1;
  }
}
