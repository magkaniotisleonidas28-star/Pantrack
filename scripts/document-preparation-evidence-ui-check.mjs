// Fictional loopback acceptance. Retained observations are fixtures; no inspection reads R2.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { localFixtureCookie } from './po-cart-worker/local-browser-fixture.mjs';
const origin = 'http://127.0.0.1:5179',
  root = resolve('.sites-runtime/preparation-evidence-browser/run-' + crypto.randomUUID());
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
  name: 'Prepared-evidence practice café',
});
const { order } = await api('/api/purchase-orders', {
  action: 'create',
  companyId,
  operationId: crypto.randomUUID(),
  source: 'manual',
  capMinor: '10000',
  notes: 'Read-only prepared evidence practice',
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
const command = (format) => ({
    companyId,
    operationId: crypto.randomUUID(),
    format,
    source: { kind: 'draft', orderId: order.snapshot.id, revision: order.revision },
  }),
  issued = [];
for (const format of ['pdf', 'xlsx'])
  issued.push((await api('/api/purchase-order-documents', command(format))).artifact);
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
    "INSERT INTO memberships(user_id,company_id,role) VALUES('preparation-fixture-owner',?,'owner')",
  )
  .run(companyId);
const bundled = await build({
  stdin: {
    contents: [
      'd1-document-archive-journal',
      'purchase-order-document-archive-contract',
      'purchase-order-history-export-contract',
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
        const bound = values.map((value) => (typeof value === 'boolean' ? Number(value) : value)),
          execute = () => ({
            results: sql.prepare(query).all(...bound),
            success: true,
            meta: { changes: 0 },
          });
        return {
          execute,
          first: async () => sql.prepare(query).get(...bound) ?? null,
          all: async () => execute(),
          run: async () => execute(),
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
const journal = new core.D1DocumentArchiveJournal(db);
async function seed(
  base,
  { who = actor, prepared = true, outcome = 'matched', active = false } = {},
) {
  const request = core.documentArchiveRequest.parse(command(base.format)),
    started = await journal.begin({
      request,
      actorId: who,
      requestFingerprint: await core.historyExportFingerprint({ request, actorId: who }),
      template: base.template,
      requestedAt: new Date().toISOString(),
      leaseMs: core.DOCUMENT_ARCHIVE_LEASE_MS,
    });
  assert.equal(started.kind, 'claim');
  const claim = started.claim;
  if (prepared) {
    const { issuedAt, ...original } = base;
    await journal.prepare(claim, {
      ...original,
      id: claim.id,
      actorId: who,
      requestedAt: claim.requestedAt,
    });
    if (outcome === 'matched')
      await journal.observe(claim, {
        kind: 'object',
        present: true,
        reportedSize: base.size,
        byteLength: base.size,
        sha256: base.sha256,
      });
    else if (outcome === 'missing')
      await journal.observe(claim, {
        kind: 'object',
        present: false,
        reportedSize: null,
        byteLength: null,
        sha256: null,
      });
    else if (outcome === 'write_unconfirmed')
      await journal.observe(claim, { kind: 'write_unknown' });
  } else await journal.observe(claim, { kind: 'generation', size: null, signature: 'missing' });
  if (!active) await journal.hold(claim, prepared ? 'held' : 'generation_failed');
  return { id: claim.id, request, base };
}
// Expected hashes/source proofs come from real issued local files. New prepared IDs
// deliberately have no object; the retained observation fixtures prove display only.
const matched = await seed(issued[0]),
  missing = await seed(issued[1], { outcome: 'missing' }),
  unknown = await seed(issued[1], { outcome: 'write_unconfirmed' }),
  empty = await seed(issued[0], { prepared: false }),
  active = await seed(issued[0], { outcome: 'none', active: true }),
  other = await seed(issued[0], { who: 'preparation-fixture-owner' });
const latest = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.at(-1),
  tables = Object.keys(
    JSON.parse(
      readFileSync(`drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`, 'utf8'),
    ).tables,
  ).sort();
const rows = () =>
    JSON.stringify(tables.map((name) => [name, sql.prepare(`SELECT * FROM "${name}"`).all()])),
  before = rows();
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
    requests = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/purchase-order-documents'))
      requests.push({
        method: request.method(),
        path: url.pathname,
        view: url.searchParams.get('view'),
      });
  });
  await page.goto(
    origin + '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?company=' + companyId),
  );
  await page.getByRole('button', { name: 'Purchase-order drafts', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open ' + order.snapshot.number, exact: true }).click();
  const copies = page.getByRole('region', { name: 'Saved copies', exact: true }),
    review = page.getByRole('region', { name: 'Saved-document review', exact: true }),
    panel = page.getByRole('region', { name: 'Prepared file evidence', exact: true });
  const show = async (target) => {
    if (!(await review.count()))
      await copies.getByRole('button', { name: 'Review saves', exact: true }).click();
    else await review.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await review
      .getByRole('button', { name: new RegExp('^View save history.*reference ' + target.id + '$') })
      .click();
    await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).waitFor();
  };
  await show(matched);
  await panel.getByText('Preparation recorded; copy not issued.', { exact: true }).waitFor();
  await panel.getByText(/The last recorded check matched/).waitFor();
  assert.ok((await panel.innerText()).includes(issued[0].size.toLocaleString() + ' bytes'));
  const beforeExpand = requests.length;
  await panel.locator('summary').click();
  await panel.getByText(issued[0].sha256, { exact: true }).waitFor();
  assert.equal(requests.length, beforeExpand, 'Expanding identifiers makes no request');
  const expectedMetadata = JSON.parse(
    sql.prepare('SELECT manifest_json FROM document_archive_intents WHERE id=?').get(matched.id)
      .manifest_json,
  );
  assert.equal(expectedMetadata.sha256, issued[0].sha256);
  await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await panel.getByText(/The last recorded check matched/).waitFor();
  assert.equal(
    sql.prepare('SELECT artifact_json FROM document_archive_intents WHERE id=?').get(matched.id)
      .artifact_json,
    null,
  );
  await show(missing);
  await panel.getByText(/The file was not found at the last recorded check/).waitFor();
  assert.ok((await panel.innerText()).includes('Excel'));
  await show(unknown);
  await panel.getByText('Storage did not confirm the earlier write.', { exact: false }).waitFor();
  await show(empty);
  await panel.getByText(/No durable preparation record is stored/).waitFor();
  assert.equal(await panel.locator('summary').count(), 0);
  await show(active);
  await panel
    .getByText('No file-storage observation has been recorded for this prepared file.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await review.getByRole('button', { name: 'Continue original save', exact: true }).isDisabled(),
    true,
  );
  await show(other);
  await panel.getByText(/Preparation recorded/).waitFor();
  assert.equal(
    await review.getByRole('button', { name: 'Continue original save', exact: true }).count(),
    0,
  );
  await copies
    .getByRole('button', { name: new RegExp('^Review saved PDF reference ' + issued[0].id + '$') })
    .click();
  await review.getByText('Copy issued', { exact: true }).waitFor();
  assert.equal(
    await panel.count(),
    0,
    'Issued copies do not display an unissued preparation panel',
  );
  await show(matched);
  await panel.locator('summary').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, 'prepared-evidence-390.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(root, 'prepared-evidence-desktop.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).focus();
  assert.equal(
    await panel
      .getByRole('button', { name: 'Refresh evidence', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  sql
    .prepare("UPDATE memberships SET role='employee' WHERE company_id=? AND user_id=?")
    .run(companyId, actor);
  changedRole = true;
  await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await review.getByRole('alert').filter({ hasText: 'The review could not be read.' }).waitFor();
  assert.equal(await panel.count(), 0);
  assert.equal(await page.getByText(issued[0].sha256, { exact: true }).count(), 0);
  sql
    .prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?")
    .run(companyId, actor);
  changedRole = false;
  await show(matched);
  await panel.getByText(/Preparation recorded/).waitFor();
  assert.equal(
    rows(),
    before,
    'Every business, archive intent, lease and observation row is preserved',
  );
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every(
      (request) =>
        request.method === 'GET' &&
        request.path === '/api/purchase-order-documents' &&
        ['list', 'review', 'review-detail'].includes(request.view),
    ),
    'No save, continuation, check or download request follows evidence review',
  );
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        companyId,
        orderId: order.snapshot.id,
        preparedStates: [
          'matched',
          'missing',
          'write_unconfirmed',
          'no_observation',
          'not_recorded',
          'other_actor',
          'issued_hidden',
        ],
        allApplicationRowsPreserved: true,
        metadataRequestsOnly: true,
        noRequestsOnIdentifierExpansion: true,
        pageErrors: errors,
        seed: 'production journal over isolated SQLite; retained observations are fixtures; native API cases separately prove storage behavior',
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
  'PASS: signed-in prepared evidence states, original metadata, retained-check wording, active/other-actor visibility, issued hiding, metadata-only refresh, role refusal/private clearing, zero application-row changes and desktop/390px/keyboard. Evidence: ' +
    root,
);
