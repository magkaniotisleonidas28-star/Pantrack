import type {SettingsActor} from './d1-replenishment-settings';

export type CloverSalesReadinessReason =
  | 'sync_not_configured' | 'clover_disconnected' | 'merchant_changed'
  | 'unaccepted_environment' | 'never_synced' | 'invalid_sync_state'
  | 'sync_disabled' | 'sync_error' | 'sync_stale' | 'held_events';

export type CloverSalesReadiness = Readonly<{
  companyId: string;
  source: 'clover_sync';
  status: 'current' | 'degraded' | 'unknown';
  heldEventCount: number;
  reasons: readonly CloverSalesReadinessReason[];
  merchantId: string | null;
  checkpointAt: string | null;
  lastSuccessAt: string | null;
  checkedAt: string;
}>;

type SyncRow = {
  environment: string;
  merchant_id: string;
  started_at: number;
  checkpoint: number;
  last_success: string | null;
  last_error: string | null;
  connection_environment: string | null;
  connection_merchant_id: string | null;
};
type CountRow = {n: number};
type Clock = {now(): Date};

function validTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

/** Reads accepted Clover sandbox health without contacting Clover or changing D1. */
export class D1ReplenishmentSalesReadiness {
  private readonly clock: Clock;
  private readonly syncEnabled: boolean;
  private readonly maxLagMs: number;

  constructor(private readonly db: D1Database, options: {syncEnabled: boolean; maxLagMs: number; clock?: Clock}) {
    if (typeof options.syncEnabled !== 'boolean' || !Number.isSafeInteger(options.maxLagMs) || options.maxLagMs < 1) {
      throw new Error('Clover sales-readiness policy is invalid.');
    }
    this.syncEnabled = options.syncEnabled;
    this.maxLagMs = options.maxLagMs;
    this.clock = options.clock ?? {now: () => new Date()};
  }

  async read(companyId: string, actor: SettingsActor): Promise<CloverSalesReadiness> {
    if (typeof companyId !== 'string' || !companyId.trim() || companyId.length > 200 ||
        !actor || actor.companyId !== companyId || !actor.userId?.trim() ||
        !['owner', 'manager', 'employee'].includes(actor.role)) {
      throw new Error('Company access is required.');
    }
    const now = this.clock.now().getTime();
    if (!Number.isFinite(now)) throw new Error('Sales-readiness clock is invalid.');
    const held = await this.db.prepare(`SELECT COUNT(*) AS n FROM sales_events e
      JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key
      WHERE e.company_id=? AND e.provider='clover' AND s.state='held'`)
      .bind(companyId).first<CountRow>();
    const heldEventCount = held?.n ?? 0;
    if (!Number.isSafeInteger(heldEventCount) || heldEventCount < 0) throw new Error('Held sales count is invalid.');
    const row = await this.db.prepare(`SELECT s.environment,s.merchant_id,s.started_at,s.checkpoint,
      s.last_success,s.last_error,c.environment AS connection_environment,
      c.merchant_id AS connection_merchant_id
      FROM clover_sync_state s LEFT JOIN clover_connections c ON c.company_id=s.company_id
      WHERE s.company_id=?`).bind(companyId).first<SyncRow>();

    const unknown: CloverSalesReadinessReason[] = [];
    const degraded: CloverSalesReadinessReason[] = [];
    if (!row) unknown.push('sync_not_configured');
    else {
      if (row.connection_merchant_id === null) unknown.push('clover_disconnected');
      else if (row.connection_environment !== row.environment || row.connection_merchant_id !== row.merchant_id) {
        unknown.push('merchant_changed');
      }
      if (row.environment !== 'sandbox') unknown.push('unaccepted_environment');
      if (row.last_success === null) unknown.push('never_synced');
      const successTime = row.last_success === null ? null : validTime(row.last_success);
      if (!Number.isSafeInteger(row.started_at) || !Number.isSafeInteger(row.checkpoint) ||
          row.started_at < 0 || row.checkpoint < row.started_at || row.checkpoint > now ||
          (row.last_success !== null && (successTime === null || successTime > now))) {
        unknown.push('invalid_sync_state');
      } else if (now - row.checkpoint > this.maxLagMs ||
          (successTime !== null && now - successTime > this.maxLagMs)) degraded.push('sync_stale');
      if (row.last_error !== null) degraded.push('sync_error');
    }
    if (!this.syncEnabled) degraded.push('sync_disabled');
    if (heldEventCount > 0) degraded.push('held_events');
    const reasons = [...unknown, ...degraded];
    return Object.freeze({
      companyId, source: 'clover_sync' as const,
      status: unknown.length ? 'unknown' as const : degraded.length ? 'degraded' as const : 'current' as const,
      heldEventCount, reasons: Object.freeze(reasons),
      merchantId: row?.merchant_id ?? null,
      checkpointAt: row && Number.isSafeInteger(row.checkpoint) &&
        Number.isFinite(new Date(row.checkpoint).getTime())
        ? new Date(row.checkpoint).toISOString() : null,
      lastSuccessAt: row?.last_success ?? null,
      checkedAt: new Date(now).toISOString(),
    });
  }
}
