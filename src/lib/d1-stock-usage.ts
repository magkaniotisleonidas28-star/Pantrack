import type { UnitDimension } from './inventory-consumption-contract';
import {
  productUsage,
  RECENT_USE_DAYS,
  USAGE_WINDOW_DAYS,
  type ProductUsage,
  type UsageCountInput,
} from './stock-usage';

/** Stock changes that put deliveries on the shelf. */
const RECEIVED = "('receive','order_receipt')";
/** Stock changes that Pantrack records as use: sales, waste, manual use and sales corrections. */
export const RECORDED_USE = "('use','waste','sale_consumption','sale_correction')";
/** Counts older than the window are still read so the first period in it has a start. */
const COUNT_LOOKBACK_DAYS = USAGE_WINDOW_DAYS + 120;
const DAY_MS = 86_400_000;

type Statement = {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
};
type Database = { prepare(query: string): Statement };

type CountRow = {
  product_id: string;
  dimension: UnitDimension;
  measured_minor: string;
  estimate_before_minor: string | null;
  opening: number;
  effective_at: string;
  prev_at: string | null;
  prev_measured: string | null;
  prev_dimension: UnitDimension | null;
  received_minor: number | string;
  recorded_change_minor: number | string;
};

// SQLite adds whole minor units exactly; a total beyond JavaScript's exact range is refused
// (the route answers 503) rather than shown rounded.
function exactTotal(value: number | string): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('Usage total is too large to show exactly.');
  return String(value);
}

export type StockUsageView = Readonly<{
  generatedAt: string;
  windowDays: number;
  products: readonly ProductUsage[];
}>;

// A movement belongs to the period after a count when it is later in time, or at the same time
// but recorded after that count. Counts without a stock-history entry sort before same-time moves.
const between = (actions: string) => `(SELECT COALESCE(SUM(CAST(m.quantity_minor AS INTEGER)),0)
  FROM inventory_events_exact m
  WHERE m.company_id=c.company_id AND m.product_id=c.product_id AND m.dimension=c.dimension
    AND m.action IN ${actions} AND c.prev_at IS NOT NULL
    AND (m.effective_at>c.prev_at OR (m.effective_at=c.prev_at AND m.balance_version_after>c.prev_v))
    AND (m.effective_at<c.effective_at OR (m.effective_at=c.effective_at AND m.balance_version_after<c.v)))`;

const COUNTS = `WITH c AS (
  SELECT r.company_id,r.product_id,r.dimension,r.measured_minor,r.estimate_before_minor,r.opening,
    r.effective_at,e.balance_version_after AS v,
    LAG(r.effective_at) OVER w AS prev_at,
    LAG(e.balance_version_after) OVER w AS prev_v,
    LAG(r.measured_minor) OVER w AS prev_measured,
    LAG(r.dimension) OVER w AS prev_dimension
  FROM inventory_reconciliations r
  LEFT JOIN inventory_events_exact e
    ON e.company_id=r.company_id AND e.id=r.id AND e.product_id=r.product_id AND e.action='count'
  WHERE r.company_id=? AND r.effective_at>=? AND r.effective_at<=?
    AND r.measured_minor IS NOT NULL AND r.dimension IS NOT NULL
  WINDOW w AS (PARTITION BY r.product_id ORDER BY r.effective_at,COALESCE(e.balance_version_after,0))
)
SELECT c.product_id,c.dimension,c.measured_minor,c.estimate_before_minor,c.opening,c.effective_at,
  c.prev_at,c.prev_measured,c.prev_dimension,
  ${between(RECEIVED)} AS received_minor,
  ${between(RECORDED_USE)} AS recorded_change_minor
FROM c ORDER BY c.product_id,c.effective_at,COALESCE(c.v,0)`;

/** Reads measured and recorded use for every product with exact stock. Changes nothing. */
export class D1StockUsage {
  constructor(
    private readonly db: Database,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async read(companyId: string): Promise<StockUsageView> {
    const now = this.clock.now(),
      nowIso = now.toISOString(),
      lookback = new Date(now.getTime() - COUNT_LOOKBACK_DAYS * DAY_MS).toISOString(),
      recentStart = new Date(now.getTime() - RECENT_USE_DAYS * DAY_MS).toISOString();
    const [balances, counts, first, recent] = await Promise.all([
      this.db
        .prepare(
          'SELECT product_id,dimension FROM inventory_balances_exact WHERE company_id=? ORDER BY product_id',
        )
        .bind(companyId)
        .all<{ product_id: string; dimension: UnitDimension }>(),
      this.db.prepare(COUNTS).bind(companyId, lookback, nowIso).all<CountRow>(),
      this.db
        .prepare(
          `SELECT product_id,MIN(effective_at) AS first_at FROM inventory_events_exact
          WHERE company_id=? AND action IN ${RECORDED_USE} AND effective_at<=? GROUP BY product_id`,
        )
        .bind(companyId, nowIso)
        .all<{ product_id: string; first_at: string }>(),
      this.db
        .prepare(
          `SELECT product_id,dimension,COALESCE(SUM(CAST(quantity_minor AS INTEGER)),0) AS total
          FROM inventory_events_exact
          WHERE company_id=? AND action IN ${RECORDED_USE} AND effective_at>=? AND effective_at<=?
          GROUP BY product_id,dimension`,
        )
        .bind(companyId, recentStart, nowIso)
        .all<{ product_id: string; dimension: UnitDimension; total: number | string }>(),
    ]);
    const firstUse = new Map(first.results.map((row) => [row.product_id, row.first_at]));
    const products = balances.results.map((balance) => {
      const countsFor: UsageCountInput[] = counts.results
        .filter((row) => row.product_id === balance.product_id)
        .map((row) => ({
          effectiveAt: row.effective_at,
          dimension: row.dimension,
          measuredMinor: row.measured_minor,
          estimateBeforeMinor: row.estimate_before_minor,
          opening: row.opening === 1,
          previous:
            row.prev_at && row.prev_measured !== null && row.prev_dimension
              ? {
                  effectiveAt: row.prev_at,
                  dimension: row.prev_dimension,
                  measuredMinor: row.prev_measured,
                }
              : null,
          receivedMinor: exactTotal(row.received_minor),
          recordedChangeMinor: exactTotal(row.recorded_change_minor),
        }));
      const recentRow = recent.results.find(
        (row) => row.product_id === balance.product_id && row.dimension === balance.dimension,
      );
      return productUsage(
        {
          productId: balance.product_id,
          dimension: balance.dimension,
          counts: countsFor,
          firstRecordedUseAt: firstUse.get(balance.product_id) ?? null,
          recentRecordedChangeMinor: exactTotal(recentRow?.total ?? 0),
        },
        now,
      );
    });
    return { generatedAt: nowIso, windowDays: USAGE_WINDOW_DAYS, products };
  }
}
