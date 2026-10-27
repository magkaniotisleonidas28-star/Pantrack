import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { format, getFileInfo, resolveConfig } from 'prettier';
import { assertFormattingEquivalent } from './readability/format-safety.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const parameters = args.filter((argument) => argument !== '--write');
const section = parameters[1];
const write = args.includes('--write');
const expectedArgs = ['--section', section];
if (
  parameters[0] !== '--section' ||
  args.filter((argument) => argument === '--write').length > 1 ||
  !/^S(?:0[1-9]|1[0-9]|2[01])$/.test(section ?? '') ||
  JSON.stringify(parameters) !== JSON.stringify(expectedArgs)
) {
  throw new Error('Use --section S01 (check only), or --section S01 --write. No paths or globs.');
}

const inventory = JSON.parse(readFileSync('docs/CODE_READABILITY_FILE_MANIFEST.json', 'utf8'));
const eligible = inventory.files.filter(
  (entry) =>
    entry.section === section &&
    entry.status !== 'Blocked' &&
    ['review-before-cleanup', 'cleanup-tooling'].includes(entry.policy) &&
    /\.(?:[cm]?js|tsx?|jsonc?)$/.test(entry.path),
);
const candidates = [];
for (const entry of eligible) {
  const path = resolve(root, entry.path);
  const local = relative(root, path);
  if (
    local === '..' ||
    local.startsWith(`..${sep}`) ||
    isAbsolute(local) ||
    local === '' ||
    local.split(sep).join('/') !== entry.path
  ) {
    throw new Error(`Inventory path must be project-relative: ${entry.path}`);
  }
  const info = await getFileInfo(path, { ignorePath: '.prettierignore' });
  if (info.ignored) continue;
  const before = readFileSync(path, 'utf8');
  const options = await resolveConfig(path);
  const after = await format(before, { ...options, filepath: path });
  assertFormattingEquivalent(before, after, entry.path);
  candidates.push({ path, before, after });
}
if (!candidates.length) throw new Error(`No eligible source files in ${section}.`);

// Prettier's independent parser/round-trip check supplements the compiler guard.
// Validate the whole selection before writing any file.
const cli = fileURLToPath(new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url));
const debug = spawnSync(
  process.execPath,
  [cli, '--debug-check', ...candidates.map((c) => c.path)],
  {
    encoding: 'utf8',
  },
);
if (debug.error) throw debug.error;
if (debug.status !== 0) throw new Error(debug.stderr || 'Prettier round-trip check failed.');

const changed = candidates.filter((candidate) => candidate.before !== candidate.after);
for (const candidate of candidates) {
  if (readFileSync(candidate.path, 'utf8') !== candidate.before) {
    throw new Error(`Source changed during verification: ${relative(root, candidate.path)}`);
  }
}
for (const candidate of changed) {
  if (write) writeFileSync(candidate.path, candidate.after);
  console.log(`${write ? 'Formatted' : 'Needs formatting'}: ${relative(root, candidate.path)}`);
}
console.log(
  `${section}: ${candidates.length} eligible files verified; ${changed.length} ${write ? 'formatted' : 'differ'}. Protected and unsupported files require separate review.`,
);
if (!write && changed.length) process.exitCode = 1;
