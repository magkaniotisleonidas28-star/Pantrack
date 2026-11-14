import { z } from 'zod';
import type { CartEntry } from './cart-preview-contract';
import { checkBrowserCart } from './po-cart-browser-contract';
import { CartPreparationError, type PreparationPreflight } from './po-cart-preparation-contract';
import { frozenCopy } from './supplier-simulation-contract';
import { isFakeAmazonBusiness } from './fake-amazon-business';

export type AmazonBusinessRequest = Readonly<{
  method: 'GET' | 'POST';
  path: string;
  query: Readonly<Record<string, string>>;
  body?: unknown;
}>;

export type AmazonBusinessResponse = Readonly<{ status: number; body: unknown }>;

/** Authentication, the user-email header and the host belong to the transport, never to callers. */
export type AmazonBusinessTransport = Readonly<{
  send(request: AmazonBusinessRequest): Promise<AmazonBusinessResponse>;
}>;

export type AmazonCartHoldReason =
  | 'sign_in_required'
  | 'changed_product'
  | 'uncertain_write'
  | 'verification_failed'
  | 'session_unavailable';

export type AmazonCartAttempt = Readonly<{
  cartId: string;
  items: readonly Readonly<{
    lineId: string;
    asin: string;
    offerId: string;
    quantity: number;
    externalId: string;
  }>[];
}>;

export type AmazonCartOutcome =
  | Readonly<{
      state: 'ready';
      cartId: string;
      recovered: boolean;
      entries: readonly CartEntry[];
      lines: readonly Readonly<{ lineId: string; asin: string; offerId: string; itemId: string }>[];
    }>
  | Readonly<{ state: 'review_needed'; reason: AmazonCartHoldReason; detail: string }>;

const CARTS = '/cart/2025-04-30/carts';
const PRODUCTS = '/products/2020-08-26/products';
const ASIN = /^[A-Z0-9]{10}$/;
// Amazon carts carry no pack label. The reviewed mapping pins the ASIN, so the
// line's label is attached locally; unrelated items get this placeholder.
const UNRELATED_LABEL = 'existing Amazon item';

// Cart, item-list and offer reads plus add-items are the only permitted calls.
// Ordering, modify, delete and cost estimation stay unreachable here.
const allowed: readonly Readonly<{ method: AmazonBusinessRequest['method']; path: RegExp }>[] = [
  { method: 'GET', path: /^\/cart\/2025-04-30\/carts$/ },
  { method: 'GET', path: /^\/cart\/2025-04-30\/carts\/[^/]+\/items$/ },
  { method: 'POST', path: /^\/cart\/2025-04-30\/carts\/[^/]+\/items$/ },
  { method: 'GET', path: /^\/products\/2020-08-26\/products\/[A-Z0-9]{10}\/offers$/ },
];

const amount = z.object({ amount: z.number(), currencyCode: z.string() });
const cartList = z.object({
  cartDetailsList: z.array(z.object({ id: z.string().min(1).max(200), cartType: z.string() })),
});
const offerList = z.object({
  offers: z
    .array(
      z.object({
        offerId: z.string().min(1).max(2000),
        condition: z.object({ conditionValue: z.string() }),
        price: z.object({ value: amount }),
        quantityLimits: z.object({ minQuantity: z.number().int(), maxQuantity: z.number().int() }),
      }),
    )
    .max(100),
});
// The overview names productIdentifier/buyingOptionIdentifier; the static sandbox
// returns asin/offerId. Accept exactly one spelling per field.
const cartItem = z
  .object({
    itemId: z.string().min(1).max(200),
    asin: z.string().optional(),
    productIdentifier: z.string().optional(),
    offerId: z.string().optional(),
    buyingOptionIdentifier: z.string().optional(),
    quantity: z.number().int().positive().max(999_999_999),
    isItemAvailable: z.boolean(),
    price: amount,
  })
  .transform((item, ctx) => {
    const asin = item.asin ?? item.productIdentifier;
    const offerId = item.offerId ?? item.buyingOptionIdentifier;
    if (
      (item.asin !== undefined && item.productIdentifier !== undefined) ||
      (item.offerId !== undefined && item.buyingOptionIdentifier !== undefined) ||
      !asin ||
      !offerId
    ) {
      ctx.addIssue({ code: 'custom', message: 'Ambiguous cart item identity.' });
      return z.NEVER;
    }
    return {
      itemId: item.itemId,
      asin,
      offerId,
      quantity: item.quantity,
      price: item.price,
      available: item.isItemAvailable,
    };
  });
