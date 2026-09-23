import {defaultSettings, type InventoryRecord} from './inventory';
import {
  curatedUnit,
  customUnit,
  readCanonical,
  toCanonical,
  type UnitDefinition,
} from './inventory-quantities';
import type {ExactQuantity, UnitDimension} from './inventory-consumption-contract';
import type {
  ActivationInput,
  ArchiveInput,
  ConfigureInventoryInput,
  InventoryCountInput,
  InventoryManagementService,
  InventoryManagementView,
  InventoryMovementInput,
  ManagedInventoryRecord,
  ManagedUnitInput,
  ModifierActivationInput,
  ModifierDraftInput,
  ModifierVersionView,
  RecipeAmountInput,
  RecipeDraftInput,
  RecipeVersionView,
} from './inventory-management-contract';
import {legacyM3Review} from './legacy-m3-review';

const ZERO = BigInt(0);
const MILLION = BigInt(1_000_000);
const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

type Clock = {now(): Date};
type BalanceRow = {
  product_id: string; config_id: string; dimension: UnitDimension; on_hand_minor: string;
  incoming_minor: string; estimated_used_minor: string; version: number;
  latest_count_effective_at: string | null; updated_at: string;
  stock_unit_id: string; stock_unit_version: number; stock_unit_label: string;
};
type UnitRow = {
  unit_id: string; version: number; kind: string; dimension: UnitDimension | null;
  label: string; numerator: string | null; denominator: string | null;
};
type ConfigRow = {
  id: string; version: number; status: string; stock_unit_id: string; stock_unit_version: number;
  purchase_unit_label?: string; purchase_quantity_minor?: string | null;
  effective_from?: string; created_by?: string;
};
type StoredMovementRow = {
  product_id: string; action: string; entered_amount: string | null; entered_unit_id: string | null;
  balance_version_before: number; effective_at: string; actor: string; note: string;
};
type StoredCountRow = {
  product_id: string; entered_amount: string; entered_unit_id: string | null;
  effective_at: string; actor: string; note: string;
};
type LegacyRow = {data: string; version: number};
type RecipeRow = {
  recipe_id: string; id: string; version: number; status: 'draft' | 'active' | 'archived';
  name: string; active_from: string | null; active_to: string | null;
};
type ModifierRow = {
  recipe_id: string; modifier_id: string; id: string; version: number;
  status: 'draft' | 'active' | 'archived'; active_from: string | null; active_to: string | null; name: string;
};

export class InventoryManagementError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InventoryManagementError';
  }
}

function validId(value: string) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function instant(value: string): number | null {
  const match = RFC_3339.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText = '0', offsetMinuteText = '0'] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson<T>(value: string, label: string): T {
  try { return JSON.parse(value) as T; }
  catch { throw new InventoryManagementError('corrupt_store', `Persisted ${label} JSON is invalid.`); }
}

function exact(dimension: UnitDimension, minor: string): ExactQuantity {
  const value = {dimension, minor};
  readCanonical(value);
  return value;
}

function changes(result: D1Result<unknown> | undefined) {
  return Number(result?.meta?.changes ?? 0);
}

function positive(value: ExactQuantity, message: string) {
  if (readCanonical(value) <= ZERO) throw new InventoryManagementError('invalid_quantity', message);
}

function legacyNumber(value: ExactQuantity, unit: UnitDefinition) {
  const minor = readCanonical(value);
  const scale = value.dimension === 'count' ? BigInt(1) : MILLION;
  const numerator = BigInt(unit.numerator), denominator = BigInt(unit.denominator);
  const negative = minor < ZERO;
  const absolute = negative ? -minor : minor;
  const scaledNumerator = absolute * denominator * BigInt(1000);
  const scaledDenominator = numerator * scale;
  const rounded = scaledNumerator / scaledDenominator + (scaledNumerator % scaledDenominator * BigInt(2) >= scaledDenominator ? BigInt(1) : ZERO);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new InventoryManagementError('invalid_quantity', 'Legacy inventory projection exceeds its safe numeric range.');
  return Number(negative ? -rounded : rounded) / 1000;
}

export class D1InventoryManagementService implements InventoryManagementService {
  private readonly clock: Clock;
  constructor(private readonly db: D1Database, options: {clock?: Clock} = {}) {
    this.clock = options.clock ?? {now: () => new Date()};
  }

