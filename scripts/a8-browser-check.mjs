import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  statSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  openSync,
  closeSync,
} from 'node:fs';
import { createServer as createPortProbe, connect } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { withA8Server } from './a8-browser/lifecycle.mjs';
import { runA8Scenario } from './a8-browser/scenario.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const runId = randomUUID(),
  root = resolve(sourceRoot, '.sites-runtime/a8-browser/run-' + runId);
mkdirSync(root, { recursive: true, mode: 0o700 });
const record = (name, value) =>
  writeFileSync(resolve(root, name + '.json'), JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
const invocation = { argumentCount: process.argv.length - 2 };
record('invocation-inputs', invocation);
function refuse(reason, message) {
  record('refusal', { passed: false, reason });
  throw Error(message);
}
if (invocation.argumentCount > 0)
  refuse('unsupported_arguments', 'Use pnpm a8:check:browser without arguments.');
const browserCandidates = process.env.CHROME_PATH
  ? [resolve(process.env.CHROME_PATH)]
  : [
      chromium.executablePath(),
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ];
const executablePath = browserCandidates.find(
  (path) => existsSync(path) && statSync(path).isFile(),
);
const preflight = {
  browserAvailable: Boolean(executablePath),
  dependenciesAvailable: existsSync(resolve(sourceRoot, 'node_modules/vite')),
};
record('preflight-inputs', preflight);
if (!executablePath)
  refuse(
    'browser_unavailable',
    'A local Chromium browser is required. Set CHROME_PATH to its executable.',
  );
if (!preflight.dependenciesAvailable)
  refuse('dependencies_unavailable', 'Install the locked project dependencies before this check.');

function sourceFiles() {
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: sourceRoot,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(
          (file) =>
            file &&
            !/^(?:\.sites-runtime|node_modules|docs|dist|\.wrangler|\.next|work)(?:\/|$)|(?:\.md|\.tsbuildinfo)$/.test(
              file,
            ) &&
            !(file !== '.env.example' && /^\.env(?:\.|$)/.test(basename(file))) &&
            !/^\.dev\.vars(?:\.|$)|^\.npmrc$/.test(basename(file)),
        ),
    ),
  ].sort();
}
function snapshot(files) {
  const hash = createHash('sha256');
  for (const file of files)
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(resolve(sourceRoot, file)));
  return { files: files.length, sha256: hash.digest('hex') };
}
const files = sourceFiles(),
  before = snapshot(files);
// Workerd's Windows SQLite paths must not inherit a deeply nested worktree path.
const appBase = resolve(process.env.LOCALAPPDATA ?? tmpdir(), 'Pantrack/a8-browser');
if (process.platform === 'win32') mkdirSync(appBase, { recursive: true, mode: 0o700 });
const app =
  process.platform === 'win32' ? mkdtempSync(resolve(appBase, 'app-')) : resolve(root, 'app');
mkdirSync(app, { recursive: true, mode: 0o700 });
const report = {
  version: 1,
  runId,
  source: before,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim(),
  startedAt: new Date().toISOString(),
  root,
  appRoot: app,
  passed: false,
  commands: [],
};
const previousEnvironment = { ...process.env },
  previousDirectory = process.cwd();
const env = {};
for (const name of [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'LANG',
  'LC_ALL',
  'TZ',
  'XDG_RUNTIME_DIR',
])
  if (process.env[name] !== undefined) env[name] = process.env[name];
env.PATH =
  dirname(process.execPath) +
  (process.platform === 'win32' ? ';' : ':') +
  (env.PATH ?? env.Path ?? '');
Object.assign(env, {
  BROWSER: 'none',
  CLOUDFLARE_CF_FETCH_ENABLED: 'false',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_WRITE_LOGS: 'false',
  SITES_RUNTIME_ROOT: resolve(app, '.sites-runtime'),
  WRANGLER_LOG_PATH: resolve(app, '.sites-runtime/wrangler/logs'),
  WRANGLER_REGISTRY_PATH: resolve(app, '.sites-runtime/wrangler/dev-registry'),
  MINIFLARE_REGISTRY_PATH: resolve(app, '.sites-runtime/wrangler/registry'),
});
let origin, failure;
const portFree = (port) =>
  new Promise((ok) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      ok(false);
    });
    socket.once('error', () => ok(true));
  });
