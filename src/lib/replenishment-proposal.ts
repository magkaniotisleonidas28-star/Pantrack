import type {ExactQuantity} from './inventory-consumption-contract';
import {calculateTarget, readCanonical, type TargetInput} from './inventory-quantities';
import type {CloverSalesReadiness} from './d1-replenishment-sales-readiness';

export const REPLENISHMENT_PROPOSAL_CONTRACT = 'pantrack.replenishment-review.v1' as const;
export const REPLENISHMENT_PROPOSAL_CONTRACT_V2 = 'pantrack.replenishment-review.v2' as const;

export type SalesReadiness = Readonly<{
  source: 'fictional_fixture';
  status: 'current' | 'degraded' | 'unknown';
  heldEventCount: number;
}> | CloverSalesReadiness;

type PriceEstimate = Readonly<{source: 'fictional_fixture'; currency: string; perPackMinor: string}>;

export type ReviewProposalInput = Readonly<{
  companyId: string;
  productId: string;
  inventoryVersion: number;
  inventoryConfigId: string;
  inventoryConfigVersion: number;
  settingsChangeId: string;
  settingsVersion: number;
  settingsChangedBy: string;
  calculatedAt: string;
  lastCountAt: string | null;
  countEveryDays: number;
  expiresAt: string | null;
  expiryStatus: 'checked' | 'not_checked';
  salesReadiness: SalesReadiness;
  supplier: Readonly<{
    source: 'fictional_fixture'; mappingId: string; mappingVersion: number;
    supplierId: string; accountId: string; locationId: string; sku: string;
  }>;
  priceEstimate: PriceEstimate | null;
  quantities: Omit<TargetInput, 'hasOpeningCount' | 'stale'>;
  policy: Readonly<{
    minimumPacks: string;
    orderMultiplePacks: string;
    maximumPacks: string | null;
  }>;
}>;

type ReviewReason =
  | 'opening_count_required' | 'stale_count' | 'expired_stock' | 'expiry_not_checked'
  | 'sales_not_current' | 'held_sales_events'
  | 'minimum_exceeds_limit' | 'order_multiple_exceeds_limit' | 'price_not_checked';

export type ReviewProposalSnapshot = Readonly<{
  contract: typeof REPLENISHMENT_PROPOSAL_CONTRACT | typeof REPLENISHMENT_PROPOSAL_CONTRACT_V2;
  mode: 'review_only';
  companyId: string;
  productId: string;
  inventoryVersion: number;
  inventoryConfigId: string;
  inventoryConfigVersion: number;
  settingsChangeId: string;
  settingsVersion: number;
  settingsChangedBy: string;
  calculatedAt: string;
  lastCountAt: string | null;
  countEveryDays: number;
  expiresAt: string | null;
  expiryStatus: 'checked' | 'not_checked';
  salesReadiness: SalesReadiness;
  supplier: ReviewProposalInput['supplier'];
  priceEstimate: PriceEstimate | null;
  estimatedLineTotal: Readonly<{currency: string; minor: string}> | null;
  quantities: ReviewProposalInput['quantities'];
  policy: ReviewProposalInput['policy'];
  explanation: Readonly<{
    position: ExactQuantity;
    shortfall: ExactQuantity;
    wantedPacks: string;
    capacityPacks: string | null;
    shelfLifePacks: string | null;
    maximumPacks: string | null;
    recommendedPacks: string;
    limitedBy: readonly ('capacity' | 'shelf_life' | 'maximum_packs')[];
    reviewReasons: readonly ReviewReason[];
  }>;
}>;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const DAY_MS = 86_400_000;

function identifier(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Proposal identifiers must be nonempty and at most 200 characters.');
  return value;
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Proposal versions must be positive safe integers.');
  return value;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('Proposal timestamps must be canonical UTC ISO strings.');
  }
  return parsed;
}

function packs(value: string, allowZero: boolean): bigint {
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error('Pack limits must be canonical nonnegative integers.');
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || (!allowZero && parsed === ZERO)) throw new Error('Pack limits exceed supported policy bounds.');
  return parsed;
}

function estimatedPrice(value: PriceEstimate | null): bigint | null {
  if (value === null) return null;
  if (value.source !== 'fictional_fixture' || !/^[A-Z]{3}$/.test(value.currency) ||
      typeof value.perPackMinor !== 'string' || value.perPackMinor.length > 20 ||
      !/^[1-9]\d*$/.test(value.perPackMinor)) throw new Error('Price estimate fixture is invalid.');
  return BigInt(value.perPackMinor);
}

