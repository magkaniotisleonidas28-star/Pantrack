import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { fixture } from './helpers/supplier-simulation.mjs';

// Any network attempt fails the suite: this slice proves local behavior only.
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('Network is not allowed in the Amazon Business fake test.');
};

await build({
  stdin: {
    contents: [
      'amazon-business-cart',
      'fake-amazon-business',
      'po-cart-preparation-contract',
      'd1-purchase-order-drafts',
    ]
      .map((name) => `export * from './src/lib/${name}.ts';`)
      .join('\n'),
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.sites-runtime/amazon-business-cart-test.mjs',
});
const {
  prepareAmazonBusinessCart,
  amazonMinor,
  createFakeAmazonBusiness,
  isFakeAmazonBusiness,
  preparationPreflight,
  D1PurchaseOrderDrafts,
} = await import('../.sites-runtime/amazon-business-cart-test.mjs');

const COFFEE = 'B0DEMOCOF1',
  CUPS = 'B0DEMOCUP2';
const f = await fixture();
try {
  await f.source({ productId: 'coffee' });
  const drafts = new D1PurchaseOrderDrafts(f.db, f.options);
  let order = await drafts.create({
    action: 'create',
    source: 'manual',
    companyId: 'a',
    operationId: randomUUID(),
    supplier: {
      id: 'cart-demo-supplier',
      name: 'Fictional cart',
      email: 'demo@example.invalid',
      accountId: 'DEMO-CART',
      locationId: 'DEMO-CAFE',
      deliveryAddress: 'Fictional counter',
    },
    capMinor: '15000',
    notes: 'Practice only',
    lines: [
      {
        kind: 'stock',
        productId: 'coffee',
        expectedConfigId: 'config-coffee',
        expectedConfigVersion: 1,
        sku: COFFEE,
        description: 'Coffee',
        packs: '2',
        estimatedUnitMinor: '5400',
      },
      {
        kind: 'non_stock',
        sku: CUPS,
        description: 'Cups',
        unitLabel: 'sleeve of 50',
        packs: '3',
        estimatedUnitMinor: '650',
      },
    ],
  });
  const command = {
    companyId: 'a',
    orderId: order.snapshot.id,
    expectedRevision: order.revision,
    operationId: randomUUID(),
  };
  order = await drafts.review({ ...command, action: 'review', acknowledgeWarnings: true });
  command.expectedRevision = order.revision;
  const preflight = preparationPreflight(command, 'manager', order, {
    companyId: 'a',
    id: 'fictional-connection',
    version: 1,
    supplierId: 'cart-demo-supplier',
    accountId: 'DEMO-CART',
    locationId: 'DEMO-CAFE',
    mode: 'fictional',
    status: 'active',
    paused: false,
  });
  assert.equal(preflight.itemSubtotalMinor, '12750');

  const offers = {
    [COFFEE]: [
      { offerId: 'offer-coffee', amount: 54 },
      { offerId: 'offer-coffee-used', amount: 54, condition: 'USED' },
      { offerId: 'offer-coffee-dear', amount: 61.25 },
    ],
    [CUPS]: [{ offerId: 'offer-cups', amount: 6.5, maxQuantity: 10 }],
  };
  const run = async (fake, extra = {}) => {
    const attempts = [];
    const outcome = await prepareAmazonBusinessCart(preflight, fake, {
      cartType: 'DEFAULT',
      beforeWrite: async (attempt) => {
        // The planned write is persisted before the add-items request is sent.
        assert.equal(
          fake.requests.filter((r) => r.method === 'POST').length,
          0,
          'beforeWrite runs before any write',
        );
        attempts.push(attempt);
      },
      ...extra,
    });
    for (const r of fake.requests) {
      assert.ok(['GET', 'POST'].includes(r.method));
      assert.match(r.path, /^\/(cart\/2025-04-30\/carts|products\/2020-08-26\/products\/)/);
      assert.doesNotMatch(r.path, /order/i);
    }
    return { outcome, attempts, posts: fake.requests.filter((r) => r.method === 'POST') };
  };

  // Normal: exact ASINs, offers, quantities and reviewed prices; one write.
  const unrelated = { asin: 'B0UNRELATE', offerId: 'offer-other', quantity: 1, amount: 9.99 };
  {
    const fake = createFakeAmazonBusiness({ offers, existing: [unrelated] });
    assert.ok(isFakeAmazonBusiness(fake));
    const { outcome, attempts, posts } = await run(fake);
    assert.equal(outcome.state, 'ready');
    assert.equal(outcome.cartId, 'cart-default');
    assert.equal(outcome.recovered, false);
    assert.ok(Object.isFrozen(outcome) && Object.isFrozen(outcome.entries));
    assert.deepEqual(outcome.entries, [
      { sku: 'B0UNRELATE', unitLabel: 'existing Amazon item', packs: '1', unitMinor: '999' },
      { sku: COFFEE, unitLabel: preflight.lines[0].unitLabel, packs: '2', unitMinor: '5400' },
      { sku: CUPS, unitLabel: 'sleeve of 50', packs: '3', unitMinor: '650' },
    ]);
    assert.deepEqual(
      outcome.lines.map((l) => [l.asin, l.offerId]),
      [
        [COFFEE, 'offer-coffee'],
        [CUPS, 'offer-cups'],
      ],
    );
    assert.equal(attempts.length, 1);
    assert.deepEqual(attempts[0].items, [
      {
        lineId: preflight.lines[0].lineId,
        asin: COFFEE,
        offerId: 'offer-coffee',
        quantity: 2,
        externalId: `${command.operationId}:${preflight.lines[0].lineId}`,
      },
      {
        lineId: preflight.lines[1].lineId,
        asin: CUPS,
        offerId: 'offer-cups',
        quantity: 3,
        externalId: `${command.operationId}:${preflight.lines[1].lineId}`,
      },
    ]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, '/cart/2025-04-30/carts/cart-default/items');
    assert.deepEqual(posts[0].query, { region: 'US' });
    assert.deepEqual(
      posts[0].body.items.map((i) => i.asin),
      [COFFEE, CUPS],
    );
    // No caller-supplied identity, email or credential reaches the request.
    assert.doesNotMatch(JSON.stringify(fake.requests), /manager|@|token|secret/i);
  }

  // The reference documentation's field names parse the same way.
  {
    const { outcome } = await run(createFakeAmazonBusiness({ offers, naming: 'reference' }));
    assert.equal(outcome.state, 'ready');
  }

  // The website cart is chosen only when asked for, and only if exactly one exists.
  {
    const fake = createFakeAmazonBusiness({ offers });
    const { outcome } = await run(fake, { cartType: 'AMAZON_WEBSITE_CART' });
    assert.equal(outcome.cartId, 'cart-website');
    for (const carts of [
      [],
      [
        { id: 'one', cartType: 'DEFAULT' },
        { id: 'two', cartType: 'DEFAULT' },
      ],
    ]) {
      const twice = createFakeAmazonBusiness({ offers, carts });
      const held = await run(twice);
      assert.deepEqual(
        { ...held.outcome },
        {
          state: 'review_needed',
          reason: 'session_unavailable',
          detail: 'Expected one DEFAULT cart.',
        },
      );
      assert.equal(held.posts.length, 0);
    }
  }

  const held = async (options, reason, detail, posts) => {
    const fake = createFakeAmazonBusiness({ offers, ...options });
    const result = await run(fake);
    assert.deepEqual({ ...result.outcome }, { state: 'review_needed', reason, detail });
    assert.equal(result.posts.length, posts, `${detail}: write count`);
    return result;
  };

  // Holds before any write: requested item already present, offer choice, cap, access.
  await held(
    { existing: [{ asin: CUPS, offerId: 'offer-cups', quantity: 1, amount: 6.5 }] },
    'changed_product',
    'requested_sku_present',
    0,
  );
  await held(
    { offers: { ...offers, [COFFEE]: [{ offerId: 'offer-coffee', amount: 55 }] } },
    'changed_product',
    'no_offer_at_reviewed_price_and_quantity',
    0,
  );
  await held(
    {
      offers: {
        ...offers,
        [COFFEE]: [
          { offerId: 'a', amount: 54 },
          { offerId: 'b', amount: 54 },
        ],
      },
    },
    'changed_product',
    'ambiguous_offer',
    0,
  );
  await held(
    { offers: { ...offers, [CUPS]: [{ offerId: 'offer-cups', amount: 6.5, maxQuantity: 2 }] } },
    'changed_product',
    'no_offer_at_reviewed_price_and_quantity',
    0,
  );
  await held(
    { existing: [{ ...unrelated, amount: 22.51 }] },
    'verification_failed',
    'cap_exceeded',
    0,
  );
  await held(
    { scenario: 'unauthorized' },
    'sign_in_required',
    'Amazon Business access needs renewal.',
    0,
  );
  await held(
    { scenario: 'malformed' },
    'verification_failed',
    'Unexpected Amazon Business response.',
    0,
  );

  // Definite refusals after one write attempt; never retried.
  await held({ scenario: 'rejected' }, 'changed_product', 'rejected_items', 1);
  await held(
    { scenario: 'throttled' },
    'session_unavailable',
    'Amazon Business is throttling requests.',
    1,
  );
  await held({ scenario: 'price_changed' }, 'changed_product', 'cart_mismatch', 1);
  await held({ scenario: 'unavailable' }, 'changed_product', 'item_unavailable', 1);

  // Uncertain writes: read back once, accept only an exact cart, never resend.
  {
    const fake = createFakeAmazonBusiness({ offers, scenario: 'lost_response' });
    const { outcome, posts } = await run(fake);
    assert.equal(outcome.state, 'ready');
    assert.equal(outcome.recovered, true);
    assert.equal(posts.length, 1);
  }
  await held({ scenario: 'timeout_before_write' }, 'uncertain_write', 'incomplete_cart', 1);

  // A failed write record prevents the call.
  {
    const fake = createFakeAmazonBusiness({ offers });
    await assert.rejects(
      prepareAmazonBusinessCart(preflight, fake, {
        cartType: 'DEFAULT',
        beforeWrite: async () => {
          throw new Error('Attempt record unavailable.');
        },
      }),
      /Attempt record unavailable/,
    );
    assert.equal(fake.requests.filter((r) => r.method === 'POST').length, 0);
  }

  // Only the registered fake is accepted; a look-alike transport is never called.
  {
    let sent = 0;
    const lookalike = Object.freeze({
      send: async () => {
        sent++;
        return { status: 200, body: {} };
      },
    });
    assert.equal(isFakeAmazonBusiness(lookalike), false);
    await assert.rejects(
      prepareAmazonBusinessCart(preflight, lookalike, {
        cartType: 'DEFAULT',
        beforeWrite: async () => {},
      }),
      (e) => e.code === 'real_disabled',
    );
    assert.equal(sent, 0);
  }

  // Mapping guards run before any request.
  for (const changed of [
    { ...preflight, lines: [{ ...preflight.lines[0], sku: 'DEMO-COFFEE' }] },
    { ...preflight, mode: 'real' },
  ]) {
    const fake = createFakeAmazonBusiness({ offers });
    await assert.rejects(
      prepareAmazonBusinessCart(changed, fake, {
        cartType: 'DEFAULT',
        beforeWrite: async () => {},
      }),
      (e) => ['source_changed', 'real_disabled'].includes(e.code),
    );
    assert.equal(fake.requests.length, 0);
  }

  // Prices convert only from exact USD dollars-and-cents.
  for (const [value, minor] of [
    [{ amount: 54, currencyCode: 'USD' }, '5400'],
    [{ amount: 6.5, currencyCode: 'USD' }, '650'],
    [{ amount: 12.45, currencyCode: 'USD' }, '1245'],
    [{ amount: 0, currencyCode: 'USD' }, '0'],
    [{ amount: 0.1 + 0.2, currencyCode: 'USD' }, null],
    [{ amount: 1.005, currencyCode: 'USD' }, null],
    [{ amount: 1e21, currencyCode: 'USD' }, null],
    [{ amount: -1, currencyCode: 'USD' }, null],
    [{ amount: Number.NaN, currencyCode: 'USD' }, null],
    [{ amount: 5, currencyCode: 'EUR' }, null],
  ])
    assert.equal(amazonMinor(value), minor, JSON.stringify(value));

  assert.equal(networkCalls, 0);
  console.log(
    'PASS: Amazon Business fake cart preparation: exact offers and read-back, cap and holds before writes, one never-retried write, uncertain-write recovery, fake-only transport and no ordering or network.',
  );
} finally {
  f.sql.close();
}