try {
  for (const file of files) {
    const from = resolve(sourceRoot, file),
      to = resolve(app, file),
      local = relative(app, to);
    if (
      local.startsWith('..' + sep) ||
      local === '..' ||
      isAbsolute(local) ||
      !lstatSync(from).isFile()
    )
      throw Error('Only regular project source files can enter the A8 app copy.');
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    copyFileSync(from, to);
  }
  // Own the cache directories while reusing installed package contents.
  mkdirSync(resolve(app, 'node_modules'));
  for (const name of readdirSync(resolve(sourceRoot, 'node_modules'))) {
    if (name.startsWith('.')) continue;
    const from = resolve(sourceRoot, 'node_modules', name),
      to = resolve(app, 'node_modules', name);
    if (statSync(from).isDirectory())
      symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    else copyFileSync(from, to);
  }
  const probe = createPortProbe();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  origin = 'http://127.0.0.1:' + port;
  report.origin = origin;
  function command(name, args) {
    const logPath = resolve(root, name + '.log'),
      fd = openSync(logPath, 'wx', 0o600);
    const result = spawnSync(process.execPath, args, {
      cwd: app,
      env,
      windowsHide: true,
      timeout: 180000,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    report.commands.push({ name, args, exitCode: result.status, logPath });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(name + ' failed; see its private log.');
  }
  command('local-setup', ['scripts/local-setup.mjs']);
  const varsPath = resolve(app, '.dev.vars'),
    vars = readFileSync(varsPath, 'utf8');
  if ([...vars.matchAll(/^APP_ORIGIN=.*$/gm)].length !== 1)
    throw Error('Expected one fresh local origin setting.');
  writeFileSync(
    varsPath,
    vars.replace(/^APP_ORIGIN=.*$/m, 'APP_ORIGIN=' + origin) +
      '\nPANTRACK_EXACT_INVENTORY_PREVIEW=enabled\nPANTRACK_CLOVER_SYNC_ENABLED=enabled\n',
    { mode: 0o600 },
  );
  command('migrations', [
    '--import',
    './scripts/sites-env.mjs',
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    'wrangler.local.jsonc',
    '--persist-to',
    '.wrangler/state',
  ]);
  // Do not let a caller's integration credentials or local execution profile enter this fixture.
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, env);
  process.chdir(app);
  const { createServer } = await import('vite');
  report.browser = await withA8Server({
    createServer: (observe) =>
      createServer({
        root: app,
        configFile: resolve(app, 'vite.config.ts'),
        cacheDir: resolve(app, 'node_modules/.vite'),
        plugins: [{ name: 'a8-browser-resource-owner', enforce: 'pre', configureServer: observe }],
        clearScreen: false,
        server: { host: '127.0.0.1', port, strictPort: true },
      }),
    record,
    run: async (server) => {
      await server.listen();
      let ready = false;
      for (const deadline = Date.now() + 120000; Date.now() < deadline;) {
        try {
          const response = await fetch(origin + '/api/companies', {
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
          if (response.status === 401) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((ok) => setTimeout(ok, 250));
      }
      if (!ready) throw Error('The isolated A8 app did not become ready.');
      return runA8Scenario({ origin, appRoot: app, evidenceRoot: root, executablePath });
    },
  });
  report.cleanup = { portFree: await portFree(port) };
  if (!report.cleanup.portFree) throw Error('The A8 preview port is still occupied after cleanup.');
} catch (error) {
  failure = error;
  report.failure = { name: error.name, message: error.message };
} finally {
  process.chdir(previousDirectory);
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, previousEnvironment);
  const afterFiles = sourceFiles(),
    after = snapshot(afterFiles);
  report.sourceAfter = after;
  report.sourceUnchanged =
    JSON.stringify(files) === JSON.stringify(afterFiles) &&
    JSON.stringify(before) === JSON.stringify(after);
  if (origin)
    report.cleanup = { ...report.cleanup, portFree: await portFree(Number(new URL(origin).port)) };
  report.finishedAt = new Date().toISOString();
  report.passed =
    !failure &&
    report.sourceUnchanged &&
    report.browser?.passed === true &&
    report.cleanup?.portFree === true;
  report.hostedDataChanged = false;
  report.gateOrPaidActionPerformed = false;
  record('report', report);
}
console.log(`${report.passed ? 'PASS' : 'FAIL'}: A8 local browser check. Evidence: ${root}`);
if (failure) console.error(failure);
if (!report.passed) process.exitCode = 1;