  private now() {
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime())) throw new InventoryManagementError('invalid_time', 'Server time is invalid.');
    return now.toISOString();
  }

  private normalizedTime(value: string, futureAllowed = false) {
    const parsed = instant(value);
    const now = this.clock.now().getTime();
    if (parsed === null || (!futureAllowed && parsed > now)) throw new InventoryManagementError('invalid_time', 'Enter a valid occurrence time that is not in the future.');
    return new Date(parsed).toISOString();
  }

  private async product(companyId: string, productId: string) {
    if (!validId(companyId) || !validId(productId)) throw new InventoryManagementError('invalid_identity', 'Company and product identities are required.');
    const row = await this.db.prepare('SELECT 1 AS found FROM products WHERE owner=? AND id=?').bind(companyId,productId).first<{found:number}>();
    if (!row) throw new InventoryManagementError('not_found', 'Product was not found in this company.');
  }

  private async unit(companyId: string, productId: string, unitId: string, version?: number): Promise<UnitDefinition> {
    const row = await this.db.prepare(`SELECT unit_id,version,kind,dimension,label,numerator,denominator FROM product_unit_versions
      WHERE company_id=? AND product_id=? AND unit_id=?${version === undefined ? ' ORDER BY version DESC LIMIT 1' : ' AND version=?'}`)
      .bind(...(version === undefined ? [companyId,productId,unitId] : [companyId,productId,unitId,version])).first<UnitRow>();
    if (!row || !row.dimension || !row.numerator || !row.denominator) throw new InventoryManagementError('unit_unclassified', 'Select a classified unit for this product.');
    if (row.kind === 'curated') {
      const resolved = curatedUnit(row.unit_id);
      if (resolved.dimension !== row.dimension || resolved.numerator !== row.numerator || resolved.denominator !== row.denominator) throw new InventoryManagementError('corrupt_store', 'Persisted curated unit does not match the catalog.');
      return resolved;
    }
    if (row.kind !== 'custom') throw new InventoryManagementError('unit_unclassified', 'Select a classified unit for this product.');
    return customUnit({id:row.unit_id,version:row.version,label:row.label,dimension:row.dimension,numerator:row.numerator,denominator:row.denominator,companyId,productId});
  }

  private async prepareUnit(companyId: string, productId: string, input: ManagedUnitInput) {
    if (input.kind === 'curated') return {unit: curatedUnit(input.id), version: 1};
    const latest = await this.db.prepare('SELECT MAX(version) AS version FROM product_unit_versions WHERE company_id=? AND product_id=? AND unit_id=?')
      .bind(companyId,productId,input.id).first<{version:number|null}>();
    const version = Number(latest?.version ?? 0) + 1;
    return {unit: customUnit({...input,version,companyId,productId}), version};
  }

  private async balance(companyId: string, productId: string) {
    return this.db.prepare(`SELECT b.product_id,b.config_id,b.dimension,b.on_hand_minor,b.incoming_minor,b.estimated_used_minor,
      b.version,b.latest_count_effective_at,b.updated_at,c.stock_unit_id,c.stock_unit_version,u.label AS stock_unit_label
      FROM inventory_balances_exact b JOIN inventory_config_versions c
        ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
      JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id
        AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE b.company_id=? AND b.product_id=?`).bind(companyId,productId).first<BalanceRow>();
  }

  private record(row: BalanceRow): ManagedInventoryRecord {
    return {
      productId:row.product_id,configId:row.config_id,dimension:row.dimension,stockUnitId:row.stock_unit_id,
      stockUnitLabel:row.stock_unit_label,onHand:exact(row.dimension,row.on_hand_minor),incoming:exact(row.dimension,row.incoming_minor),
      estimatedUsed:exact(row.dimension,row.estimated_used_minor),version:row.version,latestCountEffectiveAt:row.latest_count_effective_at,
    };
  }

  private async legacy(companyId: string, productId: string) {
    return this.db.prepare('SELECT data,version FROM inventory WHERE company_id=? AND product_id=?').bind(companyId,productId).first<LegacyRow>();
  }

  private legacyRecord(row: LegacyRow | null, productId: string, at: string): InventoryRecord {
    if (!row) return {productId,settings:{...defaultSettings},onHand:0,incoming:0,lastCount:null,updated:at,version:0,estimatedUsed:0};
    const record = parseJson<InventoryRecord>(row.data,'legacy inventory');
    if (record.productId !== productId || record.version !== row.version) throw new InventoryManagementError('corrupt_store','Legacy inventory identity is invalid.');
    return record;
  }

  async configure(input: ConfigureInventoryInput): Promise<ManagedInventoryRecord> {
    await this.product(input.companyId,input.productId);
    if (!validId(input.operationId) || !validId(input.actor) || !input.purchaseUnitLabel.trim()) throw new InventoryManagementError('invalid_input','Configuration identity, actor, and purchase unit are required.');
    const effectiveAt = this.normalizedTime(input.effectiveAt);
    const at = this.now();
    const existing = await this.db.prepare(`SELECT id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,
      purchase_quantity_minor,effective_from,created_by FROM inventory_config_versions
      WHERE company_id=? AND product_id=? AND id=?`).bind(input.companyId,input.productId,input.operationId).first<ConfigRow>();
    if (existing) {
      const existingUnit = await this.unit(input.companyId,input.productId,existing.stock_unit_id,existing.stock_unit_version);
      const requestedPurchase = toCanonical(input.purchaseAmount,existingUnit,{companyId:input.companyId,productId:input.productId});
      const sameUnit = input.stockUnit.kind === existingUnit.kind && input.stockUnit.id === existingUnit.id &&
        (input.stockUnit.kind === 'curated' || (input.stockUnit.label === existingUnit.label && input.stockUnit.dimension === existingUnit.dimension &&
          input.stockUnit.numerator === existingUnit.numerator && input.stockUnit.denominator === existingUnit.denominator));
      const opening=await this.db.prepare('SELECT entered_amount FROM inventory_reconciliations WHERE company_id=? AND id=?').bind(input.companyId,`count:${input.operationId}`).first<{entered_amount:string}>();
      if (existing.status !== 'active' || !sameUnit || existing.purchase_unit_label !== input.purchaseUnitLabel.trim() ||
          existing.purchase_quantity_minor !== requestedPurchase.minor || existing.effective_from !== effectiveAt || existing.created_by !== input.actor ||
          (opening?.entered_amount??undefined)!==input.openingAmount) {
        throw new InventoryManagementError('operation_conflict','That configuration operation identity was already used for different input.');
      }
      const replay = await this.balance(input.companyId,input.productId);
      if (!replay || replay.config_id !== existing.id) throw new InventoryManagementError('operation_conflict','That configuration is no longer the active version. Use a new operation identity.');
      return this.record(replay);
    }
    const {unit,version:unitVersion} = await this.prepareUnit(input.companyId,input.productId,input.stockUnit);
    const purchase = toCanonical(input.purchaseAmount,unit,{companyId:input.companyId,productId:input.productId});
    positive(purchase,'Purchase quantity must be positive.');
    const prior = await this.balance(input.companyId,input.productId);
    const active = await this.db.prepare("SELECT id,version,status,stock_unit_id,stock_unit_version FROM inventory_config_versions WHERE company_id=? AND product_id=? AND status='active'")
      .bind(input.companyId,input.productId).first<ConfigRow>();
    const legacy = await this.legacy(input.companyId,input.productId);
    const legacyRecord = this.legacyRecord(legacy,input.productId,at);
    const nextVersion = Number((await this.db.prepare('SELECT MAX(version) AS version FROM inventory_config_versions WHERE company_id=? AND product_id=?').bind(input.companyId,input.productId).first<{version:number|null}>())?.version ?? 0)+1;
    let opening: ExactQuantity | null = null;
    if (!prior || prior.dimension !== unit.dimension) {
      if (input.openingAmount === undefined) throw new InventoryManagementError('opening_count_required','A fresh physical count is required for initial classification or a dimension change.');
      opening = toCanonical(input.openingAmount,unit,{companyId:input.companyId,productId:input.productId});
      if (readCanonical(opening) < ZERO) throw new InventoryManagementError('invalid_quantity','Physical counts cannot be negative.');
    }
    else if(input.openingAmount!==undefined)throw new InventoryManagementError('invalid_input','Record a physical count separately after a same-dimension unit change.');
    if (prior && prior.dimension !== unit.dimension) {
      const event = await this.db.prepare('SELECT 1 AS found FROM inventory_events_exact WHERE company_id=? AND product_id=? LIMIT 1').bind(input.companyId,input.productId).first();
      const recipe = await this.db.prepare('SELECT 1 AS found FROM recipe_version_ingredients WHERE company_id=? AND product_id=? LIMIT 1').bind(input.companyId,input.productId).first();
      if (event || recipe || prior.latest_count_effective_at || readCanonical(exact(prior.dimension,prior.incoming_minor)) !== ZERO) throw new InventoryManagementError('unit_incompatible','The inventory dimension cannot change after counts, movements, incoming stock, or recipe use.');
    }
    const legacyVersion = legacy?.version ?? 0;
    const balanceVersion = prior?.version ?? 0;
    const onHand = opening ?? (prior ? exact(prior.dimension,prior.on_hand_minor) : exact(unit.dimension,'0'));
    const incoming = prior && prior.dimension === unit.dimension ? exact(unit.dimension,prior.incoming_minor) : exact(unit.dimension,'0');
    const estimated = prior && prior.dimension === unit.dimension ? exact(unit.dimension,prior.estimated_used_minor) : exact(unit.dimension,'0');
    legacyRecord.settings.unit=unit.label;
    legacyRecord.settings.unitsPerPack=legacyNumber(purchase,unit);
    legacyRecord.onHand=legacyNumber(onHand,unit);
    legacyRecord.incoming=legacyNumber(incoming,unit);
    legacyRecord.estimatedUsed=legacyNumber(estimated,unit);
    legacyRecord.lastCount=opening?effectiveAt:legacyRecord.lastCount;
    legacyRecord.updated=at;
    legacyRecord.version=legacyVersion+1;
    const unitStatement = this.db.prepare(`INSERT OR IGNORE INTO product_unit_versions(
      company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(input.companyId,input.productId,unit.id,unitVersion,unit.kind,unit.dimension,unit.label,unit.numerator,unit.denominator,input.actor,at);
    const statements: D1PreparedStatement[]=[
      this.db.prepare("DELETE FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND config_id=?)").bind(input.companyId,input.productId,input.operationId,input.companyId,input.productId,input.operationId),
      unitStatement,
      this.db.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
        VALUES (?,?,?,?,'pending',?,?,?,?,NULL,?,NULL,?,?)`).bind(input.companyId,input.productId,input.operationId,nextVersion,unit.id,unitVersion,input.purchaseUnitLabel.trim(),purchase.minor,effectiveAt,input.actor,at),
    ];
    if (prior) statements.push(this.db.prepare(`UPDATE inventory_balances_exact SET config_id=?,dimension=?,on_hand_minor=?,incoming_minor=?,estimated_used_minor=?,version=?,latest_count_effective_at=?,updated_at=?
      WHERE company_id=? AND product_id=? AND version=?`).bind(input.operationId,unit.dimension,onHand.minor,incoming.minor,estimated.minor,balanceVersion+1,opening?effectiveAt:prior.latest_count_effective_at,at,input.companyId,input.productId,balanceVersion));
    else statements.push(this.db.prepare(`INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at)
      VALUES (?,?,?,?,?,'0','0',1,?,?)`).bind(input.companyId,input.productId,input.operationId,unit.dimension,onHand.minor,effectiveAt,at));
    if (active) statements.push(this.db.prepare("UPDATE inventory_config_versions SET status='archived',replaced_at=? WHERE company_id=? AND product_id=? AND id=? AND status='active' AND EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND config_id=?)").bind(at,input.companyId,input.productId,active.id,input.companyId,input.productId,input.operationId));
    statements.push(this.db.prepare("UPDATE inventory_config_versions SET status='active' WHERE company_id=? AND product_id=? AND id=? AND status='pending' AND EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND config_id=?)").bind(input.companyId,input.productId,input.operationId,input.companyId,input.productId,input.operationId));
    if (opening) {
      statements.push(
        this.db.prepare(`INSERT INTO inventory_reconciliations(company_id,id,product_id,config_id,dimension,measured_minor,entered_amount,entered_unit_id,legacy_unit_label,estimate_before_minor,variance_minor,effective_at,recorded_at,actor,note,opening)
          SELECT ?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,'',1 WHERE EXISTS(SELECT 1 FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=? AND status='active')`).bind(input.companyId,`count:${input.operationId}`,input.productId,input.operationId,unit.dimension,opening.minor,input.openingAmount!,unit.id,null,effectiveAt,at,input.actor,input.companyId,input.productId,input.operationId),
        this.db.prepare(`INSERT INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,balance_version_before,balance_version_after,effective_at,recorded_at,actor,note,consumption_key)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',NULL WHERE EXISTS(SELECT 1 FROM inventory_reconciliations WHERE company_id=? AND id=?)`).bind(input.companyId,`count:${input.operationId}`,input.productId,input.operationId,'count',unit.dimension,opening.minor,input.openingAmount!,unit.id,balanceVersion,balanceVersion+1,effectiveAt,at,input.actor,input.companyId,`count:${input.operationId}`),
      );
    }
    statements.push(legacy ? this.db.prepare('UPDATE inventory SET data=?,version=? WHERE company_id=? AND product_id=? AND version=? AND EXISTS(SELECT 1 FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=? AND status=\'active\')').bind(JSON.stringify(legacyRecord),legacyVersion+1,input.companyId,input.productId,legacyVersion,input.companyId,input.productId,input.operationId)
      : this.db.prepare('INSERT INTO inventory(company_id,product_id,data,version) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=? AND status=\'active\')').bind(input.companyId,input.productId,JSON.stringify(legacyRecord),1,input.companyId,input.productId,input.operationId));
    // If the balance CAS lost, deliberately collide with the pending row so D1
    // rolls the whole transactional batch back instead of retaining a dead draft.
    statements.push(this.db.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
      SELECT ?,?,?,?,'pending',?,?,?,?,NULL,?,NULL,?,? WHERE NOT EXISTS(
        SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND config_id=?
      )`).bind(input.companyId,input.productId,input.operationId,nextVersion,unit.id,unitVersion,input.purchaseUnitLabel.trim(),purchase.minor,effectiveAt,input.actor,at,input.companyId,input.productId,input.operationId));
    try{await this.db.batch(statements);}catch(error){
      if(await this.db.prepare('SELECT 1 AS found FROM inventory_config_versions WHERE company_id=? AND product_id=? AND id=?').bind(input.companyId,input.productId,input.operationId).first())return this.configure(input);
      const current=await this.balance(input.companyId,input.productId);
      if(current&&current.version!==balanceVersion)throw new InventoryManagementError('concurrent_update','Inventory changed while it was being configured. Refresh and retry.');
      throw error;
    }
    const configured=await this.balance(input.companyId,input.productId);
    if(!configured||configured.config_id!==input.operationId)throw new InventoryManagementError('concurrent_update','Inventory changed while it was being configured. Refresh and retry.');
    return this.record(configured);
  }

  private async movementState(input: InventoryMovementInput | InventoryCountInput) {
    await this.product(input.companyId,input.productId);
    if(!validId(input.operationId)||!validId(input.actor)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw new InventoryManagementError('invalid_input','Operation identity, actor, and expected version are required.');
    const row=await this.balance(input.companyId,input.productId);
    if(!row)throw new InventoryManagementError('inventory_not_configured','Classify this product and record an opening count first.');
    const unit=await this.unit(input.companyId,input.productId,input.unitId);
    if(unit.dimension!==row.dimension)throw new InventoryManagementError('unit_incompatible','The entered unit has a different dimension.');
    const effectiveAt=this.normalizedTime(input.effectiveAt);
    return {row,unit,effectiveAt,at:this.now(),legacy:await this.legacy(input.companyId,input.productId)};
  }

  async recordMovement(input: InventoryMovementInput) {
    const state=await this.movementState(input),{row,unit,effectiveAt,at,legacy}=state;
    const amount=toCanonical(input.amount,unit,{companyId:input.companyId,productId:input.productId});positive(amount,'Movement quantity must be positive.');
    const eventId=`movement:${input.operationId}`;
    const stored=await this.db.prepare(`SELECT product_id,action,entered_amount,entered_unit_id,balance_version_before,effective_at,actor,note
      FROM inventory_events_exact WHERE company_id=? AND id=?`).bind(input.companyId,eventId).first<StoredMovementRow>();
    if(stored){
      if(stored.product_id!==input.productId||stored.action!==input.action||stored.entered_amount!==input.amount||stored.entered_unit_id!==input.unitId||
          stored.balance_version_before!==input.expectedVersion||stored.effective_at!==effectiveAt||stored.actor!==input.actor||stored.note!==input.note.trim()){
        throw new InventoryManagementError('operation_conflict','That movement operation identity was already used for different input.');
      }
      const replay=await this.balance(input.companyId,input.productId);
      if(!replay)throw new InventoryManagementError('corrupt_store','Updated inventory is missing.');
      return this.record(replay);
    }
    const onHand=readCanonical(exact(row.dimension,row.on_hand_minor)),incoming=readCanonical(exact(row.dimension,row.incoming_minor)),used=readCanonical(exact(row.dimension,row.estimated_used_minor));
    if(row.latest_count_effective_at&&Date.parse(effectiveAt)<=Date.parse(row.latest_count_effective_at))throw new InventoryManagementError('before_count_cutoff','Stock movements must occur after the latest physical count.');
    let nextOnHand=onHand,nextIncoming=incoming,nextUsed=used,delta=ZERO;
    if(input.action==='receive'){nextOnHand+=readCanonical(amount);delta=readCanonical(amount);if(input.fromIncoming)nextIncoming=nextIncoming>readCanonical(amount)?nextIncoming-readCanonical(amount):ZERO;}
    if(input.action==='use'||input.action==='waste'){if(readCanonical(amount)>nextOnHand)throw new InventoryManagementError('invalid_quantity','Quantity exceeds recorded stock. Record a fresh count first.');nextOnHand-=readCanonical(amount);nextUsed+=readCanonical(amount);delta=-readCanonical(amount);}
    if(input.action==='incoming'){nextIncoming=readCanonical(amount);delta=nextIncoming-incoming;}
    const legacyRecord=this.legacyRecord(legacy,input.productId,at);legacyRecord.onHand=legacyNumber(exact(row.dimension,String(nextOnHand)),unit);legacyRecord.incoming=legacyNumber(exact(row.dimension,String(nextIncoming)),unit);legacyRecord.estimatedUsed=legacyNumber(exact(row.dimension,String(nextUsed)),unit);legacyRecord.updated=at;legacyRecord.version=(legacy?.version??0)+1;
    const results=await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,balance_version_before,balance_version_after,effective_at,recorded_at,actor,note,consumption_key)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND version=?)`).bind(input.companyId,eventId,input.productId,row.config_id,input.action,row.dimension,String(delta),input.amount,input.unitId,input.expectedVersion,input.expectedVersion+1,effectiveAt,at,input.actor,input.note.trim(),input.companyId,input.productId,input.expectedVersion),
      this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor=?,incoming_minor=?,estimated_used_minor=?,version=?,updated_at=? WHERE company_id=? AND product_id=? AND version=? AND changes()=1`).bind(String(nextOnHand),String(nextIncoming),String(nextUsed),input.expectedVersion+1,at,input.companyId,input.productId,input.expectedVersion),
      legacy?this.db.prepare('UPDATE inventory SET data=?,version=? WHERE company_id=? AND product_id=? AND version=? AND changes()=1').bind(JSON.stringify(legacyRecord),legacyRecord.version,input.companyId,input.productId,legacy.version):this.db.prepare('INSERT INTO inventory(company_id,product_id,data,version) SELECT ?,?,?,? WHERE changes()=1').bind(input.companyId,input.productId,JSON.stringify(legacyRecord),legacyRecord.version),
    ]);
    if(changes(results[0])!==1){const replay=await this.db.prepare('SELECT 1 AS found FROM inventory_events_exact WHERE company_id=? AND id=? AND product_id=?').bind(input.companyId,eventId,input.productId).first();if(!replay)throw new InventoryManagementError('concurrent_update','Inventory changed. Refresh and retry.');}
    const updated=await this.balance(input.companyId,input.productId);if(!updated)throw new InventoryManagementError('corrupt_store','Updated inventory is missing.');return this.record(updated);
  }

  async recordCount(input: InventoryCountInput) {
    const {row,unit,effectiveAt,at,legacy}=await this.movementState(input);
    const measured=toCanonical(input.amount,unit,{companyId:input.companyId,productId:input.productId});if(readCanonical(measured)<ZERO)throw new InventoryManagementError('invalid_quantity','Physical counts cannot be negative.');
    const id=`count:${input.operationId}`;
    const stored=await this.db.prepare(`SELECT product_id,entered_amount,entered_unit_id,effective_at,actor,note
      FROM inventory_reconciliations WHERE company_id=? AND id=?`).bind(input.companyId,id).first<StoredCountRow>();
    if(stored){
      if(stored.product_id!==input.productId||stored.entered_amount!==input.amount||stored.entered_unit_id!==input.unitId||
          stored.effective_at!==effectiveAt||stored.actor!==input.actor||stored.note!==input.note.trim()){
        throw new InventoryManagementError('operation_conflict','That count operation identity was already used for different input.');
      }
      const replay=await this.balance(input.companyId,input.productId);
      if(!replay)throw new InventoryManagementError('corrupt_store','Updated inventory is missing.');
      return this.record(replay);
    }
    const latestEvent=await this.db.prepare('SELECT effective_at FROM inventory_events_exact WHERE company_id=? AND product_id=? ORDER BY effective_at DESC LIMIT 1').bind(input.companyId,input.productId).first<{effective_at:string}>();
    if((row.latest_count_effective_at&&Date.parse(effectiveAt)<=Date.parse(row.latest_count_effective_at))||(latestEvent&&Date.parse(effectiveAt)<=Date.parse(latestEvent.effective_at)))throw new InventoryManagementError('invalid_time','A physical count must be later than every existing count and stock movement.');
    const before=exact(row.dimension,row.on_hand_minor),opening=row.latest_count_effective_at===null,variance=readCanonical(measured)-readCanonical(before);
    const legacyRecord=this.legacyRecord(legacy,input.productId,at);legacyRecord.onHand=legacyNumber(measured,unit);legacyRecord.estimatedUsed=0;legacyRecord.lastCount=effectiveAt;legacyRecord.updated=at;legacyRecord.version=(legacy?.version??0)+1;
    const results=await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO inventory_reconciliations(company_id,id,product_id,config_id,dimension,measured_minor,entered_amount,entered_unit_id,legacy_unit_label,estimate_before_minor,variance_minor,effective_at,recorded_at,actor,note,opening)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND version=?)`).bind(input.companyId,id,input.productId,row.config_id,row.dimension,measured.minor,input.amount,input.unitId,null,opening?null:before.minor,opening?null:String(variance),effectiveAt,at,input.actor,input.note.trim(),opening?1:0,input.companyId,input.productId,input.expectedVersion),
      this.db.prepare(`INSERT OR IGNORE INTO inventory_events_exact(company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,balance_version_before,balance_version_after,effective_at,recorded_at,actor,note,consumption_key)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL WHERE changes()=1`).bind(input.companyId,id,input.productId,row.config_id,'count',row.dimension,opening?measured.minor:String(variance),input.amount,input.unitId,input.expectedVersion,input.expectedVersion+1,effectiveAt,at,input.actor,input.note.trim()),
      this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor=?,estimated_used_minor='0',version=?,latest_count_effective_at=?,updated_at=? WHERE company_id=? AND product_id=? AND version=? AND changes()=1`).bind(measured.minor,input.expectedVersion+1,effectiveAt,at,input.companyId,input.productId,input.expectedVersion),
      legacy?this.db.prepare('UPDATE inventory SET data=?,version=? WHERE company_id=? AND product_id=? AND version=? AND changes()=1').bind(JSON.stringify(legacyRecord),legacyRecord.version,input.companyId,input.productId,legacy.version):this.db.prepare('INSERT INTO inventory(company_id,product_id,data,version) SELECT ?,?,?,? WHERE changes()=1').bind(input.companyId,input.productId,JSON.stringify(legacyRecord),legacyRecord.version),
    ]);
    if(changes(results[0])!==1){const replay=await this.db.prepare('SELECT 1 AS found FROM inventory_reconciliations WHERE company_id=? AND id=? AND product_id=?').bind(input.companyId,id,input.productId).first();if(!replay)throw new InventoryManagementError('concurrent_update','Inventory changed. Refresh and retry.');}
    const updated=await this.balance(input.companyId,input.productId);if(!updated)throw new InventoryManagementError('corrupt_store','Updated inventory is missing.');return this.record(updated);
  }

  private async recipeAmounts(companyId:string,values:RecipeAmountInput[],signed=false){
    if(!values.length||values.length>50||new Set(values.map(v=>v.productId)).size!==values.length)throw new InventoryManagementError('invalid_recipe','Recipes require one entry per ingredient.');
    const result=[];
    for(const value of values){await this.product(companyId,value.productId);const unit=await this.unit(companyId,value.productId,value.unitId);const quantity=toCanonical(value.amount,unit,{companyId,productId:value.productId},{signed});if(!signed&&readCanonical(quantity)<=ZERO)throw new InventoryManagementError('invalid_quantity','Recipe quantities must be positive.');result.push({...value,unit,quantity});}
    return result;
  }

  async saveRecipeDraft(input: RecipeDraftInput): Promise<RecipeVersionView> {
    if(!validId(input.companyId)||!validId(input.recipeId)||!validId(input.draftId)||!validId(input.actor)||!input.name.trim())throw new InventoryManagementError('invalid_recipe','Recipe identity, name, and actor are required.');
    const amounts=await this.recipeAmounts(input.companyId,input.ingredients),at=this.now();
    const existing=await this.db.prepare('SELECT status FROM recipe_versions WHERE company_id=? AND recipe_id=? AND id=?').bind(input.companyId,input.recipeId,input.draftId).first<{status:string}>();
    const nextVersion=Number((await this.db.prepare('SELECT MAX(version) AS version FROM recipe_versions WHERE company_id=? AND recipe_id=?').bind(input.companyId,input.recipeId).first<{version:number|null}>())?.version??0)+1;
    const statements:D1PreparedStatement[]=[this.db.prepare('INSERT OR IGNORE INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)').bind(input.companyId,input.recipeId,input.actor,at)];
    if(existing){if(existing.status!=='draft')throw new InventoryManagementError('immutable_version','Activated recipe versions cannot be edited.');statements.push(this.db.prepare('DELETE FROM recipe_version_ingredients WHERE company_id=? AND recipe_id=? AND version_id=?').bind(input.companyId,input.recipeId,input.draftId),this.db.prepare("UPDATE recipe_versions SET name=? WHERE company_id=? AND recipe_id=? AND id=? AND status='draft'").bind(input.name.trim(),input.companyId,input.recipeId,input.draftId));}
    else statements.push(this.db.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at) VALUES (?,?,?,?,'draft',?,NULL,NULL,0,?,?)`).bind(input.companyId,input.recipeId,input.draftId,nextVersion,input.name.trim(),input.actor,at));
    amounts.forEach((value,index)=>statements.push(this.db.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(input.companyId,input.recipeId,input.draftId,index,value.productId,value.unit.id,value.unit.version,value.quantity.dimension,value.quantity.minor,value.amount,value.unitId)));
    await this.db.batch(statements);return this.requiredRecipe(input.companyId,input.recipeId,input.draftId);
  }

  async activateRecipe(input: ActivationInput) {
    if(!validId(input.companyId)||!validId(input.recipeId)||!validId(input.versionId)||!validId(input.actor))throw new InventoryManagementError('invalid_recipe','Recipe identity, version, and actor are required.');
    const at=this.now();
    const draft=await this.requiredRecipe(input.companyId,input.recipeId,input.versionId);
    if(draft.status==='archived')throw new InventoryManagementError('immutable_version','Archived recipe versions cannot be activated.');
    const current=await this.db.prepare("SELECT id,legacy FROM recipe_versions WHERE company_id=? AND recipe_id=? AND status='active'").bind(input.companyId,input.recipeId).first<{id:string;legacy:number}>();
    const expected=input.expectedActiveVersionId??(current?.legacy===1?current.id:null);
    const legacy={id:draft.recipeId,name:draft.name,ingredients:draft.ingredients.map(i=>({productId:i.productId,quantity:Number(i.amount),unit:i.unitId}))};
    const statements:D1PreparedStatement[]=[];
    if(expected)statements.push(this.db.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND id=? AND status='active'").bind(at,input.companyId,input.recipeId,expected));
    statements.push(expected
      ? this.db.prepare(`UPDATE recipe_versions SET status='active',active_from=?,active_to=NULL WHERE company_id=? AND recipe_id=? AND id=? AND status='draft'
          AND NOT EXISTS(SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND status='active')
          AND EXISTS(SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND id=? AND status='archived' AND active_to=?)`).bind(at,input.companyId,input.recipeId,input.versionId,input.companyId,input.recipeId,input.companyId,input.recipeId,expected,at)
      : this.db.prepare(`UPDATE recipe_versions SET status='active',active_from=?,active_to=NULL WHERE company_id=? AND recipe_id=? AND id=? AND status='draft'
          AND NOT EXISTS(SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND status='active')`).bind(at,input.companyId,input.recipeId,input.versionId,input.companyId,input.recipeId));
    statements.push(this.db.prepare(`INSERT INTO recipes(company_id,id,data)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND id=? AND status='active')
      ON CONFLICT(company_id,id) DO UPDATE SET data=excluded.data`).bind(input.companyId,input.recipeId,JSON.stringify(legacy),input.companyId,input.recipeId,input.versionId));
    await this.db.batch(statements);const version=await this.requiredRecipe(input.companyId,input.recipeId,input.versionId);if(version.status!=='active')throw new InventoryManagementError('concurrent_update','The active recipe changed. Refresh and retry.');
    return version;
  }

  async archiveRecipe(input: ArchiveInput) {
    if(!validId(input.companyId)||!validId(input.recipeId)||!validId(input.versionId)||!validId(input.actor))throw new InventoryManagementError('invalid_recipe','Recipe identity, version, and actor are required.');
    const at=this.now();
    await this.db.batch([
      this.db.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND id=? AND status='active'").bind(at,input.companyId,input.recipeId,input.versionId),
      this.db.prepare('DELETE FROM recipes WHERE company_id=? AND id=? AND changes()=1').bind(input.companyId,input.recipeId),
    ]);
    const version=await this.requiredRecipe(input.companyId,input.recipeId,input.versionId);
    if(version.status!=='archived')throw new InventoryManagementError('concurrent_update','Only the current active recipe version can be archived.');
    return version;
  }

  async saveModifierDraft(input: ModifierDraftInput): Promise<ModifierVersionView> {
    if(!validId(input.companyId)||!validId(input.recipeId)||!validId(input.modifierId)||!validId(input.draftId)||!validId(input.actor)||!input.name.trim())throw new InventoryManagementError('invalid_modifier','Modifier identity, name, and actor are required.');
    const amounts=await this.recipeAmounts(input.companyId,input.deltas.map(v=>({...v,amount:v.signed&&!v.amount.startsWith('-')?`-${v.amount}`:v.amount})),true),at=this.now();
    const recipe=await this.db.prepare('SELECT 1 AS found FROM recipe_lineages WHERE company_id=? AND id=?').bind(input.companyId,input.recipeId).first();if(!recipe)throw new InventoryManagementError('not_found','Recipe lineage was not found.');
    const lineage=await this.db.prepare('SELECT name FROM recipe_modifier_lineages WHERE company_id=? AND recipe_id=? AND id=?').bind(input.companyId,input.recipeId,input.modifierId).first<{name:string}>();
    if(lineage&&lineage.name!==input.name.trim())throw new InventoryManagementError('immutable_version','A modifier lineage name cannot change after it is created. Create a new modifier identity.');
    const existing=await this.db.prepare('SELECT status FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=?').bind(input.companyId,input.recipeId,input.modifierId,input.draftId).first<{status:string}>();
    const nextVersion=Number((await this.db.prepare('SELECT MAX(version) AS version FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=?').bind(input.companyId,input.recipeId,input.modifierId).first<{version:number|null}>())?.version??0)+1;
    const statements:D1PreparedStatement[]=[this.db.prepare('INSERT OR IGNORE INTO recipe_modifier_lineages(company_id,recipe_id,id,name,created_by,created_at) VALUES (?,?,?,?,?,?)').bind(input.companyId,input.recipeId,input.modifierId,input.name.trim(),input.actor,at)];
    if(existing){if(existing.status!=='draft')throw new InventoryManagementError('immutable_version','Activated modifier versions cannot be edited.');statements.push(this.db.prepare('DELETE FROM recipe_modifier_deltas WHERE company_id=? AND recipe_id=? AND modifier_id=? AND version_id=?').bind(input.companyId,input.recipeId,input.modifierId,input.draftId));}
    else statements.push(this.db.prepare(`INSERT INTO recipe_modifier_versions(company_id,recipe_id,modifier_id,id,version,status,active_from,active_to,created_by,created_at) VALUES (?,?,?,?,?,'draft',NULL,NULL,?,?)`).bind(input.companyId,input.recipeId,input.modifierId,input.draftId,nextVersion,input.actor,at));
    amounts.forEach((value,index)=>statements.push(this.db.prepare(`INSERT INTO recipe_modifier_deltas(company_id,recipe_id,modifier_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.companyId,input.recipeId,input.modifierId,input.draftId,index,value.productId,value.unit.id,value.unit.version,value.quantity.dimension,value.quantity.minor,value.amount,value.unitId)));
    await this.db.batch(statements);return this.requiredModifier(input.companyId,input.recipeId,input.modifierId,input.draftId);
  }

  async activateModifier(input: ModifierActivationInput) {
    if(!validId(input.companyId)||!validId(input.recipeId)||!validId(input.modifierId)||!validId(input.versionId)||!validId(input.actor))throw new InventoryManagementError('invalid_modifier','Modifier identity, version, and actor are required.');
    const at=this.now(),statements:D1PreparedStatement[]=[];
    const draft=await this.requiredModifier(input.companyId,input.recipeId,input.modifierId,input.versionId);
    if(draft.status==='archived')throw new InventoryManagementError('immutable_version','Archived modifier versions cannot be activated.');
    if(input.expectedActiveVersionId)statements.push(this.db.prepare("UPDATE recipe_modifier_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=? AND status='active'").bind(at,input.companyId,input.recipeId,input.modifierId,input.expectedActiveVersionId));
    statements.push(input.expectedActiveVersionId
      ? this.db.prepare(`UPDATE recipe_modifier_versions SET status='active',active_from=?,active_to=NULL WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=? AND status='draft'
          AND NOT EXISTS(SELECT 1 FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND status='active')
          AND EXISTS(SELECT 1 FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=? AND status='archived' AND active_to=?)`).bind(at,input.companyId,input.recipeId,input.modifierId,input.versionId,input.companyId,input.recipeId,input.modifierId,input.companyId,input.recipeId,input.modifierId,input.expectedActiveVersionId,at)
      : this.db.prepare(`UPDATE recipe_modifier_versions SET status='active',active_from=?,active_to=NULL WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=? AND status='draft'
          AND NOT EXISTS(SELECT 1 FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND status='active')`).bind(at,input.companyId,input.recipeId,input.modifierId,input.versionId,input.companyId,input.recipeId,input.modifierId));
    await this.db.batch(statements);const version=await this.requiredModifier(input.companyId,input.recipeId,input.modifierId,input.versionId);if(version.status!=='active')throw new InventoryManagementError('concurrent_update','The active modifier changed. Refresh and retry.');return version;
  }

  async archiveModifier(input: ArchiveInput & {modifierId:string}) {
    if(!validId(input.companyId)||!validId(input.recipeId)||!validId(input.modifierId)||!validId(input.versionId)||!validId(input.actor))throw new InventoryManagementError('invalid_modifier','Modifier identity, version, and actor are required.');
    const at=this.now();
    await this.db.prepare("UPDATE recipe_modifier_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=? AND status='active'").bind(at,input.companyId,input.recipeId,input.modifierId,input.versionId).run();
    const version=await this.requiredModifier(input.companyId,input.recipeId,input.modifierId,input.versionId);
    if(version.status!=='archived')throw new InventoryManagementError('concurrent_update','Only the current active modifier version can be archived.');
    return version;
  }

  private async requiredRecipe(companyId:string,recipeId:string,versionId:string){const all=await this.read(companyId);const value=all.recipes.find(v=>v.recipeId===recipeId&&v.versionId===versionId);if(!value)throw new InventoryManagementError('not_found','Recipe version was not found.');return value;}
  private async requiredModifier(companyId:string,recipeId:string,modifierId:string,versionId:string){const all=await this.read(companyId);const value=all.modifiers.find(v=>v.recipeId===recipeId&&v.modifierId===modifierId&&v.versionId===versionId);if(!value)throw new InventoryManagementError('not_found','Modifier version was not found.');return value;}

  async read(companyId: string): Promise<InventoryManagementView> {
    if(!validId(companyId))throw new InventoryManagementError('invalid_identity','Company identity is required.');
    const balances=await this.db.prepare(`SELECT b.product_id,b.config_id,b.dimension,b.on_hand_minor,b.incoming_minor,b.estimated_used_minor,b.version,b.latest_count_effective_at,b.updated_at,c.stock_unit_id,c.stock_unit_version,u.label AS stock_unit_label FROM inventory_balances_exact b JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version WHERE b.company_id=? ORDER BY b.product_id`).bind(companyId).all<BalanceRow>();
    const reconciliations=await this.db.prepare(`SELECT id,product_id,dimension,measured_minor,estimate_before_minor,variance_minor,effective_at,recorded_at,actor,note,opening FROM inventory_reconciliations WHERE company_id=? AND dimension IS NOT NULL AND measured_minor IS NOT NULL ORDER BY effective_at DESC,id`).bind(companyId).all<{id:string;product_id:string;dimension:UnitDimension;measured_minor:string;estimate_before_minor:string|null;variance_minor:string|null;effective_at:string;recorded_at:string;actor:string;note:string;opening:number}>();
    const recipes=await this.db.prepare("SELECT recipe_id,id,version,status,name,active_from,active_to FROM recipe_versions WHERE company_id=? AND legacy=0 ORDER BY recipe_id,version DESC").bind(companyId).all<RecipeRow>();
    const legacyRecipes=await this.db.prepare("SELECT recipe_id FROM recipe_versions WHERE company_id=? AND legacy=1 AND status='active' ORDER BY recipe_id").bind(companyId).all<{recipe_id:string}>();
    const recipeViews:RecipeVersionView[]=[];
    for(const row of recipes.results){const ingredients=await this.db.prepare('SELECT product_id,entered_amount,entered_unit_id,dimension,quantity_minor FROM recipe_version_ingredients WHERE company_id=? AND recipe_id=? AND version_id=? ORDER BY position').bind(companyId,row.recipe_id,row.id).all<{product_id:string;entered_amount:string;entered_unit_id:string;dimension:UnitDimension;quantity_minor:string}>();recipeViews.push({recipeId:row.recipe_id,versionId:row.id,version:row.version,status:row.status,name:row.name,activeFrom:row.active_from,activeTo:row.active_to,ingredients:ingredients.results.map(i=>({productId:i.product_id,amount:i.entered_amount,unitId:i.entered_unit_id,quantity:exact(i.dimension,i.quantity_minor)}))});}
    const modifiers=await this.db.prepare(`SELECT v.recipe_id,v.modifier_id,v.id,v.version,v.status,v.active_from,v.active_to,l.name FROM recipe_modifier_versions v JOIN recipe_modifier_lineages l ON l.company_id=v.company_id AND l.recipe_id=v.recipe_id AND l.id=v.modifier_id WHERE v.company_id=? ORDER BY v.recipe_id,v.modifier_id,v.version DESC`).bind(companyId).all<ModifierRow>();
    const modifierViews:ModifierVersionView[]=[];
    for(const row of modifiers.results){const deltas=await this.db.prepare('SELECT product_id,entered_amount,entered_unit_id,dimension,quantity_minor FROM recipe_modifier_deltas WHERE company_id=? AND recipe_id=? AND modifier_id=? AND version_id=? ORDER BY position').bind(companyId,row.recipe_id,row.modifier_id,row.id).all<{product_id:string;entered_amount:string;entered_unit_id:string;dimension:UnitDimension;quantity_minor:string}>();modifierViews.push({recipeId:row.recipe_id,modifierId:row.modifier_id,versionId:row.id,version:row.version,status:row.status,name:row.name,activeFrom:row.active_from,activeTo:row.active_to,deltas:deltas.results.map(i=>({productId:i.product_id,amount:i.entered_amount,unitId:i.entered_unit_id,quantity:exact(i.dimension,i.quantity_minor)}))});}
    return {records:balances.results.map(row=>this.record(row)),reconciliations:reconciliations.results.map(row=>({id:row.id,productId:row.product_id,measured:exact(row.dimension,row.measured_minor),estimateBefore:row.estimate_before_minor===null?null:exact(row.dimension,row.estimate_before_minor),variance:row.variance_minor===null?null:exact(row.dimension,row.variance_minor),effectiveAt:row.effective_at,recordedAt:row.recorded_at,actor:row.actor,note:row.note,opening:Boolean(row.opening)})),legacyRecipeIds:legacyRecipes.results.map(row=>row.recipe_id),recipes:recipeViews,modifiers:modifierViews,legacyReview:await legacyM3Review(this.db,companyId)};
  }
}
