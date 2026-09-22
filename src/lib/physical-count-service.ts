import {consumptionInstant} from '@/lib/inventory-consumption-engine';
import {curatedUnit, customUnit, readCanonical, toCanonical, type UnitDefinition} from '@/lib/inventory-quantities';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';

type Unit = {unit_id: string; version: number; kind: string; dimension: UnitDimension | null;
  label: string; numerator: string | null; denominator: string | null; retired_at: string | null};
type Config = {id: string; status: string; stock_unit_id: string; stock_unit_version: number};
type Balance = {config_id: string; dimension: UnitDimension; on_hand_minor: string;
  estimated_used_minor: string; version: number; latest_count_effective_at: string | null};
type Timed = {effective_at: string; dimension?: string | null; measured_minor?: string | null; action?: string};
type State = {products: {id: string}[]; units: Unit[]; configs: Config[]; balances: Balance[];
  events: Timed[]; counts: Timed[]; legacyEvents: {created: string}[]; legacyInventory: {version: number}[]};

const parts = {
  products: ['products', 'id', 'AND owner=(SELECT company FROM context) AND id=(SELECT product FROM context)', 'id'],
  units: ['product_unit_versions', 'unit_id version kind dimension label numerator denominator retired_at', '', 'unit_id,version'],
  configs: ['inventory_config_versions', 'id status stock_unit_id stock_unit_version', '', 'version,id'],
  balances: ['inventory_balances_exact', 'config_id dimension on_hand_minor estimated_used_minor version latest_count_effective_at', '', 'version'],
  events: ['inventory_events_exact', 'effective_at action', '', 'effective_at,id'],
  counts: ['inventory_reconciliations', 'effective_at dimension measured_minor', '', 'effective_at,id'],
  legacyEvents: ['inventory_events', 'created', '', 'created,id'],
  legacyInventory: ['inventory', 'version', '', 'version'],
} as const;
const SNAPSHOT = `WITH context AS (SELECT ? AS company, ? AS product)
  SELECT json_object(${Object.entries(parts).map(([name, [table, columns, special, order]]) =>
    `'${name}',json((SELECT json_group_array(json_object(${columns.split(' ').map(column => `'${column}',${column}`).join(',')}))
      FROM (SELECT ${columns.split(' ').join(',')} FROM ${table}
        WHERE ${table === 'products' ? '1=1' : 'company_id=(SELECT company FROM context) AND product_id=(SELECT product FROM context)'}
        ${special} ORDER BY ${order})))`).join(',')}) AS snapshot`;

export class PhysicalCountError extends Error {
  constructor(public readonly code: 'unauthenticated' | 'forbidden' | 'invalid_input' | 'not_found' |
    'unclassified' | 'conflict' | 'invalid_history', message: string) { super(message); }
}
function fail(code: PhysicalCountError['code'], message: string): never { throw new PhysicalCountError(code, message); }
function identity(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('invalid_input', 'An identity is missing or too long.');
}
function instant(value: string): number {
  const time = consumptionInstant(value);
  if (time === null) fail('invalid_input', 'Enter a valid date and time.');
  return time;
}

/** Internal A4 service. The caller must obtain userId from a verified session. */
export class PhysicalCountService {
  constructor(private readonly db: D1Database, private readonly companyId: string, private readonly userId: string | null,
    private readonly clock: () => string = () => new Date().toISOString(), private readonly idFactory: () => string = () => crypto.randomUUID()) {
    identity(companyId);
  }

  private async authorize() {
    if (!this.userId) fail('unauthenticated', 'Sign in before counting stock.');
    const member = await this.db.prepare('SELECT role FROM memberships WHERE company_id=? AND user_id=?')
      .bind(this.companyId, this.userId).first<{role: string}>();
    if (!member || !['owner', 'manager'].includes(member.role)) fail('forbidden', 'Only this company’s owner or manager can count stock.');
  }

  async inspect(productId: string): Promise<{token: string; balance: Balance | null}> {
    identity(productId);
    await this.authorize();
    const row = await this.db.prepare(SNAPSHOT).bind(this.companyId, productId).first<{snapshot: string}>();
    if (!row) throw new Error('Count snapshot unavailable.');
    const state = JSON.parse(row.snapshot) as State;
    if (state.products.length !== 1) fail('not_found', 'Product not found in this company.');
    return {token: row.snapshot, balance: state.balances[0] ?? null};
  }

