// Isolated fictional PO preview only. No external service or hosted database access.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { localFixtureCookie } from './po-cart-worker/local-browser-fixture.mjs';
const origin = 'http://127.0.0.1:5179',
  root = resolve('.sites-runtime/issued-check-browser/run-' + crypto.randomUUID());
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
  name: 'Issued-file checks practice café',
});
const input = () => ({
  action: 'create',
  companyId,
  operationId: crypto.randomUUID(),
  source: 'manual',
  capMinor: '10000',
  notes: 'Issued checks practice',
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
const { order } = await api('/api/purchase-orders', input()),
  copies = [];
for (const format of ['pdf', 'xlsx'])
  copies.push(
    (
      await api('/api/purchase-order-documents', {
        companyId,
        operationId: crypto.randomUUID(),
        format,
        source: { kind: 'draft', orderId: order.snapshot.id, revision: order.revision },
      })
    ).artifact,
  );
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
const db = new DatabaseSync(matches[0]);
db.prepare(
  "INSERT INTO memberships(user_id,company_id,role) VALUES('issued-check-fixture-owner',?,'owner')",
).run(companyId);
const latest = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.at(-1),
  tables = Object.keys(
    JSON.parse(
      readFileSync(`drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`, 'utf8'),
    ).tables,
  )
    .filter((name) => name !== 'document_archive_observations')
    .sort();
const rows = () =>
  JSON.stringify(tables.map((name) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
let before = rows();
const observationCount = () =>
  db
    .prepare('SELECT count(*) n FROM document_archive_observations WHERE company_id=?')
    .get(companyId).n;
const receiptCount = () =>
  db
    .prepare(
      "SELECT count(*) n FROM document_archive_observations WHERE company_id=? AND json_extract(payload_json,'$.check.contract')='pantrack.issued-file-check.v1'",
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
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(60000);
  const open = async () => {
    await page.goto(
      origin + '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?company=' + companyId),
    );
    await page.getByRole('button', { name: 'Purchase-order drafts', exact: true }).first().click();
    await page.getByRole('button', { name: 'Open ' + order.snapshot.number, exact: true }).click();
  };
  await open();
  const copiesPanel = page.getByRole('region', { name: 'Saved copies', exact: true }),
    review = page.getByRole('region', { name: 'Saved-document review', exact: true }),
    control = page.getByRole('region', { name: 'Check issued file', exact: true });
  const show = async (artifact) => {
    await copiesPanel
      .getByRole('button', {
        name: new RegExp(
          '^Review saved ' +
            (artifact.format === 'pdf' ? 'PDF' : 'Excel') +
            ' reference ' +
            artifact.id +
            '$',
        ),
      })
      .click();
    await control.getByRole('button', { name: 'Check file now', exact: true }).waitFor();
  };
  await show(copies[0]);
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await control.getByText(/New check recorded: The file matched/).waitFor();
  assert.equal(receiptCount(), 1);
  const firstId = db
    .prepare(
      "SELECT id FROM document_archive_observations WHERE company_id=? AND json_extract(payload_json,'$.check.contract') IS NOT NULL",
    )
    .get(companyId).id;
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[aria-label="Check issued file"]')
        ?.getAttribute('aria-busy')
        ?.includes('true'),
  );
  assert.equal(receiptCount(), 2);
  assert.ok(
    db
      .prepare(
        "SELECT id FROM document_archive_observations WHERE company_id=? AND json_extract(payload_json,'$.check.contract') IS NOT NULL AND id!=?",
      )
      .get(companyId, firstId),
  );
  // Lose the real HTTP result after the server committed, close/reopen, then replay.
  let sent, retried;
  await page.route('**/api/purchase-order-documents/check', async (route) => {
    sent = route.request().postDataJSON();
    await route.fetch();
    await route.abort('failed');
  });
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await control
    .getByRole('alert')
    .filter({ hasText: 'The check could not be confirmed.' })
    .waitFor();
  assert.equal(receiptCount(), 3);
  const afterLost = observationCount();
  await page.unroute('**/api/purchase-order-documents/check');
  await copiesPanel.getByRole('button', { name: 'Close save review' }).click();
  await show(copies[0]);
  await control.getByRole('button', { name: 'Retry this check' }).waitFor();
  await page.route('**/api/purchase-order-documents/check', (route) => {
    retried = route.request().postDataJSON();
    return route.continue();
  });
  await control.getByRole('button', { name: 'Retry this check' }).click();
  await control.getByText(/Recorded result from an earlier check/).waitFor();
  await page.unroute('**/api/purchase-order-documents/check');
  assert.deepEqual(sent, retried);
  assert.equal(observationCount(), afterLost);
  // Stop waiting after commit and retrieve the same receipt without another check.
  let entered, release, finished;
  const started = new Promise((r) => (entered = r)),
    released = new Promise((r) => (release = r)),
    ended = new Promise((r) => (finished = r));
  await page.route('**/api/purchase-order-documents/check', async (route) => {
    try {
      const response = await route.fetch();
      entered();
      await released;
      await route.fulfill({ response });
    } catch {
      /* Owned browser cancellation. */
    } finally {
      finished();
    }
  });
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await started;
  await control.getByRole('button', { name: 'Stop waiting for check' }).click();
  release();
  await ended;
  await page.unroute('**/api/purchase-order-documents/check');
  await control.getByText(/Stopped waiting/).waitFor();
  const afterStop = observationCount();
  await control.getByRole('button', { name: 'Retry this check' }).click();
  await control.getByText(/Recorded result from an earlier check/).waitFor();
  assert.equal(observationCount(), afterStop);
  await show(copies[1]);
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await control.getByText(/New check recorded: The file matched/).waitFor();
  const beforeRefresh = observationCount();
  await review.getByRole('button', { name: 'Refresh review' }).click();
  await review.getByText('No saves need attention in this list.').waitFor();
  assert.equal(observationCount(), beforeRefresh, 'Refresh never scans a file');
  await show(copies[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, 'issued-check-390.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(root, 'issued-check-desktop.png'), fullPage: true });
  await control.getByRole('button', { name: 'Check file now', exact: true }).focus();
  assert.equal(
    await control
      .getByRole('button', { name: 'Check file now', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  // The final metadata handoff must refuse a real role change after a receipt exists.
  await page.route('**/api/purchase-order-documents?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('view') === 'metadata') {
      db.prepare("UPDATE memberships SET role='employee' WHERE company_id=? AND user_id=?").run(
        companyId,
        actor,
      );
      changedRole = true;
    }
    await route.continue();
  });
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await control
    .getByRole('alert')
    .filter({ hasText: 'The check could not be confirmed.' })
    .waitFor();
  assert.equal(await control.getByText(/New check recorded:/).count(), 0);
  db.prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?").run(
    companyId,
    actor,
  );
  changedRole = false;
  await page.unroute('**/api/purchase-order-documents?**');
  const afterRevocation = observationCount();
  await control.getByRole('button', { name: 'Retry this check' }).click();
  await control.getByText(/Recorded result from an earlier check/).waitFor();
  assert.equal(observationCount(), afterRevocation);
  assert.equal(rows(), before, 'Only observation/check rows append');
  // Later source edits/cancellation do not invalidate an issued historical file.
  const edited = (
    await api('/api/purchase-orders', {
      ...input(),
      action: 'edit',
      orderId: order.snapshot.id,
      expectedRevision: order.revision,
      reason: 'Later correction',
      notes: 'Changed after issue',
    })
  ).order;
  await api('/api/purchase-orders', {
    action: 'cancel',
    companyId,
    operationId: crypto.randomUUID(),
    orderId: order.snapshot.id,
    expectedRevision: edited.revision,
    reason: 'Historical check fixture',
  });
  before = rows();
  await open();
  await show(copies[0]);
  await control.getByRole('button', { name: 'Check file now', exact: true }).click();
  await control.getByText(/New check recorded: The file matched/).waitFor();
  assert.equal(rows(), before);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        companyId,
        orderId: order.snapshot.id,
        copies: copies.map((c) => c.id),
        receipts: receiptCount(),
        sameCommandReplay: true,
        refreshReadOnly: true,
        businessRowsPreserved: true,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  await context.close();
} finally {
  if (changedRole)
    db.prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?").run(
      companyId,
      actor,
    );
  db.close();
  await browser.close();
}
console.log(
  'PASS: actual issued PDF/Excel checks, new versus replay identity, lost response/reopen, stop/retry, journal-only refresh, final role refusal, historical checks and unchanged business/archive records. Evidence: ' +
    root,
);
