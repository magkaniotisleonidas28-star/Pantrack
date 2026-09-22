import {consumptionInstant} from '@/lib/inventory-consumption-engine';
import {curatedUnit, customUnit, readCanonical, toCanonical, type UnitDefinition} from '@/lib/inventory-quantities';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';

type Unit = {unit_id: string; version: number; kind: string; dimension: UnitDimension | null;
  label: string; numerator: string | null; denominator: string | null; retired_at: string | null};
type Config = {id: string; version: number; status: string; stock_unit_id: string; stock_unit_version: number;
  purchase_quantity_minor: string | null; effective_from: string};
type Balance = {config_id: string; dimension: UnitDimension; on_hand_minor: string; incoming_minor: string;
  estimated_used_minor: string; version: number; latest_count_effective_at: string | null};
type State = {products: {id: string}[]; units: Unit[]; configs: Config[]; balances: Balance[];
  events: {id: string; action: string}[]; legacyEvents: {id: string}[]; counts: {id: string}[];
  ingredients: {recipe_id: string}[]; deltas: {recipe_id: string}[]; legacyInventory: {data: string; version: number}[]};

const entries = {
  products: ['products', 'id', 'owner=(SELECT company FROM context) AND id=(SELECT product FROM context)', 'id'],
  units: ['product_unit_versions', 'unit_id version kind dimension label numerator denominator retired_at', '', 'unit_id,version'],
  configs: ['inventory_config_versions', 'id version status stock_unit_id stock_unit_version purchase_quantity_minor effective_from', '', 'version,id'],
  balances: ['inventory_balances_exact', 'config_id dimension on_hand_minor incoming_minor estimated_used_minor version latest_count_effective_at', '', 'version'],
  events: ['inventory_events_exact', 'id action', '', 'id'],
  legacyEvents: ['inventory_events', 'id', '', 'id'],
  counts: ['inventory_reconciliations', 'id', '', 'id'],
  ingredients: ['recipe_version_ingredients', 'recipe_id', '', 'recipe_id,version_id,position'],
  deltas: ['recipe_modifier_deltas', 'recipe_id', '', 'recipe_id,modifier_id,version_id,position'],
  legacyInventory: ['inventory', 'data version', '', 'version'],
} as const;
const SNAPSHOT = `WITH context AS (SELECT ? AS company, ? AS product)
  SELECT json_object(${Object.entries(entries).map(([name, [table, columns, special, order]]) =>
    `'${name}',json((SELECT json_group_array(json_object(${columns.split(' ').map(column => `'${column}',${column}`).join(',')}))
      FROM (SELECT ${columns.split(' ').join(',')} FROM ${table}
        WHERE ${table === 'products' ? special : 'company_id=(SELECT company FROM context) AND product_id=(SELECT product FROM context)'}
        ORDER BY ${order})))`).join(',')}) AS snapshot`;

export class ConfigurationError extends Error {
  constructor(public readonly code: 'unauthenticated' | 'forbidden' | 'invalid_input' | 'not_found' |
    'conflict' | 'incompatible_history', message: string) { super(message); }
}
function fail(code: ConfigurationError['code'], message: string): never { throw new ConfigurationError(code, message); }
function identity(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('invalid_input', 'An identity is missing or too long.');
}

type Selection = {kind: 'curated'; unitId: string} | {kind: 'custom'; unitId: string; label: string;
  dimension: UnitDimension; numerator: string; denominator: string};

/** Internal A4 configuration writer; userId must come from a verified session. */
export class InventoryConfigurationService {
  constructor(private readonly db: D1Database, private readonly companyId: string, private readonly userId: string | null,
    private readonly clock: () => string = () => new Date().toISOString(), private readonly idFactory: () => string = () => crypto.randomUUID()) {
    identity(companyId);
  }

  private async authorize() {
    if (!this.userId) fail('unauthenticated', 'Sign in before changing inventory units.');
    const row = await this.db.prepare('SELECT role FROM memberships WHERE company_id=? AND user_id=?')
      .bind(this.companyId, this.userId).first<{role: string}>();
    if (!row || !['owner', 'manager'].includes(row.role)) fail('forbidden', 'Only this company’s owner or manager can change inventory units.');
  }