  async record(productId: string, input: {unitId: string; unitVersion: number; amount: string;
    effectiveAt: string; note?: string}, expected: string) {
    const data = structuredClone(input);
    const current = await this.inspect(productId);
    if (current.token !== expected) fail('conflict', 'Stock changed. Reload before recording the count.');
    const state = JSON.parse(current.token) as State;
    if (!data || typeof data !== 'object') fail('invalid_input', 'Enter a count.');
    identity(data.unitId);
    if (typeof data.note !== 'undefined' && (typeof data.note !== 'string' || data.note.length > 300)) fail('invalid_input', 'The note is too long.');
    const recordedAt = this.clock();
    const recordedTime = instant(recordedAt);
    const effectiveTime = instant(data.effectiveAt);
    if (effectiveTime > recordedTime) fail('invalid_history', 'A physical count cannot be in the future.');
    const effectiveAt = new Date(effectiveTime).toISOString();
    const configs = state.configs.filter(config => config.status === 'active');
    const [balance] = state.balances;
    if (configs.length !== 1 || state.balances.length !== 1 || !balance || balance.config_id !== configs[0].id ||
      !Number.isSafeInteger(balance.version) || balance.version < 0) fail('unclassified', 'Classify and configure this stock before recording a count.');
    const stock = state.units.find(unit => unit.unit_id === configs[0].stock_unit_id && unit.version === configs[0].stock_unit_version);
    const unit = state.units.find(row => row.unit_id === data.unitId && row.version === data.unitVersion);
    if (!stock || !unit || stock.retired_at || unit.retired_at ||
      !['curated', 'custom'].includes(stock.kind) || !['curated', 'custom'].includes(unit.kind) ||
      !stock.dimension || !unit.dimension || stock.dimension !== balance.dimension ||
      data.unitVersion !== Math.max(...state.units.filter(row => row.unit_id === data.unitId).map(row => row.version))) {
      fail('unclassified', 'Use current classified units with the stock dimension.');
    }
    let definition: UnitDefinition;
    if (unit.kind === 'curated') {
      definition = curatedUnit(unit.unit_id);
      if (definition.version !== unit.version || definition.dimension !== unit.dimension ||
        definition.numerator !== unit.numerator || definition.denominator !== unit.denominator) fail('unclassified', 'Stored unit differs from its catalog.');
    } else {
      definition = customUnit({id: unit.unit_id, version: unit.version, label: unit.label,
        dimension: unit.dimension, numerator: unit.numerator!, denominator: unit.denominator!,
        companyId: this.companyId, productId});
    }
    const measured = toCanonical(data.amount, definition, {companyId: this.companyId, productId}, {dimension: balance.dimension});
    const estimate = readCanonical({dimension: balance.dimension, minor: balance.on_hand_minor});
    const priorTimes = [
      ...state.counts.map(row => instant(row.effective_at)),
      ...state.events.map(row => instant(row.effective_at)),
      ...state.legacyEvents.map(row => instant(row.created)),
      ...(balance.latest_count_effective_at ? [instant(balance.latest_count_effective_at)] : []),
    ];
    if (priorTimes.some(time => effectiveTime <= time)) fail('invalid_history', 'Count time must follow all recorded stock changes. Record a current correction.');
    // A3 preserved legacy counts without inventing canonical measurements.
    // The first classified count opens the exact ledger, even if legacy counts exist.
    const opening = balance.latest_count_effective_at === null &&
      state.counts.every(count => count.dimension === null && count.measured_minor === null);
    if (opening && state.events.some(event => !['configuration', 'incoming'].includes(event.action ?? ''))) {
      fail('invalid_history', 'Record an opening count before new stock activity.');
    }
    const variance = opening ? null : readCanonical({dimension: balance.dimension, minor: String(BigInt(measured.minor) - estimate)});
    const countId = this.idFactory(), auditId = this.idFactory();
    const note = data.note?.trim() ?? '';
    const guard = this.db.prepare(`INSERT INTO security_audit(id,company_id,actor,action,target,created)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))
        AND (${SNAPSHOT})=? THEN ? ELSE NULL END,?,?,?,?,?`)
      .bind(this.companyId, this.userId, this.companyId, productId, expected, auditId,
        this.companyId, this.userId, 'inventory.count_recorded', JSON.stringify({productId, countId}), recordedTime);
    const update = this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor=?, estimated_used_minor='0',
      version=?, latest_count_effective_at=?, updated_at=?
      WHERE company_id=? AND product_id=? AND config_id=? AND dimension=? AND on_hand_minor=? AND version=?`)
      .bind(measured.minor, balance.version + 1, effectiveAt, recordedAt,
        this.companyId, productId, balance.config_id, balance.dimension, balance.on_hand_minor, balance.version);
    const event = this.db.prepare(`INSERT INTO inventory_events_exact
      (company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,
       balance_version_before,balance_version_after,effective_at,recorded_at,actor,note)
      VALUES (?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?,'count',?,?,?,?,?,?,?,?,?,?)`)
      .bind(this.companyId, countId, productId, balance.config_id, balance.dimension, measured.minor,
        data.amount, data.unitId, balance.version, balance.version + 1, effectiveAt, recordedAt, this.userId, note);
    const reconciliation = this.db.prepare(`INSERT INTO inventory_reconciliations
      (company_id,id,product_id,config_id,dimension,measured_minor,entered_amount,entered_unit_id,
       estimate_before_minor,variance_minor,effective_at,recorded_at,actor,note,opening)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(this.companyId, countId, productId, balance.config_id, balance.dimension, measured.minor,
        data.amount, data.unitId, opening ? null : balance.on_hand_minor, variance?.toString() ?? null,
        effectiveAt, recordedAt, this.userId, note, opening ? 1 : 0);
    try { await this.db.batch([guard, update, event, reconciliation]); }
    catch (error) {
      if (String(error).includes('NOT NULL constraint failed: security_audit.id') ||
        String(error).includes('NOT NULL constraint failed: inventory_events_exact.product_id')) {
        fail('conflict', 'Stock or access changed. Reload before recording the count.');
      }
      throw error;
    }
    return {id: countId, productId, measured, estimateBefore: opening ? null : {dimension: balance.dimension, minor: balance.on_hand_minor},
      variance: variance === null ? null : {dimension: balance.dimension, minor: variance.toString()}, opening, effectiveAt, recordedAt};
  }
}
