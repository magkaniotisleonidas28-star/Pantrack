import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const evaluationBundle = '.sites-runtime/po-cart-workers/ai-evaluate.mjs';
// sites-env and the filesystem/CLI seeder resolve the repository relative to
// their own source URL. Bundled, they would resolve it from the generated
// module's directory, so they always load from their real files instead.
const repositoryRelative = /(?:^|\/)(?:local-browser-fixture|sites-env)\.mjs$/;

export function buildEvaluation(outfile = evaluationBundle) {
  return build({
    entryPoints: ['scripts/po-cart-worker/ai-evaluate.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile,
    logLevel: 'silent',
    plugins: [
      {
        name: 'repository-relative-modules',
        setup(bundler) {
          bundler.onResolve({ filter: repositoryRelative }, (args) => ({
            path: pathToFileURL(resolve(args.resolveDir, args.path)).href,
            external: true,
          }));
        },
      },
    ],
  });
}