  async inspect(productId: string): Promise<{token: string; configs: Config[]}> {
    identity(productId);
    await this.authorize();
    const row = await this.db.prepare(SNAPSHOT).bind(this.companyId, productId).first<{snapshot: string}>();
    if (!row) throw new Error('Configuration snapshot unavailable.');
    const state = JSON.parse(row.snapshot) as State;
    if (state.products.length !== 1) fail('not_found', 'Product not found in this company.');
    return {token: row.snapshot, configs: state.configs};
  }

  async activate(productId: string, input: {unit: Selection; purchaseUnitLabel: string; packAmount?: string}, expected: string) {
    const data = structuredClone(input);
    const current = await this.inspect(productId);
    if (current.token !== expected) fail('conflict', 'Inventory configuration changed. Reload before saving.');
    const state = JSON.parse(current.token) as State;
    if (!data?.unit || !['curated', 'custom'].includes(data.unit.kind)) fail('invalid_input', 'Choose a classified stock unit.');
    identity(data.unit.unitId);
    if (typeof data.purchaseUnitLabel !== 'string' || !data.purchaseUnitLabel.trim() || data.purchaseUnitLabel.length > 100) {
      fail('invalid_input', 'Name the supplier purchase unit.');
    }
    const now = this.clock();
    if (consumptionInstant(now) === null) fail('invalid_input', 'Invalid server clock.');
    const at = new Date(now).toISOString();
    const active = state.configs.filter(config => config.status === 'active');
    if (active.length > 1 || state.balances.length > 1) fail('incompatible_history', 'Inventory configuration is ambiguous.');
    const previous = active[0] ?? null;
    if (previous && Date.parse(previous.effective_from) >= Date.parse(at)) fail('incompatible_history', 'Configuration changes must move forward in time.');
    const balance = state.balances[0] ?? null;
    if ((previous && !balance) || (balance && (!previous || balance.config_id !== previous.id ||
      !Number.isSafeInteger(balance.version) || balance.version < 0))) {
      fail('incompatible_history', 'Balance does not match the active configuration.');
    }
    let unit: UnitDefinition;
    let unitVersion: number;
    const statements: D1PreparedStatement[] = [];
    if (data.unit.kind === 'curated') {
      unit = curatedUnit(data.unit.unitId);
      unitVersion = unit.version;
      const saved = state.units.find(row => row.unit_id === unit.id && row.version === unit.version);
      if (saved && (saved.kind !== 'curated' || saved.dimension !== unit.dimension ||
        saved.numerator !== unit.numerator || saved.denominator !== unit.denominator || saved.retired_at)) {
        fail('incompatible_history', 'Stored unit differs from the curated catalog.');
      }
      if (!saved) statements.push(this.db.prepare(`INSERT INTO product_unit_versions
        (company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(this.companyId, productId, unit.id, unit.version,
        'curated', unit.dimension, unit.label, unit.numerator, unit.denominator, this.userId, at));
    } else {
      const old = state.units.filter(row => row.unit_id === data.unit.unitId);
      if (old.some(row => row.kind !== 'custom')) fail('incompatible_history', 'This unit ID is already used for another kind of unit.');
      unitVersion = Math.max(0, ...old.map(row => row.version)) + 1;
      unit = customUnit({...data.unit, id: data.unit.unitId, version: unitVersion,
        companyId: this.companyId, productId});
      if (!Number.isSafeInteger(unitVersion)) fail('invalid_input', 'Too many unit versions.');
      statements.push(this.db.prepare(`UPDATE product_unit_versions SET retired_at=?
        WHERE company_id=? AND product_id=? AND unit_id=? AND retired_at IS NULL`)
        .bind(at, this.companyId, productId, unit.id));
      statements.push(this.db.prepare(`INSERT INTO product_unit_versions
        (company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(this.companyId, productId, unit.id, unit.version,
        'custom', unit.dimension, unit.label, unit.numerator, unit.denominator, this.userId, at));
    }
    const previousDimension = balance?.dimension ?? null;
    const dimensionChanged = previousDimension !== null && previousDimension !== unit.dimension;
    if (dimensionChanged) {
      const oldLegacy = state.legacyInventory[0] ? JSON.parse(state.legacyInventory[0].data) as {onHand?: number; incoming?: number} : null;
      const hasHistory = state.events.some(event => event.action !== 'configuration') ||
        state.legacyEvents.length || state.counts.length ||
        state.ingredients.length || state.deltas.length || balance?.latest_count_effective_at !== null ||
        (oldLegacy && (oldLegacy.onHand !== 0 || oldLegacy.incoming !== 0));
      if (hasHistory || !balance || readCanonical({dimension: balance.dimension, minor: balance.on_hand_minor}) !== BigInt(0) ||
        readCanonical({dimension: balance.dimension, minor: balance.incoming_minor}) !== BigInt(0)) {
        fail('incompatible_history', 'A dimension change needs a new product once stock or recipe history exists.');
      }
    }
    const pack = data.packAmount === undefined ? (previousDimension === unit.dimension ? previous?.purchase_quantity_minor ?? null : null)
      : toCanonical(data.packAmount, unit, {companyId: this.companyId, productId}, {dimension: unit.dimension}).minor;
    if (pack !== null && readCanonical({dimension: unit.dimension, minor: pack}) <= BigInt(0)) fail('invalid_input', 'Purchase pack must be positive.');
    const version = Math.max(0, ...state.configs.map(config => config.version)) + 1;
    if (!Number.isSafeInteger(version)) fail('invalid_input', 'Too many configuration versions.');
    const configId = this.idFactory(), auditId = this.idFactory();
    const guard = this.db.prepare(`INSERT INTO security_audit(id,company_id,actor,action,target,created)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))
        AND (${SNAPSHOT})=? THEN ? ELSE NULL END,?,?,?,?,?`)
      .bind(this.companyId, this.userId, this.companyId, productId, expected, auditId,
        this.companyId, this.userId, 'inventory.configuration_activated', JSON.stringify({productId, configId}), Date.parse(at));
    if (previous) statements.push(this.db.prepare(`UPDATE inventory_config_versions SET status='archived',replaced_at=?
      WHERE company_id=? AND product_id=? AND id=? AND status='active'`).bind(at, this.companyId, productId, previous.id));
    statements.push(this.db.prepare(`INSERT INTO inventory_config_versions
      (company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,
       purchase_quantity_minor,effective_from,created_by,created_at)
      VALUES (?,?,?,?, 'active',?,?,?,?,?,?,?)`).bind(this.companyId, productId, configId, version,
        unit.id, unitVersion, data.purchaseUnitLabel.trim(), pack, at, this.userId, at));
    if (balance) {
      statements.push(this.db.prepare(`UPDATE inventory_balances_exact SET config_id=?,dimension=?,
        on_hand_minor=?,incoming_minor=?,estimated_used_minor=?,version=?,updated_at=?
        WHERE company_id=? AND product_id=? AND config_id=? AND version=?`)
        .bind(configId, unit.dimension, dimensionChanged ? '0' : balance.on_hand_minor,
          dimensionChanged ? '0' : balance.incoming_minor, dimensionChanged ? '0' : balance.estimated_used_minor,
          balance.version + 1, at, this.companyId, productId, balance.config_id, balance.version));
      statements.push(this.db.prepare(`INSERT INTO inventory_events_exact
        (company_id,id,product_id,config_id,action,dimension,balance_version_before,balance_version_after,
         effective_at,recorded_at,actor,note)
        VALUES (?, ?, CASE WHEN changes()=1 THEN ? ELSE NULL END, ?, 'configuration', ?, ?, ?, ?, ?, ?, '')`)
        .bind(this.companyId, this.idFactory(), productId, configId, unit.dimension,
          balance.version, balance.version + 1, at, at, this.userId));
    } else {
      statements.push(this.db.prepare(`INSERT INTO inventory_balances_exact
        (company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,updated_at)
        VALUES (?,?,?,?,'0','0','0',0,?)`).bind(this.companyId, productId, configId, unit.dimension, at));
    }
    try { await this.db.batch([guard, ...statements]); }
    catch (error) {
      if (String(error).includes('NOT NULL constraint failed: security_audit.id') ||
        String(error).includes('NOT NULL constraint failed: inventory_events_exact.product_id')) {
        fail('conflict', 'Inventory or access changed. Reload before saving.');
      }
      throw error;
    }
    return {configId, version, unitId: unit.id, unitVersion, dimension: unit.dimension};
  }
}
