import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

// Keep the screen-lifecycle rules enforceable without requiring a browser in CI.
// Behavioral regressions run separately in tests/browser/screen-updates.mjs.
const rules = new Set([
  'react-hooks/set-state-in-effect',
  'react-hooks/exhaustive-deps',
  'react-hooks/purity',
  'react-hooks/refs',
  'react-hooks/immutability',
]);
const results = await new ESLint().lintFiles(['src/components/workspace']);
assert.deepEqual(
  results.filter((result) => result.fatalErrorCount).map((result) => result.filePath),
  [],
  'Workspace source must parse before checking lifecycle rules',
);
const findings = results.flatMap((result) =>
  result.messages
    .filter((message) => rules.has(message.ruleId))
    .map((message) => `${result.filePath}:${message.line} ${message.ruleId}`),
);
assert.deepEqual(
  findings,
  [],
  `Screen lifecycle findings remain (${findings.length}):\n${findings.slice(0, 5).join('\n')}`,
);
console.log('PASS: workspace screen lifecycle rules have no unresolved findings.');
