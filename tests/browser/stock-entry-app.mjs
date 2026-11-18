import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

// Run against a fresh local app using fixture sign-in and exact inventory.
const origin = process.argv[2];
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
const signIn = await fetch(origin + '/signin-with-chatgpt?return_to=/', { redirect: 'manual' });
assert.equal(signIn.status, 302);
const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
const companyId = crypto.randomUUID();
async function api(path, body) {
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: { cookie, ...(body ? { origin, 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
await api('/api/companies', {
  action: 'create',
  id: companyId,
  name: 'Fictional stock refactor café',
});
const inventory = async () =>
  (await api('/api/inventory?' + new URLSearchParams({ companyId }))).exact;
const record = async (productId) =>
  (await inventory()).records.find((item) => item.productId === productId);

const evidence = '.sites-runtime/refactor-refresh';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  timezoneId: 'UTC',
});
const requests = [],
  failures = [],
  external = [];
let loseResponse = false,
  committed;
try {
  await context.route('**/*', (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    if (requestOrigin === origin) return route.continue();
    external.push(requestOrigin);
    return route.abort('blockedbyclient');
  });
  await context.route('**/api/inventory', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData());
    requests.push(body);
    if (!loseResponse) return route.continue();
    loseResponse = false;
    try {
      const reply = await route.fetch();
      assert.equal(reply.status(), 200, await reply.text());
      committed = await record(body.productId);
    } catch (error) {
      failures.push(String(error));
    } finally {
      await route.abort('failed');
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(
    origin + '/signin-with-chatgpt?return_to=' + encodeURIComponent('/?company=' + companyId),
  );
  await page.getByRole('button', { name: 'Inventory', exact: true }).first().click();
  const form = page.locator('form.stock-entry');
  const add = () => page.getByRole('button', { name: 'Add stock', exact: true }).click();
  const radio = (name) => form.getByRole('radio', { name, exact: true });
  const button = (name) => form.getByRole('button', { name, exact: true });
  const row = (text) => page.getByRole('row').filter({ hasText: text });
  const catalog = form.getByLabel('Catalog item');
  const mode = form.getByLabel('What would you like to record?');
  const exactContainer = form.getByLabel('Container', { exact: true });
  const contentUnit = form.getByLabel('Unit', { exact: true });
  const start = Date.now() - 86400000;
  let minute = 0;
  async function setTime() {
    const summary = form.locator('summary').filter({ hasText: /^Change time/ });
    if (!(await form.getByLabel('Occurred at').isVisible())) await summary.click();
    // Native datetime-local input normalizes away zero seconds.
    await form
      .getByLabel('Occurred at')
      .fill(new Date(start + minute++ * 60000).toISOString().slice(0, 16));
  }

  await add();
  await radio('New item').check();
  await form.getByLabel('Item name').fill('Fictional heavy cream');
  await form.getByLabel('Item name').blur();
  assert.equal(await exactContainer.inputValue(), 'carton');
  assert.equal(await contentUnit.inputValue(), 'fl_oz_us');
  await form.getByLabel('Amount in one carton').fill('32');
  await form.getByLabel('Full cartons').fill('3');
  await radio('½ left').check();
  assert.match(await form.getByRole('status').innerText(), /112 fl oz/);
  await setTime();
  await button('Save item & stock').click();
  await row('Fictional heavy cream').getByRole('button', { name: 'Update stock' }).waitFor();
  const cream = requests.at(-1);
  assert.equal(cream.openingPackages.remainderUnitId, 'mL');
  assert.equal((await record(cream.productId)).onHand.minor, '3312235311');

  await add();
  await radio('New item').check();
  await form.getByLabel('Item name').fill('Fictional vanilla syrup');
  await form.getByLabel('Item name').blur();
  assert.equal(await exactContainer.inputValue(), 'bottle');
  await form.getByLabel('Amount in one bottle').fill('32');
  await form.getByText('Measured with a pump or scoop?', { exact: false }).click();
  await form.getByLabel('Yes, recipes use a pump, scoop or shot').check();
  await form.getByLabel('Amount in one measure').fill('0.25');
  await form.getByLabel('Full bottles').fill('1');
  await setTime();
  await button('Save item & stock').click();
  await row('Fictional vanilla syrup').getByRole('button', { name: 'Update stock' }).waitFor();
  const syrup = requests.at(-1);
  assert.equal(syrup.stockUnit.label, 'pump');
  assert.equal(syrup.stockUnit.kind, 'custom');

  await add();
  const editor = await form.elementHandle();
  await catalog.selectOption(syrup.productId);
  await mode.selectOption('configure');
  assert.equal(await form.getByLabel('Amount in one measure').inputValue(), '0.25');
  assert.equal(await exactContainer.inputValue(), 'bottle');
  await catalog.selectOption(cream.productId);
  assert.equal(await editor.evaluate((node) => node.isConnected), true);
  assert.equal(await mode.inputValue(), 'receive');
  assert.equal(await form.getByLabel('Cartons received').inputValue(), '');
  await setTime();
  await form.getByLabel('Cartons received').fill('1');
  await page.screenshot({ path: evidence + '/stock-delivery-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await page.screenshot({ path: evidence + '/stock-delivery-phone.png', fullPage: true });
  loseResponse = true;
  await button('Save delivery').click();
  await button('Retry the same stock save').waitFor();
  assert.ok(committed);
  assert.equal(committed.onHand.minor, '4258588257');
  assert.equal(await catalog.isDisabled(), true);
  await button('Retry the same stock save').click();
  await row('Fictional heavy cream').getByRole('button', { name: 'Update stock' }).waitFor();
  assert.deepEqual(requests.at(-1), requests.at(-2));
  assert.equal((await record(cream.productId)).version, committed.version);
  assert.equal((await record(cream.productId)).onHand.minor, committed.onHand.minor);
  assert.deepEqual(external, []);
  assert.deepEqual(failures, []);
  console.log(
    'PASS: served app guesses containers, opens a fractional count, configures a pump, switches in one editor, and retries a committed delivery exactly once.',
  );
} finally {
  await context.close();
  await browser.close();
}
