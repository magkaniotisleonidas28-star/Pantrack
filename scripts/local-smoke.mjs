import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/run-framework.mjs', 'dev', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none', WRANGLER_SEND_METRICS: 'false' },
  detached: process.platform !== 'win32',
});
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
child.on('error', error => { output += error.message; });
const deadline = Date.now() + 120_000;
try {
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Dev server exited (${child.exitCode})`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
      if (response.ok && (await response.text()).includes('pantrack')) { ready = true; break; }
    } catch { /* The dev server compiles on the first request. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Home page must load locally');
  assert.equal((await fetch(`${origin}/api/companies`)).status, 401, 'Anonymous access');
  assert.equal((await fetch(`${origin}/api/companies`, { headers: {
    'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'forged@example.test',
  } })).status, 401, 'Local middleware strips forged identity headers');
  const signIn = await fetch(`${origin}/signin-with-chatgpt?return_to=/`, { redirect: 'manual' });
  assert.equal(signIn.status, 302);
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Local sign in provides a fixture cookie');
  const companyId = crypto.randomUUID();
  const created = await fetch(`${origin}/api/companies`, {
    method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'create', id: companyId, name: 'Local smoke test café' }),
  });
  assert.equal(created.status, 200, await created.text());
  const companies = await (await fetch(`${origin}/api/companies`, { headers: { cookie } })).json();
  assert.ok(companies.companies.some(company => company.id === companyId && company.role === 'owner'));
  const catalog = await fetch(`${origin}/api/workspace?companyId=${companyId}`, { headers: { cookie } });
  assert.equal(catalog.status, 200, 'New local company catalog');
  assert.equal((await fetch(`${origin}/api/workspace?companyId=${crypto.randomUUID()}`, { headers: { cookie } })).status, 403, 'Wrong-company access');
  const signOut = await fetch(`${origin}/signout-with-chatgpt?return_to=/`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(signOut.status, 302);
  assert.match(signOut.headers.get('set-cookie'), /Max-Age=0/);
  console.log('PASS: local home page, anonymous/forged-header rejection, fixture sign in, company creation, catalog, tenant isolation and sign out.');
  console.log('The smoke test leaves a fictional company in your local D1 database.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
  }
}
