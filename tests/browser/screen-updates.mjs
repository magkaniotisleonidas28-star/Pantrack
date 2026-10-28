import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

// Explicit local component checks, separate from the portable default suite.
// Only a fresh owned browser, inline HTML, fake fetch and denied network are used.
const result = await build({
  entryPoints: ['tests/browser/screen-update-fixture.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'empty' },
});
const selected = process.argv.slice(2);
assert.ok(
  selected.every((name) =>
    [
      'clock',
      'weekly-retry',
      'members-race',
      'theme-hydration',
      'theme-storage-denied',
      'menu-recovery',
      'ingredient-recovery',
      'delivery-input',
      'archive-race',
      'limits-edit-race',
      'payments-race',
      'payments-return',
      'cart-recovery',
      'cart-polling',
    ].includes(name),
  ),
  'Unknown component scenario',
);
const browser = await chromium.launch({ headless: true });
try {
  for (const name of selected.length
    ? selected
    : [
        'clock',
        'weekly-retry',
        'members-race',
        'theme-hydration',
        'theme-storage-denied',
        'menu-recovery',
        'ingredient-recovery',
        'delivery-input',
        'archive-race',
        'limits-edit-race',
        'payments-race',
        'payments-return',
        'cart-recovery',
        'cart-polling',
      ]) {
    const context = await browser.newContext();
    await context.route('**/*', (route) =>
      route.request().url() === 'http://127.0.0.1/'
        ? route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body><div id="root"></div></body></html>',
          })
        : route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.goto('http://127.0.0.1/');
    if (name === 'clock' || name === 'cart-polling')
      await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    if (name === 'cart-polling') {
      await page.evaluate(() => window.mountPollingCart());
      const initial = await page.evaluate(() => window.cartPollRequests);
      await page.clock.fastForward(2000);
      await page.evaluate(() => window.flushScreen());
      assert.ok(
        (await page.evaluate(() => window.cartPollRequests)) > initial,
        'Queued jobs continue polling',
      );
      await page.evaluate(() => {
        window.cartPollState = 'canceled';
      });
      await page.clock.fastForward(2000);
      await page.evaluate(() => window.flushScreen());
      assert.match(await page.locator('body').innerText(), /Preparation canceled/);
      const stopped = await page.evaluate(() => window.cartPollRequests);
      await page.clock.fastForward(6000);
      await page.evaluate(() => window.flushScreen());
      assert.equal(
        await page.evaluate(() => window.cartPollRequests),
        stopped,
        'Canceled jobs release their polling timer',
      );
      console.log(
        'PASS: actual React cart polls active work and releases its timer after cancellation.',
      );
    } else if (name === 'limits-edit-race') {
      await page.evaluate(() => window.mountLimits());
      await page.evaluate(() => window.resolveLimits(10000));
      assert.ok(
        (await page.evaluate(() => window.screenRequests.length)) >= 3,
        'Background refresh starts after initial data',
      );
      const input = page.getByRole('textbox', { name: /^Per order/ });
      await input.fill('12');
      await page.evaluate(() => window.resolveLimits(5000));
      assert.equal(
        await input.inputValue(),
        '12',
        'Late background limits must not overwrite a typed edit',
      );
      console.log('PASS: actual React spending limits protect edits from an outstanding refresh.');
    } else if (name === 'payments-race') {
      await page.evaluate(() => window.mountPayments('first'));
      await page.evaluate(() => window.mountPayments('second'));
      await page.evaluate(() => window.resolvePayments('second'));
      await page.evaluate(() => window.resolvePayments('first'));
      assert.match(await page.locator('body').innerText(), /2222/);
      assert.doesNotMatch(await page.locator('body').innerText(), /1111/);
      console.log('PASS: actual React payment reads reject an obsolete company response.');
    } else if (name === 'payments-return') {
      await page.evaluate(() =>
        history.replaceState(
          null,
          '',
          '/?company=second&payment_setup=success&session_id=fictional-session',
        ),
      );
      await page.evaluate(() => window.mountPayments('second'));
      await page.evaluate(() => window.resolvePayments('second'));
      assert.match(await page.locator('body').innerText(), /Card saved securely/);
      const posts = await page.evaluate(() => window.screenPosts);
      assert.ok(posts.length >= 1);
      assert.ok(
        posts.every(
          (body) =>
            body.action === 'verify' &&
            body.companyId === 'second' &&
            body.sessionId === 'fictional-session',
        ),
      );
      assert.doesNotMatch(page.url(), /session_id|payment_setup/);
      console.log(
        'PASS: actual React payment return verifies the bound session and removes callback parameters.',
      );
    } else if (name === 'cart-recovery') {
      await page.evaluate(() => window.mountDurableRecovery());
      await page.evaluate(() => window.clickScreen('Retry saved request'));
      const { posts, body } = await page.evaluate(() => ({
        posts: window.screenPosts,
        body: window.recoveredWasteBody,
      }));
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0], body);
      assert.equal(
        await page.getByRole('button', { name: 'Retry saved request', exact: true }).isVisible(),
        true,
      );
      console.log(
        'PASS: actual React cart recovery sends the original saved operation and retains uncertain retry.',
      );
    } else if (name === 'delivery-input') {
      await page.evaluate(() => window.mountDelivery('first'));
      const received = page.getByRole('textbox', { name: 'Packs received of Milk', exact: true });
      await received.fill('12');
      await page.evaluate(() => window.mountDelivery('first'));
      assert.equal(await received.inputValue(), '12', 'Equivalent parent data keeps a typed count');
      await page.evaluate(() => window.mountDelivery('second'));
      assert.equal(
        await received.inputValue(),
        '',
        'Another confirmation starts with a blank count',
      );
      console.log(
        'PASS: actual React delivery fields retain edits and reset for another confirmation.',
      );
    } else if (name === 'archive-race') {
      await page.evaluate(() => window.mountArchive('first'));
      await page.evaluate(() => window.mountArchive('second'));
      assert.equal(await page.evaluate(() => window.archiveAborted('first')), true);
      await page.evaluate(() => window.resolveArchive('second'));
      assert.match(await page.locator('body').innerText(), /No saved copies yet/);
      await page.evaluate(() => window.resolveArchive('first', true));
      assert.doesNotMatch(await page.locator('body').innerText(), /could not be read/);
      assert.equal(
        await page.getByRole('button', { name: 'Save PDF copy', exact: true }).isEnabled(),
        true,
      );
      console.log(
        'PASS: actual React archive switches abort old reads and reject an obsolete failure.',
      );
    } else if (name.endsWith('-recovery')) {
      await page.evaluate(
        (kind) => window.mountRecoveredWaste(kind),
        name === 'menu-recovery' ? 'menu' : 'ingredient',
      );
      await page
        .getByRole('button', { name: 'Retry same save', exact: true })
        .first()
        .waitFor({ state: 'visible' });
      assert.ok(
        await page
          .locator('input,textarea')
          .evaluateAll((nodes) => nodes.some((node) => node.value === 'Keep the original note')),
      );
      await page.evaluate(() => window.clickScreen('Retry same save'));
      const { posts, body } = await page.evaluate(() => ({
        posts: window.screenPosts,
        body: window.recoveredWasteBody,
      }));
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0], body);
      console.log(
        'PASS: actual React restores the original waste fields and operation despite corrupt preferences (' +
          name +
          ').',
      );
    } else if (name.startsWith('theme-')) {
      if (name === 'theme-hydration')
        await page.evaluate(() => localStorage.setItem('pantrack-workspace-theme', 'dark'));
      else
        await page.evaluate(() => {
          Storage.prototype.setItem = () => {
            throw new Error('Fictional blocked storage');
          };
        });
      await page.evaluate((hydrate) => window.mountTheme(hydrate), name === 'theme-hydration');
      const initial = name === 'theme-hydration' ? 'dark' : 'light';
      assert.equal(await page.locator('[data-theme]').getAttribute('data-theme'), initial);
      if (name === 'theme-hydration') {
        assert.match(await page.evaluate(() => window.serverThemeMarkup), /light/);
        assert.deepEqual(await page.evaluate(() => window.hydrationErrors), []);
      }
      await page.evaluate((label) => window.clickScreen(label), initial);
      assert.equal(
        await page.locator('[data-theme]').getAttribute('data-theme'),
        initial === 'dark' ? 'light' : 'dark',
      );
      console.log(
        'PASS: real React theme preserves hydration and toggles with persisted or blocked storage (' +
          name +
          ').',
      );
    } else if (name === 'clock') {
      await page.evaluate(() => window.mountClock());
      const before = Number(await page.locator('[data-clock]').innerText());
      await page.clock.fastForward(1000);
      await page.evaluate(() => window.flushScreen());
      assert.ok(Number(await page.locator('[data-clock]').innerText()) >= before + 1000);
      console.log('PASS: actual React StrictMode clock updates at the deadline.');
    } else if (name === 'weekly-retry') {
      await page.evaluate(() => window.mountWeekly());
      await page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ state: 'visible' });
      await page.evaluate(() => window.clickScreen('Pause'));
      assert.match(await page.locator('body').innerText(), /Retry the same save/);
      await page.evaluate(() => window.clickScreen('Retry the same save'));
      const posts = await page.evaluate(() => window.screenPosts);
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[1], posts[0], 'Uncertain weekly retry keeps the exact operation/body');
      console.log(
        'PASS: real React exposes the uncertain retry and sends the identical weekly operation.',
      );
    } else {
      await page.evaluate(() => window.mountMembers('first'));
      await page.evaluate(() => window.mountMembers('second'));
      await page.evaluate(() => window.resolveMembers('second'));
      assert.match(await page.locator('body').innerText(), /second@example.test/);
      await page.evaluate(() => window.resolveMembers('first'));
      assert.match(
        await page.locator('body').innerText(),
        /second@example.test/,
        'An older company response must not overwrite the current company screen',
      );
      assert.doesNotMatch(await page.locator('body').innerText(), /first@example.test/);
      console.log(
        'PASS: real React StrictMode keeps the current company after reversed fetch completion.',
      );
    }
    assert.deepEqual(pageErrors, [], 'No unhandled component errors');
    await context.close();
  }
} finally {
  await browser.close();
}
