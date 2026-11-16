import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Photo waste suggestions, W4b (decision 0010): a reader proposes, the server
// checks, nothing is recorded, and the photo is never stored.
mkdirSync('.sites-runtime/waste-suggestions', { recursive: true });
await build({
  entryPoints: [
    'src/lib/d1-waste-suggestions.ts',
    'src/lib/waste-suggestion-contract.ts',
    'src/lib/d1-inventory-management.ts',
    'src/lib/d1-recipe-publisher.ts',
    'src/lib/d1-menu-waste.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.sites-runtime/waste-suggestions',
  external: ['cloudflare:workers'],
});
const out = '../.sites-runtime/waste-suggestions/';
const { D1WasteSuggestions } = await import(out + 'd1-waste-suggestions.js');
const contract = await import(out + 'waste-suggestion-contract.js');
const { D1InventoryManagementService } = await import(out + 'd1-inventory-management.js');
const { publishRecipe } = await import(out + 'd1-recipe-publisher.js');
const { D1MenuWasteService } = await import(out + 'd1-menu-waste.js');
const { checkedEntries, readPhoto, fakeWasteReader } = contract;

// Photos: type, signature and size are checked; nothing else about them is kept.
const bytes = (head, length = 32) =>
  Buffer.from([...head, ...new Array(Math.max(0, length - head.length)).fill(7)]).toString(
    'base64',
  );
const jpeg = { mediaType: 'image/jpeg', data: bytes([0xff, 0xd8, 0xff, 0xe0]) };
const png = {
  mediaType: 'image/png',
  data: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};
const webp = {
  mediaType: 'image/webp',
  data: Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WEBP'),
    Buffer.alloc(20),
  ]).toString('base64'),
};
for (const photo of [jpeg, png, webp]) assert.ok(readPhoto(photo).length >= 12, photo.mediaType);
for (const photo of [
  { ...png, mediaType: 'image/jpeg' },
  { mediaType: 'image/jpeg', data: bytes([0x25, 0x50, 0x44, 0x46]) },
  { mediaType: 'image/jpeg', data: bytes([0xff, 0xd8, 0xff, 0xe0], contract.MAX_PHOTO_BYTES + 1) },
])
  assert.throws(
    () => readPhoto(photo),
    (e) => e.code === 'invalid_photo',
  );
assert.equal(
  contract.wasteSuggestionRequest.safeParse({
    companyId: 'a',
    operationId: crypto.randomUUID(),
    note: 'x',
    photo: { ...jpeg, data: 'not base64!' },
  }).success,
  false,
);
assert.equal(
  contract.wasteSuggestionRequest.safeParse({
    companyId: 'a',
    operationId: crypto.randomUUID(),
    note: 'x'.repeat(301),
    photo: jpeg,
  }).success,
  false,
);

// Reader output is untrusted: only catalog items, sensible quantities and known reasons survive.
const catalog = [
  { ref: 'm1', name: 'Croissant', kind: 'menu' },
  { ref: 'i1', name: 'Oat milk', kind: 'ingredient', unit: 'fl oz' },
];
assert.deepEqual(checkedEntries('not a list', catalog), []);
assert.deepEqual(
  checkedEntries(
    [
      { ref: 'm1', quantity: '5', reason: 'end_of_day', explanation: '5 on the tray' },
      { ref: 'm1', quantity: '6', reason: 'end_of_day' },
      { ref: 'x9', quantity: '1', reason: 'spilled' },
      { ref: 'i1', quantity: null, reason: 'teleported', explanation: 'x'.repeat(300) },
      { productId: 'oat', quantity: '1' },
    ],
    catalog,
  ),
  [
    {
      ref: 'm1',
      name: 'Croissant',
      kind: 'menu',
      quantity: '5',
      unit: null,
      reason: 'end_of_day',
      explanation: '5 on the tray',
    },
    {
      ref: 'i1',
      name: 'Oat milk',
      kind: 'ingredient',
      quantity: null,
      unit: null,
      reason: 'other',
      explanation: 'x'.repeat(200),
    },
  ],
);
for (const quantity of ['0', '1.5', '1000', '-1', 'five', null])
  assert.deepEqual(
    checkedEntries([{ ref: 'm1', quantity, reason: 'other' }], catalog),
    [],
    String(quantity),
  );
