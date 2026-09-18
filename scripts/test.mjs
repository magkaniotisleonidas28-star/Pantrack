import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const requested = process.argv.slice(2).map(name => name.replace(/^tests[\\/]/, '').replace(/\.mjs$/, ''));
const files = readdirSync('tests').filter(name => name.endsWith('.mjs')).sort();
for (const name of requested) {
  if (!files.includes(`${name}.mjs`)) throw new Error(`Unknown test: ${name}`);
}
const selected = files.filter(name => !requested.length || requested.includes(name.slice(0, -4)));
if (!selected.length) throw new Error('No tests selected.');
// Existing integration harnesses share generated module names. Isolate processes
// and run sequentially so parallel writers cannot invalidate the evidence.
for (const name of selected) {
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.execPath, [`tests/${name}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\nPassed ${selected.length} test suites.`);
