import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (!existsSync('.env.local')) copyFileSync('.env.example', '.env.local', constants.COPYFILE_EXCL);
// No working payment, POS or vendor credentials are needed for local use.
// Wrangler reads .dev.vars; never copy potentially real environment values.
const names = readFileSync('.env.example', 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => line.split('=')[0]);
const defaults = Object.fromEntries(names.map(name => [name, name === 'CLOVER_ENVIRONMENT' ? 'sandbox' : name === 'PANTRACK_LOCAL_AUTH' ? '1' : '']));
if (!existsSync('.dev.vars')) writeFileSync('.dev.vars', '# Local only. Empty integration secrets disable external setup.\n' + names.map(name => `${name}=${defaults[name]}`).join('\n') + '\n', { flag: 'wx' });
else {
  const current = readFileSync('.dev.vars', 'utf8');
  const missing = names.filter(name => !new RegExp(`^${name}=`, 'm').test(current));
  if (missing.length) writeFileSync('.dev.vars', `${current.endsWith('\n') ? current : `${current}\n`}${missing.map(name => `${name}=${defaults[name]}`).join('\n')}\n`);
}
console.log('Local variable files are ready. Apply migrations with pnpm db:migrate:local, then run pnpm dev.');
