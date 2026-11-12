import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { findLocalD1Database } from '../local-d1-database.mjs';

export async function runA8Scenario({ origin, appRoot, evidenceRoot, executablePath }) {
  assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  const packet = evidenceRoot;
  const signedIn = await fetch(origin + '/signin-with-chatgpt?return_to=/', { redirect: 'manual' });
  assert.ok([302, 303].includes(signedIn.status));
  const cookie = signedIn.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'The isolated fixture must provide a sign-in cookie');
  const companyId = crypto.randomUUID(),
    productId = 'fictional-a8-' + crypto.randomUUID();
  const request = (path, body, authenticated = true) =>
    fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: {
        ...(authenticated ? { cookie } : {}),
        ...(body ? { origin, 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const ok = async (path, body) => {
    const response = await request(path, body);
    assert.equal(response.status, 200, path + ': ' + (await response.clone().text()));
    return response.json();
  };
  let db, actor, browser, context, failure;
  const errors = [],
    commands = [],
    outside = [],
    changes = [];
  const facts = {
    passed: false,
    companyId,
    productId,
    fixtureScope:
      'Fresh isolated local D1 and placeholder sandbox health; no provider or supplier action.',
  };
  const role = (value) =>
    db
      .prepare('UPDATE memberships SET role=? WHERE company_id=? AND user_id=?')
      .run(value, companyId, actor);
  try {
    await ok('/api/companies', {
      action: 'create',
      id: companyId,
      name: 'Fictional A8 browser café',
    });
    await ok('/api/workspace', {
      action: 'product',
      companyId,
      product: {
        id: productId,
        name: 'Fictional milk',
        supplier: 'Unverified fictional supplier',
        sku: 'FICTIONAL-A8',
        pack: 'case',
        unit: 'case',
        price: 0,
        category: 'Fictional',
        url: '',
        sample: true,
      },
    });
    const at = new Date().toISOString();
    await ok('/api/inventory', {
      action: 'configureExact',
      companyId,
      productId,
      operationId: crypto.randomUUID(),
      stockUnit: { kind: 'curated', id: 'mL' },
      purchaseUnitLabel: 'case',
      purchaseAmount: '1000',
      openingAmount: '10',
      effectiveAt: at,
    });
    const databasePath = findLocalD1Database(
      resolve(appRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'),
      { companyId, productId },
    );
    db = new DatabaseSync(databasePath);
    facts.databasePath = resolve(databasePath);
    actor = db
      .prepare("SELECT user_id FROM memberships WHERE company_id=? AND role='owner'")
      .get(companyId).user_id;
    // Retain an owner while exercising the signed-in actor's employee permissions.
    db.prepare("INSERT INTO memberships(user_id,company_id,role) VALUES(?,?,'owner')").run(
      'fictional-spare-owner-' + crypto.randomUUID(),
      companyId,
    );
    const config = db
      .prepare(
        "SELECT id,version FROM inventory_config_versions WHERE company_id=? AND product_id=? AND status='active'",
      )
      .get(companyId, productId);
    const qty = (minor) => ({ dimension: 'volume', minor: String(minor) });
    db.prepare(
      `INSERT INTO replenishment_settings_versions
  (company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,
   dimension,settings_json,changed_by,change_reason,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      companyId,
      productId,
      1,
      crypto.randomUUID(),
      config.id,
      config.version,
      'volume',
      JSON.stringify({
        target: qty(20000000),
        capacity: qty(10000000000),
        dailyUse: qty(1000000),
        shelfDays: 3650,
        countEveryDays: 3650,
        minimumPacks: '0',
        orderMultiplePacks: '1',
        maximumPacks: '5',
      }),
      actor,
      'Fictional browser fixture',
      at,
    );
    const merchant = 'fictional-merchant-' + crypto.randomUUID();
    db.prepare(
      `INSERT INTO clover_connections
  (company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)`,
    ).run(companyId, merchant, 'sandbox', 'encrypted-fictional-placeholder', at, at);
    db.prepare(
      `INSERT INTO clover_sync_state
  (company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until)
  VALUES (?,?,?,?,?,?,?,?,0)`,
    ).run(
      companyId,
      'sandbox',
      merchant,
      Date.now() - 3600000,
      Date.now() - 60000,
      at,
      new Date(Date.now() - 60000).toISOString(),
      null,
    );
    const latest = JSON.parse(
      readFileSync(resolve(appRoot, 'drizzle/meta/_journal.json'), 'utf8'),
    ).entries.at(-1);
    const inventoryTables = Object.keys(
      JSON.parse(
        readFileSync(
          resolve(appRoot, `drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`),
          'utf8',
        ),
      ).tables,
    )
      .filter((name) => name.startsWith('inventory_'))
      .sort();
    assert.ok(inventoryTables.includes('inventory_balances_exact'));
    const inventoryRows = () =>
      JSON.stringify(
        inventoryTables.map((name) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
      );
    const initialInventory = inventoryRows();
    const proposalsPath =
      '/api/replenishment/proposals?' + new URLSearchParams({ companyId, productId });
    const views = async () => (await ok(proposalsPath)).views;
    const originCount = () =>
      db
        .prepare('SELECT count(*) AS n FROM replenishment_proposal_origins WHERE company_id=?')
        .get(companyId).n;
    assert.equal((await request(proposalsPath, null, false)).status, 401);
    assert.equal(
      (
        await request(
          '/api/replenishment/proposals?' +
            new URLSearchParams({ companyId: crypto.randomUUID(), productId }),
        )
      ).status,
      403,
    );
    role('employee');
    assert.equal((await request(proposalsPath)).status, 403);
    assert.equal(
      (
        await request('/api/replenishment/proposals', {
          action: 'create',
          companyId,
          productId,
          proposalId: crypto.randomUUID(),
          createId: crypto.randomUUID(),
        })
      ).status,
      403,
    );
    assert.equal(originCount(), 0);
    role('owner');
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      outside.push(new URL(route.request().url()).origin);
      return route.abort('blockedbyclient');
    });
    let lose;
    await context.route('**/api/replenishment/proposals', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try {
        const body = JSON.parse(route.request().postData());
        commands.push(body);
        if (lose !== body.action) return route.continue();
        lose = undefined;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Fictional lost reply' }),
        });
      } catch (error) {
        errors.push('Route: ' + error.message);
        await route.abort('failed').catch(() => {});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST') changes.push(new URL(request.url()).pathname);
    });
    async function openPlan() {
      await page.goto(
        origin + '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?company=' + companyId),
      );
      await page.getByRole('button', { name: 'Inventory', exact: true }).first().click();
      await page
        .getByRole('navigation', { name: 'Inventory sections' })
        .getByRole('button', { name: 'Purchasing plan', exact: true })
        .click();
    }
    await openPlan();
    await page.locator('summary').filter({ hasText: 'Clover review' }).click();
    await page.getByRole('button', { name: 'Calculate review', exact: true }).click();
    await page.getByText('Review suggestion: 1 whole packs', { exact: true }).waitFor();
    const saved = page
      .getByRole('heading', { name: 'Saved review proposals', exact: true })
      .locator('xpath=ancestor::section[1]');
    const create = saved.getByRole('button', { name: 'Save new review', exact: true });
    lose = 'create';
    await create.click();
    await saved.getByRole('alert').filter({ hasText: 'Fictional lost reply' }).waitFor();
    assert.equal(originCount(), 1);
    await create.click();
    await saved.getByRole('status').filter({ hasText: 'Review saved.' }).waitFor();
    const creates = commands.filter((command) => command.action === 'create');
    assert.equal(creates.length, 2);
    assert.deepEqual(creates[0], creates[1]);
    assert.equal(originCount(), 1);
    const first = (await views())[0];
    assert.equal(first.revision, 1);
    assert.equal(first.handoff.supplierSubmissionAllowed, false);
    await saved.getByLabel('Whole packs', { exact: true }).fill('1');
    await saved
      .getByLabel('Reason for edit or cancellation', { exact: true })
      .fill('Fictional browser quantity review');
    lose = 'edit';
    const edit = saved.getByRole('button', { name: 'Save quantity edit', exact: true });
    await edit.focus();
    await page.keyboard.press('Enter');
    await saved.getByRole('alert').filter({ hasText: 'Fictional lost reply' }).waitFor();
    assert.equal((await views())[0].revision, 2);
    await edit.click();
    await saved.getByRole('status').filter({ hasText: 'Quantity edit audited.' }).waitFor();
    const edits = commands.filter((command) => command.action === 'edit');
    assert.equal(edits.length, 2);
    assert.deepEqual(edits[0], edits[1]);
    assert.equal((await views())[0].revision, 2);
    assert.equal(
      inventoryRows(),
      initialInventory,
      'Proposal review must not change stock or inventory history',
    );
    await page.screenshot({ path: join(packet, 'a8-desktop.png'), fullPage: true });
    const balance = db
      .prepare('SELECT version FROM inventory_balances_exact WHERE company_id=? AND product_id=?')
      .get(companyId, productId);
    await ok('/api/inventory', {
      action: 'countExact',
      companyId,
      productId,
      operationId: crypto.randomUUID(),
      expectedVersion: balance.version,
      amount: '11',
      unitId: 'mL',
      effectiveAt: new Date().toISOString(),
      note: 'Fictional source change for browser verification',
    });
    const countedInventory = inventoryRows();
    await saved.getByRole('button', { name: 'Load saved reviews', exact: true }).click();
    await saved.getByText('Source check: inventory_changed.', { exact: true }).waitFor();
    assert.equal(await saved.getByLabel('Whole packs', { exact: true }).count(), 0);
    const stockStale = (await views())[0];
    assert.equal(stockStale.revision, 3);
    assert.equal(stockStale.invalidationReason, 'inventory_changed');
    await saved.getByRole('button', { name: 'Load saved reviews', exact: true }).click();
    assert.equal(
      (await views())[0].revision,
      3,
      'Repeated reads must preserve the same invalidation event',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.screenshot({ path: join(packet, 'a8-phone.png'), fullPage: true });
    await saved
      .getByLabel('Reason for cancellation', { exact: true })
      .fill('Replace the stale fictional stock review');
    await saved.getByRole('button', { name: 'Cancel stale review', exact: true }).click();
    await saved.getByRole('status').filter({ hasText: 'Review canceled.' }).waitFor();
    assert.equal(
      (await views()).find((view) => view.origin.id === first.origin.id).status,
      'canceled',
    );
    await create.click();
    await saved.getByRole('status').filter({ hasText: 'Review saved.' }).waitFor();
    assert.equal(originCount(), 2);
    const current = (await views()).find((view) => view.status !== 'canceled');
    assert.equal(current.revision, 1);
    const old = Date.now() - 11 * 60000;
    db.prepare('UPDATE clover_sync_state SET checkpoint=?,last_success=? WHERE company_id=?').run(
      old,
      new Date(old).toISOString(),
      companyId,
    );
    await saved.getByRole('button', { name: 'Load saved reviews', exact: true }).click();
    await saved.getByText('Source check: source_unavailable.', { exact: true }).waitFor();
    await create.click();
    await saved.getByRole('alert').waitFor();
    assert.equal(originCount(), 2, 'Stale sales must prevent a new origin');
    const salesStale = (await views()).find((view) => view.origin.id === current.origin.id);
    assert.equal(salesStale.status, 'review_required');
    assert.equal(salesStale.invalidationReason, 'source_unavailable');
    await saved
      .getByLabel('Reason for cancellation', { exact: true })
      .fill('Cancel the stale fictional sales review');
    await saved.getByRole('button', { name: 'Cancel stale review', exact: true }).click();
    await saved.getByRole('status').filter({ hasText: 'Review canceled.' }).waitFor();
    assert.ok((await views()).every((view) => view.status === 'canceled'));
    assert.equal(
      inventoryRows(),
      countedInventory,
      'Only the explicit physical count may change inventory',
    );
    role('employee');
    assert.equal((await request(proposalsPath)).status, 403);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(
      origin + '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?company=' + companyId),
    );
    await page
      .getByRole('heading', { name: 'Company inventory, recipes & sales', exact: true })
      .waitFor();
    assert.equal(await page.locator('summary').filter({ hasText: 'Clover review' }).count(), 0);
    assert.equal(
      await page.getByRole('heading', { name: 'Saved review proposals', exact: true }).count(),
      0,
    );
    role('owner');
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
    assert.ok(changes.every((path) => path === '/api/replenishment/proposals'));
    Object.assign(facts, {
      passed: true,
      anonymousRefused: true,
      wrongCompanyRefused: true,
      employeeRefused: true,
      employeeUiHidden: true,
      calculationDisplayed: true,
      lostCreateReplyReplayedOnce: true,
      lostEditReplyReplayedOnce: true,
      keyboardActivation: true,
      stockChangeInvalidatesOnce: true,
      staleSalesBlockCreation: true,
      staleReviewsCanBeCanceled: true,
      phone390NoOverflow: true,
      onlyExplicitCountChangesInventory: true,
      supplierSubmissionDisabled: true,
      externalBrowserRequests: outside.length,
      browserMutationPaths: [...new Set(changes)],
      origins: originCount(),
      proposalPostAttempts: commands.length,
      pageErrors: errors,
    });
  } catch (error) {
    facts.failure = error.message;
    if (context)
      for (const page of context.pages())
        await page
          .screenshot({ path: join(packet, 'failure.png'), fullPage: true })
          .catch(() => {});
    failure = error;
  } finally {
    const cleanup = [];
    for (const close of [
      () => db && actor && role('owner'),
      () => context?.close(),
      () => browser?.close(),
      () => db?.close(),
    ])
      try {
        await close();
      } catch (error) {
        cleanup.push(error);
      }
    facts.resourcesClosed = cleanup.length === 0;
    if (cleanup.length) facts.passed = false;
    writeFileSync(join(packet, 'browser-result.json'), JSON.stringify(facts, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    if (cleanup.length)
      throw new AggregateError(
        [...(failure ? [failure] : []), ...cleanup],
        'A8 browser cleanup failed.',
      );
  }
  if (failure) throw failure;
  return facts;
}
