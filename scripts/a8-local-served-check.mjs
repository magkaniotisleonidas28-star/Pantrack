import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {findLocalD1Database} from './local-d1-database.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const vars = readFileSync('.dev.vars', 'utf8');
for (const gate of ['PANTRACK_EXACT_INVENTORY_PREVIEW', 'PANTRACK_CLOVER_SYNC_ENABLED']) {
  assert.match(vars, new RegExp(`^${gate}=enabled\\s*$`, 'm'), `${gate} must be enabled in local .dev.vars`);
}
const stateDir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/run-framework.mjs', 'dev', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, BROWSER: 'none', WRANGLER_SEND_METRICS: 'false'},
  detached: process.platform !== 'win32',
});
let output = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
}
server.on('error', error => { output += error.message; });
let db;
try {
  let ready = false;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline;) {
    if (server.exitCode !== null) throw new Error(`Dev server exited (${server.exitCode})`);
    try {
      const response = await fetch(origin, {signal: AbortSignal.timeout(5000)});
      if (response.ok && (await response.text()).includes('pantrack')) { ready = true; break; }
    } catch { /* First request can compile. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Local server must be ready');
  const signIn = await fetch(`${origin}/signin-with-chatgpt?return_to=/`, {redirect: 'manual'});
  assert.equal(signIn.status, 302);
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Fixture sign-in must issue a cookie');
  const companyId = crypto.randomUUID();
  const productId = `fictional-a8-${crypto.randomUUID()}`;
  const merchantId = `fictional-merchant-${crypto.randomUUID()}`;
  const request = (path, body, authenticated = true) => fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(authenticated ? {cookie} : {}),
      ...(body ? {origin, 'content-type': 'application/json'} : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const expectOk = async (path, body) => {
    const response = await request(path, body);
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  await expectOk('/api/companies', {action: 'create', id: companyId, name: 'Fictional A8 local check'});
  await expectOk('/api/workspace', {action: 'product', companyId, product: {
    id: productId, name: 'Fictional milk', supplier: 'Unverified fictional supplier',
    sku: 'FICTIONAL-A8', pack: 'case', unit: 'case', price: 0,
    category: 'Fictional', url: '', sample: true,
  }});
  const at = new Date().toISOString();
  await expectOk('/api/inventory', {action: 'configureExact', companyId, productId,
    operationId: crypto.randomUUID(), stockUnit: {kind: 'curated', id: 'mL'},
    purchaseUnitLabel: 'case', purchaseAmount: '1000', openingAmount: '10', effectiveAt: at});

  const dbPath = findLocalD1Database(stateDir, {companyId, productId});
  db = new DatabaseSync(dbPath);
  const config = db.prepare("SELECT id,version FROM inventory_config_versions WHERE company_id=? AND product_id=? AND status='active'").get(companyId, productId);
  assert.ok(config, 'Exact inventory configuration must exist');
  const quantity = minor => ({dimension: 'volume', minor: String(minor)});
  const settings = {target: quantity(20000000), capacity: quantity(10000000000),
    dailyUse: quantity(1000000), shelfDays: 3650, countEveryDays: 3650,
    minimumPacks: '0', orderMultiplePacks: '1', maximumPacks: '5'};
  db.prepare(`INSERT INTO replenishment_settings_versions
    (company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,
     dimension,settings_json,changed_by,change_reason,changed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(companyId, productId, 1, crypto.randomUUID(),
      config.id, config.version, 'volume', JSON.stringify(settings), 'fictional-local-owner',
      'Fictional local served check', at);
  db.prepare(`INSERT INTO clover_connections
    (company_id,merchant_id,environment,secret,connected,last_checked,lease_until)
    VALUES (?,?,?,?,?,?,0)`).run(companyId, merchantId, 'sandbox',
      'encrypted-fictional-placeholder', at, at);
  db.prepare(`INSERT INTO clover_sync_state
    (company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until)
    VALUES (?,?,?,?,?,?,?,?,0)`).run(companyId, 'sandbox', merchantId,
      Date.now() - 3600000, Date.now() - 60000, at,
      new Date(Date.now() - 60000).toISOString(), null);

  const path = `/api/replenishment/review?companyId=${companyId}&productId=${productId}`;
  assert.equal((await request(path, null, false)).status, 401, 'Anonymous review is denied');
  assert.equal((await request(`/api/replenishment/review?companyId=${crypto.randomUUID()}&productId=${productId}`)).status, 403,
    'Wrong-company review is denied');
  const review = await expectOk(path);
  assert.equal(review.snapshot?.contract, 'pantrack.replenishment-review.v2');
  const proposalId = crypto.randomUUID();
  const create = {action: 'create', companyId, productId, proposalId, createId: crypto.randomUUID()};
  const saved = await expectOk('/api/replenishment/proposals', create);
  assert.equal(saved.view?.handoff?.supplierSubmissionAllowed, false);
  assert.equal(saved.view?.revision, 1);
  assert.equal((await expectOk('/api/replenishment/proposals', create)).view.revision, 1,
    'Create retry must not add a revision');
  const listPath = `/api/replenishment/proposals?companyId=${companyId}&productId=${productId}`;
  assert.equal((await expectOk(listPath)).views.length, 1);
  const edited = await expectOk('/api/replenishment/proposals', {action: 'edit', companyId, proposalId,
    expectedRevision: 1, changeId: crypto.randomUUID(), packs: '1', reason: 'Fictional manager review'});
  assert.equal(edited.view?.revision, 2);
  db.prepare('UPDATE clover_sync_state SET checkpoint=? WHERE company_id=?').run(Date.now() - 120000, companyId);
  const invalidated = (await expectOk(listPath)).views[0];
  assert.equal(invalidated.revision, 3);
  assert.equal(invalidated.status, 'review_required');
  assert.equal(invalidated.invalidationReason, 'source_unavailable');
  assert.match(invalidated.events.at(-1).reason, /Clover sales health changed/);
  assert.equal((await expectOk(listPath)).views[0].revision, 3,
    'Repeated reads must not add audit events');
  const canceled = await expectOk('/api/replenishment/proposals', {action: 'cancel', companyId,
    proposalId, expectedRevision: 3, changeId: crypto.randomUUID(),
    reason: 'Replace stale fictional proposal'});
  assert.equal(canceled.view?.status, 'canceled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM replenishment_proposal_origins WHERE company_id=?').get(companyId).n, 1);
  console.log('PASS: served A8 review, auth boundaries, create/retry/list/edit, Clover checkpoint invalidation, audited repeat read, and cancel.');
  console.log('Fictional records remain only in this worktree\'s local D1. No provider or supplier endpoint was contacted.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  db?.close();
  if (server.pid && server.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], {stdio: 'ignore'});
    else { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
  }
}