for (const quantity of ['0', '-2', '1e3', '1.2345'])
  assert.deepEqual(
    checkedEntries([{ ref: 'i1', quantity, reason: 'spilled' }], catalog),
    [],
    quantity,
  );
assert.equal(
  checkedEntries([{ ref: 'i1', quantity: '32', reason: 'spilled' }], catalog)[0].unit,
  'fl oz',
);
assert.equal(
  checkedEntries(
    Array.from({ length: 9 }, (_, n) => ({ ref: n % 2 ? 'm1' : 'i1', quantity: '1' })),
    catalog,
  ).length,
  2,
);

// Local D1 stand-in enforcing Cloudflare's 100 bound parameters per statement.
class Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    if (values.length > 100) throw new Error('D1 maximum bound parameters exceeded');
    return new Statement(this.database, this.query, values);
  }

  async first() {
    return this.database.prepare(this.query).get(...this.values) ?? null;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.query).all(...this.values) };
  }

  runSync() {
    const statement = this.database.prepare(this.query);
    if (/^\s*SELECT\b/i.test(this.query))
      return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
    const result = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

class Database {
  constructor(sql) {
    this.sql = sql;
  }

  prepare(query) {
    return new Statement(this.sql, query);
  }

  async batch(statements) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sql.exec('COMMIT');
      return results;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
}

const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const e of JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries)
  sql.exec(readFileSync(`drizzle/${e.tag}.sql`, 'utf8'));
let now = '2026-04-01T00:00:00.000Z';
const clock = { now: () => new Date(now) };
for (const id of ['a', 'b'])
  sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(id, id, now);
const db = new Database(sql),
  stock = new D1InventoryManagementService(db, { clock });
for (const [company, id, name, unit] of [
  ['a', 'croissant', 'Croissant', 'each'],
  ['a', 'oat', 'Oat milk', 'fl_oz_us'],
  ['a', 'beans', 'Espresso beans', 'g'],
  ['b', 'scone', 'Scone', 'each'],
]) {
  sql
    .prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)')
    .run(company, id, JSON.stringify({ id, name }));
  await stock.configure({
    companyId: company,
    actor: 'owner',
    productId: id,
    operationId: 'setup-' + id,
    stockUnit: { kind: 'curated', id: unit },
    purchaseUnitLabel: 'pack',
    purchaseAmount: '1',
    openingAmount: '100',
    effectiveAt: '2026-01-01T00:00:00Z',
  });
}
const menu = new D1MenuWasteService(db);
for (const [company, productId] of [
  ['a', 'croissant'],
  ['a', 'oat'],
  ['b', 'scone'],
])
  await menu.setup(
    {
      companyId: company,
      productId,
      offered: true,
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    },
    'owner',
  );
await publishRecipe(
  db,
  {
    companyId: 'a',
    actor: 'owner',
    operationId: 'latte',
    recipeId: 'latte',
    versionId: 'latte-1',
    name: 'Oat latte',
    expectedActiveVersionId: null,
    expectedModifiers: {},
    ingredients: [
      { productId: 'oat', amount: '10', unitId: 'fl_oz_us' },
      { productId: 'beans', amount: '18', unitId: 'g' },
    ],
    choices: [],
    modifiers: [],
  },
  now,
);

let calls = 0,
  nextFailure = null,
  nextOutput = null;
const reader = {
  async read(input) {
    calls++;
    this.last = input;
    if (nextFailure) {
      const e = nextFailure;
      nextFailure = null;
      throw e;
    }
    if (nextOutput) {
      const o = nextOutput;
      nextOutput = null;
      return o;
    }
    return fakeWasteReader.read(input);
  },
};
const service = new D1WasteSuggestions(db, reader, { clock });
const ask = (note, extra = {}) =>
  service.suggest(
    { companyId: 'a', operationId: crypto.randomUUID(), note, photo: jpeg, ...extra },
    'staff-1',
  );

