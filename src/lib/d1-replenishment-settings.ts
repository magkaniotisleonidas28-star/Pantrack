import type {ExactQuantity, UnitDimension} from './inventory-consumption-contract';
import {readCanonical} from './inventory-quantities';
import type {Role} from './authorization';

export type ReplenishmentSettings = Readonly<{
  target: ExactQuantity;
  capacity: ExactQuantity | null;
  dailyUse: ExactQuantity;
  shelfDays: number | null;
  countEveryDays: number;
  minimumPacks: string;
  orderMultiplePacks: string;
  maximumPacks: string | null;
}>;

export type SettingsActor = Readonly<{companyId: string; userId: string; role: Role}>;
export type SettingsVersion = Readonly<{
  companyId: string;
  productId: string;
  version: number;
  changeId: string;
  inventoryConfigId: string;
  inventoryConfigVersion: number;
  dimension: UnitDimension;
  settings: ReplenishmentSettings;
  changedBy: string;
  changeReason: string;
  changedAt: string;
}>;

export type SaveSettingsInput = Readonly<{
  companyId: string;
  productId: string;
  changeId: string;
  expectedVersion: number;
  expectedConfigId: string;
  expectedConfigVersion: number;
  actor: SettingsActor;
  reason: string;
  settings: ReplenishmentSettings;
}>;

export class ReplenishmentSettingsError extends Error {
  constructor(public readonly code: 'invalid_request' | 'forbidden' | 'config_changed' | 'concurrent_update' | 'change_conflict' | 'corrupt_store' | 'storage_failure', message: string) {
    super(message);
    this.name = 'ReplenishmentSettingsError';
  }
}

type StoredRow = {
  company_id: string; product_id: string; version: number; change_id: string;
  inventory_config_id: string; inventory_config_version: number; dimension: UnitDimension;
  settings_json: string; changed_by: string; change_reason: string; changed_at: string;
};
type ConfigRow = {id: string; version: number; dimension: UnitDimension | null};
type Clock = {now(): Date};
const MAX_MINOR = BigInt('9223372036854775807');

function id(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ReplenishmentSettingsError('invalid_request', 'A company, product, change, config, or actor ID is invalid.');
  return value;
}

function actorFor(actor: SettingsActor, companyId: string, write: boolean): void {
  if (!actor || actor.companyId !== companyId || !['owner', 'manager', 'employee'].includes(actor.role)) throw new ReplenishmentSettingsError('forbidden', 'Company access is required.');
  id(actor.userId);
  if (write && actor.role !== 'owner' && actor.role !== 'manager') throw new ReplenishmentSettingsError('forbidden', 'An owner or manager must change replenishment settings.');
}

function packPolicy(value: string, positive: boolean): string {
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|[1-9]\d*)$/.test(value) ||
      BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER) || (positive && value === '0')) {
    throw new ReplenishmentSettingsError('invalid_request', 'Pack policy must use bounded whole packs.');
  }
  return value;
}

function quantity(value: ExactQuantity, dimension: UnitDimension): ExactQuantity {
  try {
    const minor = readCanonical(value);
    if (value.dimension !== dimension || minor < BigInt(0)) throw new Error('dimension or sign');
    return {dimension, minor: value.minor};
  } catch {
    throw new ReplenishmentSettingsError('invalid_request', 'Planning quantities must be nonnegative canonical values in the active inventory dimension.');
  }
}

function normalize(settings: ReplenishmentSettings, dimension: UnitDimension): ReplenishmentSettings {
  if (!settings || !['count', 'mass', 'volume'].includes(dimension)) throw new ReplenishmentSettingsError('config_changed', 'A classified active inventory configuration is required.');
  const target = quantity(settings.target, dimension);
  const capacity = settings.capacity === null ? null : quantity(settings.capacity, dimension);
  const dailyUse = quantity(settings.dailyUse, dimension);
  if (!Number.isSafeInteger(settings.countEveryDays) || settings.countEveryDays < 1 || settings.countEveryDays > 3650 ||
      (settings.shelfDays !== null && (!Number.isSafeInteger(settings.shelfDays) || settings.shelfDays < 1 || settings.shelfDays > 3650))) {
    throw new ReplenishmentSettingsError('invalid_request', 'Count and shelf intervals must be positive whole days.');
  }
  if (settings.shelfDays !== null && (readCanonical(dailyUse) === BigInt(0) || readCanonical(dailyUse) * BigInt(settings.shelfDays) > MAX_MINOR)) {
    throw new ReplenishmentSettingsError('invalid_request', 'A shelf-life limit requires positive daily use within the exact quantity range.');
  }
  return {
    target, capacity, dailyUse, shelfDays: settings.shelfDays, countEveryDays: settings.countEveryDays,
    minimumPacks: packPolicy(settings.minimumPacks, false),
    orderMultiplePacks: packPolicy(settings.orderMultiplePacks, true),
    maximumPacks: settings.maximumPacks === null ? null : packPolicy(settings.maximumPacks, false),
  };
}

function decode(row: StoredRow): SettingsVersion {
  let parsed: ReplenishmentSettings;
  try { parsed = JSON.parse(row.settings_json) as ReplenishmentSettings; }
  catch { throw new ReplenishmentSettingsError('corrupt_store', 'Saved replenishment settings are unreadable.'); }
  try {
    return {
      companyId: row.company_id, productId: row.product_id, version: row.version, changeId: row.change_id,
      inventoryConfigId: row.inventory_config_id, inventoryConfigVersion: row.inventory_config_version,
      dimension: row.dimension, settings: normalize(parsed, row.dimension), changedBy: row.changed_by,
      changeReason: row.change_reason, changedAt: row.changed_at,
    };
  } catch {
    throw new ReplenishmentSettingsError('corrupt_store', 'Saved replenishment settings failed validation.');
  }
}

