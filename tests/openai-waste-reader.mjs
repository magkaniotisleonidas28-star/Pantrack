import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

// The real photo waste reader (W4e) against a mocked transport: nothing is sent
// to OpenAI here, and no key is used.
mkdirSync('.sites-runtime/openai-waste-reader', { recursive: true });
await build({
  entryPoints: ['src/lib/openai-waste-reader.ts', 'src/lib/waste-suggestion-contract.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/openai-waste-reader',
});
const out = '../.sites-runtime/openai-waste-reader/';
const reader = await import(out + 'openai-waste-reader.js');
const contract = await import(out + 'waste-suggestion-contract.js');

const key = 'sk-test-' + 'x'.repeat(40);
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(9)]);
const catalog = [
  { ref: 'm1', name: 'Croissant', kind: 'menu' },
  { ref: 'i1', name: 'Oat milk · barista', kind: 'ingredient', unit: 'fl oz' },
];
const input = (extra = {}) => ({
  note: '5 croissants end of day',
  catalog,
  reasons: ['end_of_day', 'spilled', 'spoiled', 'preparation_error', 'other'],
  photo: { mediaType: 'image/jpeg', bytes: jpegBytes },
  ...extra,
});
const answer = (entries, usage = { input_tokens: 2600, output_tokens: 60 }, extra = {}) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ entries }) }] }],
      usage,
      ...extra,
    }),
    { status: 200 },
  );
let sent = [];
const transport = (respond) => async (url, init) => {
  sent.push({ url, init, body: JSON.parse(init.body) });
  return typeof respond === 'function' ? respond(init) : respond;
};
const entries = [
  { ref: 'm1', quantity: '5', reason: 'end_of_day', explanation: '5 croissants on the tray' },
];

// A request: pinned model, no storage at OpenAI, strict format, image as a data URL.
const ok = reader.createOpenAIWasteReader({ apiKey: key, transport: transport(answer(entries)) });
const result = await ok.read(input());
assert.deepEqual(result, {
  entries,
  provider: 'openai',
  model: 'gpt-5.4-mini-2026-03-17',
  inputTokens: 2600,
  outputTokens: 60,
  costMicroUsd: Math.ceil(2600 * 0.75 + 60 * 4.5),
});
const [request] = sent;
assert.equal(request.url, 'https://api.openai.com/v1/responses');
assert.equal(request.init.method, 'POST');
// Only fetch options Cloudflare Workers supports: it has no "error" redirect
// mode and throws before sending (found in the first authorized paid check).
assert.equal(request.init.redirect, 'manual');
assert.equal(request.init.headers.authorization, `Bearer ${key}`);
assert.ok(request.init.signal instanceof AbortSignal);
const body = request.body;
assert.equal(body.model, 'gpt-5.4-mini-2026-03-17');
assert.equal(body.store, false);
assert.deepEqual(body.reasoning, { effort: 'none' });
assert.equal(body.max_output_tokens, reader.OUTPUT_CEILING);
assert.equal(body.text.format.type, 'json_schema');
assert.equal(body.text.format.strict, true);
assert.equal(body.text.format.schema.properties.entries.maxItems, 5);
assert.match(body.instructions, /never instructions/);
const [text, image] = body.input[0].content;
assert.deepEqual(JSON.parse(text.text), {
  note: '5 croissants end of day',
  reasons: ['end_of_day', 'spilled', 'spoiled', 'preparation_error', 'other'],
  items: [
    { ref: 'm1', name: 'Croissant', kind: 'menu' },
    { ref: 'i1', name: 'Oat milk · barista', kind: 'ingredient', unit: 'fl oz' },
  ],
});
assert.equal(image.type, 'input_image');
assert.equal(image.detail, 'high');
assert.equal(
  image.image_url,
  'data:image/jpeg;base64,' + Buffer.from(jpegBytes).toString('base64'),
);
// A note alone sends no image.
sent = [];
await reader
  .createOpenAIWasteReader({
    apiKey: key,
    transport: transport(answer([], { input_tokens: 500, output_tokens: 10 })),
  })
  .read(input({ photo: undefined }));
