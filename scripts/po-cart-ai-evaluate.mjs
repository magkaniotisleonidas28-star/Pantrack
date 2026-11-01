import { randomUUID } from 'node:crypto';
import { loadAiConfig, modelConfig } from './cart-preview/ai-config.mjs';
import { writePrivate } from './po-cart-worker/private-files.mjs';
import { buildEvaluation } from './po-cart-worker/evaluation-build.mjs';
if (!process.argv.includes('--ai'))
  throw Error('Real AI requires the dedicated --ai evaluation command.');
try {
  loadAiConfig();
  modelConfig();
} catch {
  const report = '.sites-runtime/po-cart-workers/ai-evaluation/pending-' + randomUUID() + '.json';
  writePrivate(report, {
    evidence: 'pending',
    reason: 'Private model configuration is absent or differs from the reviewed model/pricing.',
    realModelCalls: 0,
    acceptanceComplete: false,
    actualBillingUsd: null,
    manualTimingComparison: 'pending',
  });
  console.error(
    'Real-AI evaluation pending: privately configure .dev.vars.cart (mode 0600). No model calls made. Report: ' +
      report,
  );
  process.exitCode = 1;
}
if (!process.exitCode) {
  // The build keeps the filesystem/CLI seeder and sites-env unbundled: they
  // resolve the repository relative to their own source URL.
  await buildEvaluation();
  const { seedLocalBrowserJob } = await import('./po-cart-worker/local-browser-fixture.mjs');
  const { runEvaluation } = await import('../.sites-runtime/po-cart-workers/ai-evaluate.mjs');
  await runEvaluation(seedLocalBrowserJob);
}