/** Storage boundary only. Caller must derive actor from an authenticated company membership. */
export class D1ReplenishmentSettingsStore {
  private readonly clock: Clock;
  constructor(private readonly db: D1Database, options: {clock?: Clock} = {}) { this.clock = options.clock ?? {now: () => new Date()}; }

  async current(companyId: string, productId: string, actor: SettingsActor): Promise<SettingsVersion | null> {
    id(companyId); id(productId); actorFor(actor, companyId, false);
    const row = await this.db.prepare('SELECT * FROM replenishment_settings_versions WHERE company_id=? AND product_id=? ORDER BY version DESC LIMIT 1')
      .bind(companyId, productId).first<StoredRow>();
    return row ? decode(row) : null;
  }

  async history(companyId: string, productId: string, actor: SettingsActor): Promise<SettingsVersion[]> {
    id(companyId); id(productId); actorFor(actor, companyId, false);
    const rows = await this.db.prepare('SELECT * FROM replenishment_settings_versions WHERE company_id=? AND product_id=? ORDER BY version ASC')
      .bind(companyId, productId).all<StoredRow>();
    return rows.results.map(decode);
  }

  private async byChange(companyId: string, productId: string, changeId: string): Promise<SettingsVersion | null> {
    const row = await this.db.prepare('SELECT * FROM replenishment_settings_versions WHERE company_id=? AND product_id=? AND change_id=?')
      .bind(companyId, productId, changeId).first<StoredRow>();
    return row ? decode(row) : null;
  }

  async save(input: SaveSettingsInput): Promise<SettingsVersion> {
    id(input.companyId); id(input.productId); id(input.changeId); id(input.expectedConfigId);
    actorFor(input.actor, input.companyId, true);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(input.expectedConfigVersion) || input.expectedConfigVersion < 1 ||
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 300) {
      throw new ReplenishmentSettingsError('invalid_request', 'Expected versions and a short change reason are required.');
    }
    const prior = await this.byChange(input.companyId, input.productId, input.changeId);
    if (prior) {
      const replayJson = JSON.stringify(normalize(input.settings, prior.dimension));
      if (prior.version === input.expectedVersion + 1 && prior.inventoryConfigId === input.expectedConfigId &&
          prior.inventoryConfigVersion === input.expectedConfigVersion && prior.changedBy === input.actor.userId &&
          prior.changeReason === input.reason && JSON.stringify(prior.settings) === replayJson) return prior;
      throw new ReplenishmentSettingsError('change_conflict', 'This change ID already represents different settings.');
    }
    const config = await this.db.prepare(`SELECT c.id,c.version,u.dimension FROM inventory_config_versions c
      JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE c.company_id=? AND c.product_id=? AND c.status='active'`)
      .bind(input.companyId, input.productId).first<ConfigRow>();
    if (!config || config.id !== input.expectedConfigId || config.version !== input.expectedConfigVersion || !config.dimension) {
      throw new ReplenishmentSettingsError('config_changed', 'Active exact inventory configuration changed or is unavailable.');
    }
    const settings = normalize(input.settings, config.dimension);
    const settingsJson = JSON.stringify(settings);
    const at = this.clock.now().toISOString();
    try {
      const result = await this.db.prepare(`INSERT INTO replenishment_settings_versions
        (company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,dimension,settings_json,changed_by,change_reason,changed_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=? AND version=? AND status='active'
        ) AND COALESCE((SELECT MAX(version) FROM replenishment_settings_versions WHERE company_id=? AND product_id=?),0)=?`)
        .bind(input.companyId,input.productId,input.expectedVersion+1,input.changeId,config.id,config.version,config.dimension,
          settingsJson,input.actor.userId,input.reason,at,input.companyId,input.productId,config.id,config.version,
          input.companyId,input.productId,input.expectedVersion).run();
      if (Number(result.meta?.changes ?? 0) !== 1) throw new ReplenishmentSettingsError('concurrent_update', 'Inventory configuration or settings version changed. Refresh and retry.');
    } catch (error) {
      if (error instanceof ReplenishmentSettingsError) throw error;
      const replay = await this.byChange(input.companyId, input.productId, input.changeId);
      if (replay) {
        if (replay.version === input.expectedVersion + 1 && replay.inventoryConfigId === config.id &&
            replay.inventoryConfigVersion === config.version && replay.changedBy === input.actor.userId &&
            replay.changeReason === input.reason && JSON.stringify(replay.settings) === settingsJson) return replay;
        throw new ReplenishmentSettingsError('change_conflict', 'This change ID already represents different settings.');
      }
      if (error instanceof Error && /(?:UNIQUE constraint failed|constraint violation)/i.test(error.message)) {
        throw new ReplenishmentSettingsError('concurrent_update', 'A settings change won the version race. Refresh and retry.');
      }
      if (error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message)) {
        throw new ReplenishmentSettingsError('config_changed', 'Inventory configuration changed before settings could be saved.');
      }
      throw new ReplenishmentSettingsError('storage_failure', 'Settings could not be stored.');
    }
    const saved = await this.byChange(input.companyId, input.productId, input.changeId);
    if (!saved) throw new ReplenishmentSettingsError('corrupt_store', 'A committed settings version is missing.');
    return saved;
  }
}
