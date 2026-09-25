import {REPLENISHMENT_PROPOSAL_CONTRACT, type ReviewProposalSnapshot} from './replenishment-proposal';

export type ReviewProposalGroup = Readonly<{
  mode: 'review_only';
  companyId: string;
  supplierId: string;
  accountId: string;
  locationId: string;
  lines: readonly ReviewProposalSnapshot[];
  estimatedTotals: readonly Readonly<{currency: string; minor: string}>[];
  unpricedLineCount: number;
  reviewReasons: readonly ReviewProposalSnapshot['explanation']['reviewReasons'][number][];
}>;

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.values(value).every(child => deeplyFrozen(child, seen));
}

/** Groups frozen A6 line snapshots for review without submitting or reserving stock. */
export function groupReviewProposals(companyId: string, lines: readonly ReviewProposalSnapshot[]): readonly ReviewProposalGroup[] {
  if (typeof companyId !== 'string' || !companyId.trim()) throw new Error('Review company is required.');
  const products = new Set<string>();
  const buckets = new Map<string, ReviewProposalSnapshot[]>();
  for (const line of lines) {
    if (line.companyId !== companyId) throw new Error('Review lines must belong to one company.');
    if (line.contract !== REPLENISHMENT_PROPOSAL_CONTRACT || line.mode !== 'review_only' || !deeplyFrozen(line)) {
      throw new Error('Review lines must be frozen A6 snapshots.');
    }
    if (products.has(line.productId)) throw new Error('A product may appear only once in a review batch.');
    products.add(line.productId);
    const key = JSON.stringify([line.supplier.supplierId, line.supplier.accountId, line.supplier.locationId]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(line);
    buckets.set(key, bucket);
  }
  const groups = [...buckets.values()].map(bucket => {
    bucket.sort((a, b) => a.productId.localeCompare(b.productId));
    const first = bucket[0];
    const totals = new Map<string, bigint>();
    const reasons = new Set<ReviewProposalSnapshot['explanation']['reviewReasons'][number]>();
    let unpricedLineCount = 0;
    for (const line of bucket) {
      for (const reason of line.explanation.reviewReasons) reasons.add(reason);
      if (line.estimatedLineTotal === null) {
        unpricedLineCount++;
      } else {
        const {currency, minor} = line.estimatedLineTotal;
        totals.set(currency, (totals.get(currency) ?? BigInt(0)) + BigInt(minor));
      }
    }
    return Object.freeze({
      mode: 'review_only' as const, companyId,
      supplierId: first.supplier.supplierId,
      accountId: first.supplier.accountId,
      locationId: first.supplier.locationId,
      lines: Object.freeze(bucket),
      estimatedTotals: Object.freeze([...totals].sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, total]) => Object.freeze({currency, minor: total.toString()}))),
      unpricedLineCount,
      reviewReasons: Object.freeze([...reasons].sort()),
    });
  });
  groups.sort((a, b) => JSON.stringify([a.supplierId, a.accountId, a.locationId])
    .localeCompare(JSON.stringify([b.supplierId, b.accountId, b.locationId])));
  return Object.freeze(groups);
}
