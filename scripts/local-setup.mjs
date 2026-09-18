import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (!existsSync('.env.local')) copyFileSync('.env.example', '.env.local', constants.COPYFILE_EXCL);
// No working payment, POS or vendor credentials are needed for local use.
// Wrangler reads .dev.vars; never copy potentially real environment values.
if (!existsSync('.dev.vars')) {
  const names = readFileSync('.env.example', 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => line.split('=')[0]);
  writeFileSync('.dev.vars', '# Local only. Empty integration secrets disable external setup.\n' +
    names.map(name => `${name}=${name === 'CLOVER_ENVIRONMENT' ? 'sandbox' : ''}`).join('\n') + '\n', { flag: 'wx' });
}
console.log('Local variable files are ready. Apply migrations with pnpm db:migrate:local, then run pnpm dev.');