// The catalog: ready menu items and stocked ingredients, once each, own company only.
// Oat milk offered as ready-made is not ready (it is not counted in whole items), so it is not a menu choice.
const items = (await service.catalog('a')).map((c) => [
  c.item.ref,
  c.item.name,
  c.item.kind,
  c.item.unit ?? null,
]);
assert.deepEqual(items, [
  ['m1', 'Croissant', 'menu', null],
  ['m2', 'Oat latte', 'menu', null],
  ['i1', 'Espresso beans', 'ingredient', 'g'],
  ['i2', 'Oat milk', 'ingredient', 'fl oz'],
]);
assert.deepEqual(
  (await service.catalog('b')).map((c) => c.item.name),
  ['Scone'],
);

const balances = () =>
  sql
    .prepare(
      'SELECT company_id,product_id,on_hand_minor,version FROM inventory_balances_exact ORDER BY 1,2',
    )
    .all()
    .map((r) => ({ ...r }));
const eventsBefore = sql.prepare('SELECT count(*) n FROM inventory_events_exact').get().n,
  balancesBefore = balances();
// End-of-day croissants: a menu entry with the counted quantity.
const croissants = await ask('5 croissants end of day');
assert.equal(croissants.status, 'suggested');
assert.deepEqual(
  croissants.entries.map((e) => [e.name, e.quantity, e.reason, e.target]),
  [
    [
      'Croissant',
      '5',
      'end_of_day',
      {
        form: 'menu',
        sourceKind: 'product',
        sourceId: 'croissant',
        sourceVersion: croissants.entries[0].target.sourceVersion,
      },
    ],
  ],
);
// The reader sees names and opaque refs, never internal IDs, plus the photo bytes and note.
assert.ok(!JSON.stringify(reader.last.catalog).includes('croissant"'));
assert.equal(reader.last.photo.mediaType, 'image/jpeg');
assert.equal(reader.last.note, '5 croissants end of day');
// A spilled latte: the recipe item; spilled oat milk: an ingredient whose amount is asked.
assert.deepEqual(
  (await ask('spilled an oat latte')).entries.map((e) => [
    e.name,
    e.quantity,
    e.reason,
    e.target.form,
  ]),
  [['Oat latte', '1', 'spilled', 'menu']],
);
const milk = await ask('spilled oat milk on the counter');
assert.deepEqual(
  milk.entries.map((e) => [e.name, e.quantity, e.unit, e.target]),
  [['Oat milk', null, null, { form: 'ingredient', productId: 'oat', unitId: 'fl_oz_us' }]],
);
// Nothing recognisable: no guess.
const nothing = await ask('a blurry photo');
assert.equal(nothing.status, 'empty');
assert.deepEqual(nothing.entries, []);
// Another company's items can never be suggested, even if a reader names them.
nextOutput = {
  entries: [{ ref: 'm1', quantity: '2', reason: 'other' }],
  provider: 'test',
  model: 't',
  inputTokens: 1,
  outputTokens: 1,
  costMicroUsd: 0,
};
const otherCompany = await service.suggest(
  { companyId: 'b', operationId: crypto.randomUUID(), note: '2 croissants', photo: jpeg },
  'staff-b',
);
assert.deepEqual(
  otherCompany.entries.map((e) => e.name),
  ['Scone'],
  "m1 is company b's own scone",
);

// No waste or stock changes from any suggestion.
assert.equal(sql.prepare('SELECT count(*) n FROM inventory_events_exact').get().n, eventsBefore);
assert.deepEqual(balances(), balancesBefore);

// Replays never read twice; a reused request with another photo or note conflicts.
const operationId = crypto.randomUUID();
const first = await service.suggest(
  { companyId: 'a', operationId, note: '3 croissants', photo: jpeg },
  'staff-1',
);
const before = calls;
assert.deepEqual(
  await service.suggest(
    { companyId: 'a', operationId, note: '3 croissants', photo: jpeg },
    'staff-1',
  ),
  first,
);
assert.equal(calls, before, 'A replay does not read again.');
for (const changed of [{ note: '4 croissants' }, { photo: png }])
  await assert.rejects(
    service.suggest(
      { companyId: 'a', operationId, note: '3 croissants', photo: jpeg, ...changed },
      'staff-1',
    ),
    (e) => e.code === 'operation_conflict',
  );
