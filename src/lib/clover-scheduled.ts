import { database } from '@/db/raw';
import { cloverConfig } from '@/lib/clover';
import {
  cloverSyncBudget,
  cloverSyncEnabled,
  syncClover,
  type CloverSyncBudget,
} from '@/lib/clover-sync';

/** Each sync reads at most 24 hours, so a café far behind gets several passes per run. */
export const MAX_PASSES_PER_CAFE = 6;
/** Stop starting new passes after this long; the next run, 10 minutes later, carries on. */
export const RUN_BUDGET_MS = 5 * 60 * 1000;
/** A café counts as caught up once its checkpoint is within this of now. */
const CAUGHT_UP_MS = 15 * 60 * 1000;

export type ScheduledCafeResult = {
  companyId: string;
  outcome: 'synced' | 'busy' | 'failed';
  passes: number;
  created: number;
  paused: number;
};

type Sync = (
  companyId: string,
  budget: CloverSyncBudget,
) => Promise<{ created: number; paused?: number; checkpoint: string; partial?: boolean }>;

/**
 * Pantrack's own Clover check, run by the Worker's 10-minute trigger (decision
 * 0012, step P3). It reads each connected café whose sales sync is on.
 * - The existing per-café lease keeps it from overlapping with a webhook, Sync
 *   now or another trigger: a café already syncing is skipped as busy.
 * - The existing duplicate protection keeps a sale from being counted twice.
 * - One café's error is recorded on that café and doesn't stop the others.
 */
export async function runScheduledCloverSync(
  deps: { db?: D1Database; sync?: Sync; now?: () => number; budget?: CloverSyncBudget } = {},
): Promise<{ skipped?: 'sync_disabled'; cafes: ScheduledCafeResult[] }> {
  if (!cloverSyncEnabled()) return { skipped: 'sync_disabled', cafes: [] };
  const db = deps.db ?? database(),
    sync = deps.sync ?? syncClover,
    now = deps.now ?? Date.now,
    started = now(),
    // Cloudflare limits requests per run, so every café in this run shares one budget.
    budget = deps.budget ?? cloverSyncBudget();
  const environment = cloverConfig().environment;
  const cafes = await db
    .prepare(
      'SELECT s.company_id FROM clover_sync_state s JOIN clover_connections c ON c.company_id=s.company_id AND c.environment=s.environment AND c.merchant_id=s.merchant_id WHERE s.environment=? AND NOT EXISTS(SELECT 1 FROM clover_access_removals r WHERE r.company_id=s.company_id) ORDER BY s.checkpoint ASC,s.company_id ASC',
    )
    .bind(environment)
    .all<{ company_id: string }>();
  const results: ScheduledCafeResult[] = [];
  for (const { company_id: companyId } of cafes.results) {
    if (now() - started > RUN_BUDGET_MS || budget.fetches <= 0 || budget.newSales <= 0) break;
    const result: ScheduledCafeResult = {
      companyId,
      outcome: 'synced',
      passes: 0,
      created: 0,
      paused: 0,
    };
    try {
      for (let pass = 0; pass < MAX_PASSES_PER_CAFE; pass++) {
        const synced = await sync(companyId, budget);
        result.passes++;
        result.created += synced.created;
        result.paused += synced.paused ?? 0;
        // The run's budget ran out: the café carries on from its new checkpoint next time.
        if (synced.partial) break;
        const checkpoint = Date.parse(synced.checkpoint);
        if (!Number.isFinite(checkpoint) || now() - checkpoint <= CAUGHT_UP_MS) break;
        if (now() - started > RUN_BUDGET_MS) break;
      }
    } catch (error) {
      // syncClover records its own error on the café. A held lease means a
      // webhook, Sync now or another trigger is already reading this café.
      result.outcome =
        error instanceof Error && /already running/.test(error.message) ? 'busy' : 'failed';
    }
    results.push(result);
  }
  return { cafes: results };
}
