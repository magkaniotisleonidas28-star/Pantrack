import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

mkdirSync('.sites-runtime', { recursive: true });
await build({ entryPoints: ['build/sites-vite-plugin.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.sites-runtime/test-local-auth.mjs' });
const { sites } = await import('../.sites-runtime/test-local-auth.mjs');
const plugin = sites();
assert.equal(plugin.config({}, {command:'build'}).define.__PANTRACK_LOCAL_AUTH_KEY__, '""', 'Production builds contain no fixture key');
assert.notEqual(plugin.config({}, {command:'serve'}).define.__PANTRACK_LOCAL_AUTH_KEY__, '""');
assert.equal(sites({mockAuth:false}).config({}, {command:'serve'}).define.__PANTRACK_LOCAL_AUTH_KEY__, '""');
let middleware;
plugin.configureServer({ config: { server: {}, logger: { info() {} } }, middlewares: { use(handler) { middleware = handler; } } });
function request({ path = '/', host = '127.0.0.1:5173', remoteAddress = '127.0.0.1', headers = {}, method = 'GET' } = {}) {
  const req = { headers: { host, ...headers }, rawHeaders: Object.entries({ host, ...headers }).flat(), socket: { remoteAddress }, method, url: path };
  const res = { statusCode: 200, headers: {}, ended: false, setHeader(name, value) { this.headers[name] = value; }, end() { this.ended = true; } };
  let continued = false;
  middleware(req, res, () => { continued = true; });
  return { req, res, continued };
}
const forged = { 'oai-authenticated-user-id': 'attacker', 'oai-authenticated-user-email': 'attacker@example.test' };
for (const options of [{}, { host: 'evil.example' }, { remoteAddress: '192.168.1.10' }]) {
  const { req } = request({ ...options, headers: forged });
  assert.equal(req.headers['oai-authenticated-user-id'], undefined);
  assert.ok(!req.rawHeaders.includes('attacker'));
}
assert.equal(request({ path: '/signin-with-chatgpt', host: 'evil.example' }).res.statusCode, 403);
assert.equal(request({ path: '/signin-with-chatgpt', remoteAddress: '192.168.1.10' }).res.statusCode, 403);
assert.equal(request({ path: '/signin-with-chatgpt', headers: { origin: 'https://evil.example' } }).res.statusCode, 403);
assert.equal(request({ path: '/signin-with-chatgpt', method: 'POST' }).res.statusCode, 405);
assert.equal(request({ path: '/signin-with-chatgpt', headers: { purpose: 'prefetch' } }).res.statusCode, 204);
const signIn = request({ path: '/signin-with-chatgpt?return_to=https://evil.example' });
assert.equal(signIn.res.headers.Location, '/');
assert.match(signIn.res.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
const signedIn = request({ headers: { ...forged, cookie: '__sites_local_auth=1; app=value' } });
assert.equal(signedIn.req.headers['oai-authenticated-user-id'], 'local_seedy');
assert.equal(signedIn.req.headers.cookie, 'app=value', 'Fixture cookie is removed before the application sees it');
assert.ok(signedIn.continued);
assert.equal(request({ headers: { cookie: '__sites_local_auth=1; __sites_local_auth=1' } }).req.headers['oai-authenticated-user-id'], undefined);
assert.equal(request({ host: 'evil.example', headers: { cookie: '__sites_local_auth=1' } }).req.headers['oai-authenticated-user-id'], undefined);
let registered = false;
sites({ mockAuth: false }).configureServer({ middlewares: { use() { registered = true; } } });
assert.equal(registered, false, 'Managed hosting does not install the local fixture');
console.log('PASS: local auth socket/host limits, forged header stripping, cookie isolation, redirect/origin/prefetch guards, and fixture disablement.');