const itemList = z.object({ items: z.array(cartItem).max(200) });
const addResult = itemList.extend({ rejectedItems: z.array(z.unknown()).max(200) });

class Hold extends Error {
  constructor(
    readonly reason: AmazonCartHoldReason,
    readonly detail: string,
    /** The request may have been applied even though no usable reply arrived. */
    readonly uncertain = false,
  ) {
    super(detail);
  }
}

/** Exact decimal dollars to integer cents; anything else is not a price we can compare. */
export function amazonMinor(value: { amount: number; currencyCode: string }): string | null {
  if (value.currencyCode !== 'USD' || !Number.isFinite(value.amount) || value.amount < 0)
    return null;
  const text = String(value.amount).match(/^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/);
  if (!text) return null;
  return String(BigInt(text[1]) * BigInt(100) + BigInt((text[2] ?? '').padEnd(2, '0')));
}

async function call<T>(
  transport: AmazonBusinessTransport,
  request: AmazonBusinessRequest,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  if (!allowed.some((a) => a.method === request.method && a.path.test(request.path)))
    throw new Error('Amazon Business request is outside the cart-preparation allowlist.');
  const response = await transport.send(frozenCopy(request));
  if (response.status === 401 || response.status === 403)
    throw new Hold('sign_in_required', 'Amazon Business access needs renewal.');
  if (response.status === 429)
    throw new Hold('session_unavailable', 'Amazon Business is throttling requests.');
  if (response.status >= 500)
    throw new Hold('session_unavailable', `Amazon Business returned ${response.status}.`, true);
  if (response.status !== 200)
    throw new Hold('verification_failed', `Amazon Business returned ${response.status}.`);
  const parsed = schema.safeParse(response.body);
  if (!parsed.success)
    throw new Hold('verification_failed', 'Unexpected Amazon Business response.', true);
  return parsed.data;
}

type Line = PreparationPreflight['lines'][number];
type Item = z.infer<typeof cartItem>;

function entries(items: readonly Item[], lines: readonly Line[]): CartEntry[] {
  return items.map((item) => {
    const unitMinor = amazonMinor(item.price);
    if (unitMinor === null) throw new Hold('verification_failed', 'Unreadable cart price.');
    return {
      sku: item.asin,
      unitLabel: lines.find((l) => l.sku === item.asin)?.unitLabel ?? UNRELATED_LABEL,
      packs: String(item.quantity),
      unitMinor,
    };
  });
}

/**
 * Fills one Amazon Business cart from an authorized fictional preflight, then
 * reads it back and applies the browser worker's verification and cap. It never
 * orders, retries a write, or changes existing cart items. Only the registered
 * fake transport is accepted until a sandbox gate records evidence.
 */
