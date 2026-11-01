// Fictional loopback acceptance only. Seed reservations through the production journal.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { localFixtureCookie } from './po-cart-worker/local-browser-fixture.mjs';
const origin = 'http://127.0.0.1:5179',
  root = resolve('.sites-runtime/continuation-browser/run-' + crypto.randomUUID());
mkdirSync(root, { recursive: true });
const companyId = crypto.randomUUID(),
  actor = 'local_seedy',
  cookie = await localFixtureCookie(origin),
  headers = {
    cookie,
    origin,
    'content-type': 'application/json',
    'X-Pantrack-Archive-Viewer': actor,
  };
const api = async (path, body) => {
  const response = await fetch(origin + path, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers,
    redirect: 'error',
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
await api('/api/companies', {
  action: 'create',
  id: companyId,
  name: 'Interrupted-save practice café',
});
const { order } = await api('/api/purchase-orders', {
  action: 'create',
  companyId,
  operationId: crypto.randomUUID(),
  source: 'manual',
  capMinor: '10000',
  notes: 'Original-request continuation practice',
  supplier: {
    id: 'fictional',
    name: 'Fictional Café Supply',
    email: 'orders@example.invalid',
    accountId: 'fixture',
    locationId: 'fixture',
    deliveryAddress: 'Fictional street',
  },
  lines: [
    {
      kind: 'non_stock',
      sku: 'BAGS',
      description: 'Delivery bags',
      unitLabel: 'case',
      packs: '2',
      estimatedUnitMinor: '125',
    },
  ],
});
const d1Root = resolve('.sites-runtime/po-review-state/v3/d1'),
  matches = [];
for (const name of readdirSync(d1Root, { recursive: true }).filter(
  (n) => n.endsWith('.sqlite') && !n.endsWith('metadata.sqlite'),
)) {
  const path = join(d1Root, name),
    candidate = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      candidate
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='companies'")
        .get() &&
      candidate.prepare('SELECT 1 FROM companies WHERE id=?').get(companyId)
    )
      matches.push(path);
  } finally {
    candidate.close();
  }
}
assert.equal(matches.length, 1);
const sql = new DatabaseSync(matches[0]);
sql
  .prepare(
    "INSERT INTO memberships(user_id,company_id,role) VALUES('continuation-fixture-owner',?,'owner')",
  )
  .run(companyId);
