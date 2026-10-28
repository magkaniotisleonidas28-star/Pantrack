import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['src/lib/request-scope.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createRequestScope } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const scope = createRequestScope();
let finishOld, finishNew;
const old = new Promise((resolve) => {
  finishOld = resolve;
});
const next = new Promise((resolve) => {
  finishNew = resolve;
});
const published = [];
const first = scope.begin(),
  second = scope.begin();
const tasks = [
  old.then((value) => {
    if (first()) published.push(value);
  }),
  next.then((value) => {
    if (second()) published.push(value);
  }),
];
finishNew('current');
finishOld('obsolete');
await Promise.all(tasks);
assert.deepEqual(published, ['current']);
const beforeUnmount = scope.begin();
scope.invalidate();
assert.equal(beforeUnmount(), false);
scope.activate();
const afterReplay = scope.begin();
assert.equal(afterReplay(), true);
assert.equal(beforeUnmount(), false);
const rejected = scope.begin();
const visibleError = Promise.reject(new Error('obsolete')).catch((error) => {
  if (rejected()) published.push(error.message);
});
scope.invalidate();
scope.activate();
await visibleError;
assert.deepEqual(published, ['current']);
console.log(
  'PASS: request publication remains owned across reversed completion, invalidation, StrictMode replay and stale failures.',
);