export async function prepareAmazonBusinessCart(
  preflight: PreparationPreflight,
  transport: AmazonBusinessTransport,
  options: {
    cartType: 'DEFAULT' | 'AMAZON_WEBSITE_CART';
    /** Persist the exact planned write; a throw here prevents the call. */
    beforeWrite(attempt: AmazonCartAttempt): Promise<void>;
  },
): Promise<AmazonCartOutcome> {
  if (!isFakeAmazonBusiness(transport))
    throw new CartPreparationError(
      'real_disabled',
      'Only the local Amazon Business fake is enabled.',
    );
  if (preflight.mode !== 'fictional' || preflight.currency !== 'USD')
    throw new CartPreparationError('real_disabled', 'Only fictional USD preparation is enabled.');
  if (preflight.lines.some((l) => !ASIN.test(l.sku)))
    throw new CartPreparationError(
      'source_changed',
      'Each Amazon Business line needs an ASIN SKU.',
    );
  try {
    const carts = (
      await call(transport, { method: 'GET', path: CARTS, query: { region: 'US' } }, cartList)
    ).cartDetailsList.filter((c) => c.cartType === options.cartType);
    if (carts.length !== 1)
      throw new Hold('session_unavailable', `Expected one ${options.cartType} cart.`);
    const cartId = carts[0].id;
    const items = `${CARTS}/${encodeURIComponent(cartId)}/items`;
    const read = async () =>
      (await call(transport, { method: 'GET', path: items, query: { region: 'US' } }, itemList))
        .items;

    const before = await read();
    const baseline = entries(before, []);
    const baselineCheck = checkBrowserCart('baseline', baseline, preflight);
    if (baselineCheck !== 'verified') throw new Hold('changed_product', baselineCheck);

    // Choose every offer before writing, so a later line cannot leave a partial cart.
    const planned = [];
    for (const line of preflight.lines) {
      const { offers } = await call(
        transport,
        {
          method: 'GET',
          path: `${PRODUCTS}/${line.sku}/offers`,
          query: { productRegion: 'US', locale: 'en_US', pageNumber: '1', pageSize: '20' },
        },
        offerList,
      );
      const packs = Number(line.packs);
      const matches = offers.filter(
        (o) =>
          o.condition.conditionValue === 'NEW' &&
          amazonMinor(o.price.value) === line.unitMinor &&
          o.quantityLimits.minQuantity <= packs &&
          packs <= o.quantityLimits.maxQuantity,
      );
      if (matches.length !== 1)
        throw new Hold(
          'changed_product',
          matches.length ? 'ambiguous_offer' : 'no_offer_at_reviewed_price_and_quantity',
        );
      planned.push({
        lineId: line.lineId,
        asin: line.sku,
        offerId: matches[0].offerId,
        quantity: packs,
        externalId: `${preflight.request.operationId}:${line.lineId}`,
      });
    }
    // The cap bounds the complete cart, so check it before any write as well as after.
    // Each chosen offer equals its reviewed unit price, so the planned total is the subtotal.
    const exposure = baseline.reduce(
      (n, e) => n + BigInt(e.packs) * BigInt(e.unitMinor),
      BigInt(preflight.itemSubtotalMinor),
    );
    if (exposure > BigInt(preflight.capMinor))
      throw new Hold('verification_failed', 'cap_exceeded');
    const attempt = frozenCopy({ cartId, items: planned });
    await options.beforeWrite(attempt);

    let recovered = false;
    try {
      const added = await call(
        transport,
        {
          method: 'POST',
          path: items,
          query: { region: 'US' },
          body: {
            items: planned.map(({ asin, offerId, quantity, externalId }) => ({
              asin,
              offerId,
              quantity,
              externalId,
            })),
          },
        },
        addResult,
      );
      if (added.rejectedItems.length) throw new Hold('changed_product', 'rejected_items');
    } catch (error) {
      // A definite refusal is final. A lost, failed or unreadable reply may have
      // written: read back once and accept only an exactly verified cart. Never resend.
      if (error instanceof Hold && !error.uncertain) throw error;
      recovered = true;
    }

    const after = await read().catch((error) => {
      throw recovered && error instanceof Hold
        ? new Hold('uncertain_write', 'Cart could not be read after an uncertain write.')
        : error;
    });
    const final = entries(after, preflight.lines);
    const finalCheck = checkBrowserCart('final', final, preflight, baseline);
    const unavailable = after.some(
      (item) => !item.available && preflight.lines.some((l) => l.sku === item.asin),
    );
    if (finalCheck !== 'verified' || unavailable)
      throw new Hold(
        recovered
          ? 'uncertain_write'
          : finalCheck === 'cap_exceeded'
            ? 'verification_failed'
            : 'changed_product',
        unavailable ? 'item_unavailable' : finalCheck,
      );
    return frozenCopy({
      state: 'ready',
      cartId,
      recovered,
      entries: final,
      lines: planned.map((p) => ({
        lineId: p.lineId,
        asin: p.asin,
        offerId: p.offerId,
        itemId: after.find((i) => i.asin === p.asin)!.itemId,
      })),
    });
  } catch (error) {
    if (error instanceof Hold)
      return frozenCopy({ state: 'review_needed', reason: error.reason, detail: error.detail });
    throw error;
  }
}
