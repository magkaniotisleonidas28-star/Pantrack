import {
  INVENTORY_CONSUMPTION_CONTRACT,
  type ConsumptionIssue,
  type ExactQuantity,
  type InventoryConsumptionApplied,
  type InventoryConsumptionPort,
  type InventoryConsumptionRequest,
  type InventoryConsumptionResult,
  type SelectedRecipeVersion,
  type UnitDimension,
} from '@/lib/inventory-consumption-contract';

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const MILLION = BigInt(1_000_000);
const MAX_SIGNED_64 = BigInt('9223372036854775807');
const MIN_SIGNED_64 = -MAX_SIGNED_64 - ONE;
const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

type Clock = {now(): Date};

type ApplicationRow = {
  request_fingerprint: string;
  result_json: string;
};

type VersionRow = {
  id: string;
  status: string;
  active_from: string | null;
  active_to: string | null;
};

type IngredientRow = {
  product_id: string;
  dimension: string | null;
  quantity_minor: string | null;
};

type BalanceRow = {
  product_id: string;
  config_id: string;
  dimension: string;
  on_hand_minor: string;
  estimated_used_minor: string;
  version: number;
  latest_count_effective_at: string | null;
  config_status: string;
  unit_kind: string;
  unit_dimension: string | null;
  numerator: string | null;
  denominator: string | null;
  legacy_data: string | null;
  legacy_version: number | null;
};

type Aggregate = {
  dimension: UnitDimension;
  minor: bigint;
  lineId: string;
};

type LoadedBalance = BalanceRow & {
  onHand: bigint;
  estimatedUsed: bigint;
  legacyData: Record<string, unknown> | null;
};

type PersistedApplication = InventoryConsumptionApplied & {_claimToken: string};

export class InventoryConsumptionPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryConsumptionPersistenceError';
  }
}

function instant(value: string): number | null {
  const match = RFC_3339.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText = '0', offsetMinuteText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dimension(value: unknown): value is UnitDimension {
  return value === 'count' || value === 'mass' || value === 'volume';
}

function signedMinor(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 20 || !/^-?(?:0|[1-9]\d*)$/.test(value) || value === '-0') return null;
  const parsed = BigInt(value);
  return parsed >= MIN_SIGNED_64 && parsed <= MAX_SIGNED_64 ? parsed : null;
}

function positiveInteger(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 19 || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_SIGNED_64 ? parsed : null;
}

function positiveFactor(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 128 || !/^[1-9]\d*$/.test(value)) return null;
  return BigInt(value);
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new InventoryConsumptionPersistenceError(`Persisted ${label} JSON is invalid.`);
  }
}

