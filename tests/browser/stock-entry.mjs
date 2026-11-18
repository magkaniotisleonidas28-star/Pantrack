import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({
  entryPoints: ['tests/browser/stock-entry-fixture.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
});
const browser = await chromium.launch();
const value = (page, name) => page.getByLabel(name).inputValue();
const choose = (page, id) => page.getByLabel('Catalog item').selectOption(id);
const action = (page, next) => page.getByLabel('What would you like to record?').selectOption(next);
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const radio = (page, name) => page.getByRole('radio', { name, exact: true });
const unload = (page) =>
  page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
const requests = (page) => page.evaluate(() => window.stockFixture.requests);
const pack = async (page) => [
  await page.getByLabel('Container', { exact: true }).inputValue(),
  await value(page, /^Amount in one (?!measure)/),
  await page.getByLabel('Unit', { exact: true }).inputValue(),
];
async function scenario(name, initial, system, check) {
  const context = await browser.newContext({ timezoneId: 'UTC' });
  try {
    await context.route('**/*', (route) =>
      route.request().url() === 'http://127.0.0.1/'
        ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })
        : route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(([id, units]) => window.stockFixture.render(id, units), [initial, system]);
    const editor = await page.locator('form.stock-entry').elementHandle();
    await check(page);
    assert.equal(await editor.evaluate((form) => form.isConnected), true);
    await page.evaluate(() => window.stockFixture.unmount());
    assert.equal(await unload(page), false);
    assert.equal(await page.evaluate(() => window.stockFixture.dirty), false);
    assert.deepEqual(errors, []);
    console.log('PASS: ' + name);
  } finally {
    await context.close();
  }
}
try {
  for (const [system, everyday] of [
    ['us', 'fl_oz_us'],
    ['metric', 'mL'],
  ]) {
    await scenario(
      system + ' guess on initial mount and actual selection',
      'cream',
      system,
      async (page) => {
        assert.deepEqual(await pack(page), ['carton', '', everyday]);
        await page.getByLabel('Amount in one carton').fill('32');
        await page.getByLabel('Full cartons').fill('3');
        await radio(page, '½ left').check();
        await radio(page, 'Exact total (' + (system === 'us' ? 'fl oz' : 'mL') + ')').check();
        await page.getByLabel('Total on hand').fill('12');
        await choose(page, 'milk');
        assert.equal(await value(page, 'What would you like to record?'), 'receive');
        assert.equal(await value(page, 'Bottles received'), '');
        await choose(page, 'cream');
        assert.deepEqual(await pack(page), ['carton', '', everyday]);
        assert.equal(await radio(page, 'Cartons').isChecked(), true);
        assert.equal(await radio(page, 'None').isChecked(), true);
        await radio(page, 'Exact total (' + (system === 'us' ? 'fl oz' : 'mL') + ')').check();
        assert.equal(await value(page, 'Total on hand'), '');
        await radio(page, 'New item').check();
        assert.deepEqual(await pack(page), ['', '', '']);
        await page.getByLabel('Item name').fill('Fictional vanilla syrup');
        await page.getByLabel('Item name').blur();
        assert.deepEqual(await pack(page), ['bottle', '', everyday]);
        await page.getByLabel('Container', { exact: true }).fill('jug');
        await page.getByLabel('Item name').fill('Fictional heavy cream');
        await page.getByLabel('Item name').blur();
        assert.deepEqual(await pack(page), ['jug', '', everyday]);
        await radio(page, 'Existing item').check();
        await choose(page, 'legacy');
        await action(page, 'configure');
        assert.deepEqual(await pack(page), ['sack', '6', 'g']);
        assert.equal(await value(page, 'In recipes, measure it in'), 'kg');
        await choose(page, 'missing');
        await action(page, 'configure');
        assert.deepEqual(await pack(page), ['', '', 'g']);
      },
    );
  }
  await scenario(
    'custom round trip keeps exact conversion and editor unit',
    'flour',
    'us',
    async (page) => {
      await action(page, 'configure');
      const initial = await pack(page);
      assert.deepEqual(initial.slice(0, 2), ['bag', '2.4000']);
      assert.notEqual(initial[2], 'stored-scoop');
      assert.equal(await value(page, 'Measure name'), 'scoop');
      assert.equal(await value(page, 'Amount in one measure'), '0.088');
      await page.getByLabel('Amount in one measure').fill('0.1');
      await choose(page, 'milk');
      await choose(page, 'flour');
      await action(page, 'configure');
      assert.deepEqual(await pack(page), initial);
      assert.equal(await value(page, 'Amount in one measure'), '0.088');
      await click(page, 'Save changes');
      await page.getByRole('button', { name: 'Refresh stock list' }).waitFor();
      const [saved] = await requests(page);
      assert.deepEqual(saved.stockUnit, {
        kind: 'custom',
        id: initial[2],
        label: 'scoop',
        dimension: 'mass',
        numerator: '5',
        denominator: '2',
      });
      assert.equal(saved.purchaseContentUnitId, initial[2]);
      assert.equal(saved.purchaseAmount, '2.4000');
      assert.equal(saved.expectedConfigId, 'flour-config');
      assert.equal('openingPackages' in saved, false);
    },
  );
  await scenario(
    'fraction, exact remainder, and pending retry after actual selection',
    'milk',
    'metric',
    async (page) => {
      await page
        .locator('summary')
        .filter({ hasText: /^Change time/ })
        .click();
      await page.getByLabel('Occurred at').fill('2026-01-02T12:34');
      await page.getByLabel('Note (optional)').fill('Fictional retained note');
      await page.getByLabel('This delivery was already recorded as incoming').check();
      await choose(page, 'flour');
      assert.equal(
        await page.getByLabel('This delivery was already recorded as incoming').isChecked(),
        false,
      );
      await action(page, 'count');
      await page.getByLabel('Full bags').fill('2');
      await radio(page, '¾ left').check();
      assert.match(await page.getByRole('status').innerText(), /New physical total: 16.5 g/);
      await radio(page, 'Exact amount').check();
      await page.getByLabel('Left in the open bag (g)').fill('1.25');
      assert.match(await page.getByRole('status').innerText(), /New physical total: 13.25 g/);
      await radio(page, '¾ left').check();
      await page.evaluate(() => {
        window.stockFixture.responses = [503, 200];
      });
      await click(page, 'Save physical count');
      await page.getByRole('button', { name: 'Retry the same stock save' }).waitFor();
      assert.equal(await unload(page), true);
      assert.equal(await page.getByLabel('Catalog item').isDisabled(), true);
      await page.evaluate(() => window.stockFixture.render('milk', 'metric', 99));
      await click(page, 'Retry the same stock save');
      await page.getByRole('button', { name: 'Refresh stock list' }).waitFor();
      const [first, second] = await requests(page);
      assert.deepEqual(second, first);
      assert.equal(first.companyId, 'fictional-company');
      assert.equal(first.productId, 'flour');
      assert.equal(first.configId, 'flour-config');
      assert.equal(first.expectedVersion, 7);
      assert.equal(first.effectiveAt, '2026-01-02T12:34:00.000Z');
      assert.equal(first.note, 'Fictional retained note');
      assert.deepEqual(first.quantity, { packages: '2', remainder: '4.5', remainderUnitId: 'g' });
      assert.equal(await unload(page), false);
    },
  );
} finally {
  await browser.close();
}
