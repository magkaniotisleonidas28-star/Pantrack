import { UserFacingError } from '@/lib/user-facing-error';

export type CloverRemovalReason = 'app_removed' | 'access_refused';

/** Clover no longer lets Pantrack in: the app was removed or access was refused. */
export class CloverAccessRefused extends UserFacingError {
  constructor() {
    super('Clover access was removed. Reconnect Clover to keep sales coming in.');
    this.name = 'CloverAccessRefused';
  }
}

/**
 * Records that Clover access ended without the owner disconnecting (decision
 * 0012, step P4). Automatic syncing stops and the owner is told to reconnect.
 * Recipe links, Not tracked marks, the sync checkpoint and sales history are
 * kept.
 * - `app_removed`: the café removed the app in Clover. The stored tokens are
 *   deleted, so Pantrack reads nothing more until the owner reconnects.
 * - `access_refused`: Clover refused the stored tokens. They are kept, and a
 *   later Clover request that works clears the notice.
 * Nothing is recorded when that merchant's connection is already gone.
 * Returns whether it recorded.
 */
export async function recordCloverAccessRemoved(
  db: D1Database,
  input: {
    companyId: string;
    environment: string;
    merchantId: string;
    reason: CloverRemovalReason;
    at?: Date;
  },
) {
  const at = (input.at ?? new Date()).toISOString();
  const scope = [input.companyId, input.environment, input.merchantId] as const;
  const record = `INSERT INTO clover_access_removals(company_id,environment,merchant_id,reason,removed_at)
    SELECT ?,?,?,?,? WHERE %CONDITION%
    ON CONFLICT(company_id) DO UPDATE SET environment=excluded.environment,
    merchant_id=excluded.merchant_id,reason=excluded.reason,removed_at=excluded.removed_at`;
  const statements =
    input.reason === 'app_removed'
      ? [
          db
            .prepare(
              'DELETE FROM clover_connections WHERE company_id=? AND environment=? AND merchant_id=?',
            )
            .bind(...scope),
          db.prepare(record.replace('%CONDITION%', 'changes()=1')).bind(...scope, input.reason, at),
        ]
      : [
          db
            .prepare(
              record.replace(
                '%CONDITION%',
                'EXISTS(SELECT 1 FROM clover_connections WHERE company_id=? AND environment=? AND merchant_id=?)',
              ),
            )
            .bind(...scope, input.reason, at, ...scope),
        ];
  statements.push(
    db
      .prepare(
        "INSERT INTO security_audit(id,company_id,actor,action,target,created) SELECT ?,?,'clover','clover.access_removed',?,? WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), input.companyId, input.reason, Date.parse(at)),
  );
  await db.batch(statements);
  const recorded = await db
    .prepare(
      'SELECT 1 AS found FROM clover_access_removals WHERE company_id=? AND reason=? AND removed_at=?',
    )
    .bind(input.companyId, input.reason, at)
    .first();
  return !!recorded;
}

/** A Clover request worked again, so a refused-access notice no longer applies. */
export async function clearCloverAccessRefused(db: D1Database, companyId: string) {
  await db
    .prepare("DELETE FROM clover_access_removals WHERE company_id=? AND reason='access_refused'")
    .bind(companyId)
    .run();
}

/** The last removal for a company, or null once it reconnected or disconnected. */
export async function cloverAccessRemoval(db: D1Database, companyId: string) {
  const row = await db
    .prepare('SELECT reason,removed_at FROM clover_access_removals WHERE company_id=?')
    .bind(companyId)
    .first<{ reason: CloverRemovalReason; removed_at: string }>();
  return row ? { reason: row.reason, at: row.removed_at } : null;
}
