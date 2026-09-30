import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';

mkdirSync('.sites-runtime', {recursive: true});
const sql = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + file, 'utf8'));
globalThis.posStatusDB = {prepare(query) { let values = []; return {
  bind(...v) { values = v; return this; }, async first() { return sql.prepare(query).get(...values) || null; },
  async all() { return {results: sql.prepare(query).all(...values)}; }, async run() { return sql.prepare(query).run(...values); },
}; }};
globalThis.posStatusUser = {userId: 'owner'};
globalThis.posStatusEnv = {APP_ORIGIN: 'https://test', CLOVER_ENVIRONMENT: 'sandbox', CLOVER_CLIENT_ID: 'fictional-app', CLOVER_CLIENT_SECRET: 'private-app-secret', VENDOR_ENCRYPTION_KEY: 'private-key'};
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('Register status must not make external requests.'); };
const plugin = {name: 'pos-status-runtime', setup(b) {
  b.onResolve({filter: /chatgpt-auth|db\/raw|^cloudflare:workers$/}, args => ({path: args.path, namespace: 'pos-status'}));
  b.onLoad({filter: /.*/, namespace: 'pos-status'}, args => ({contents: args.path.includes('chatgpt-auth') ? 'export async function getChatGPTUser(){return globalThis.posStatusUser}'
    : args.path === 'cloudflare:workers' ? 'export const env=globalThis.posStatusEnv' : 'export function database(){return globalThis.posStatusDB}'}));
}};
await build({entryPoints: ['src/app/api/register/route.ts'], outfile: '.sites-runtime/pos-status-api.mjs', bundle: true, platform: 'node', format: 'esm', plugins: [plugin]});
await build({entryPoints: ['src/components/workspace/pos-connection-status.tsx'], outfile: '.sites-runtime/pos-status-ui.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external'});
const api = await import('../.sites-runtime/pos-status-api.mjs');
const {default: Status} = await import('../.sites-runtime/pos-status-ui.mjs');
for (const company of ['company-a', 'company-b']) sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, 'now');
for (const role of ['owner', 'manager', 'employee']) sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(role, 'company-a', role);
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('other-owner', 'company-b', 'owner');
const settings = {provider: 'toast', customName: '', location: 'saved-reference'};
sql.prepare('INSERT INTO register_settings(company_id,data) VALUES (?,?)').run('company-a', JSON.stringify(settings));
sql.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)').run('company-a', 'private-location-id', 'sandbox', 'private-encrypted-token', 'now', null);
const now = Date.now();
sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)').run('company-a', 'sandbox', 'private-location-id', now, now);
const get = (company = 'company-a') => api.GET(new Request(`https://test/api/register?companyId=${company}`));
const post = (action, companyId = 'company-a') => api.POST(new Request('https://test/api/register', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://test'}, body: JSON.stringify({companyId, action, settings})}));
const changes = () => sql.prepare('SELECT total_changes() AS n').get().n;

const beforeRead = changes(), response = await get(), data = await response.json();
assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
assert.equal(changes(), beforeRead, 'Status reads must not write or consume inventory.');
assert.deepEqual(data.settings, settings); assert.equal(data.availability.native.state, 'setup_required');
assert.equal(data.availability.native.reason, 'adapter_not_implemented'); assert.equal(data.availability.native.sync, 'unavailable');
assert.equal(data.availability.capabilities.catalog, false); assert.equal(data.availability.capabilities.webhooks, false); assert.equal(data.availability.fallbacks.csv, true);
assert.equal(data.availability.fallbacks.bridge, 'disabled');
const toastHtml = renderToStaticMarkup(Status({name: 'Toast', availability: data.availability}));
assert.match(toastHtml, /Toast native integration: setup required/); assert.match(toastHtml, /Direct Toast sales sync is not available yet/);
assert.match(toastHtml, /CSV import: available/); assert.ok(!toastHtml.includes('Toast authorized'));

globalThis.posStatusUser = null; assert.equal((await get()).status, 401); assert.equal((await post('save')).status, 401);
globalThis.posStatusUser = {userId: 'other-owner'}; assert.equal((await get()).status, 403); assert.equal((await post('save')).status, 403);
for (const role of ['manager', 'employee']) {
  globalThis.posStatusUser = {userId: role};
  const memberResponse = await get(); assert.equal(memberResponse.status, 200, 'Existing read permission preserved.');
  const memberData = JSON.stringify(await memberResponse.json());
  for (const secret of ['private-location-id', 'private-encrypted-token', 'private-app-secret', 'private-key', 'token_hash']) assert.ok(!memberData.includes(secret), secret);
  for (const action of ['save', 'token', 'revoke']) assert.equal((await post(action)).status, 403, `${role} cannot ${action}`);
}
globalThis.posStatusUser = {userId: 'owner'};
assert.equal((await get('company-b')).status, 403); assert.equal((await post('save', 'company-b')).status, 403);
assert.equal((await post('save')).status, 200); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM clover_connections').get().n, 1, 'Changing provider preference preserves Clover connection/history.');
assert.equal((await post('token')).status, 200);
let availability = (await (await get()).json()).availability;
assert.equal(availability.fallbacks.bridge, 'configured'); assert.equal(availability.native.state, 'setup_required');
assert.match(renderToStaticMarkup(Status({name: 'Toast', availability})), /no accepted requests yet/);
sql.prepare('UPDATE register_settings SET last_received=? WHERE company_id=?').run(new Date(now).toISOString(), 'company-a');
availability = (await (await get()).json()).availability; assert.equal(availability.fallbacks.bridge, 'received');
assert.equal((await post('revoke')).status, 200); assert.equal((await (await get()).json()).availability.fallbacks.bridge, 'disabled');

settings.provider = 'clover'; assert.equal((await post('save')).status, 200);
availability = (await (await get()).json()).availability; assert.equal(availability.native.state, 'authorized'); assert.equal(availability.native.sync, 'paused');
assert.equal(availability.capabilities.authorization, 'oauth2'); assert.equal(availability.capabilities.locations, 'bound_location');
globalThis.posStatusEnv.PANTRACK_CLOVER_SYNC_ENABLED = 'enabled';
availability = (await (await get()).json()).availability; assert.equal(availability.native.sync, 'ready');
assert.match(renderToStaticMarkup(Status({name: 'Clover', availability})), /ready for manual sync/);
sql.prepare('UPDATE clover_sync_state SET last_error=? WHERE company_id=?').run('private-provider-error', 'company-a');
availability = (await (await get()).json()).availability; assert.equal(availability.native.state, 'degraded'); assert.equal(availability.native.sync, 'degraded');
for (const secret of ['private-provider-error', 'private-encrypted-token', 'private-location-id', 'private-app-secret', 'private-key', 'token_hash']) assert.ok(!JSON.stringify(availability).includes(secret), secret);
globalThis.posStatusEnv.CLOVER_ENVIRONMENT = 'production';
availability = (await (await get()).json()).availability; assert.equal(availability.native.state, 'setup_required'); assert.equal(availability.native.reason, 'environment_mismatch'); assert.equal(availability.native.sandboxAccepted, false);
globalThis.posStatusEnv.CLOVER_ENVIRONMENT = 'sandbox';
sql.prepare('DELETE FROM clover_sync_state WHERE company_id=?').run('company-a');
availability = (await (await get()).json()).availability;
assert.equal(availability.native.state, 'degraded'); assert.equal(availability.native.sync, 'unavailable'); assert.equal(availability.native.reason, 'status_unavailable');
assert.match(renderToStaticMarkup(Status({name: 'Clover', availability})), /Connection status could not be checked/);
sql.prepare('DELETE FROM clover_connections WHERE company_id=?').run('company-a');
availability = (await (await get()).json()).availability; assert.equal(availability.native.state, 'disconnected');
const originalPrepare = globalThis.posStatusDB.prepare;
globalThis.posStatusDB.prepare = query => { if (query.includes('clover_connections')) throw new Error('private-db-error'); return originalPrepare(query); };
const degraded = await get(); assert.equal(degraded.status, 200); assert.equal((await degraded.json()).availability.native.reason, 'status_unavailable');
globalThis.posStatusDB.prepare = originalPrepare;
assert.equal(externalCalls, 0); assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sales_events').get().n, 0);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_events').get().n, 0);
console.log('PASS: register API is read-only, company/role protected and private; Toast remains setup required, Clover reports local authorization/sync status, bridge configuration is distinct from receipt history, and status never calls a provider.');
