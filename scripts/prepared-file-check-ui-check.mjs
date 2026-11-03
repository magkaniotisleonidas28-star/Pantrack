// Fictional loopback acceptance. Object setup/tampering is confined to this isolated local preview.
import './sites-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { localFixtureCookie } from './po-cart-worker/local-browser-fixture.mjs';
const origin = 'http://127.0.0.1:5179',
  root = resolve('.sites-runtime/prepared-check-browser/run-' + crypto.randomUUID());
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
  name: 'Prepared-check practice café',
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
// Expected hashes/source proofs come from real issued local files. The explicit
// fixture setup below adds the matching bytes under the prepared ID.
const matched = await seed(issued[0]),
  missing = await seed(issued[1], { outcome: 'missing' }),
  unknown = await seed(issued[1], { outcome: 'write_unconfirmed' }),
  empty = await seed(issued[0], { prepared: false }),
  active = await seed(issued[0], { outcome: 'none', active: true }),
  other = await seed(issued[0], { who: 'preparation-fixture-owner' });
const preparedManifest = JSON.parse(
    sql.prepare('SELECT manifest_json FROM document_archive_intents WHERE id=?').get(matched.id)
      .manifest_json,
  ),
  objectKey = await core.archiveObjectKey(preparedManifest);
assert.equal(preparedManifest.companyId, companyId);
assert.equal(preparedManifest.id, matched.id);
const download = await fetch(
  origin + '/api/purchase-order-documents?' + new URLSearchParams({ companyId, id: issued[0].id }),
  { headers, redirect: 'error' },
);
assert.equal(download.status, 200);
const originalBytes = new Uint8Array(await download.arrayBuffer()),
  goodFile = join(root, 'fixture-original.pdf'),
  badFile = join(root, 'fixture-damaged.pdf');
writeFileSync(goodFile, originalBytes);
writeFileSync(badFile, new Uint8Array(originalBytes.length));
function localObject(action, file) {
  const args = [
    'node_modules/wrangler/bin/wrangler.js',
    'r2',
    'object',
    action,
    'pantrack-fictional-documents/' + objectKey,
    '--local',
    '--persist-to',
    '.sites-runtime/po-review-state',
    '--config',
    '.sites-runtime/po-review-config/wrangler.jsonc',
    ...(file ? ['--file', file] : []),
  ];
  assert.ok(args.includes('--local'));
  assert.equal(args.includes('--remote'), false);
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
}
localObject('put', goodFile);
const latest = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.at(-1),
  tables = Object.keys(
    JSON.parse(
      readFileSync(`drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`, 'utf8'),
    ).tables,
  )
    .filter((name) => name !== 'document_archive_observations')
    .sort();
const rows = () =>
    JSON.stringify(tables.map((name) => [name, sql.prepare(`SELECT * FROM "${name}"`).all()])),
  before = rows();
const legacyRows = () =>
    JSON.stringify(
      sql
        .prepare(
          "SELECT * FROM document_archive_observations WHERE json_extract(payload_json,'$.kind') IS NOT 'prepared_check' ORDER BY rowid",
        )
        .all(),
    ),
  legacyBefore = legacyRows();
const checkRows = () =>
  sql
    .prepare(
      "SELECT * FROM document_archive_observations WHERE company_id=? AND document_id=? AND json_extract(payload_json,'$.kind')='prepared_check' ORDER BY rowid",
    )
    .all(companyId, matched.id);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH ?? chromium.executablePath(),
});
let changedRole = false,
  closing = false,
  releaseHeld;
