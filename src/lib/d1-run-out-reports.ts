import { D1InventoryManagementService, InventoryManagementError } from './d1-inventory-management';
import {
  RunOutError,
  type RunOutReportOutcome,
  type RunOutReportView,
  type RunOutResolutionOutcome,
} from './run-out-contract';

type Clock = { now(): Date };
type Actor = Readonly<{ userId: string; email: string }>;
type ReportRow = {
  id: string;
  product_id: string;
  reported_by: string;
  reporter_email: string;
  note: string;
  reported_at: string;
};

const view = (row: ReportRow): RunOutReportView => ({
  id: row.id,
  productId: row.product_id,
  reporterEmail: row.reporter_email,
  note: row.note,
  reportedAt: row.reported_at,
});

const OPEN = `SELECT r.id,r.product_id,r.reported_by,r.reporter_email,r.note,r.reported_at
  FROM run_out_reports r LEFT JOIN run_out_resolutions s
  ON s.company_id=r.company_id AND s.report_id=r.id
  WHERE r.company_id=? AND s.report_id IS NULL`;

/**
 * R1c (decision 0011). Any member reports that a product ran out; a report never changes stock.
 * An owner or manager confirms it as a zero count (one batch with that count) or dismisses it.
 */
export class D1RunOutReports {
  private readonly clock: Clock;
  private readonly stock: D1InventoryManagementService;

