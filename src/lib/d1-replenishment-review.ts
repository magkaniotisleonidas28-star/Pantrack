import type {ExactQuantity, UnitDimension} from './inventory-consumption-contract';
import {readCanonical} from './inventory-quantities';
import {D1ReplenishmentSettingsStore, type SettingsActor} from './d1-replenishment-settings';
import {buildReviewProposal, type ReviewProposalInput, type ReviewProposalSnapshot} from './replenishment-proposal';

type Fixture<T> = Readonly<T & {companyId: string; source: 'fictional_fixture'}>;
export type ReviewSalesFixture = Fixture<ReviewProposalInput['salesReadiness']>;
export type ReviewSupplierFixture = Fixture<ReviewProposalInput['supplier']>;

export type ReviewSourceRequest = Readonly<{
  companyId: string;
  productId: string;
  actor: SettingsActor;
  sales: ReviewSalesFixture;
  supplier: ReviewSupplierFixture;
}>;

export type ReviewSourceResult =
  | Readonly<{kind: 'snapshot'; snapshot: ReviewProposalSnapshot}>
  | Readonly<{kind: 'unavailable'; reason: 'settings_missing' | 'exact_inventory_missing' | 'settings_stale' | 'invalid_balance' | 'pack_unclassified' | 'source_changed'}>;

type BalanceRow = {
  config_id: string;
  config_version: number;
  config_status: string;
  dimension: UnitDimension;
  unit_dimension: UnitDimension | null;
  on_hand_minor: string;
  incoming_minor: string;
  purchase_quantity_minor: string | null;
  version: number;
  latest_count_effective_at: string | null;
};
type VersionRow = {balance_version: number; config_id: string; config_version: number; config_status: string; settings_version: number | null};
type Clock = {now(): Date};
const ZERO = BigInt(0);

function validFixture(request: ReviewSourceRequest): void {
  for (const fixture of [request.sales, request.supplier]) {
    if (!fixture || fixture.source !== 'fictional_fixture' || fixture.companyId !== request.companyId) {
      throw new Error('Review fixtures must belong to the requested company.');
    }
  }
  if (!['current', 'degraded', 'unknown'].includes(request.sales.status) ||
      !Number.isSafeInteger(request.sales.heldEventCount) || request.sales.heldEventCount < 0) {
    throw new Error('Review sales fixture is invalid.');
  }
  for (const value of [request.supplier.supplierId, request.supplier.accountId, request.supplier.locationId, request.supplier.sku]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Review supplier fixture is invalid.');
  }
}

function quantity(dimension: UnitDimension, minor: string): ExactQuantity {
  const value = {dimension, minor};
  readCanonical(value);
  return value;
}

function countTime(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid count time.');
  return new Date(parsed).toISOString();
}

/** Read-only A6 bridge. No proposal is persisted or eligible for submission. */
export class D1ReplenishmentReview {
  private readonly settings: D1ReplenishmentSettingsStore;
  private readonly clock: Clock;
  constructor(private readonly db: D1Database, options: {clock?: Clock} = {}) {
    this.settings = new D1ReplenishmentSettingsStore(db);
    this.clock = options.clock ?? {now: () => new Date()};
  }

  async build(request: ReviewSourceRequest): Promise<ReviewSourceResult> {
    // The settings store checks the server-derived actor and company before data is read.
    const settings = await this.settings.current(request.companyId, request.productId, request.actor);
    validFixture(request);
    if (!settings) return {kind: 'unavailable', reason: 'settings_missing'};
    const row = await this.db.prepare(`SELECT b.config_id,c.version AS config_version,c.status AS config_status,
      b.dimension,u.dimension AS unit_dimension,b.on_hand_minor,b.incoming_minor,c.purchase_quantity_minor,
      b.version,b.latest_count_effective_at
      FROM inventory_balances_exact b
      JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
      JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE b.company_id=? AND b.product_id=?`)
      .bind(request.companyId, request.productId).first<BalanceRow>();
    if (!row) return {kind: 'unavailable', reason: 'exact_inventory_missing'};
    if (row.config_status !== 'active' || settings.inventoryConfigId !== row.config_id ||
        settings.inventoryConfigVersion !== row.config_version || settings.dimension !== row.dimension ||
        row.unit_dimension !== row.dimension) return {kind: 'unavailable', reason: 'settings_stale'};
    if (row.purchase_quantity_minor === null) return {kind: 'unavailable', reason: 'pack_unclassified'};

    let snapshot: ReviewProposalSnapshot;
    try {
      const onHand = quantity(row.dimension, row.on_hand_minor);
      const incoming = quantity(row.dimension, row.incoming_minor);
      const pack = quantity(row.dimension, row.purchase_quantity_minor);
      if (readCanonical(onHand) < ZERO || readCanonical(incoming) < ZERO) return {kind: 'unavailable', reason: 'invalid_balance'};
      if (readCanonical(pack) <= ZERO) return {kind: 'unavailable', reason: 'pack_unclassified'};
      const shelfLimit = settings.settings.shelfDays === null ? null : quantity(
        row.dimension, (readCanonical(settings.settings.dailyUse) * BigInt(settings.settings.shelfDays)).toString(),
      );
      snapshot = buildReviewProposal({
        companyId: request.companyId, productId: request.productId,
        inventoryVersion: row.version, inventoryConfigId: row.config_id,
        inventoryConfigVersion: row.config_version, settingsChangeId: settings.changeId,
        settingsVersion: settings.version, settingsChangedBy: settings.changedBy,
        calculatedAt: this.clock.now().toISOString(), lastCountAt: countTime(row.latest_count_effective_at),
        countEveryDays: settings.settings.countEveryDays, expiresAt: null, expiryStatus: 'not_checked',
        salesReadiness: {source: 'fictional_fixture', status: request.sales.status, heldEventCount: request.sales.heldEventCount},
        supplier: {
          source: 'fictional_fixture',
          supplierId: request.supplier.supplierId, accountId: request.supplier.accountId,
          locationId: request.supplier.locationId, sku: request.supplier.sku,
        },
        quantities: {target: settings.settings.target, onHand, incoming, pack, capacity: settings.settings.capacity, shelfLimit},
        policy: {
          minimumPacks: settings.settings.minimumPacks, orderMultiplePacks: settings.settings.orderMultiplePacks,
          maximumPacks: settings.settings.maximumPacks,
        },
      });
    } catch {
      return {kind: 'unavailable', reason: 'invalid_balance'};
    }
    // Detect changes between the settings and balance reads. A7 must still revalidate
    // these versions when it introduces durable proposal lifecycle actions.
    const current = await this.db.prepare(`SELECT b.version AS balance_version,b.config_id,c.version AS config_version,
      c.status AS config_status,(SELECT MAX(version) FROM replenishment_settings_versions
      WHERE company_id=b.company_id AND product_id=b.product_id) AS settings_version
      FROM inventory_balances_exact b JOIN inventory_config_versions c
      ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
      WHERE b.company_id=? AND b.product_id=?`)
      .bind(request.companyId, request.productId).first<VersionRow>();
    if (!current || current.balance_version !== row.version || current.config_id !== row.config_id ||
        current.config_version !== row.config_version || current.config_status !== 'active' ||
        current.settings_version !== settings.version) return {kind: 'unavailable', reason: 'source_changed'};
    return {kind: 'snapshot', snapshot};
  }
}