const deferred = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve: (value) => resolve(value) };
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
  let mode = 'normal',
    heldReady;
  const commands = [],
    responses = [],
    errors = [],
    requests = [];
  await context.route('**/api/purchase-order-documents/check-prepared', async (route) => {
    try {
      commands.push(JSON.parse(route.request().postData()));
      const response = await route.fetch();
      if (response.ok()) responses.push(await response.json());
      if (mode === 'lose') {
        mode = 'normal';
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Fictional lost response' }),
        });
        return;
      }
      if (mode === 'hold') {
        mode = 'normal';
        heldReady.resolve();
        await releaseHeld.promise;
        try {
          await route.fulfill({ response });
        } catch {
          /* The user's stop action may already have canceled this reply. */
        }
        return;
      }
      await route.fulfill({ response });
    } catch (error) {
      if (!closing) errors.push('Route: ' + error.message);
      try {
        await route.abort('failed');
      } catch {
        /* Already canceled during teardown. */
      }
    }
  });
  const page = await context.newPage();
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
    panel = page.getByRole('region', { name: 'Prepared file evidence', exact: true }),
    control = page.getByRole('region', { name: 'Check prepared file', exact: true });
  const button = () =>
    control.getByRole('button', { name: 'Check prepared file now', exact: true });
  async function show(target) {
    if (!(await review.count()))
      await copies.getByRole('button', { name: 'Review saves', exact: true }).click();
    else await review.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await review
      .getByRole('button', { name: new RegExp('^View save history.*reference ' + target.id + '$') })
      .click();
    await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).waitFor();
  }
  await show(matched);
  const noChecks = commands.length;
  await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await button().waitFor();
  assert.equal(commands.length, noChecks, 'Refresh never starts a check');
  mode = 'lose';
  await button().click();
  await control
    .getByRole('alert')
    .filter({ hasText: 'The prepared-file check could not be confirmed.' })
    .waitFor();
  const firstCommand = commands.at(-1),
    firstResult = responses.at(-1),
    retainedAfterLost = JSON.stringify(checkRows());
  assert.equal(firstResult.check.outcome, 'verified');
  await copies.getByRole('button', { name: 'Close save review', exact: true }).click();
  await show(matched);
  await control
    .getByRole('button', { name: 'Retry this prepared-file check', exact: true })
    .click();
  await control.getByText(/Recorded result from an earlier prepared-file check/).waitFor();
  assert.deepEqual(commands.at(-1), firstCommand);
  assert.equal(
    JSON.stringify(checkRows()),
    retainedAfterLost,
    'Recovering a lost reply adds no new read/result',
  );
  await button().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await button().evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await control.getByText(/New prepared-file check recorded/).waitFor();
  assert.notEqual(commands.at(-1).operationId, firstCommand.operationId);
  assert.equal(responses.at(-1).check.outcome, 'verified');
  assert.equal(
    sql.prepare('SELECT artifact_json FROM document_archive_intents WHERE id=?').get(matched.id)
      .artifact_json,
    null,
  );
  mode = 'hold';
  heldReady = deferred();
  releaseHeld = deferred();
  await button().click();
  await heldReady.promise;
  await control
    .getByRole('button', { name: 'Stop waiting for prepared-file check', exact: true })
    .click();
  const stoppedCommand = commands.at(-1),
    stoppedRows = JSON.stringify(checkRows());
  releaseHeld.resolve();
  await control
    .getByRole('button', { name: 'Retry this prepared-file check', exact: true })
    .click();
  await control.getByText(/Recorded result from an earlier prepared-file check/).waitFor();
  assert.deepEqual(commands.at(-1), stoppedCommand);
  assert.equal(JSON.stringify(checkRows()), stoppedRows);
  // These are explicit fixture operations, outside the application action under test.
  localObject('delete');
  const afterDelete = commands.length;
  await panel.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await button().waitFor();
  assert.equal(commands.length, afterDelete);
  await panel.getByText(/last recorded check matched/).waitFor();
  await button().click();
  await control.getByText(/The prepared file was not found during this check/).waitFor();
  await panel.getByText(/The file was not found at the last recorded check/).waitFor();
  localObject('put', badFile);
  await button().click();
  await control
    .getByText(/The prepared file contents did not match its original details/)
    .waitFor();
  await panel.getByText(/The last recorded contents differed/).waitFor();
  localObject('put', goodFile);
  await button().click();
  await control.getByText(/The prepared file matched its original details/).waitFor();
  await panel.getByText(/last recorded check matched/).waitFor();
  await show(empty);
  assert.equal(await control.count(), 0, 'No check exists without a preparation record');
  await show(other);
  assert.equal(
    await review.getByRole('button', { name: 'Continue original save', exact: true }).count(),
    0,
  );
  await button().click();
  await control.getByText(/The prepared file was not found during this check/).waitFor();
  await copies
    .getByRole('button', { name: new RegExp('^Review saved PDF reference ' + issued[0].id + '$') })
    .click();
  await review.getByText('Copy issued', { exact: true }).waitFor();
  assert.equal(await control.count(), 0);
  assert.equal(await panel.count(), 0);
  await show(matched);
  await panel.locator('summary').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, 'prepared-check-390.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(root, 'prepared-check-desktop.png'), fullPage: true });
  sql
    .prepare("UPDATE memberships SET role='employee' WHERE company_id=? AND user_id=?")
    .run(companyId, actor);
  changedRole = true;
  await button().click();
  await review.getByRole('alert').filter({ hasText: 'The review could not be read.' }).waitFor();
  assert.equal(await panel.count(), 0);
  assert.equal(await control.count(), 0);
  assert.equal(await page.getByText(issued[0].sha256, { exact: true }).count(), 0);
  sql
    .prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?")
    .run(companyId, actor);
  changedRole = false;
  await show(matched);
  await control
    .getByRole('button', { name: 'Retry this prepared-file check', exact: true })
    .click();
  await control.getByText(/New prepared-file check recorded/).waitFor();
  assert.equal(rows(), before, 'All business, intent and lease rows remain identical');
  assert.equal(legacyRows(), legacyBefore, 'Every earlier observation is retained unchanged');
  assert.ok(checkRows().length > 0);
  assert.ok(checkRows().every((row) => row.token === null && row.actor_id === actor));
  assert.ok(
    requests.every(
      (request) =>
        (request.method === 'GET' &&
          request.path === '/api/purchase-order-documents' &&
          ['list', 'review', 'review-detail'].includes(request.view)) ||
        (request.method === 'POST' &&
          request.path === '/api/purchase-order-documents/check-prepared'),
    ),
    'No save, continuation, issued check or download action follows the setup',
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        companyId,
        orderId: order.snapshot.id,
        preparedCheckRequests: commands.length,
        lostResponseReplay: true,
        stopRetryReplay: true,
        newIdentity: true,
        realObjectOutcomes: ['verified', 'missing', 'damaged'],
        metadataRefreshStartsNoCheck: true,
        otherActorCanInspectButNotContinue: true,
        unpreparedAndIssuedControlsHidden: true,
        roleLossClearsPrivateData: true,
        allBusinessIntentLeaseRowsPreserved: true,
        legacyObservationsPreserved: true,
        onlyDeclaredCheckEventsAppend: true,
        keyboardEnter: true,
        noOverflow390: true,
        pageErrors: errors,
        fixtureScope:
          'Isolated fictional D1/R2; original bytes downloaded from a locally issued file; explicit local-only fixture put/delete/corruption occur outside app actions.',
      },
      null,
      2,
    ) + '\n',
  );
  await context.unrouteAll({ behavior: 'wait' });
  await context.close();
} finally {
  closing = true;
  releaseHeld?.resolve();
  if (changedRole)
    sql
      .prepare("UPDATE memberships SET role='owner' WHERE company_id=? AND user_id=?")
      .run(companyId, actor);
  sql.close();
  await browser.close();
}
console.log(
  'PASS: signed-in prepared-file checks with actual local R2 verified/missing/damaged/recovery results, real lost reply and stop/retry, keyboard action, source/actor visibility, role refusal clearing, preserved business/intent/lease/history rows and desktop/390px. Evidence: ' +
    root,
);
