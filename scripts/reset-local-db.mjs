import { rmSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = resolve(root, '.wrangler/state/v3/d1');
const withinRoot = relative(root, state);
if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot)) throw new Error('Invalid local database path.');
if (!process.argv.includes('--confirm-local-reset')) {
  console.error('Stop the dev server first. This deletes only the local D1 data. Run pnpm db:reset:local --confirm-local-reset to proceed.');
  process.exit(1);
}
console.log(`Resetting local D1 state: ${state}`);
rmSync(state, { recursive: true, force: true });
const result = spawnSync(process.execPath, [
  '--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js',
  'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.local.jsonc', '--persist-to', '.wrangler/state',
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
