import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildEvaluation, evaluationBundle } from '../scripts/po-cart-worker/evaluation-build.mjs';

// The paid evaluation runs from a module generated two directories deep. On
// 2026-11-01 a bundled sites-env moved the process into `.sites-runtime`, where
// the frozen-source snapshot found no files before any provider request.
// The check generates at the same depth, outside the protected worker evidence,
// so external packages resolve as they do for the real bundle.
const generated = resolve('.sites-runtime', 'evaluation-build-check-' + randomUUID()),
  elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'pantrack-evaluation-build-')));
try {
  assert.equal(evaluationBundle, '.sites-runtime/po-cart-workers/ai-evaluate.mjs');
  // The paid command builds only through this shared build and loads its output.
  const command = readFileSync('scripts/po-cart-ai-evaluate.mjs', 'utf8');
  assert.match(command, /^ {2}await buildEvaluation\(\);$/m);
  assert.doesNotMatch(command, /esbuild|\bbuild\(/);
  assert.match(command, /import\('\.\.\/\.sites-runtime\/po-cart-workers\/ai-evaluate\.mjs'\)/);
  const outfile = join(generated, 'ai-evaluate.mjs');
  await buildEvaluation(outfile);
  const text = readFileSync(outfile, 'utf8');
  // Repository-relative modules load from their real files; nothing generated changes directory.
  assert.doesNotMatch(
    text,
    /^\/\/ scripts\/(?:sites-env|po-cart-worker\/local-browser-fixture)\.mjs$/m,
  );
  assert.doesNotMatch(text, /process\.chdir/);
  assert.ok(
    text.includes(
      JSON.stringify(
        pathToFileURL(resolve('scripts/po-cart-worker/local-browser-fixture.mjs')).href,
      ),
    ),
  );
  // Loading the generated module from elsewhere leaves the process in the
  // repository, where the paid run's frozen-source snapshot finds the source.
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(outfile).href)});
const { sourceSnapshot } = await import(${JSON.stringify(pathToFileURL(resolve('scripts/po-cart-worker/acceptance-gate.mjs')).href)});
console.log(JSON.stringify({ cwd: process.cwd(), files: sourceSnapshot().files }));`,
    ],
    { cwd: elsewhere, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  const loaded = JSON.parse(child.stdout.trim().split('\n').pop());
  assert.equal(realpathSync(loaded.cwd), realpathSync(process.cwd()));
  assert.ok(loaded.files > 0);
  console.log(
    'PASS evaluation build: generated two directories deep, repository-relative modules stay unbundled and the frozen source is found.',
  );
} finally {
  rmSync(generated, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
}
