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
const MAX_SIGNED_64 = BigInt('9223372036854775807');
const MIN_SIGNED_64 = -MAX_SIGNED_64 - ONE;
const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

export type InventoryBalance = {
  companyId: string;
  productId: string;
  dimension: UnitDimension;
  onHandMinor: string;
  version: number;
  classified: boolean;
  openingCountAt: string | null;
};

export type RecipeIngredient = {
  productId: string;
  quantity: ExactQuantity;
  issue?: 'unit_unclassified' | 'unit_incompatible';
};

export type RecipeVersion = {
  companyId: string;
  recipeId: string;
  versionId: string;
  status: 'draft' | 'active' | 'archived';
  activeFrom: string | null;
  activeTo: string | null;
  ingredients: RecipeIngredient[];
};

export type ModifierVersion = {
  companyId: string;
  recipeId: string;
  modifierId: string;
  versionId: string;
  status: 'draft' | 'active' | 'archived';
  activeFrom: string | null;
  activeTo: string | null;
  deltas: RecipeIngredient[];
};

export type InventoryConsumptionState = {
  now: string;
  balances: InventoryBalance[];
  recipes: RecipeVersion[];
  modifiers: ModifierVersion[];
};

type StoredApplication = {
  fingerprint: string;
  result: InventoryConsumptionApplied;
};

type Aggregate = {
  dimension: UnitDimension;
  minor: bigint;
  lineId: string;
};

function scoped(...values: string[]) {
  return JSON.stringify(values);
}

export function consumptionInstant(value: string): number | null {
  const match = RFC_3339.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText = '0', offsetMinuteText = '0'] = match;
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

function signedMinor(value: string): bigint | null {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value) || value === '-0') return null;
  const parsed = BigInt(value);
  return parsed >= MIN_SIGNED_64 && parsed <= MAX_SIGNED_64 ? parsed : null;
}

function positiveCount(value: string): bigint | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_SIGNED_64 ? parsed : null;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function activeAt(
  version: {status: 'draft' | 'active' | 'archived'; activeFrom: string | null; activeTo: string | null},
  occurredAt: number,
) {
  if (version.status === 'draft' || version.activeFrom === null) return false;
  const from = consumptionInstant(version.activeFrom);
  const to = version.activeTo === null ? null : consumptionInstant(version.activeTo);
  return from !== null && from <= occurredAt && (to === null || occurredAt < to);
}

function assertVersionIntervals<T extends {status: 'draft' | 'active' | 'archived'; activeFrom: string | null; activeTo: string | null}>(
  versions: T[],
  identity: (version: T) => string,
) {
  const groups = new Map<string, T[]>();
  for (const version of versions) {
    const key = identity(version);
    groups.set(key, [...(groups.get(key) ?? []), version]);
  }
  for (const group of groups.values()) {
    const intervals = group
      .filter(version => version.status !== 'draft')
      .sort((a, b) => consumptionInstant(a.activeFrom!)! - consumptionInstant(b.activeFrom!)!);
    for (let index = 1; index < intervals.length; index++) {
      const priorEnd = intervals[index - 1].activeTo === null ? null : consumptionInstant(intervals[index - 1].activeTo!);
      const currentStart = consumptionInstant(intervals[index].activeFrom!)!;
      if (priorEnd === null || currentStart < priorEnd) throw new Error('Inventory version intervals overlap.');
    }
  }
}

