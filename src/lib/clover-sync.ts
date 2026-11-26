import { UserFacingError } from '@/lib/user-facing-error';
import { env } from 'cloudflare:workers';
import { database } from '@/db/raw';
import { cloverConfig, cloverJson, withClover } from '@/lib/clover';
import {
  cloverSource,
  pausedCloverOrder,
  readCloverOrder,
  type CloverOrder,
  type CloverOrderIdentity,
} from '@/lib/clover-orders';
import { SalesIngestionError, type SalesEventDraftV1 } from '@/lib/sales-ingestion';
import { d1SalesService } from '@/lib/d1-sales-runtime';
import { receivePosEvent } from '@/lib/pos-adapter';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const OVERLAP_MS = 60 * 60 * 1000;
/**
 * Clover requests one Worker run may make. Cloudflare's free plan allows 50
 * subrequests per run; a token refresh and recovery can use two more, so 40
 * leaves room. `PANTRACK_CLOVER_FETCH_BUDGET` can raise it on a paid plan.
 */
export const CLOVER_FETCH_BUDGET = 40;
/** New sales one run records and applies; each uses many database queries. */
export const CLOVER_NEW_SALES_BUDGET = 20;
/**
 * An order changed this recently is read again even if it was already
 * received: a refund can become visible on the same modified time.
 */
const RECENT_REREAD_MS = 10 * 60 * 1000;

/** What a run may still spend. Shared by every sync in one Worker invocation. */
export type CloverSyncBudget = { fetches: number; newSales: number };

export function cloverSyncBudget(): CloverSyncBudget {
  const configured = Number(
    (env as unknown as { PANTRACK_CLOVER_FETCH_BUDGET?: string }).PANTRACK_CLOVER_FETCH_BUDGET,
  );
  return {
    fetches:
      Number.isSafeInteger(configured) && configured >= 1 && configured <= 9_000
        ? configured
        : CLOVER_FETCH_BUDGET,
    newSales: CLOVER_NEW_SALES_BUDGET,
  };
}

/** The run's budget is spent; the sync records how far it got and stops. */
class BudgetSpent extends Error {}
/**
 * Intake refusals about an order's own details: that order is paused instead.
 * A sale time slightly ahead of this clock is not here: the next sync reads it.
 */
const ORDER_DETAIL_ERRORS = new Set([
  'invalid_revision',
  'invalid_lines',
  'invalid_line',
  'invalid_quantity',
  'invalid_modifiers',
  'invalid_modifier',
  'payload_too_large',
  'retained_fragment_too_large',
]);

export function cloverSyncEnabled() {
  const settings = env as unknown as {
    PANTRACK_CLOVER_SYNC_ENABLED?: string;
    CLOVER_ENVIRONMENT?: string;
  };
  return (
    settings.PANTRACK_CLOVER_SYNC_ENABLED === 'enabled' && settings.CLOVER_ENVIRONMENT === 'sandbox'
  );
}

export async function cloverSyncStatus(companyId: string) {
  const db = database();
  const state = await db
    .prepare(
      'SELECT environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error FROM clover_sync_state WHERE company_id=?',
    )
    .bind(companyId)
    .first<{
      environment: string;
      merchant_id: string;
      started_at: number;
      checkpoint: number;
      last_attempt: string | null;
      last_success: string | null;
      last_error: string | null;
    }>();
  if (!state) return null;
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id=? AND e.provider='clover' AND e.environment=? AND e.merchant_id=? AND s.state='held'",
    )
    .bind(companyId, state.environment, state.merchant_id)
    .first<{ n: number }>();
  return {
    startedAt: new Date(state.started_at).toISOString(),
    checkpoint: new Date(state.checkpoint).toISOString(),
    lastAttempt: state.last_attempt,
    lastSuccess: state.last_success,
    lastError: state.last_error,
    heldCount: count?.n ?? 0,
    lagMs: Math.max(0, Date.now() - state.checkpoint),
    enabled: cloverSyncEnabled(),
  };
}