// Concurrent repeats of one request read once.
const shared = crypto.randomUUID(),
  concurrentBefore = calls;
const settled = await Promise.allSettled(
  [1, 2, 3].map(() =>
    service.suggest(
      { companyId: 'a', operationId: shared, note: '2 croissants', photo: jpeg },
      'staff-1',
    ),
  ),
);
assert.equal(calls - concurrentBefore, 1, 'Concurrent repeats read once.');
assert.ok(settled.some((s) => s.status === 'fulfilled' && s.value.entries[0]?.quantity === '2'));
assert.ok(settled.every((s) => s.status === 'fulfilled' || s.reason.code === 'operation_conflict'));

// A request claimed by another attempt between the check and the claim is not read again.
const racedId = crypto.randomUUID();
const { createHash: hash } = await import('node:crypto');
const racedFingerprint = hash('sha256')
  .update(
    JSON.stringify([
      'raced',
      hash('sha256').update(Buffer.from(jpeg.data, 'base64')).digest('hex'),
    ]),
  )
  .digest('hex');
const realPrepare = db.prepare.bind(db);
let hidden = true;
db.prepare = (query) => {
  const statement = realPrepare(query);
  if (!query.startsWith('SELECT fingerprint')) return statement;
  return {
    bind: (...values) => {
      const bound = statement.bind(...values);
      return {
        first: async () => {
          if (values[1] !== racedId || !hidden) return bound.first();
          hidden = false;
          // The other attempt claims now, after this one found nothing.
          sql
            .prepare(
              "INSERT INTO waste_suggestions(company_id,id,actor,fingerprint,note,status,created_at) VALUES ('a',?,'staff-2',?,'raced','pending',?)",
            )
            .run(racedId, racedFingerprint, now);
          return null;
        },
      };
    },
  };
};
const beforeRace = calls;
await assert.rejects(
  service.suggest({ companyId: 'a', operationId: racedId, note: 'raced', photo: jpeg }, 'staff-1'),
  (e) => e.code === 'operation_conflict',
);
assert.equal(calls, beforeRace, 'The losing attempt does not read.');
db.prepare = realPrepare;

// A reader failure is recorded and reported; it is not retried under the same request.
nextFailure = new Error('provider down');
const failedId = crypto.randomUUID();
const failed = await service.suggest(
  { companyId: 'a', operationId: failedId, note: '5 croissants', photo: jpeg },
  'staff-1',
);
assert.equal(failed.status, 'failed');
const afterFailure = calls;
assert.equal(
  (
    await service.suggest(
      { companyId: 'a', operationId: failedId, note: '5 croissants', photo: jpeg },
      'staff-1',
    )
  ).status,
  'failed',
);
assert.equal(calls, afterFailure);
// An interrupted read left pending is reported as failed after two minutes, never re-read.
const stuck = crypto.randomUUID();
const { createHash } = await import('node:crypto');
const photoHash = createHash('sha256').update(Buffer.from(jpeg.data, 'base64')).digest('hex');
const fingerprint = createHash('sha256')
  .update(JSON.stringify(['stuck', photoHash]))
  .digest('hex');
sql
  .prepare(
    "INSERT INTO waste_suggestions(company_id,id,actor,fingerprint,note,status,created_at) VALUES ('a',?,'staff-1',?,'stuck','pending',?)",
  )
  .run(stuck, fingerprint, now);
await assert.rejects(
  service.suggest({ companyId: 'a', operationId: stuck, note: 'stuck', photo: jpeg }, 'staff-1'),
  (e) => e.code === 'operation_conflict',
);
now = '2026-04-01T00:03:00.000Z';
const beforeStuck = calls;
assert.equal(
  (
    await service.suggest(
      { companyId: 'a', operationId: stuck, note: 'stuck', photo: jpeg },
      'staff-1',
    )
  ).status,
  'failed',
);
assert.equal(calls, beforeStuck);