  constructor(
    private readonly db: D1Database,
    options: { clock?: Clock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.stock = new D1InventoryManagementService(db, { clock: this.clock });
  }

  /** Products that can be reported: those with exact stock set up. */
  async stocked(companyId: string): Promise<string[]> {
    const rows = await this.db
      .prepare(
        'SELECT product_id FROM inventory_balances_exact WHERE company_id=? ORDER BY product_id',
      )
      .bind(companyId)
      .all<{ product_id: string }>();
    return rows.results.map((row) => row.product_id);
  }

  async open(companyId: string): Promise<RunOutReportView[]> {
    const rows = await this.db
      .prepare(OPEN + ' ORDER BY r.reported_at,r.id')
      .bind(companyId)
      .all<ReportRow>();
    return rows.results.map(view);
  }

  async report(
    input: { companyId: string; operationId: string; productId: string; note: string },
    actor: Actor,
  ): Promise<RunOutReportOutcome> {
    const note = input.note.trim();
    const existing = await this.db
      .prepare(
        'SELECT id,product_id,reported_by,reporter_email,note,reported_at FROM run_out_reports WHERE company_id=? AND id=?',
      )
      .bind(input.companyId, input.operationId)
      .first<ReportRow>();
    if (existing) {
      if (
        existing.product_id !== input.productId ||
        existing.note !== note ||
        existing.reported_by !== actor.userId
      )
        throw new RunOutError('conflict', 'That report reference was already used.');
      return { report: view(existing), created: true };
    }
    const stocked = await this.db
      .prepare('SELECT 1 AS ok FROM inventory_balances_exact WHERE company_id=? AND product_id=?')
      .bind(input.companyId, input.productId)
      .first<{ ok: number }>();
    if (!stocked) throw new RunOutError('no_stock', 'Choose a product that has stock set up.');
    const open = await this.db
      .prepare(OPEN + ' AND r.product_id=? ORDER BY r.reported_at,r.id LIMIT 1')
      .bind(input.companyId, input.productId)
      .first<ReportRow>();
    if (open) return { report: view(open), created: false };
    const reportedAt = this.clock.now().toISOString();
    await this.db
      .prepare(
        'INSERT INTO run_out_reports(company_id,id,product_id,reported_by,reporter_email,note,reported_at) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        input.companyId,
        input.operationId,
        input.productId,
        actor.userId,
        actor.email,
        note,
        reportedAt,
      )
      .run();
    return {
      report: {
        id: input.operationId,
        productId: input.productId,
        reporterEmail: actor.email,
        note,
        reportedAt,
      },
      created: true,
    };
  }

  /** Confirms (zero count) or dismisses a report and every other open report for that product. */
  async resolve(
    input: { companyId: string; operationId: string; reportId: string },
    outcome: 'confirmed' | 'dismissed',
    actor: Actor,
  ): Promise<RunOutResolutionOutcome> {
    const replay = () =>
      this.db
        .prepare(
          'SELECT report_id,outcome,count_id,operation_id FROM run_out_resolutions WHERE company_id=? AND operation_id=? ORDER BY report_id',
        )
        .bind(input.companyId, input.operationId)
        .all<{
          report_id: string;
          outcome: string;
          count_id: string | null;
          operation_id: string;
        }>();
    const done = (await replay()).results;
    if (done.length) {
      if (done[0].outcome !== outcome || !done.some((row) => row.report_id === input.reportId))
        throw new RunOutError('conflict', 'That action reference was already used.');
      return {
        outcome,
        reportIds: done.map((row) => row.report_id),
        countId: done[0].count_id,
      };
    }
    const report = await this.db
      .prepare('SELECT product_id FROM run_out_reports WHERE company_id=? AND id=?')
      .bind(input.companyId, input.reportId)
      .first<{ product_id: string }>();
    if (!report) throw new RunOutError('not_found', 'That report was not found.');
    const open = (
      await this.db
        .prepare(OPEN + ' AND r.product_id=? ORDER BY r.reported_at,r.id')
        .bind(input.companyId, report.product_id)
        .all<ReportRow>()
    ).results;
    if (!open.some((row) => row.id === input.reportId))
      throw new RunOutError('already_resolved', 'Someone already dealt with this report.');
    const resolvedAt = this.clock.now().toISOString();
    // Sorted like the saved outcomes, so a repeated request returns exactly the same answer.
    const ids = open.map((row) => row.id).sort();
    if (outcome === 'dismissed') {
      try {
        await this.db.batch(
          ids.map((id) =>
            this.db
              .prepare(
                `INSERT INTO run_out_resolutions(company_id,report_id,operation_id,outcome,count_id,resolved_by,resolved_at)
              VALUES(?,?,?,'dismissed',NULL,?,?)`,
              )
              .bind(input.companyId, id, input.operationId, actor.email, resolvedAt),
          ),
        );
      } catch (error) {
        if (/constraint|unique|primary key/i.test(String((error as Error)?.message)))
          throw new RunOutError('already_resolved', 'Someone already dealt with this report.');
        throw error;
      }
      return { outcome, reportIds: ids, countId: null };
    }
    const balance = await this.db
      .prepare(
        `SELECT b.version,c.stock_unit_id FROM inventory_balances_exact b JOIN inventory_config_versions c
        ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
        WHERE b.company_id=? AND b.product_id=?`,
      )
      .bind(input.companyId, report.product_id)
      .first<{ version: number; stock_unit_id: string }>();
    if (!balance) throw new RunOutError('no_stock', 'This product no longer has stock set up.');
    const countOperation = 'run-out:' + input.operationId,
      countId = 'count:' + countOperation;
    // Each outcome is written only if stock is still at the version the count is saved against,
    // so the outcomes and the zero count are saved together or not at all.
    const outcomes = ids.map((id) =>
      this.db
        .prepare(
          `INSERT INTO run_out_resolutions(company_id,report_id,operation_id,outcome,count_id,resolved_by,resolved_at)
          SELECT ?,?,?,'confirmed',?,?,? WHERE EXISTS(
            SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND version=?)`,
        )
        .bind(
          input.companyId,
          id,
          input.operationId,
          countId,
          actor.email,
          resolvedAt,
          input.companyId,
          report.product_id,
          balance.version,
        ),
    );
    try {
      await this.stock.recordCount(
        {
          companyId: input.companyId,
          productId: report.product_id,
          operationId: countOperation,
          expectedVersion: balance.version,
          actor: actor.email,
          amount: '0',
          unitId: balance.stock_unit_id,
          effectiveAt: resolvedAt,
          note: 'Confirmed run-out report',
        },
        outcomes,
      );
    } catch (error) {
      if (error instanceof InventoryManagementError) {
        if (error.code === 'concurrent_update')
          throw new RunOutError('stale', 'Stock just changed. Please try again.');
        throw new RunOutError('stale', error.message);
      }
      // A second outcome for the same report breaks its primary key, and the whole batch is undone.
      if (/constraint|unique|primary key/i.test(String((error as Error)?.message)))
        throw new RunOutError('already_resolved', 'Someone already dealt with this report.');
      throw error;
    }
    const saved = (await replay()).results;
    if (saved.length !== ids.length || saved.some((row) => row.count_id !== countId))
      throw new RunOutError('stale', 'Stock just changed. Please try again.');
    return { outcome, reportIds: ids, countId };
  }
}
