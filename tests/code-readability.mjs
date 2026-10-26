import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { format } from 'prettier';
import { assertFormattingEquivalent } from '../scripts/readability/format-safety.mjs';

const options = JSON.parse(readFileSync('.prettierrc.json', 'utf8'));
const fixtures = [
  ['fixture.d.ts', 'declare namespace Cloudflare{interface Env{DB:D1Database;}}'],
  ['fixture.ts', "import {value} from './state'; const total=(value + 1);"],
  ['fixture.ts', 'const sql=`SELECT x\n  FROM stock WHERE id=?`;'],
  ['fixture.ts', "const ids=['a'] as const;type Id=typeof ids[number];"],
  ['fixture.ts', 'interface State{readonly id:string;value?:number};const state:State={id:"a"};'],
  ['fixture.tsx', 'const x=<div>Hello <b>world</b>!</div>;'],
  ['fixture.tsx', 'const x=<button aria-label="Save" disabled={busy}>Save</button>;'],
  ['fixture.jsonc', '// Configuration\n{ "first":1,"second":[2,3] }'],
  [
    'fixture.mjs',
    '#!/usr/bin/env node\n// Startup order is deliberate.\nimport "./first.mjs";import "./second.mjs";',
  ],
  ['fixture.ts', '// @ts-expect-error Deliberate fixture\nconst value:number="text";'],
  ['fixture.ts', '/** @param {string} input */\nfunction parse(input){return input;}'],
  ['fixture.ts', '/* @__PURE__ */make();const target="https://example.test/*not-a-comment*/";'],
];
for (const [filename, source] of fixtures) {
  const formatted = await format(source, { ...options, filepath: filename });
  assertFormattingEquivalent(source, formatted, filename);
  assert.equal(await format(formatted, { ...options, filepath: filename }), formatted);
}

const refusals = [
  ['const value=1;', 'const value=2;'],
  ['const value=1;', 'let value=1;'],
  ['type Values=(A|B)[];', 'type Values=A|B[];'],
  ['const value:string="a";', 'const value:number="a";'],
  ['import type {State} from "./state";', 'import {State} from "./state";'],
  ['import "./one";import "./two";', 'import "./two";import "./one";'],
  ['const state={first:1,second:2};', 'const state={second:2,first:1};'],
  ['const sql=`SELECT 1`;', 'const sql=`SELECT  1`;'],
  ['const raw=String.raw`a\\nb`;', 'const raw=String.raw`a\nb`;'],
  ['const value=(source?.first).second;', 'const value=source?.first.second;'],
  ['function read(){return value;}', 'function read(){return\nvalue;}'],
  ['if(ready);process();', 'if(ready)process();'],
  ['// @ts-expect-error\nconst value=1;', 'const value=1;'],
  ['/* @__PURE__ */make();', 'make();'],
  ['/** @param {string} value */\nread(value);', '/** @param {number} value */\nread(value);'],
  ['#!/usr/bin/env node\nrun();', 'run();'],
  ['const x=<div>Hello world</div>;', 'const x=<div>Hello  world</div>;', 'fixture.tsx'],
  ['const x=<div>A <b>B</b></div>;', 'const x=<div>A<b>B</b></div>;', 'fixture.tsx'],
];
for (const [before, after, filename = 'fixture.ts'] of refusals) {
  assert.throws(() => assertFormattingEquivalent(before, after, filename));
}
assert.throws(() => assertFormattingEquivalent('const =;', 'const value=1;', 'invalid.ts'));

for (const args of [
  [],
  ['--write'],
  ['--section', 'S00'],
  ['--section', 'S01', 'src/lib/auth.ts'],
  ['--section', 'S01', '--check'],
]) {
  const result = spawnSync(process.execPath, ['scripts/readability-format.mjs', ...args], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use --section/);
}
console.log(
  'PASS: readability formatting preserves syntax/types/literals/import order/comments/JSX runtime and refuses unsafe candidates or unscoped writes.',
);