export async function syncClover(companyId: string, budget: CloverSyncBudget = cloverSyncBudget()) {
  if (!cloverSyncEnabled()) throw new UserFacingError('Clover sales sync is disabled.');
  const db = database(),
    now = Date.now(),
    lease = now + 120_000;
  const state = await db
    .prepare(
      'UPDATE clover_sync_state SET lease_until=?,last_attempt=?,last_error=NULL WHERE company_id=? AND lease_until<? RETURNING environment,merchant_id,started_at,checkpoint',
    )
    .bind(lease, new Date(now).toISOString(), companyId, now)
    .first<{ environment: string; merchant_id: string; started_at: number; checkpoint: number }>();
  if (!state) throw new UserFacingError('Clover is disconnected or a sync is already running.');
  try {
    const result = await withClover(companyId, async (connection, token) => {
      if (
        connection.merchant_id !== state.merchant_id ||
        connection.environment !== state.environment
      )
        throw new UserFacingError('Clover connection changed. Reconnect before syncing.');
      const config = cloverConfig(),
        source = cloverSource(companyId, state.environment, state.merchant_id),
        service = d1SalesService(db);
      const lower = Math.max(state.started_at, state.checkpoint - OVERLAP_MS),
        upper = Math.min(Date.now(), lower + 24 * 60 * 60 * 1000);
      if (upper < lower)
        return {
          scanned: 0,
          created: 0,
          held: 0,
          duplicates: 0,
          partial: false,
          checkpoint: new Date(state.checkpoint).toISOString(),
        };
      const fetchClover = (url: string) => {
        if (budget.fetches <= 0) throw new BudgetSpent();
        budget.fetches--;
        return cloverJson(url, { headers: { Authorization: 'Bearer ' + token } });
      };
      // The latest revision Pantrack already holds for each order on a page.
      const knownRevisions = async (ids: string[]) => {
        const known = new Map<string, number>();
        for (let i = 0; i < ids.length; i += 90) {
          const chunk = ids.slice(i, i + 90);
          const rows = await db
            .prepare(
              `SELECT external_order_id AS id,MAX(revision) AS revision FROM sales_events
              WHERE company_id=? AND provider='clover' AND environment=? AND merchant_id=?
              AND external_order_id IN (${chunk.map(() => '?').join(',')}) GROUP BY external_order_id`,
            )
            .bind(companyId, state.environment, state.merchant_id, ...chunk)
            .all<{ id: string; revision: number }>();
          for (const row of rows.results) known.set(row.id, row.revision);
        }
        return known;
      };
      let scanned = 0,
        created = 0,
        held = 0,
        duplicates = 0,
        paused = 0;
      const deletedIds = new Set<string>();
      const receive = async (identity: CloverOrderIdentity, draft: SalesEventDraftV1) => {
        try {
          return {
            receipt: await receivePosEvent(service, companyId, source, draft),
            unreadable: Boolean(draft.unreadable),
          };
        } catch (error) {
          // Details Clover sent that intake refuses pause this order, not the sync.
          if (
            draft.unreadable ||
            !(error instanceof SalesIngestionError) ||
            !ORDER_DETAIL_ERRORS.has(error.code)
          )
            throw error;
          return {
            receipt: await receivePosEvent(
              service,
              companyId,
              source,
              pausedCloverOrder(identity, 'clover_unreadable_order'),
            ),
            unreadable: true,
          };
        }
      };
      const ingest = async (identity: CloverOrderIdentity, draft: SalesEventDraftV1 | null) => {
        scanned++;
        if (!draft) return;
        const { receipt, unreadable } = await receive(identity, draft);
        if (receipt.kind === 'created' && unreadable) paused++;
        if (receipt.kind === 'created') {
          created++;
          budget.newSales--;
          const status = await service.process(companyId, receipt.eventKey);
          if (status?.state === 'held') held++;
          if (status?.state === 'failed')
            throw new UserFacingError('A Clover event was received but could not be applied.');
        } else duplicates++;
      };
      // Clover omits deleted orders from modifiedTime results and returns 404 for
      // their detail URL. The deletedTime-filtered list is the provider evidence.
      // When the budget runs out, the checkpoint moves to the first order not yet
      // handled, so the next run carries on from there instead of starting over.
      let partial = false,
        resumeFrom = state.checkpoint;
      passes: for (const field of ['deletedTime', 'modifiedTime'] as const) {
        let finished = false;
        let cursor: { time: number; id: string } | undefined,
          ties = false;
        const seen = new Set<string>();
        for (let page = 0; page < MAX_PAGES; page++) {
          const url = new URL(
            config.api + '/v3/merchants/' + encodeURIComponent(state.merchant_id) + '/orders',
          );
          url.searchParams.set('filter', `${field}>=${lower}`);
          url.searchParams.append('filter', `${field}<=${upper}`);
          url.searchParams.set('orderBy', 'modifiedTime ASC,id ASC');
          // Drain the boundary timestamp by ID, then seek later timestamps. Separate
          // conjunctive queries avoid relying on an undocumented compound OR filter.
          if (cursor) {
            url.searchParams.append('filter', `modifiedTime${ties ? '=' : '>'}${cursor.time}`);
            if (ties) url.searchParams.append('filter', `id>${cursor.id}`);
          }
          url.searchParams.set('limit', String(PAGE_SIZE));
          if (field === 'deletedTime')
            url.searchParams.set('expand', 'lineItems,lineItems.modifications,payments');
          let list: { elements?: CloverOrder[] };
          try {
            list = (await fetchClover(url.href)) as { elements?: CloverOrder[] };
          } catch (error) {
            if (!(error instanceof BudgetSpent)) throw error;
            partial = true;
            if (field === 'modifiedTime') resumeFrom = cursor ? cursor.time : lower;
            break passes;
          }
          if (!Array.isArray(list.elements) || list.elements.length > PAGE_SIZE)
            throw new UserFacingError('Clover returned an invalid orders page.');
          let previous = cursor;
          for (const item of list.elements) {
            if (
              typeof item.id !== 'string' ||
              !/^[A-Za-z0-9_-]{1,200}$/.test(item.id) ||
              !Number.isSafeInteger(item.modifiedTime) ||
              (previous &&
                (item.modifiedTime < previous.time ||
                  (item.modifiedTime === previous.time && item.id <= previous.id))) ||
              (cursor &&
                (ties ? item.modifiedTime !== cursor.time : item.modifiedTime <= cursor.time))
            )
              throw new UserFacingError('Clover returned an invalid orders page.');
            previous = { time: item.modifiedTime, id: item.id };
          }
          const known = await knownRevisions(list.elements.map((item) => item.id));
          for (const item of list.elements) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            if (item.modifiedTime > upper) continue;
            // Already received at this modification, and not so recent that a refund
            // may still appear on it: counted, not read again.
            if (
              (known.get(item.id) ?? -1) >= item.modifiedTime &&
              (field === 'deletedTime' || item.modifiedTime < Date.now() - RECENT_REREAD_MS)
            ) {
              scanned++;
              duplicates++;
              if (field === 'deletedTime') deletedIds.add(item.id);
              continue;
            }
            if (field === 'deletedTime') {
              if (deletedIds.has(item.id)) continue;
              deletedIds.add(item.id);
              await ingest(item, readCloverOrder(item, item, state.started_at, true));
              continue;
            }
            if (deletedIds.has(item.id)) continue;
            const detailUrl =
              config.api +
              '/v3/merchants/' +
              encodeURIComponent(state.merchant_id) +
              '/orders/' +
              encodeURIComponent(item.id) +
              '?expand=lineItems,lineItems.modifications,payments,refunds';
            let order: CloverOrder;
            try {
              if (budget.newSales <= 0) throw new BudgetSpent();
              order = (await fetchClover(detailUrl)) as CloverOrder;
            } catch (error) {
              if (!(error instanceof BudgetSpent)) throw error;
              partial = true;
              resumeFrom = item.modifiedTime;
              break passes;
            }
            // A detail that doesn't match its list entry is paused under the list identity.
            if (!order || order.id !== item.id) {
              await ingest(item, pausedCloverOrder(item, 'clover_unreadable_order'));
              continue;
            }
            if (Number.isSafeInteger(order.modifiedTime) && order.modifiedTime > upper) continue;
            const identity = Number.isSafeInteger(order.modifiedTime)
              ? { id: item.id, modifiedTime: Math.max(item.modifiedTime, order.modifiedTime) }
              : item;
            await ingest(identity, readCloverOrder(identity, order, state.started_at));
          }
          if (list.elements.length < PAGE_SIZE) {
            if (!ties) {
              finished = true;
              break;
            }
            // The boundary is exhausted; the next range starts strictly after it.
            ties = false;
          } else ties = true;
          cursor = previous;
        }
        if (!finished)
          throw new UserFacingError(
            'Clover order page limit reached; checkpoint was not advanced.',
          );
      }
      const checkpoint = Math.max(state.checkpoint, partial ? resumeFrom : upper);
      await db
        .prepare(
          'UPDATE clover_sync_state SET checkpoint=?,last_success=?,last_error=NULL WHERE company_id=? AND lease_until=?',
        )
        .bind(checkpoint, new Date().toISOString(), companyId, lease)
        .run();
      return {
        scanned,
        created,
        held,
        duplicates,
        paused,
        partial,
        checkpoint: new Date(checkpoint).toISOString(),
      };
    });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Clover sync failed.';
    await db
      .prepare('UPDATE clover_sync_state SET last_error=? WHERE company_id=? AND lease_until=?')
      .bind(message.slice(0, 300), companyId, lease)
      .run();
    throw e;
  } finally {
    await db
      .prepare('UPDATE clover_sync_state SET lease_until=0 WHERE company_id=? AND lease_until=?')
      .bind(companyId, lease)
      .run();
  }
}