export function canonicalConsumptionFingerprint(request: InventoryConsumptionRequest) {
  return JSON.stringify({
    contract: request.contract,
    companyId: request.companyId,
    idempotencyKey: request.idempotencyKey,
    occurredAt: new Date(request.occurredAt).toISOString(),
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

export function validateConsumptionRequest(request: InventoryConsumptionRequest, now: number): ConsumptionIssue | null {
    if (request.contract !== INVENTORY_CONSUMPTION_CONTRACT) {
      return ({code: 'invalid_contract', message: 'Unsupported inventory consumption contract.'});
    }
    if (
      typeof request.companyId !== 'string' || !request.companyId || request.companyId.length > 200 ||
      typeof request.idempotencyKey !== 'string' || !request.idempotencyKey || request.idempotencyKey.length > 200 ||
      !Array.isArray(request.lines) ||
      request.lines.length < 1 || request.lines.length > 100
    ) {
      return ({code: 'invalid_request', message: 'Request identity or line count is invalid.'});
    }

    const occurredAt = typeof request.occurredAt === 'string' ? consumptionInstant(request.occurredAt) : null;
    if (occurredAt === null || occurredAt > now) {
      return ({code: 'invalid_occurrence_time', message: 'Occurrence time must be valid and not in the future.'});
    }

    const lineIds = new Set<string>();
    for (const line of request.lines) {
      const modifierIds = new Set<string>();
      if (
        !line || typeof line.lineId !== 'string' || !line.lineId || line.lineId.length > 200 || lineIds.has(line.lineId) ||
        typeof line.recipeId !== 'string' || !line.recipeId || line.recipeId.length > 200 ||
        !Array.isArray(line.modifiers) || line.modifiers.length > 100
      ) {
        return ({code: 'invalid_request', message: 'Line or modifier identity is invalid.'});
      }
      lineIds.add(line.lineId);
      if (typeof line.quantity !== 'string' || positiveCount(line.quantity) === null) {
        return ({code: 'invalid_quantity', message: 'Line quantity must be a positive whole count.', lineId: line.lineId});
      }
      for (const modifier of line.modifiers) {
        if (
          !modifier || typeof modifier.modifierId !== 'string' || !modifier.modifierId || modifier.modifierId.length > 200 || modifierIds.has(modifier.modifierId)
        ) {
          return ({code: 'invalid_request', message: 'Modifier identities must be unique.', lineId: line.lineId});
        }
        modifierIds.add(modifier.modifierId);
        if (typeof modifier.quantity !== 'string' || positiveCount(modifier.quantity) === null) {
          return ({code: 'invalid_quantity', message: 'Modifier quantity must be a positive whole count.', lineId: line.lineId, modifierId: modifier.modifierId});
        }
      }
    }

    return null;
}

/** Deterministic engine over detached state; owns no database or provider calls. */
export class InventoryConsumptionEngine implements InventoryConsumptionPort {
  private readonly now: number;
  private readonly balances = new Map<string, InventoryBalance>();
  private readonly recipes: RecipeVersion[];
  private readonly modifiers: ModifierVersion[];
  private readonly applications = new Map<string, StoredApplication>();

  constructor(fixture: InventoryConsumptionState) {
    const now = consumptionInstant(fixture.now);
    if (now === null) throw new Error('Inventory clock must be RFC 3339.');
    this.now = now;
    this.recipes = copy(fixture.recipes);
    this.modifiers = copy(fixture.modifiers);
    for (const version of [...this.recipes, ...this.modifiers]) {
      if (!['draft', 'active', 'archived'].includes(version.status)) throw new Error('Inventory version status is invalid.');
      if (version.status === 'draft') {
        if (version.activeFrom !== null || version.activeTo !== null) throw new Error('Inventory draft cannot have an active interval.');
        continue;
      }
      const from = version.activeFrom === null ? null : consumptionInstant(version.activeFrom);
      const to = version.activeTo === null ? null : consumptionInstant(version.activeTo);
      if (
        from === null ||
        (version.status === 'active' && version.activeTo !== null) ||
        (version.status === 'archived' && version.activeTo === null) ||
        (version.activeTo !== null && (to === null || to <= from))
      ) {
        throw new Error('Inventory version interval is invalid.');
      }
    }
    assertVersionIntervals(this.recipes, version => scoped(version.companyId, version.recipeId));
    assertVersionIntervals(this.modifiers, version => scoped(version.companyId, version.recipeId, version.modifierId));
    for (const balance of copy(fixture.balances)) {
      if (signedMinor(balance.onHandMinor) === null) throw new Error('Inventory balance is not canonical.');
      if (balance.openingCountAt !== null && consumptionInstant(balance.openingCountAt) === null) throw new Error('Inventory opening count must be RFC 3339.');
      if (this.balances.has(scoped(balance.companyId, balance.productId))) throw new Error('Duplicate inventory balance.');
      this.balances.set(scoped(balance.companyId, balance.productId), balance);
    }
  }

  getBalance(companyId: string, productId: string) {
    const balance = this.balances.get(scoped(companyId, productId));
    return balance ? copy(balance) : null;
  }

  async consume(request: InventoryConsumptionRequest): Promise<InventoryConsumptionResult> {
    const base = {
      contract: INVENTORY_CONSUMPTION_CONTRACT,
      companyId: request.companyId,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
    } as const;
    const rejected = (issue: ConsumptionIssue): InventoryConsumptionResult => ({
      ...base,
      status: 'rejected',
      issues: [issue],
    });

    const issue = validateConsumptionRequest(request, this.now);
    if (issue) return rejected(issue);
    const occurredAt = consumptionInstant(request.occurredAt)!;

    const fingerprint = canonicalConsumptionFingerprint(request);
    const applicationKey = scoped(request.companyId, request.idempotencyKey);
    const existing = this.applications.get(applicationKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return rejected({code: 'idempotency_conflict', message: 'Idempotency key was already applied with different input.'});
      }
      return {...copy(existing.result), replayed: true};
    }

    const issues: ConsumptionIssue[] = [];
    const selectedVersions: SelectedRecipeVersion[] = [];
    const aggregates = new Map<string, Aggregate>();
    let quantityOverflow: ConsumptionIssue | null = null;
    const add = (target: Map<string, Aggregate>, productId: string, quantity: ExactQuantity, multiplier: bigint, lineId: string) => {
      const value = signedMinor(quantity.minor);
      if (value === null) {
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
      target.set(productId, {
        dimension: quantity.dimension,
        minor: next,
        lineId: prior?.lineId ?? lineId,
      });
    };

    for (const line of request.lines) {
      const recipe = this.recipes.find(version =>
        version.companyId === request.companyId &&
        version.recipeId === line.recipeId &&
        activeAt(version, occurredAt)
      );
      if (!recipe) {
        issues.push({code: 'recipe_version_not_found', message: 'No recipe version covers the occurrence time.', lineId: line.lineId, recipeId: line.recipeId});
        continue;
      }

      const selected: SelectedRecipeVersion = {
        lineId: line.lineId,
        recipeId: line.recipeId,
        recipeVersionId: recipe.versionId,
        quantity: line.quantity,
        modifiers: [],
      };
      const lineQuantity = BigInt(line.quantity);
      const lineAggregates = new Map<string, Aggregate>();
      for (const ingredient of recipe.ingredients) {
        if (ingredient.issue || ingredient.quantity.minor.startsWith('-')) {
          issues.push({code: ingredient.issue ?? 'unit_incompatible', message: 'Recipe ingredient requires review.', lineId: line.lineId, productId: ingredient.productId});
        } else add(lineAggregates, ingredient.productId, ingredient.quantity, lineQuantity, line.lineId);
      }

      for (const requestedModifier of line.modifiers) {
        const modifier = this.modifiers.find(version =>
          version.companyId === request.companyId &&
          version.recipeId === line.recipeId &&
          version.modifierId === requestedModifier.modifierId &&
          activeAt(version, occurredAt)
        );
        if (!modifier) {
          issues.push({
            code: 'modifier_version_not_found',
            message: 'No modifier version covers the occurrence time.',
            lineId: line.lineId,
            recipeId: line.recipeId,
            modifierId: requestedModifier.modifierId,
          });
          continue;
        }
        selected.modifiers.push({
          modifierId: requestedModifier.modifierId,
          modifierVersionId: modifier.versionId,
          quantity: requestedModifier.quantity,
        });
        const modifierQuantity = BigInt(requestedModifier.quantity);
        for (const delta of modifier.deltas) {
          if (delta.issue) issues.push({code: delta.issue, message: 'Modifier ingredient requires review.', lineId: line.lineId, productId: delta.productId});
          else add(lineAggregates, delta.productId, delta.quantity, modifierQuantity, line.lineId);
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

    if (quantityOverflow) return rejected(quantityOverflow);

    for (const [productId, aggregate] of aggregates) {
      if (aggregate.minor === ZERO) continue;
      const balance = this.balances.get(scoped(request.companyId, productId));
      if (!balance) {
        issues.push({code: 'inventory_not_configured', message: 'Ingredient inventory is not configured.', lineId: aggregate.lineId, productId});
        continue;
      }
      if (!balance.classified) {
        issues.push({code: 'unit_unclassified', message: 'Ingredient unit requires manager classification.', lineId: aggregate.lineId, productId});
        continue;
      }
      if (balance.dimension !== aggregate.dimension) {
        issues.push({code: 'unit_incompatible', message: 'Ingredient and inventory dimensions do not agree.', lineId: aggregate.lineId, productId});
        continue;
      }
      if (balance.openingCountAt === null) {
        issues.push({code: 'opening_count_required', message: 'Ingredient needs an opening count.', lineId: aggregate.lineId, productId});
        continue;
      }
      const cutoff = consumptionInstant(balance.openingCountAt);
      if (cutoff === null) throw new Error('Inventory opening count must be RFC 3339.');
      if (occurredAt <= cutoff) {
        issues.push({code: 'before_count_cutoff', message: 'Sale occurred at or before the latest physical count.', lineId: aggregate.lineId, productId});
      }
    }

    if (issues.length) return {...base, status: 'held', issues};

    for (const [productId, aggregate] of aggregates) {
      if (aggregate.minor === ZERO) continue;
      const balance = this.balances.get(scoped(request.companyId, productId))!;
      const after = BigInt(balance.onHandMinor) - aggregate.minor;
      if (after < MIN_SIGNED_64 || after > MAX_SIGNED_64) {
        return rejected({code: 'invalid_quantity', message: 'Resulting inventory balance exceeds the supported range.', productId});
      }
    }

    const changes = [...aggregates]
      .filter(([, aggregate]) => aggregate.minor > ZERO)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([productId, aggregate]) => {
        const balance = this.balances.get(scoped(request.companyId, productId))!;
        const before = BigInt(balance.onHandMinor);
        const versionBefore = balance.version;
        balance.onHandMinor = String(before - aggregate.minor);
        balance.version++;
        return {
          productId,
          consumed: {dimension: aggregate.dimension, minor: String(aggregate.minor)},
          balanceBefore: {dimension: balance.dimension, minor: String(before)},
          balanceAfter: {dimension: balance.dimension, minor: balance.onHandMinor},
          versionBefore,
          versionAfter: balance.version,
        };
      });

    const result: InventoryConsumptionApplied = {
      ...base,
      status: 'applied',
      occurredAt: new Date(occurredAt).toISOString(),
      selectedVersions,
      changes,
    };
    this.applications.set(applicationKey, {fingerprint, result: copy(result)});
    return result;
  }
}