function canonicalRequest(request: InventoryConsumptionRequest, occurredAt: string) {
  return JSON.stringify({
    contract: request.contract,
    companyId: request.companyId,
    idempotencyKey: request.idempotencyKey,
    occurredAt,
    lines: request.lines
      .map(line => ({
        lineId: line.lineId,
        recipeId: line.recipeId,
        quantity: line.quantity,
        modifiers: line.modifiers
          .map(modifier => ({modifierId: modifier.modifierId, quantity: modifier.quantity}))
          .sort((a, b) => a.modifierId.localeCompare(b.modifierId)),
      }))
      .sort((a, b) => a.lineId.localeCompare(b.lineId)),
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function activeAt(version: VersionRow, occurredAt: number) {
  if (version.status !== 'active' && version.status !== 'archived') return false;
  if (version.active_from === null) return false;
  const from = instant(version.active_from);
  const to = version.active_to === null ? null : instant(version.active_to);
  if (from === null || (version.active_to !== null && (to === null || to <= from))) {
    throw new InventoryConsumptionPersistenceError('Persisted recipe activation interval is invalid.');
  }
  return from <= occurredAt && (to === null || occurredAt < to);
}

function validateStoredResult(value: unknown, companyId: string, idempotencyKey: string): value is PersistedApplication {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<PersistedApplication>;
  if (
    result.contract !== INVENTORY_CONSUMPTION_CONTRACT || result.status !== 'applied' ||
    result.companyId !== companyId || result.idempotencyKey !== idempotencyKey ||
    result.replayed !== false || typeof result._claimToken !== 'string' || !result._claimToken ||
    typeof result.occurredAt !== 'string' || instant(result.occurredAt) === null ||
    !Array.isArray(result.selectedVersions) || !Array.isArray(result.changes)
  ) return false;
  return result.changes.every(change =>
    change && typeof change.productId === 'string' && change.productId.length > 0 &&
    dimension(change.consumed?.dimension) && signedMinor(change.consumed.minor) !== null &&
    change.balanceBefore?.dimension === change.consumed.dimension && signedMinor(change.balanceBefore.minor) !== null &&
    change.balanceAfter?.dimension === change.consumed.dimension && signedMinor(change.balanceAfter.minor) !== null &&
    Number.isSafeInteger(change.versionBefore) && Number.isSafeInteger(change.versionAfter) && change.versionAfter === change.versionBefore + 1
  );
}

function publicResult(value: PersistedApplication, replayed: boolean): InventoryConsumptionApplied {
  const {_claimToken, ...result} = value;
  void _claimToken;
  return {...structuredClone(result), replayed};
}

function roundedLegacyValue(minor: bigint, row: BalanceRow): number {
  const numerator = positiveFactor(row.numerator);
  const denominator = positiveFactor(row.denominator);
  if (!dimension(row.unit_dimension) || row.unit_dimension !== row.dimension || numerator === null || denominator === null) {
    throw new InventoryConsumptionPersistenceError('Persisted stock-unit conversion is invalid.');
  }
  const scale = row.dimension === 'count' ? ONE : MILLION;
  const negative = minor < ZERO;
  const absolute = negative ? -minor : minor;
  const scaledNumerator = absolute * denominator * BigInt(1000);
  const scaledDenominator = numerator * scale;
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const rounded = quotient + (remainder * TWO >= scaledDenominator ? ONE : ZERO);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new InventoryConsumptionPersistenceError('Legacy inventory projection exceeds its safe numeric range.');
  return Number(negative ? -rounded : rounded) / 1000;
}

export class D1InventoryConsumptionPort implements InventoryConsumptionPort {
  private readonly clock: Clock;
  private readonly idFactory: () => string;

  constructor(
    private readonly db: D1Database,
    options: {clock?: Clock; idFactory?: () => string} = {},
  ) {
    this.clock = options.clock ?? {now: () => new Date()};
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  private base(request: InventoryConsumptionRequest) {
    return {
      contract: INVENTORY_CONSUMPTION_CONTRACT,
      companyId: request.companyId,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
    } as const;
  }

  private rejected(request: InventoryConsumptionRequest, issue: ConsumptionIssue): InventoryConsumptionResult {
    return {...this.base(request), status: 'rejected', issues: [issue]};
  }

  private async existing(request: InventoryConsumptionRequest, fingerprint: string) {
    const row = await this.db.prepare(`SELECT request_fingerprint,result_json FROM inventory_consumption_applications
      WHERE company_id=? AND idempotency_key=?`).bind(request.companyId, request.idempotencyKey).first<ApplicationRow>();
    if (!row) return null;
    if (row.request_fingerprint !== fingerprint) {
      return this.rejected(request, {code: 'idempotency_conflict', message: 'Idempotency key was already applied with different input.'});
    }
    const persisted = parseJson<unknown>(row.result_json, 'inventory application');
    if (!validateStoredResult(persisted, request.companyId, request.idempotencyKey)) {
      throw new InventoryConsumptionPersistenceError('Persisted inventory application failed validation.');
    }
    return publicResult(persisted, true);
  }

  private async selectedVersion(table: 'recipe_versions' | 'recipe_modifier_versions', request: InventoryConsumptionRequest, recipeId: string, occurredAt: number, modifierId?: string) {
    const modifierClause = modifierId === undefined ? '' : ' AND modifier_id=?';
    const legacyClause = table === 'recipe_versions' ? ' AND legacy=0' : '';
    const values = modifierId === undefined ? [request.companyId, recipeId] : [request.companyId, recipeId, modifierId];
    const rows = await this.db.prepare(`SELECT id,status,active_from,active_to FROM ${table}
      WHERE company_id=? AND recipe_id=?${modifierClause}${legacyClause}`).bind(...values).all<VersionRow>();
    const matches = rows.results.filter(version => activeAt(version, occurredAt));
    if (matches.length > 1) throw new InventoryConsumptionPersistenceError('Persisted recipe activation intervals overlap.');
    return matches[0] ?? null;
  }

  private async ingredients(companyId: string, recipeId: string, versionId: string) {
    const rows = await this.db.prepare(`SELECT product_id,dimension,quantity_minor FROM recipe_version_ingredients
      WHERE company_id=? AND recipe_id=? AND version_id=? ORDER BY position`).bind(companyId, recipeId, versionId).all<IngredientRow>();
    return rows.results;
  }

  private async modifierDeltas(companyId: string, recipeId: string, modifierId: string, versionId: string) {
    const rows = await this.db.prepare(`SELECT product_id,dimension,quantity_minor FROM recipe_modifier_deltas
      WHERE company_id=? AND recipe_id=? AND modifier_id=? AND version_id=? ORDER BY position`).bind(companyId, recipeId, modifierId, versionId).all<IngredientRow>();
    return rows.results;
  }

  private async balance(companyId: string, productId: string): Promise<LoadedBalance | null> {
    const row = await this.db.prepare(`SELECT b.product_id,b.config_id,b.dimension,b.on_hand_minor,b.estimated_used_minor,
      b.version,b.latest_count_effective_at,c.status AS config_status,u.kind AS unit_kind,u.dimension AS unit_dimension,
      u.numerator,u.denominator,i.data AS legacy_data,i.version AS legacy_version
      FROM inventory_balances_exact b
      JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
      JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id
        AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      LEFT JOIN inventory i ON i.company_id=b.company_id AND i.product_id=b.product_id
      WHERE b.company_id=? AND b.product_id=?`).bind(companyId, productId).first<BalanceRow>();
    if (!row) return null;
    const onHand = signedMinor(row.on_hand_minor);
    const estimatedUsed = signedMinor(row.estimated_used_minor);
    if (!dimension(row.dimension) || onHand === null || estimatedUsed === null || !Number.isSafeInteger(row.version) || row.version < 0) {
      throw new InventoryConsumptionPersistenceError('Persisted exact inventory balance is invalid.');
    }
    let legacyData: Record<string, unknown> | null = null;
    if (row.legacy_data !== null) {
      const parsed = parseJson<unknown>(row.legacy_data, 'legacy inventory');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Number.isSafeInteger(row.legacy_version) || row.legacy_version! < 0) {
        throw new InventoryConsumptionPersistenceError('Persisted legacy inventory projection is invalid.');
      }
      legacyData = parsed as Record<string, unknown>;
    }
    return {...row, onHand, estimatedUsed, legacyData};
  }

  async consume(request: InventoryConsumptionRequest): Promise<InventoryConsumptionResult> {
    return this.consumeAttempt(request, 0);
  }

  private async consumeAttempt(request: InventoryConsumptionRequest, retryCount: number): Promise<InventoryConsumptionResult> {
    const base = this.base(request);
    if (request.contract !== INVENTORY_CONSUMPTION_CONTRACT) {
      return this.rejected(request, {code: 'invalid_contract', message: 'Unsupported inventory consumption contract.'});
    }
    if (
      typeof request.companyId !== 'string' || !request.companyId || request.companyId.length > 200 ||
      typeof request.idempotencyKey !== 'string' || !request.idempotencyKey || request.idempotencyKey.length > 200 ||
      !Array.isArray(request.lines) || request.lines.length < 1 || request.lines.length > 100
    ) {
      return this.rejected(request, {code: 'invalid_request', message: 'Request identity or line count is invalid.'});
    }
    const occurredAt = instant(request.occurredAt);
    const now = this.clock.now();
    if (occurredAt === null || !Number.isFinite(now.getTime()) || occurredAt > now.getTime()) {
      return this.rejected(request, {code: 'invalid_occurrence_time', message: 'Occurrence time must be valid and not in the future.'});
    }
    const normalizedOccurredAt = new Date(occurredAt).toISOString();
    const lineIds = new Set<string>();
    for (const line of request.lines) {
      const modifierIds = new Set<string>();
      if (
        !line || typeof line.lineId !== 'string' || !line.lineId || line.lineId.length > 200 || lineIds.has(line.lineId) ||
        typeof line.recipeId !== 'string' || !line.recipeId || line.recipeId.length > 200 ||
        !Array.isArray(line.modifiers) || line.modifiers.length > 100
      ) {
        return this.rejected(request, {code: 'invalid_request', message: 'Line or modifier identity is invalid.', lineId: line?.lineId});
      }
      lineIds.add(line.lineId);
      if (positiveInteger(line.quantity) === null) {
        return this.rejected(request, {code: 'invalid_quantity', message: 'Line quantity must be a positive whole count.', lineId: line.lineId});
      }
      for (const modifier of line.modifiers) {
        if (
          !modifier || typeof modifier.modifierId !== 'string' || !modifier.modifierId || modifier.modifierId.length > 200 ||
          modifierIds.has(modifier.modifierId)
        ) {
          return this.rejected(request, {code: 'invalid_request', message: 'Modifier identities must be unique.', lineId: line.lineId, modifierId: modifier?.modifierId});
        }
        modifierIds.add(modifier.modifierId);
        if (positiveInteger(modifier.quantity) === null) {
          return this.rejected(request, {code: 'invalid_quantity', message: 'Modifier quantity must be a positive whole count.', lineId: line.lineId, modifierId: modifier.modifierId});
        }
      }
    }

    const fingerprint = await sha256(canonicalRequest(request, normalizedOccurredAt));
    const alreadyApplied = await this.existing(request, fingerprint);
    if (alreadyApplied) return alreadyApplied;

    const issues: ConsumptionIssue[] = [];
    const selectedVersions: SelectedRecipeVersion[] = [];
    const aggregates = new Map<string, Aggregate>();
    let quantityOverflow: ConsumptionIssue | null = null;
    const add = (target: Map<string, Aggregate>, productId: string, quantity: ExactQuantity, multiplier: bigint, lineId: string) => {
      const value = signedMinor(quantity.minor);
      if (!dimension(quantity.dimension) || value === null) {
        issues.push({code: 'unit_incompatible', message: 'Configured quantity is not canonical.', lineId, productId});
        return;
      }
      const prior = target.get(productId);
      if (prior && prior.dimension !== quantity.dimension) {
        issues.push({code: 'unit_incompatible', message: 'Ingredient dimensions do not agree.', lineId, productId});
        return;
      }
      const next = (prior?.minor ?? ZERO) + value * multiplier;
      if (next < MIN_SIGNED_64 || next > MAX_SIGNED_64) {
        quantityOverflow = {code: 'invalid_quantity', message: 'Aggregated quantity exceeds the supported range.', lineId, productId};
        return;
      }
      target.set(productId, {dimension: quantity.dimension, minor: next, lineId: prior?.lineId ?? lineId});
    };

    for (const line of request.lines) {
      const recipe = await this.selectedVersion('recipe_versions', request, line.recipeId, occurredAt);
      if (!recipe) {
        issues.push({code: 'recipe_version_not_found', message: 'No recipe version covers the occurrence time.', lineId: line.lineId, recipeId: line.recipeId});
        continue;
      }
      const selected: SelectedRecipeVersion = {
        lineId: line.lineId,
        recipeId: line.recipeId,
        recipeVersionId: recipe.id,
        quantity: line.quantity,
        modifiers: [],
      };
      const lineAggregates = new Map<string, Aggregate>();
      for (const ingredient of await this.ingredients(request.companyId, line.recipeId, recipe.id)) {
        add(lineAggregates, ingredient.product_id, {dimension: ingredient.dimension as UnitDimension, minor: ingredient.quantity_minor ?? ''}, BigInt(line.quantity), line.lineId);
      }
      for (const requestedModifier of line.modifiers) {
        const modifier = await this.selectedVersion('recipe_modifier_versions', request, line.recipeId, occurredAt, requestedModifier.modifierId);
        if (!modifier) {
          issues.push({
            code: 'modifier_version_not_found', message: 'No modifier version covers the occurrence time.',
            lineId: line.lineId, recipeId: line.recipeId, modifierId: requestedModifier.modifierId,
          });
          continue;
        }
        selected.modifiers.push({modifierId: requestedModifier.modifierId, modifierVersionId: modifier.id, quantity: requestedModifier.quantity});
        for (const delta of await this.modifierDeltas(request.companyId, line.recipeId, requestedModifier.modifierId, modifier.id)) {
          add(lineAggregates, delta.product_id, {dimension: delta.dimension as UnitDimension, minor: delta.quantity_minor ?? ''}, BigInt(requestedModifier.quantity), line.lineId);
        }
      }
      for (const [productId, aggregate] of lineAggregates) {
        if (aggregate.minor < ZERO) {
          issues.push({code: 'negative_modifier_result', message: 'Combined recipe and modifier consumption is negative.', lineId: line.lineId, productId});
          continue;
        }
        add(aggregates, productId, {dimension: aggregate.dimension, minor: String(aggregate.minor)}, ONE, line.lineId);
      }
      selectedVersions.push(selected);
    }
    if (quantityOverflow) return this.rejected(request, quantityOverflow);

    const balances = new Map<string, LoadedBalance>();
    for (const [productId, aggregate] of aggregates) {
      if (aggregate.minor === ZERO) continue;
      const balance = await this.balance(request.companyId, productId);
      if (!balance) {
        issues.push({code: 'inventory_not_configured', message: 'Ingredient inventory is not configured.', lineId: aggregate.lineId, productId});
        continue;
      }
      balances.set(productId, balance);
      if (balance.config_status !== 'active' || !['curated', 'custom'].includes(balance.unit_kind) || balance.unit_dimension === null) {
        issues.push({code: 'unit_unclassified', message: 'Ingredient unit requires manager classification.', lineId: aggregate.lineId, productId});
        continue;
      }
      if (balance.dimension !== aggregate.dimension || balance.unit_dimension !== aggregate.dimension) {
        issues.push({code: 'unit_incompatible', message: 'Ingredient and inventory dimensions do not agree.', lineId: aggregate.lineId, productId});
        continue;
      }
      if (balance.latest_count_effective_at === null) {
        issues.push({code: 'opening_count_required', message: 'Ingredient needs an opening count.', lineId: aggregate.lineId, productId});
        continue;
      }
      const cutoff = instant(balance.latest_count_effective_at);
      if (cutoff === null) throw new InventoryConsumptionPersistenceError('Persisted inventory count cutoff is invalid.');
      if (occurredAt <= cutoff) {
        issues.push({code: 'before_count_cutoff', message: 'Sale occurred at or before the latest physical count.', lineId: aggregate.lineId, productId});
      }
    }
    if (issues.length) return {...base, status: 'held', issues};

    const changes: InventoryConsumptionApplied['changes'] = [];
    const legacyUpdates = new Map<string, {json: string; versionBefore: number}>();
    for (const [productId, aggregate] of [...aggregates].sort(([a], [b]) => a.localeCompare(b))) {
      if (aggregate.minor === ZERO) continue;
      const balance = balances.get(productId)!;
      const after = balance.onHand - aggregate.minor;
      const estimatedUsedAfter = balance.estimatedUsed + aggregate.minor;
      if (after < MIN_SIGNED_64 || after > MAX_SIGNED_64 || estimatedUsedAfter < MIN_SIGNED_64 || estimatedUsedAfter > MAX_SIGNED_64) {
        return this.rejected(request, {code: 'invalid_quantity', message: 'Resulting inventory balance exceeds the supported range.', productId});
      }
      changes.push({
        productId,
        consumed: {dimension: aggregate.dimension, minor: String(aggregate.minor)},
        balanceBefore: {dimension: aggregate.dimension, minor: String(balance.onHand)},
        balanceAfter: {dimension: aggregate.dimension, minor: String(after)},
        versionBefore: balance.version,
        versionAfter: balance.version + 1,
      });
      if (balance.legacyData !== null) {
        const legacy = structuredClone(balance.legacyData);
        legacy.onHand = roundedLegacyValue(after, balance);
        legacy.estimatedUsed = roundedLegacyValue(estimatedUsedAfter, balance);
        legacy.version = balance.legacy_version! + 1;
        legacy.updated = now.toISOString();
        legacyUpdates.set(productId, {json: JSON.stringify(legacy), versionBefore: balance.legacy_version!});
      }
    }

    const result: InventoryConsumptionApplied = {
      ...base,
      status: 'applied',
      occurredAt: normalizedOccurredAt,
      selectedVersions,
      changes,
    };
    const claimToken = this.idFactory();
    if (!claimToken) throw new InventoryConsumptionPersistenceError('Application claim identity is missing.');
    const persisted: PersistedApplication = {...result, _claimToken: claimToken};
    const resultJson = JSON.stringify(persisted);
    const appliedAt = now.toISOString();
    const guardSql: string[] = [];
    const guardValues: unknown[] = [];
    for (const change of changes) {
      guardSql.push('EXISTS(SELECT 1 FROM inventory_balances_exact WHERE company_id=? AND product_id=? AND version=?)');
      guardValues.push(request.companyId, change.productId, change.versionBefore);
      const legacy = legacyUpdates.get(change.productId);
      if (legacy) {
        guardSql.push('EXISTS(SELECT 1 FROM inventory WHERE company_id=? AND product_id=? AND version=?)');
        guardValues.push(request.companyId, change.productId, legacy.versionBefore);
      }
    }
    const statements: D1PreparedStatement[] = [
      this.db.prepare(`INSERT OR IGNORE INTO inventory_consumption_applications(
        company_id,idempotency_key,contract,request_fingerprint,occurred_at,result_json,applied_at
      ) SELECT ?,?,?,?,?,?,?${guardSql.length ? ` WHERE ${guardSql.join(' AND ')}` : ''}`).bind(
        request.companyId, request.idempotencyKey, INVENTORY_CONSUMPTION_CONTRACT, fingerprint,
        normalizedOccurredAt, resultJson, appliedAt, ...guardValues,
      ),
    ];
    for (const change of changes) {
      const balance = balances.get(change.productId)!;
      const estimatedUsedAfter = balance.estimatedUsed + BigInt(change.consumed.minor);
      statements.push(
        this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor=?,estimated_used_minor=?,version=?,updated_at=?
          WHERE company_id=? AND product_id=? AND version=? AND EXISTS(
            SELECT 1 FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=? AND result_json=?
          )`).bind(
          change.balanceAfter.minor,String(estimatedUsedAfter),change.versionAfter,appliedAt,
          request.companyId,change.productId,change.versionBefore,request.companyId,request.idempotencyKey,resultJson,
        ),
        this.db.prepare(`INSERT INTO inventory_events_exact(
          company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,
          balance_version_before,balance_version_after,effective_at,recorded_at,actor,note,consumption_key
        ) SELECT ?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,? WHERE EXISTS(
          SELECT 1 FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=? AND result_json=?
        )`).bind(
          request.companyId,this.idFactory(),change.productId,balance.config_id,'sale_consumption',change.consumed.dimension,
          `-${change.consumed.minor}`,change.versionBefore,change.versionAfter,normalizedOccurredAt,appliedAt,
          'sales-ingestion','',request.idempotencyKey,request.companyId,request.idempotencyKey,resultJson,
        ),
      );
      const legacy = legacyUpdates.get(change.productId);
      if (legacy) {
        statements.push(this.db.prepare(`UPDATE inventory SET data=?,version=?
          WHERE company_id=? AND product_id=? AND version=? AND EXISTS(
            SELECT 1 FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=? AND result_json=?
          )`).bind(
          legacy.json,legacy.versionBefore + 1,request.companyId,change.productId,legacy.versionBefore,
          request.companyId,request.idempotencyKey,resultJson,
        ));
      }
    }
    await this.db.batch(statements);

    const stored = await this.db.prepare(`SELECT request_fingerprint,result_json FROM inventory_consumption_applications
      WHERE company_id=? AND idempotency_key=?`).bind(request.companyId, request.idempotencyKey).first<ApplicationRow>();
    if (!stored) {
      if (retryCount >= 2) throw new InventoryConsumptionPersistenceError('Inventory kept changing while consumption was being applied.');
      return this.consumeAttempt(request, retryCount + 1);
    }
    if (stored.request_fingerprint !== fingerprint) {
      return this.rejected(request, {code: 'idempotency_conflict', message: 'Idempotency key was already applied with different input.'});
    }
    const storedResult = parseJson<unknown>(stored.result_json, 'inventory application');
    if (!validateStoredResult(storedResult, request.companyId, request.idempotencyKey)) {
      throw new InventoryConsumptionPersistenceError('Persisted inventory application failed validation.');
    }
    return publicResult(storedResult, storedResult._claimToken !== claimToken);
  }
}