const bundled = await build({
  stdin: {
    contents: [
      'd1-document-archive-journal',
      'purchase-order-document-archive-contract',
      'purchase-order-history-export-contract',
      'document-byte-digest',
    ]
      .map((name) => `export * from './src/lib/${name}.ts';`)
      .join('\n'),
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const core = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
const db = {
  prepare(query) {
    return {
      bind(...values) {
        return {
          execute: () => ({
            results: sql.prepare(query).all(...values),
            success: true,
            meta: { changes: 0 },
          }),
          first: async () => sql.prepare(query).get(...values) ?? null,
        };
      },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.execute());
      sql.exec('COMMIT');
      return results;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  },
};
async function reserve(format = 'pdf', who = actor, active = false) {
  const request = core.documentArchiveRequest.parse({
      companyId,
      operationId: crypto.randomUUID(),
      format,
      source: { kind: 'draft', orderId: order.snapshot.id, revision: order.revision },
    }),
    at = new Date(Date.now() - (active ? 0 : 240_000)).toISOString();
  const journal = new core.D1DocumentArchiveJournal(db, {
      clock: { now: () => new Date(at), sqlNow: "'" + at + "'" },
    }),
    result = await journal.begin({
      request,
      actorId: who,
      requestFingerprint: await core.historyExportFingerprint({ request, actorId: who }),
      template: core.archiveTemplate('draft', format),
      requestedAt: at,
      leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
    });
  assert.equal(result.kind, 'claim');
  return { id: result.claim.id, request };
}
const first = await reserve(),
  lost = await reserve('xlsx'),
  stopped = await reserve(),
  otherPending = await reserve('xlsx'),
  roleTarget = await reserve(),
  active = await reserve('pdf', actor, true),
  otherActor = await reserve('pdf', 'continuation-fixture-owner');
const latest = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.at(-1),
  tables = Object.keys(
    JSON.parse(
      readFileSync(`drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`, 'utf8'),
    ).tables,
  )
    .filter((name) => !name.startsWith('document_archive_'))
    .sort();
const rows = () =>
    JSON.stringify(tables.map((name) => [name, sql.prepare(`SELECT * FROM "${name}"`).all()])),
  before = rows();
const intent = (target) =>
    sql
      .prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?')
      .get(companyId, target.request.operationId),
  issued = () =>
    sql
      .prepare(
        'SELECT count(*) n FROM document_archive_intents WHERE company_id=? AND artifact_json IS NOT NULL',
      )
      .get(companyId).n;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
});
let changedRole = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
  const page = await context.newPage(),
    errors = [],
    posts = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/purchase-order-documents'
    )
      posts.push(request.postDataJSON());
  });
  const open = async () => {
    await page.goto(
      origin + '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?company=' + companyId),
    );
    await page.getByRole('button', { name: 'Purchase-order drafts', exact: true }).first().click();
    await page.getByRole('button', { name: 'Open ' + order.snapshot.number, exact: true }).click();
  };
  await open();
  const copies = page.getByRole('region', { name: 'Saved copies', exact: true }),
    review = page.getByRole('region', { name: 'Saved-document review', exact: true });
  const show = async (target) => {
    if (!(await review.count()))
      await copies.getByRole('button', { name: 'Review saves', exact: true }).click();
    else await review.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await review
      .getByRole('button', { name: new RegExp('^View save history.*reference ' + target.id + '$') })
      .click();
  };
  await show(otherActor);
  await review
    .getByText(
      'Only the person who started this save can continue it, with current owner or manager access.',
    )
    .waitFor();
  assert.equal(
    await review.getByRole('button', { name: 'Continue original save', exact: true }).count(),
    0,
  );
  await show(active);
  assert.equal(
    await review.getByRole('button', { name: 'Continue original save', exact: true }).isDisabled(),
    true,
  );
  await show(first);
  await review.getByRole('button', { name: 'Continue original save', exact: true }).click();
  await copies.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();
  assert.equal(issued(), 1);
  assert.equal(JSON.parse(intent(first).artifact_json).id, first.id);
  assert.deepEqual(posts.at(-1), first.request);
  // Lose the real response after commit; reload and retry the persisted original command.
  await show(lost);
  await page.route('**/api/purchase-order-documents', async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('failed');
  });
  await review.getByRole('button', { name: 'Continue original save', exact: true }).click();
  await copies.getByText('The save could not be confirmed. Retry this same save.').waitFor();
  assert.equal(issued(), 2);
  const issuedBeforeRetry = intent(lost).artifact_json;
  await page.unroute('**/api/purchase-order-documents');
  await open();
  await copies.getByRole('button', { name: 'Retry this save', exact: true }).click();
  await copies.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();
  assert.equal(issued(), 2);
  assert.equal(intent(lost).artifact_json, issuedBeforeRetry);
  assert.deepEqual(posts.slice(-2), [lost.request, lost.request]);
  // Stop before the POST is dispatched, then refuse another continuation in this pending slot.
  await show(stopped);
  let entered, release, finished;
  const started = new Promise((r) => (entered = r)),
    released = new Promise((r) => (release = r)),
    ended = new Promise((r) => (finished = r));
  await page.route('**/api/purchase-order-documents', async (route) => {
    entered();
    await released;
    try {
      await route.abort('failed');
    } catch {
      /* Owned request cancellation. */
    } finally {
      finished();
    }
  });
  await review.getByRole('button', { name: 'Continue original save', exact: true }).click();
  await started;
  await copies.getByRole('button', { name: 'Stop waiting', exact: true }).click();
  release();
  await ended;
  await page.unroute('**/api/purchase-order-documents');
  await copies
    .getByText('Stopped waiting. The save may still complete. Retry this save to check its result.')
    .waitFor();
  assert.equal(intent(stopped).artifact_json, null);
  await show(otherPending);
  assert.equal(
    await review.getByRole('button', { name: 'Continue original save', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await copies.getByRole('button', { name: 'Save PDF copy', exact: true }).isDisabled(),
    true,
  );
  await copies.getByRole('button', { name: 'Retry this save', exact: true }).click();
  await copies.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();
  assert.equal(JSON.parse(intent(stopped).artifact_json).id, stopped.id);
  assert.equal(intent(otherPending).artifact_json, null);
  // Revoke after the lookup succeeds, before the real guarded POST.
  await show(roleTarget);
  await page.route('**/api/purchase-order-documents', async (route) => {
    sql
      .prepare("UPDATE memberships SET role='employee' WHERE company_id=? AND user_id=?")
      .run(companyId, actor);
    changedRole = true;
    await route.continue();
  });
  await review.getByRole('button', { name: 'Continue original save', exact: true }).click();
  await copies
    .getByText(
      'Your session or company access changed. Sign in with owner or manager access before continuing.',
    )
    .waitFor();
  assert.equal(intent(roleTarget).manifest_json, null);
  assert.equal(intent(roleTarget).artifact_json, null);
  sql
    .prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?")
    .run(companyId, actor);
  changedRole = false;
  await page.unroute('**/api/purchase-order-documents');
  await copies.getByRole('button', { name: 'Retry this save', exact: true }).click();
  await copies.getByText('Permanent copy saved. You can download it from Saved copies.').waitFor();
  assert.equal(JSON.parse(intent(roleTarget).artifact_json).id, roleTarget.id);
  await show(otherPending);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, 'continuation-390.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(root, 'continuation-desktop.png'), fullPage: true });
  await review.getByRole('button', { name: 'Continue original save', exact: true }).focus();
  assert.equal(
    await review
      .getByRole('button', { name: 'Continue original save', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(rows(), before, 'Continuation changes archive journal rows and objects only');
  assert.deepEqual(errors, []);
  for (const target of [first, lost, stopped, roleTarget]) {
    const artifact = JSON.parse(intent(target).artifact_json),
      response = await fetch(
        origin +
          '/api/purchase-order-documents?' +
          new URLSearchParams({ companyId, id: artifact.id }),
        { headers, redirect: 'error' },
      );
    assert.equal(response.status, 200);
    assert.equal(
      await core.documentByteDigest(new Uint8Array(await response.arrayBuffer())),
      artifact.sha256,
    );
  }
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        companyId,
        orderId: order.snapshot.id,
        issued: issued(),
        sameOperationReplay: true,
        pendingSlotPreserved: true,
        roleRefusal: true,
        businessRowsPreserved: true,
        pageErrors: errors,
        seed: 'production journal over isolated local SQLite reservations',
      },
      null,
      2,
    ) + '\n',
  );
  await context.close();
} finally {
  if (changedRole)
    sql
      .prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?")
      .run(companyId, actor);
  sql.close();
  await browser.close();
}
console.log(
  'PASS: signed-in original-actor continuation, active/other-actor refusal, PDF/Excel, lost HTTP reply/reload, stop/retry and shared pending-slot safety, role refusal, native downloads, unchanged business rows and desktop/390px/keyboard. Evidence: ' +
    root,
);
