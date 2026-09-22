import {INVENTORY_CONSUMPTION_CONTRACT, type InventoryConsumptionApplied} from '@/lib/inventory-consumption-contract';
import {CONSUMPTION_SNAPSHOT_SQL, type ConsumptionSnapshotGuard} from '@/lib/inventory-consumption-snapshot';

export type ConsumptionBalanceSnapshot = {
  productId: string;
  configId: string;
  dimension: string;
  onHandMinor: string;
  estimatedUsedMinor: string;
  version: number;
  latestCountEffectiveAt: string | null;
};

export class InventoryCommitError extends Error {
  constructor(public readonly code: 'invalid_plan' | 'company_mismatch' | 'idempotency_conflict' | 'stale_balance', message: string) {
    super(message);
  }
}

function minor(value: string): bigint {
  if (!/^(?:0|-?[1-9]\d*)$/.test(value)) throw new InventoryCommitError('invalid_plan', 'Invalid canonical quantity.');
  const number = BigInt(value);
  if (number < BigInt('-9223372036854775808') || number > BigInt('9223372036854775807')) {
    throw new InventoryCommitError('invalid_plan', 'Quantity exceeds supported range.');
  }
  return number;
}

/**
 * Internal persistence boundary, NOT an authorized API or a consumption planner.
 * Callers must authenticate, authorize and bind companyId on the server, resolve
 * recipes/modifiers, and supply their original balance snapshots. The fingerprint
 * must represent canonical request input, independent of the calculated balances.
 * No route uses this store until the A2/A3 reviews and A4 integration are complete.
 */
export class D1InventoryConsumptionStore {
  constructor(private readonly db: D1Database, private readonly companyId: string) {
    if (!companyId) throw new InventoryCommitError('company_mismatch', 'Company is required.');
  }

  async balance(productId: string): Promise<ConsumptionBalanceSnapshot | null> {
    return this.db.prepare(`SELECT product_id AS productId, config_id AS configId,
      dimension, on_hand_minor AS onHandMinor, estimated_used_minor AS estimatedUsedMinor,
      version, latest_count_effective_at AS latestCountEffectiveAt
      FROM inventory_balances_exact WHERE company_id = ? AND product_id = ?`)
      .bind(this.companyId, productId).first<ConsumptionBalanceSnapshot>();
  }

  async application(key: string, fingerprint: string): Promise<InventoryConsumptionApplied | null> {
    const row = await this.db.prepare(`SELECT request_fingerprint, result_json FROM inventory_consumption_applications
      WHERE company_id = ? AND idempotency_key = ?`).bind(this.companyId, key)
      .first<{request_fingerprint: string; result_json: string}>();
    if (!row) return null;
    if (row.request_fingerprint !== fingerprint) throw new InventoryCommitError('idempotency_conflict', 'Sale key already has different input.');
    return {...JSON.parse(row.result_json) as InventoryConsumptionApplied, replayed: true};
  }

