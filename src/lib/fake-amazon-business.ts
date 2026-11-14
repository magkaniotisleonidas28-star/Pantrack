import { frozenCopy } from './supplier-simulation-contract';
import type {
  AmazonBusinessRequest,
  AmazonBusinessResponse,
  AmazonBusinessTransport,
} from './amazon-business-cart';

export type FakeAmazonBusinessScenario =
  | 'normal'
  | 'rejected'
  | 'lost_response'
  | 'timeout_before_write'
  | 'price_changed'
  | 'unavailable'
  | 'unauthorized'
  | 'throttled'
  | 'malformed';

export type FakeAmazonOffer = Readonly<{
  offerId: string;
  amount: number;
  condition?: string;
  minQuantity?: number;
  maxQuantity?: number;
}>;

export type FakeAmazonCartItem = Readonly<{
  asin: string;
  offerId: string;
  quantity: number;
  amount: number;
}>;

export type FakeAmazonBusiness = AmazonBusinessTransport &
  Readonly<{ readonly requests: readonly AmazonBusinessRequest[] }>;

const registered = new WeakSet<object>();

export function isFakeAmazonBusiness(value: unknown): value is FakeAmazonBusiness {
  return value !== null && typeof value === 'object' && registered.has(value);
}

const CARTS = '/cart/2025-04-30/carts';

/**
 * Network-free stand-in shaped like Amazon Business's published static sandbox
 * (Cart 2025-04-30, Product Search 2020-08-26). Only the frozen registry marks
 * it as fake, so a live transport cannot pass as one. It has no Ordering API.
 */
export function createFakeAmazonBusiness(options: {
  scenario?: FakeAmazonBusinessScenario;
  offers: Readonly<Record<string, readonly FakeAmazonOffer[]>>;
  existing?: readonly FakeAmazonCartItem[];
  carts?: readonly Readonly<{ id: string; cartType: string }>[];
  naming?: 'sandbox' | 'reference';
}): FakeAmazonBusiness {
  const fixture = frozenCopy(options);
  const scenario = fixture.scenario ?? 'normal';
  const carts = fixture.carts ?? [
    { id: 'cart-website', cartType: 'AMAZON_WEBSITE_CART' },
    { id: 'cart-default', cartType: 'DEFAULT' },
  ];
  const items = (fixture.existing ?? []).map((item, n) => ({
    ...item,
    itemId: `existing-${n + 1}`,
    available: true,
  }));
  const requests: AmazonBusinessRequest[] = [];
  let added = 0;
  const reply = (status: number, body: unknown): AmazonBusinessResponse =>
    frozenCopy({ status, body });
  const invalid = (message: string) =>
    reply(400, { errors: [{ code: 'INVALID_REQUEST_PARAMETER', message, details: '' }] });
  const view = (item: (typeof items)[number]) => ({
    [fixture.naming === 'reference' ? 'productIdentifier' : 'asin']: item.asin,
    itemId: item.itemId,
    [fixture.naming === 'reference' ? 'buyingOptionIdentifier' : 'offerId']: item.offerId,
    quantity: item.quantity,
    isItemAvailable: item.available,
    price: { currencyCode: 'USD', amount: item.amount },
    addedToCartDate: '2026-11-13T15:00:00.000Z',
    modifiedDate: '2026-11-13T15:00:00.000Z',
  });

  const transport: FakeAmazonBusiness = Object.freeze({
    get requests() {
      return frozenCopy(requests);
    },
    async send(request: AmazonBusinessRequest): Promise<AmazonBusinessResponse> {
      requests.push(frozenCopy(request));
      if (scenario === 'unauthorized')
        return reply(401, { errors: [{ code: 'Unauthorized', message: 'Access denied.' }] });
      const { method, path, query } = request;
      const region = path.startsWith(CARTS) ? query.region : query.productRegion;
      if (region !== 'US') return invalid('The required request parameter is missing: region.');
      if (method === 'GET' && path === CARTS)
        return reply(200, {
          cartDetailsList: carts.map((c) => ({ ...c, region: 'US' })),
        });
      const offers = path.match(/^\/products\/2020-08-26\/products\/([^/]+)\/offers$/);
      if (method === 'GET' && offers) {
        if (query.locale !== 'en_US')
          return invalid('Missing or invalid request parameters: [locale]');
        const list = fixture.offers[decodeURIComponent(offers[1])] ?? [];
        return reply(200, {
          offerCount: list.length,
          numberOfPages: 1,
          offers: list.map((o) => ({
            offerId: o.offerId,
            availability: 'In Stock.',
            condition: { conditionValue: o.condition ?? 'NEW' },
            price: { value: { amount: o.amount, currencyCode: 'USD' }, priceType: 'BUSINESS' },
            quantityLimits: { minQuantity: o.minQuantity ?? 1, maxQuantity: o.maxQuantity ?? 30 },
          })),
        });
      }
      const cart = path.match(/^\/cart\/2025-04-30\/carts\/([^/]+)\/items$/);
      if (!cart || !carts.some((c) => c.id === decodeURIComponent(cart[1])))
        return invalid('The required request parameter is missing: cartId.');
      if (method === 'GET') {
        if (scenario === 'malformed') return reply(200, { items: [{ asin: 'B0MALFORMD' }] });
        return reply(200, { items: items.map(view) });
      }
      if (method !== 'POST') return invalid('Unsupported fake operation.');
      if (scenario === 'throttled')
        return reply(429, { errors: [{ code: 'QuotaExceeded', message: 'Slow down.' }] });
      if (scenario === 'timeout_before_write') throw new Error('Simulated timeout before write.');
      const body = request.body as {
        items?: { asin?: string; offerId?: string; quantity?: number }[];
      };
      const rejectedItems: unknown[] = [];
      for (const [n, wanted] of (body.items ?? []).entries()) {
        if (!wanted.asin) return invalid('The required request parameter is missing: asin.');
        const offer = (fixture.offers[wanted.asin] ?? []).find((o) => o.offerId === wanted.offerId);
        if (!offer || (scenario === 'rejected' && n === 0)) {
          rejectedItems.push({
            id: wanted.asin,
            rejectionArtifacts: [{ type: 'UnavailableQuantity', availableQuantity: 0 }],
          });
          continue;
        }
        items.push({
          asin: wanted.asin,
          offerId: offer.offerId,
          quantity: wanted.quantity ?? 0,
          amount: scenario === 'price_changed' && n === 0 ? offer.amount + 1 : offer.amount,
          itemId: `added-${++added}`,
          available: !(scenario === 'unavailable' && n === 0),
        });
      }
      if (scenario === 'lost_response') throw new Error('Simulated lost response after write.');
      return reply(200, { items: items.map(view), rejectedItems });
    },
  });
  registered.add(transport);
  return transport;
}