function copyQuantity(value: ExactQuantity): ExactQuantity {
  readCanonical(value);
  return {dimension: value.dimension, minor: value.minor};
}

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Pure review snapshot. The caller must persist and revalidate it before any later lifecycle action. */
export function buildReviewProposal(input: ReviewProposalInput): ReviewProposalSnapshot {
  identifier(input.companyId); identifier(input.productId); identifier(input.inventoryConfigId);
  identifier(input.settingsChangeId); identifier(input.settingsChangedBy);
  for (const value of [input.supplier.mappingId, input.supplier.supplierId,
    input.supplier.accountId, input.supplier.locationId, input.supplier.sku]) identifier(value);
  version(input.inventoryVersion); version(input.inventoryConfigVersion); version(input.settingsVersion);
  version(input.supplier.mappingVersion);
  const pricePerPack = estimatedPrice(input.priceEstimate);
  if (!Number.isSafeInteger(input.countEveryDays) || input.countEveryDays < 1 || input.countEveryDays > 3650) throw new Error('Count interval is invalid.');
  const at = timestamp(input.calculatedAt);
  const lastCount = input.lastCountAt === null ? null : timestamp(input.lastCountAt);
  const expiry = input.expiresAt === null ? null : timestamp(input.expiresAt);
  if (input.expiryStatus !== 'checked' && input.expiryStatus !== 'not_checked') throw new Error('Expiry evidence status is invalid.');
  if (input.expiryStatus === 'not_checked' && expiry !== null) throw new Error('Unchecked expiry cannot contain a date.');
  if (lastCount !== null && lastCount > at) throw new Error('Proposal dates are inconsistent.');
  const sales = input.salesReadiness;
  if (!['current', 'degraded', 'unknown'].includes(sales.status) ||
      !Number.isSafeInteger(sales.heldEventCount) || sales.heldEventCount < 0) throw new Error('Sales readiness is invalid.');
  if (sales.source === 'clover_sync') {
    const validReasons = new Set(['sync_not_configured', 'clover_disconnected', 'merchant_changed',
      'unaccepted_environment', 'never_synced', 'invalid_sync_state', 'sync_disabled',
      'sync_error', 'sync_stale', 'held_events']);
    if (sales.companyId !== input.companyId || !Array.isArray(sales.reasons) ||
        !sales.reasons.every(reason => validReasons.has(reason)) ||
        (sales.merchantId !== null && (typeof sales.merchantId !== 'string' || !sales.merchantId.trim() || sales.merchantId.length > 200)) ||
        (sales.status === 'current' && (sales.merchantId === null || sales.heldEventCount !== 0 || sales.reasons.length !== 0 ||
          sales.checkpointAt === null || sales.lastSuccessAt === null)) ||
        (sales.status !== 'current' && sales.reasons.length === 0) ||
        (sales.heldEventCount > 0 && !sales.reasons.includes('held_events')) ||
        (sales.heldEventCount === 0 && sales.reasons.includes('held_events'))) {
      throw new Error('Clover sales readiness is invalid.');
    }
    if (timestamp(sales.checkedAt) > at) throw new Error('Clover sales readiness is newer than the proposal.');
    if (sales.checkpointAt !== null) timestamp(sales.checkpointAt);
    if (sales.lastSuccessAt !== null) timestamp(sales.lastSuccessAt);
  } else if (sales.source !== 'fictional_fixture') throw new Error('Sales readiness source is invalid.');
  if (input.supplier.source !== 'fictional_fixture') throw new Error('Supplier fixture is invalid.');

  const copied = {
    target: copyQuantity(input.quantities.target),
    onHand: copyQuantity(input.quantities.onHand),
    incoming: copyQuantity(input.quantities.incoming),
    pack: copyQuantity(input.quantities.pack),
    capacity: input.quantities.capacity === null ? null : copyQuantity(input.quantities.capacity),
    shelfLimit: input.quantities.shelfLimit === null ? null : copyQuantity(input.quantities.shelfLimit),
  };
  const stale = lastCount !== null && at - lastCount >= input.countEveryDays * DAY_MS;
  const target = calculateTarget({...copied, hasOpeningCount: lastCount !== null, stale});
  const minimum = packs(input.policy.minimumPacks, true);
  const multiple = packs(input.policy.orderMultiplePacks, false);
  const maximum = input.policy.maximumPacks === null ? null : packs(input.policy.maximumPacks, true);
  const position = readCanonical(target.position);
  const pack = readCanonical(copied.pack);
  const ceiling = (limit: ExactQuantity | null): bigint | null => {
    if (limit === null) return null;
    const value = readCanonical(limit);
    return value > position ? (value - position) / pack : ZERO;
  };
  const capacityPacks = ceiling(copied.capacity);
  const shelfLifePacks = ceiling(copied.shelfLimit);
  const wanted = BigInt(target.wantedPacks);
  const limitedBy: ('capacity' | 'shelf_life' | 'maximum_packs')[] = [];
  if (capacityPacks !== null && capacityPacks < wanted) limitedBy.push('capacity');
  if (shelfLifePacks !== null && shelfLifePacks < wanted) limitedBy.push('shelf_life');
  if (maximum !== null && maximum < wanted) limitedBy.push('maximum_packs');
  const upper = [capacityPacks, shelfLifePacks, maximum].filter((value): value is bigint => value !== null)
    .reduce<bigint | null>((smallest, value) => smallest === null || value < smallest ? value : smallest, null);
  const exceedsUpper = (value: bigint): boolean => upper !== null && value > upper;
  const reviewReasons: ReviewReason[] = [...target.reviewReasons];
  if (input.expiryStatus === 'not_checked') reviewReasons.push('expiry_not_checked');
  if (expiry !== null && expiry < at) reviewReasons.push('expired_stock');
  if (input.salesReadiness.status !== 'current') reviewReasons.push('sales_not_current');
  if (input.salesReadiness.heldEventCount > 0) reviewReasons.push('held_sales_events');
  if (pricePerPack === null) reviewReasons.push('price_not_checked');

  let recommended = exceedsUpper(wanted) ? upper! : wanted;
  if (recommended > ZERO) {
    if (recommended < minimum) {
      if (exceedsUpper(minimum)) reviewReasons.push('minimum_exceeds_limit');
      recommended = minimum;
    }
    const rounded = (recommended + multiple - ONE) / multiple * multiple;
    if (!exceedsUpper(recommended) && exceedsUpper(rounded)) reviewReasons.push('order_multiple_exceeds_limit');
    recommended = exceedsUpper(rounded) ? ZERO : rounded;
  }
  if (lastCount === null || (expiry !== null && expiry < at)) recommended = ZERO;

  return freezeSnapshot({
    contract: sales.source === 'clover_sync' ? REPLENISHMENT_PROPOSAL_CONTRACT_V2 : REPLENISHMENT_PROPOSAL_CONTRACT,
    mode: 'review_only',
    companyId: input.companyId, productId: input.productId,
    inventoryVersion: input.inventoryVersion, inventoryConfigId: input.inventoryConfigId,
    inventoryConfigVersion: input.inventoryConfigVersion, settingsChangeId: input.settingsChangeId,
    settingsVersion: input.settingsVersion, settingsChangedBy: input.settingsChangedBy,
    calculatedAt: input.calculatedAt, lastCountAt: input.lastCountAt,
    countEveryDays: input.countEveryDays, expiresAt: input.expiresAt, expiryStatus: input.expiryStatus,
    salesReadiness: sales.source === 'clover_sync' ? {
      companyId: sales.companyId, source: sales.source, status: sales.status,
      heldEventCount: sales.heldEventCount, reasons: [...sales.reasons],
      merchantId: sales.merchantId,
      checkpointAt: sales.checkpointAt, lastSuccessAt: sales.lastSuccessAt,
      checkedAt: sales.checkedAt,
    } : {source: sales.source, status: sales.status, heldEventCount: sales.heldEventCount},
    supplier: {...input.supplier},
    priceEstimate: input.priceEstimate === null ? null : {...input.priceEstimate},
    estimatedLineTotal: pricePerPack === null ? null : {
      currency: input.priceEstimate!.currency, minor: (recommended * pricePerPack).toString(),
    },
    quantities: copied,
    policy: {...input.policy},
    explanation: {
      position: target.position, shortfall: target.shortfall, wantedPacks: target.wantedPacks,
      capacityPacks: capacityPacks?.toString() ?? null, shelfLifePacks: shelfLifePacks?.toString() ?? null,
      maximumPacks: maximum?.toString() ?? null, recommendedPacks: recommended.toString(),
      limitedBy, reviewReasons,
    },
  });
}
