import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Explicit in-memory asset allowlist; no app routes, DB, environment files or supplier transport.
const root = new URL('../previews/c4-order-draft/', import.meta.url);
const result = await build({entryPoints: [fileURLToPath(new URL('main.ts', root))], bundle: true,
  platform: 'browser', format: 'esm', target: 'es2022', write: false});
const assets = new Map([
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('index.html', root))]],
  ['/styles.css', ['text/css; charset=utf-8', readFileSync(new URL('styles.css', root))]],
  ['/main.js', ['text/javascript; charset=utf-8', result.outputFiles[0].contents]],
]);
const server = createServer((request, response) => {
  if (!['127.0.0.1:5180', 'localhost:5180'].includes(request.headers.host)) {
    response.writeHead(403); response.end(); return;
  }
  const asset = assets.get(request.url);
  if (!asset || request.method !== 'GET') {response.writeHead(404); response.end(); return;}
  response.writeHead(200, {'Content-Type': asset[0], 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
  response.end(asset[1]);
});
server.on('error', error => {console.error(error.message); process.exitCode = 1;});
server.listen(5180, '127.0.0.1', () => console.log('Fictional review draft — not an order. Preview: http://127.0.0.1:5180 (Ctrl+C to stop).'));
