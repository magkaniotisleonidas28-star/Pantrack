import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { withA8Server } from '../scripts/a8-browser/lifecycle.mjs';

mkdirSync('.sites-runtime', { recursive: true });
const root = mkdtempSync(resolve('.sites-runtime/a8-browser-lifecycle-'));
const portFree = (port) =>
  new Promise((ok) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      ok(false);
    });
    socket.once('error', () => ok(true));
  });
async function exercise(
  name,
  { bodyFailure = false, closeFailure = false, startupFailure = false } = {},
) {
  const directory = join(root, name);
  mkdirSync(directory);
  const httpServer = createServer((_request, response) => response.end('fictional A8 lifecycle'));
  let port,
    closeCalls = 0;
  const bodyError = Error('Injected scenario failure'),
    closeError = Error('Injected close report failure');
  const record = (phase, value) =>
    writeFileSync(join(directory, phase + '.json'), JSON.stringify(value), { flag: 'wx' });
  const task = withA8Server({
    createServer: async (observe) => {
      const resource = {
        httpServer,
        close: async () => {
          closeCalls++;
          assert.equal(
            JSON.parse(readFileSync(join(directory, 'server-close-inputs.json'), 'utf8')).listening,
            true,
            'The actual resource state must be persisted before release',
          );
          await new Promise((ok, fail) =>
            httpServer.close((error) => (error ? fail(error) : ok())),
          );
          if (closeFailure) throw closeError;
        },
      };
      if (startupFailure) {
        httpServer.listen(0, '127.0.0.1');
        await once(httpServer, 'listening');
        port = httpServer.address().port;
        observe(resource);
        throw bodyError;
      }
      return resource;
    },
    record,
    run: async () => {
      httpServer.listen(0, '127.0.0.1');
      await once(httpServer, 'listening');
      port = httpServer.address().port;
      const response = await fetch('http://127.0.0.1:' + port);
      assert.equal(await response.text(), 'fictional A8 lifecycle');
      if (bodyFailure) throw bodyError;
      return { passed: true };
    },
  });
  if (closeFailure)
    await assert.rejects(
      task,
      (error) =>
        error instanceof AggregateError &&
        error.errors.includes(closeError) &&
        (!bodyFailure || error.errors.includes(bodyError)),
    );
  else if (bodyFailure || startupFailure)
    await assert.rejects(task, (error) => error === bodyError);
  else assert.deepEqual(await task, { passed: true });
  assert.equal(closeCalls, 1);
  assert.equal(httpServer.listening, false);
  assert.equal(await portFree(port), true);
  const result = JSON.parse(readFileSync(join(directory, 'server-close-result.json'), 'utf8'));
  assert.equal(result.passed, !closeFailure);
  assert.equal(result.listening, false);
}
await exercise('success');
await exercise('scenario-failure', { bodyFailure: true });
await exercise('startup-failure', { startupFailure: true });
await exercise('combined-failure', { bodyFailure: true, closeFailure: true });

const evidenceRoot = resolve('.sites-runtime/a8-browser');
const before = existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : [];
const denied = spawnSync(process.execPath, ['scripts/a8-browser-check.mjs', '--remote'], {
  encoding: 'utf8',
});
assert.notEqual(denied.status, 0);
assert.match(denied.stderr, /without arguments/);
const added = readdirSync(evidenceRoot).filter((name) => !before.includes(name));
assert.equal(added.length, 1);
const refused = join(evidenceRoot, added[0]);
assert.equal(
  JSON.parse(readFileSync(join(refused, 'invocation-inputs.json'), 'utf8')).argumentCount,
  1,
);
assert.equal(
  JSON.parse(readFileSync(join(refused, 'refusal.json'), 'utf8')).reason,
  'unsupported_arguments',
);
assert.deepEqual(
  readdirSync(refused).sort(),
  ['invocation-inputs.json', 'refusal.json'],
  'A refused invocation records its inputs without creating an app copy or database',
);
console.log(
  'PASS: actual HTTP server cleanup after success/failure, persisted cleanup inputs, retained combined errors and argument refusal.',
);