  async commit(input: InventoryConsumptionApplied, fingerprint: string, snapshots: ConsumptionBalanceSnapshot[], actor: string, at: string, guard?: ConsumptionSnapshotGuard): Promise<InventoryConsumptionApplied> {
    // Detach caller-owned data before any await.
    const result = structuredClone(input);
    const expected = structuredClone(snapshots);
    const fence = guard ? structuredClone(guard) : null;
    if (result.companyId !== this.companyId) throw new InventoryCommitError('company_mismatch', 'Plan belongs to another company.');
    const invalid = () => new InventoryCommitError('invalid_plan', 'Invalid inventory application plan.');
    if (result.contract !== INVENTORY_CONSUMPTION_CONTRACT || result.status !== 'applied' || result.replayed ||
      !result.idempotencyKey || !fingerprint || !actor || !Number.isFinite(Date.parse(at)) ||
      !Number.isFinite(Date.parse(result.occurredAt)) || Date.parse(result.occurredAt) > Date.parse(at) ||
      expected.length !== result.changes.length || new Set(expected.map(row => row.productId)).size !== expected.length ||
      new Set(result.changes.map(row => row.productId)).size !== result.changes.length) throw invalid();

    const updates = result.changes.map(change => {
      const snapshot = expected.find(row => row.productId === change.productId);
      if (!snapshot || !snapshot.configId || !['count', 'mass', 'volume'].includes(snapshot.dimension) ||
        snapshot.dimension !== change.consumed.dimension || snapshot.dimension !== change.balanceBefore.dimension ||
        snapshot.dimension !== change.balanceAfter.dimension || snapshot.onHandMinor !== change.balanceBefore.minor ||
        snapshot.version !== change.versionBefore || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0 ||
        !Number.isSafeInteger(change.versionAfter) || change.versionAfter !== snapshot.version + 1 ||
        snapshot.latestCountEffectiveAt === null || !Number.isFinite(Date.parse(snapshot.latestCountEffectiveAt)) ||
        Date.parse(result.occurredAt) <= Date.parse(snapshot.latestCountEffectiveAt)) throw invalid();
      const consumed = minor(change.consumed.minor);
      if (consumed <= BigInt(0) || minor(change.balanceBefore.minor) - consumed !== minor(change.balanceAfter.minor)) throw invalid();
      const used = minor(snapshot.estimatedUsedMinor);
      if (used < BigInt(0)) throw invalid();
      const nextUsed = String(used + consumed);
      minor(nextUsed);
      return {change, snapshot, nextUsed};
    });
    const prior = await this.application(result.idempotencyKey, fingerprint);
    if (prior) return prior;

    const receiptValues = [result.idempotencyKey, result.contract, fingerprint, result.occurredAt, JSON.stringify(result), at];
    const statements = [fence ? this.db.prepare(`INSERT INTO inventory_consumption_applications
      (company_id,idempotency_key,contract,request_fingerprint,occurred_at,result_json,applied_at)
      SELECT CASE WHEN (${CONSUMPTION_SNAPSHOT_SQL}) = ? THEN ? ELSE NULL END,?,?,?,?,?,?`)
      .bind(this.companyId, fence.recipeIdsJson, fence.snapshot, this.companyId, ...receiptValues)
      : this.db.prepare(`INSERT INTO inventory_consumption_applications
      (company_id,idempotency_key,contract,request_fingerprint,occurred_at,result_json,applied_at)
      VALUES (?,?,?,?,?,?,?)`).bind(this.companyId, result.idempotencyKey, result.contract, fingerprint,
      result.occurredAt, JSON.stringify(result), at)];
    for (const {change, snapshot, nextUsed} of updates) {
      statements.push(this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor = ?,
        estimated_used_minor = ?, version = ?, updated_at = ?
        WHERE company_id = ? AND product_id = ? AND config_id = ? AND dimension = ?
        AND on_hand_minor = ? AND estimated_used_minor = ? AND version = ? AND latest_count_effective_at = ?`)
        .bind(change.balanceAfter.minor, nextUsed, change.versionAfter, at, this.companyId,
          change.productId, snapshot.configId, snapshot.dimension, snapshot.onHandMinor,
          snapshot.estimatedUsedMinor, snapshot.version, snapshot.latestCountEffectiveAt));
      // A missed optimistic update MUST abort the whole batch, not quietly skip
      // an ingredient. The NOT NULL product_id constraint is our SQL assertion.
      statements.push(this.db.prepare(`INSERT INTO inventory_events_exact
        (company_id,id,product_id,config_id,action,dimension,quantity_minor,
         balance_version_before,balance_version_after,effective_at,recorded_at,actor,note,consumption_key)
        VALUES (?,?,CASE WHEN changes() = 1 THEN ? ELSE NULL END,?,'consumption',?,?,?,?,?,?,?,?,?)`)
        .bind(this.companyId, JSON.stringify(['consumption', result.idempotencyKey, change.productId]),
          change.productId, snapshot.configId, snapshot.dimension, change.consumed.minor,
          change.versionBefore, change.versionAfter, result.occurredAt, at, actor,
          'Applied sale ingredient consumption', result.idempotencyKey));
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      // A concurrent identical request may have won the unique key race.
      const winner = await this.application(result.idempotencyKey, fingerprint);
      if (winner) return winner;
      if (String(error).includes('NOT NULL constraint failed: inventory_events_exact.product_id') ||
        String(error).includes('NOT NULL constraint failed: inventory_consumption_applications.company_id')) {
        throw new InventoryCommitError('stale_balance', 'Inventory changed; reload and recalculate the entire sale.');
      }
      throw error;
    }
    return result;
  }
}
