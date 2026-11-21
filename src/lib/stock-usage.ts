import type { ExactQuantity, UnitDimension } from './inventory-consumption-contract';

/**
 * R1b (decision 0011): how much of a product is really used, measured from count to count,
 * compared with what Pantrack recorded (sales use, waste and manual use). Read only.
 */

export const USAGE_WINDOW_DAYS = 56;
export const RECENT_USE_DAYS = 28;
export const MIN_COUNT_DAYS = 7;
export const MIN_HISTORY_DAYS = 14;
export const RECENT_COUNTS_SHOWN = 5;

const DAY_MS = 86_400_000;
const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

/** One count, with the stock movements recorded between it and the count before it. */
export type UsageCountInput = Readonly<{
  effectiveAt: string;
  dimension: UnitDimension;
  measuredMinor: string;
  estimateBeforeMinor: string | null;
  opening: boolean;
  previous: Readonly<{
    effectiveAt: string;
    dimension: UnitDimension;
    measuredMinor: string;
  }> | null;
  /** Deliveries added to stock after the previous count and up to this one. */
  receivedMinor: string;
  /** Signed stock change from sales use, waste, manual use and sales corrections in that time. */
  recordedChangeMinor: string;
}>;

export type ProductUsageInput = Readonly<{
  productId: string;
  dimension: UnitDimension;
  /** Oldest first. */
  counts: readonly UsageCountInput[];
  firstRecordedUseAt: string | null;
  /** Signed stock change from recorded use in the last RECENT_USE_DAYS. */
  recentRecordedChangeMinor: string;
}>;

export type UsageStatus = 'enough' | 'needs_counts' | 'needs_history';

export type CountAccuracy = Readonly<{
  effectiveAt: string;
  estimate: ExactQuantity;
  measured: ExactQuantity;
  /** Measured minus estimate: negative means less was on the shelf than Pantrack expected. */
  difference: ExactQuantity;
  differencePercent: number | null;
}>;

export type ProductUsage = Readonly<{
  productId: string;
  dimension: UnitDimension;
  status: UsageStatus;
  countedDays: number;
  historyDays: number;
  /** Real use per day between counts in the last USAGE_WINDOW_DAYS. */
  measuredPerDay: ExactQuantity | null;
  /** Recorded use per day over the same count periods. */
  recordedPerDay: ExactQuantity | null;
  /** How much more was really used than recorded, as a percentage of real use. */
  unrecordedPercent: number | null;
  /** Recorded use per day in the last RECENT_USE_DAYS, when counts are too few. */
  recentRecordedPerDay: ExactQuantity | null;
  dailyUse: Readonly<{ source: 'counts' | 'recorded'; perDay: ExactQuantity }> | null;
  /** Count periods left out because a count found more than deliveries explain. */
  unexplainedIncreases: number;
  recentCounts: readonly CountAccuracy[];
}>;

function big(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error('Quantities must be whole minor units.');
  return BigInt(value);
}

function time(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Times must be valid timestamps.');
  return parsed;
}

/** Division rounded half away from zero. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < ZERO !== denominator < ZERO;
  const n = numerator < ZERO ? -numerator : numerator,
    d = denominator < ZERO ? -denominator : denominator;
  const q = (n * TWO + d) / (d * TWO);
  return negative ? -q : q;
}

const quantity = (dimension: UnitDimension, minor: bigint): ExactQuantity => ({
  dimension,
  minor: minor.toString(),
});

const days = (ms: number) => Math.round((ms / DAY_MS) * 10) / 10;

function perDay(dimension: UnitDimension, total: bigint, ms: number): ExactQuantity | null {
  if (ms <= 0) return null;
  return quantity(dimension, roundDiv(total * BigInt(DAY_MS), BigInt(Math.round(ms))));
}

export function productUsage(input: ProductUsageInput, now: Date): ProductUsage {
  const nowMs = now.getTime(),
    windowStart = nowMs - USAGE_WINDOW_DAYS * DAY_MS,
    { dimension } = input;
  let measured = ZERO,
    recorded = ZERO,
    countedMs = 0,
    unexplainedIncreases = 0;
  for (const count of input.counts) {
    const previous = count.previous;
    if (!previous || count.dimension !== dimension || previous.dimension !== dimension) continue;
    const end = time(count.effectiveAt),
      start = time(previous.effectiveAt);
    if (end < windowStart || end > nowMs || end <= start) continue;
    const used = big(previous.measuredMinor) + big(count.receivedMinor) - big(count.measuredMinor);
    if (used < ZERO) {
      unexplainedIncreases += 1;
      continue;
    }
    measured += used;
    recorded -= big(count.recordedChangeMinor);
    countedMs += end - start;
  }
  const historyMs = input.firstRecordedUseAt
    ? Math.max(0, nowMs - time(input.firstRecordedUseAt))
    : 0;
  const recentMs = Math.min(RECENT_USE_DAYS * DAY_MS, historyMs);
  const measuredPerDay = perDay(dimension, measured, countedMs),
    recordedPerDay = perDay(dimension, recorded, countedMs),
    recentRecordedPerDay = perDay(dimension, -big(input.recentRecordedChangeMinor), recentMs);
  const countedDays = days(countedMs),
    historyDays = days(historyMs);
  const enoughCounts = countedMs >= MIN_COUNT_DAYS * DAY_MS;
  const status: UsageStatus = !enoughCounts
    ? 'needs_counts'
    : historyMs < MIN_HISTORY_DAYS * DAY_MS
      ? 'needs_history'
      : 'enough';
  const recentCounts = input.counts
    .filter((count) => !count.opening && count.estimateBeforeMinor !== null)
    .filter((count) => count.dimension === dimension)
    .slice(-RECENT_COUNTS_SHOWN)
    .reverse()
    .map((count): CountAccuracy => {
      const estimate = big(count.estimateBeforeMinor!),
        found = big(count.measuredMinor),
        difference = found - estimate;
      return {
        effectiveAt: count.effectiveAt,
        estimate: quantity(dimension, estimate),
        measured: quantity(dimension, found),
        difference: quantity(dimension, difference),
        differencePercent:
          estimate > ZERO ? Number(roundDiv(difference * HUNDRED, estimate)) : null,
      };
    });
  return {
    productId: input.productId,
    dimension,
    status,
    countedDays,
    historyDays,
    measuredPerDay,
    recordedPerDay,
    unrecordedPercent:
      countedMs > 0 && measured > ZERO
        ? Number(roundDiv((measured - recorded) * HUNDRED, measured))
        : null,
    recentRecordedPerDay,
    dailyUse:
      enoughCounts && measuredPerDay
        ? { source: 'counts', perDay: measuredPerDay }
        : recentRecordedPerDay && big(recentRecordedPerDay.minor) > ZERO
          ? { source: 'recorded', perDay: recentRecordedPerDay }
          : null,
    unexplainedIncreases,
    recentCounts,
  };
}

/** Plain wording for the gap between real and recorded use. */
export function unrecordedWording(percent: number | null): string {
  if (percent === null) return 'Not measured yet';
  if (Math.abs(percent) <= 2) return 'Matches what was recorded';
  return percent > 0
    ? `About ${percent}% more used than recorded`
    : `About ${-percent}% less used than recorded`;
}

export const usageStatusWording: Record<UsageStatus, string> = {
  enough: 'Enough history',
  needs_counts: 'Needs counts at least 7 days apart',
  needs_history: 'Needs 14 days of recorded use',
};
