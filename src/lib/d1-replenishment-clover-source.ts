import type {CloverSalesReadiness} from './d1-replenishment-sales-readiness';

export type CloverReviewPolicy = Readonly<{syncEnabled: boolean; maxLagMs: number}>;

/** The database predicate used at origin insert and at every durable lifecycle action. */
export function cloverSourceGuard(
  sales: CloverSalesReadiness,
  policy: CloverReviewPolicy | undefined,
  now: Date,
): Readonly<{sql: string; args: readonly (string | number)[]}> {
  if (policy === undefined) return {sql: '0=1', args: []};
  if (typeof policy.syncEnabled !== 'boolean' || !Number.isSafeInteger(policy.maxLagMs) || policy.maxLagMs < 1 ||
      !Number.isFinite(now.getTime())) throw new Error('Clover review policy or clock is invalid.');
  if (!policy.syncEnabled) return {sql: '0=1', args: []};
  if (sales.status !== 'current' || sales.merchantId === null ||
      sales.checkpointAt === null || sales.lastSuccessAt === null) {
    return {sql: '0=1', args: []};
  }
  const checkpoint = Date.parse(sales.checkpointAt);
  if (!Number.isSafeInteger(checkpoint)) return {sql: '0=1', args: []};
  const current = now.getTime();
  const oldest = current - policy.maxLagMs;
  return {
    sql: `EXISTS (
      SELECT 1 FROM clover_sync_state s
      JOIN clover_connections c ON c.company_id=s.company_id
        AND c.environment=s.environment AND c.merchant_id=s.merchant_id
      WHERE s.company_id=? AND s.environment='sandbox' AND s.merchant_id=?
        AND s.started_at>=0 AND s.started_at<=s.checkpoint
        AND s.checkpoint=? AND s.last_success=? AND s.last_error IS NULL
        AND s.checkpoint BETWEEN ? AND ?
        AND s.last_success BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM sales_events e JOIN sales_event_states t
            ON t.company_id=e.company_id AND t.event_key=e.event_key
          WHERE e.company_id=s.company_id AND e.provider='clover' AND t.state='held'
        )
    )`,
    args: [sales.companyId, sales.merchantId, checkpoint, sales.lastSuccessAt, oldest, current,
      new Date(oldest).toISOString(), now.toISOString()],
  };
}
