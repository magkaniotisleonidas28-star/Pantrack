import type { StatusTone } from '@/components/ui/status-badge';

/**
 * A simple stock status for the stock list and the home page. "Running low" means under 30% of
 * the product's saved level; the R2 low-stock alerts decision replaces this with a rule based on
 * usage and delivery schedules. "Count due" means not counted in the last 7 days.
 */
export type StockState = 'setup' | 'out' | 'low' | 'count_due' | 'ok';

export const STOCK_STATE_LABEL: Record<StockState, string> = {
  setup: 'Needs setup',
  out: 'Out',
  low: 'Running low',
  count_due: 'Count due',
  ok: 'In stock',
};

export const STOCK_STATE_TONE: Record<StockState, StatusTone> = {
  setup: 'neutral',
  out: 'bad',
  low: 'warn',
  count_due: 'warn',
  ok: 'good',
};

const DAY_MS = 86_400_000;
const LOW_SHARE = 0.3;
const COUNT_EVERY_DAYS = 7;

export function stockState(
  record: { onHand: { minor: string }; latestCountEffectiveAt: string | null } | undefined,
  target: { minor: string } | null | undefined,
  now: number,
): StockState {
  if (!record) return 'setup';
  const onHand = Number(record.onHand.minor);
  if (!(onHand > 0)) return 'out';
  const level = target ? Number(target.minor) : 0;
  if (level > 0 && onHand < level * LOW_SHARE) return 'low';
  const counted = record.latestCountEffectiveAt ? Date.parse(record.latestCountEffectiveAt) : NaN;
  if (!Number.isFinite(counted) || now - counted > COUNT_EVERY_DAYS * DAY_MS) return 'count_due';
  return 'ok';
}