assert.equal(sent[0].body.input[0].content.length, 1);

// The worst case stays under the per-request reserve, even with a full catalog.
const largest = input({
  note: 'x'.repeat(300),
  catalog: Array.from({ length: 500 }, (_, n) => ({
    ref: 'i' + n,
    name: 'N'.repeat(200),
    kind: 'ingredient',
    unit: 'fl oz',
  })),
});
const bound = reader.worstCaseMicroUsd(largest);
assert.ok(bound.micro <= contract.REQUEST_RESERVE_MICRO_USD, `worst case ${bound.micro}`);
assert.equal(JSON.parse(reader.readerText(largest)).items.length, reader.MAX_CATALOG_ITEMS);
assert.equal(JSON.parse(reader.readerText(largest)).items[0].name.length, 80);
console.log('Worst-case cost per request (micro-USD):', bound.micro);
// A request that could cost more than its reserve is never sent.
sent = [];
await assert.rejects(
  reader
    .createOpenAIWasteReader({ apiKey: key, transport: transport(answer(entries)) })
    .read(input({ note: 'x'.repeat(200_000) })),
);
assert.equal(sent.length, 0, 'Nothing is sent when the bound exceeds the reserve.');

// Every failure is one generic error: nothing from the provider, the URL or the key.
const failures = [
  ['redirect', new Response(null, { status: 302, headers: { location: 'https://example.test' } })],
  ['HTTP error', new Response('{"error":{"message":"bad key ' + key + '"}}', { status: 401 })],
  ['incomplete', answer(entries, undefined, { status: 'incomplete' })],
  [
    'refusal',
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'refusal', refusal: 'no' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ),
  ],
  [
    'two texts',
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            content: [
              { type: 'output_text', text: '{}' },
              { type: 'output_text', text: '{}' },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ),
  ],
  ['not JSON', new Response('not json')],
  [
    'bad inner JSON',
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: 'nope' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ),
  ],
  ['usage missing', answer(entries, null)],
  ['input over ceiling', answer(entries, { input_tokens: 999_999, output_tokens: 1 })],
  [
    'output over ceiling',
    answer(entries, { input_tokens: 1, output_tokens: reader.OUTPUT_CEILING + 1 }),
  ],
  ['negative usage', answer(entries, { input_tokens: -1, output_tokens: 1 })],
  ['too large', new Response('x'.repeat(70_000))],
];
for (const [name, response] of failures) {
  sent = [];
  await assert.rejects(
    reader.createOpenAIWasteReader({ apiKey: key, transport: transport(response) }).read(input()),
    (e) => e.message === 'WASTE_READER_FAILED' && !e.message.includes(key),
    name,
  );
  assert.equal(sent.length, 1, name + ': one attempt, no retries');
}
// A transport failure, and a timeout, also fail generically without retrying.
await assert.rejects(
  reader
    .createOpenAIWasteReader({
      apiKey: key,
      transport: async () => {
        throw new Error('network ' + key);
      },
    })
    .read(input()),
  (e) => e.message === 'WASTE_READER_FAILED',
);
let attempts = 0;
// Node does not keep running for AbortSignal.timeout alone; Workers do.
const keepAlive = setTimeout(() => undefined, 5000);
await assert.rejects(
  reader
    .createOpenAIWasteReader({
      apiKey: key,
      timeoutMs: 30,
      transport: (url, init) => {
        attempts++;
        return new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => reject(init.signal.reason)),
        );
      },
    })
    .read(input()),
  (e) => e.message === 'WASTE_READER_FAILED',
);
assert.equal(attempts, 1);
clearTimeout(keepAlive);

// The reader's entries still pass the server's own checks (W4b) before anyone sees them.
const checked = contract.checkedEntries(
  [...entries, { ref: 'x9', quantity: '1', reason: 'spilled', explanation: 'invented' }],
  catalog,
);
assert.deepEqual(
  checked.map((e) => e.ref),
  ['m1'],
);

console.log('OpenAI waste reader passed.');