// Usage and cost are recorded for the monthly cap; the photo is not stored.
nextOutput = {
  entries: [],
  provider: 'openai',
  model: 'test-model',
  inputTokens: 1200.7,
  outputTokens: 80,
  costMicroUsd: 1500,
};
const billed = crypto.randomUUID();
await service.suggest({ companyId: 'a', operationId: billed, note: 'hmm', photo: jpeg }, 'staff-1');
assert.deepEqual(
  {
    ...sql
      .prepare(
        'SELECT actor,status,provider,model,input_tokens,output_tokens,cost_micro_usd FROM waste_suggestions WHERE id=?',
      )
      .get(billed),
  },
  {
    actor: 'staff-1',
    status: 'empty',
    provider: 'openai',
    model: 'test-model',
    input_tokens: 1200,
    output_tokens: 80,
    cost_micro_usd: 1500,
  },
);
const rows = JSON.stringify(sql.prepare('SELECT * FROM waste_suggestions').all());
assert.ok(
  !rows.includes(jpeg.data) && !rows.includes(png.data),
  'The photo itself is never stored.',
);
assert.equal(
  sql.prepare('SELECT count(*) n FROM waste_suggestions WHERE length(fingerprint)<>64').get().n,
  0,
);
assert.throws(() => sql.prepare("UPDATE waste_suggestions SET status='saved'").run());
assert.throws(() => sql.prepare("UPDATE waste_suggestions SET outcome='maybe'").run());

// Outcomes (W4c): only the person who asked, only for a real suggestion; "edited" outranks
// "confirmed"; "discarded" counts only until something is saved.
const outcomeOf = (id) =>
  sql.prepare('SELECT outcome FROM waste_suggestions WHERE id=?').get(id).outcome;
const record = (operationId, outcome, actor = 'staff-1', companyId = 'a') =>
  service.recordOutcome({ companyId, operationId, outcome }, actor);
const asked = await ask('2 croissants end of day');
assert.equal((await record(asked.operationId, 'discarded')).outcome, 'discarded');
assert.equal((await record(asked.operationId, 'confirmed')).outcome, 'confirmed');
assert.equal((await record(asked.operationId, 'discarded')).outcome, 'confirmed');
assert.equal((await record(asked.operationId, 'edited')).outcome, 'edited');
assert.equal((await record(asked.operationId, 'confirmed')).outcome, 'edited');
await assert.rejects(
  record(asked.operationId, 'confirmed', 'staff-2'),
  (e) => e.code === 'not_found',
);
await assert.rejects(
  record(asked.operationId, 'confirmed', 'staff-1', 'b'),
  (e) => e.code === 'not_found',
);
await assert.rejects(record(nothing.operationId, 'confirmed'), (e) => e.code === 'not_found');
await assert.rejects(record(crypto.randomUUID(), 'confirmed'), (e) => e.code === 'not_found');
await assert.rejects(record(asked.operationId, 'maybe'));
assert.equal(outcomeOf(asked.operationId), 'edited');
// Someone else's refused attempt leaves the record exactly as it was.
const mine = await ask('4 croissants end of day');
await record(mine.operationId, 'confirmed');
await assert.rejects(record(mine.operationId, 'edited', 'staff-2'), (e) => e.code === 'not_found');
assert.equal(outcomeOf(mine.operationId), 'confirmed');
assert.ok(
  sql.prepare('SELECT outcome_at FROM waste_suggestions WHERE id=?').get(asked.operationId)
    .outcome_at,
);
// The fake reader matches a product's main name, ignoring details after "·".
const barista = await fakeWasteReader.read({
  photo: reader.last.photo,
  note: 'spilled oat milk',
  catalog: [{ ref: 'i9', name: 'Oat milk · barista', kind: 'ingredient', unit: 'fl oz' }],
  reasons: [],
});
assert.deepEqual(
  barista.entries.map((e) => [e.ref, e.reason]),
  [['i9', 'spilled']],
);

console.log('Waste suggestions passed.');
