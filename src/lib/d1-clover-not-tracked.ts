import { cloverSource } from '@/lib/clover-orders';
import {
  UNLINKED_SCAN_LIMIT,
  findUnlinkedClover,
  heldCloverSale,
  type HeldCloverSale,
} from '@/lib/clover-unlinked';
import { D1SalesMappingPort } from '@/lib/d1-sales-runtime';

export type CloverScope = { companyId: string; environment: string; merchantId: string };
export type NotTrackedKind = 'item' | 'option';
export type NotTrackedMark = {
  kind: NotTrackedKind;
  externalId: string;
  name: string | null;
  markedBy: string;
  markedAt: string;
};

/** Clover items and options that the most recent paused sales are waiting on. */
export async function unlinkedClover(
  db: D1Database,
  companyId: string,
  row: { environment: string; merchant_id: string },
) {
  const held = await db
    .prepare(
      "SELECT e.occurred_at,e.normalized_json,s.last_reason FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id=? AND e.provider='clover' AND e.environment=? AND e.merchant_id=? AND s.state='held' ORDER BY e.occurred_at DESC,e.event_key LIMIT ?",
    )
    .bind(companyId, row.environment, row.merchant_id, UNLINKED_SCAN_LIMIT + 1)
    .all<{ occurred_at: string; normalized_json: string; last_reason: string | null }>();
  const sales = held.results
    .slice(0, UNLINKED_SCAN_LIMIT)
    .map(heldCloverSale)
    .filter((sale): sale is HeldCloverSale => sale !== null);
  return findUnlinkedClover(sales, new D1SalesMappingPort(db), {
    companyId,
    source: cloverSource(companyId, row.environment, row.merchant_id),
    more: held.results.length > UNLINKED_SCAN_LIMIT,
  });
}

/**
 * Clover items and options marked Not tracked (decision 0012, step P2). Their
 * sale lines take nothing from stock. Each mark and unmark is logged with who
 * and when; repeating either changes nothing and logs nothing.
 */
export class D1CloverNotTracked {
  constructor(
    private readonly db: D1Database,
    private readonly options: { clock?: () => Date; id?: () => string } = {},
  ) {}

  private now() {
    return (this.options.clock?.() ?? new Date()).toISOString();
  }

  private id() {
    return this.options.id?.() ?? crypto.randomUUID();
  }

  async list(scope: CloverScope): Promise<NotTrackedMark[]> {
    const rows = await this.db
      .prepare(
        'SELECT kind,external_id,name,marked_by,marked_at FROM clover_not_tracked WHERE company_id=? AND environment=? AND merchant_id=? ORDER BY marked_at DESC,kind,external_id',
      )
      .bind(scope.companyId, scope.environment, scope.merchantId)
      .all<{
        kind: NotTrackedKind;
        external_id: string;
        name: string | null;
        marked_by: string;
        marked_at: string;
      }>();
    return rows.results.map((row) => ({
      kind: row.kind,
      externalId: row.external_id,
      name: row.name,
      markedBy: row.marked_by,
      markedAt: row.marked_at,
    }));
  }

  /** True when something changed. */
  async mark(
    scope: CloverScope,
    input: { kind: NotTrackedKind; externalId: string; name: string | null; actor: string },
  ) {
    const at = this.now();
    const [inserted] = await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO clover_not_tracked(company_id,environment,merchant_id,kind,external_id,name,marked_by,marked_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
        )
        .bind(
          scope.companyId,
          scope.environment,
          scope.merchantId,
          input.kind,
          input.externalId,
          input.name,
          input.actor,
          at,
        ),
      this.db
        .prepare(
          "INSERT INTO clover_not_tracked_changes(company_id,change_id,environment,merchant_id,kind,external_id,action,actor,at) SELECT ?,?,?,?,?,?,'mark',?,? WHERE changes()=1",
        )
        .bind(
          scope.companyId,
          this.id(),
          scope.environment,
          scope.merchantId,
          input.kind,
          input.externalId,
          input.actor,
          at,
        ),
    ]);
    return Number(inserted?.meta?.changes ?? 0) === 1;
  }

  /** True when something changed. */
  async unmark(
    scope: CloverScope,
    input: { kind: NotTrackedKind; externalId: string; actor: string },
  ) {
    const at = this.now();
    const [deleted] = await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM clover_not_tracked WHERE company_id=? AND environment=? AND merchant_id=? AND kind=? AND external_id=?',
        )
        .bind(scope.companyId, scope.environment, scope.merchantId, input.kind, input.externalId),
      this.db
        .prepare(
          "INSERT INTO clover_not_tracked_changes(company_id,change_id,environment,merchant_id,kind,external_id,action,actor,at) SELECT ?,?,?,?,?,?,'unmark',?,? WHERE changes()=1",
        )
        .bind(
          scope.companyId,
          this.id(),
          scope.environment,
          scope.merchantId,
          input.kind,
          input.externalId,
          input.actor,
          at,
        ),
    ]);
    return Number(deleted?.meta?.changes ?? 0) === 1;
  }
}
