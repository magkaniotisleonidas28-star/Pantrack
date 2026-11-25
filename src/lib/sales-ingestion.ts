import {
  INVENTORY_CONSUMPTION_CONTRACT,
  type InventoryConsumptionApplied,
  type InventoryConsumptionPort,
  type InventoryConsumptionRequest,
  type InventoryConsumptionResult,
} from '@/lib/inventory-consumption-contract';
import {
  type HeldReason,
  type SalesSourceBinding,
  type SalesEventDraftV1,
  type SalesEventV1,
  type SalesActor,
  type TrustedReceiptContext,
  type SalesAttempt,
  type SalesConflictResolution,
  type SalesCorrectionRequest,
  type SalesOccurrenceConfirmation,
  type SalesEventRecord,
  type SalesReceipt,
  type SalesMappingPort,
  type SalesEventStore,
  SALES_EVENT_CONTRACT,
  CLOVER_PAUSE_REASONS,
  SalesIngestionError,
  leaseRecoveryOptions,
  salesEventAuditFragment,
  clone,
  utf8Bytes,
  validId,
  instant,
  LEASE_MS,
} from '@/lib/sales-event-model';

export {
  SALES_EVENT_CONTRACT,
  type SalesSourceKind,
  type SalesEventType,
  type SalesOrderStatus,
  type SalesPreparationStatus,
  type SalesTimeQuality,
  type SalesEventState,
  type HeldReason,
  type CloverPauseReason,
  type SalesSourceBinding,
  type SalesEventDraftV1,
  type SalesEventV1,
  type SalesUserActor,
  type SalesMachineActor,
  type SalesActor,
  type TrustedReceiptContext,
  type SalesTransition,
  type SalesAuditEntry,
  type SalesAttempt,
  type SalesConflictReceipt,
  type SalesResolution,
  type SalesConflictResolution,
  type SalesCorrectionRequest,
  type SalesOccurrenceConfirmation,
  type SalesStatusSummary,
  type SalesLeaseRecovery,
  leaseRecoveryOptions,
  type SalesHistoryEntry,
  type SalesEventRecord,
  type SalesStoreSnapshot,
  type SalesReceipt,
  SalesIngestionError,
  type SalesMappingResult,
  type SalesModifierMappingResult,
  type SalesMappingPort,
  type SalesEventStore,
  canonicalSalesEvent,
  salesEventAuditFragment,
} from '@/lib/sales-event-model';
export { InMemorySalesEventStore } from '@/lib/in-memory-sales-event-store';
export { FakeSalesMappingPort } from '@/lib/fake-sales-mapping';

const APPLICATION_OPERATION = 'inventory-consumption:v1';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETAINED_BYTES = 65_536;
const MAX_LINES = 100;
const MAX_MODIFIERS = 100;

function positiveCount(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalize);
    if (normalized.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const key = normalized.every((item) => 'externalLineId' in (item as object))
        ? 'externalLineId'
        : normalized.every((item) => 'externalModifierLineId' in (item as object))
          ? 'externalModifierLineId'
          : null;
      if (key)
        return normalized.sort((a, b) =>
          String((a as Record<string, unknown>)[key]).localeCompare(
            String((b as Record<string, unknown>)[key]),
          ),
        );
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new SalesIngestionError('invalid_payload', 'Source payload must contain only JSON values.');
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function encodedTuple(values: string[]) {
  return values.map((value) => `${utf8Bytes(value)}:${value}`).join('|');
}

function actorId(actor: SalesActor) {
  return actor.kind === 'user' ? `user:${actor.userId}` : `machine:${actor.machineId}`;
}

function sameSource(a: SalesSourceBinding, b: SalesSourceBinding) {
  return (
    a.kind === b.kind &&
    a.provider === b.provider &&
    a.environment === b.environment &&
    a.connectionId === b.connectionId &&
    a.merchantId === b.merchantId &&
    a.locationId === b.locationId
  );
}

function assertOperator(actor: SalesActor | null, companyId: string) {
  if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
  if (actor.kind !== 'user' || actor.companyId !== companyId)
    throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
  if (actor.role !== 'owner' && actor.role !== 'manager')
    throw new SalesIngestionError('forbidden_role', 'Owner or manager permission is required.');
  return actorId(actor);
}

function assertReadable(actor: SalesActor | null, companyId: string) {
  if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
  if (actor.kind !== 'user' || actor.companyId !== companyId)
    throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
}

function validateSource(source: SalesSourceBinding) {
  if (
    !['manual', 'csv', 'bridge', 'native'].includes(source.kind) ||
    !validId(source.provider) ||
    !validId(source.environment) ||
    !validId(source.connectionId) ||
    !validId(source.merchantId) ||
    !validId(source.locationId)
  ) {
    throw new SalesIngestionError('invalid_source', 'Trusted source binding is invalid.');
  }
}

function assertReceiptAuthorization(context: TrustedReceiptContext) {
  const { actor, companyId, source } = context;
  if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
  if (actor.companyId !== companyId)
    throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
  if (actor.kind === 'machine') {
    if (!sameSource(actor.source, source))
      throw new SalesIngestionError(
        'source_mismatch',
        'Machine identity is not bound to this source.',
      );
    return;
  }
  if (actor.role === 'employee')
    throw new SalesIngestionError('forbidden_role', 'Employees cannot receive sales events.');
  if (source.kind === 'native' || source.kind === 'bridge')
    throw new SalesIngestionError(
      'source_mismatch',
      'Machine-bound sources require machine authentication.',
    );
}

function normalizeDraft(
  draft: SalesEventDraftV1,
  now: number,
  source: SalesSourceBinding,
): Omit<SalesEventV1, 'companyId' | 'source' | 'external' | 'receivedAt' | 'integrity'> & {
  externalEventId: string;
  externalOrderId: string;
  revision: number;
} {
  if (!draft || draft.schemaVersion !== SALES_EVENT_CONTRACT)
    throw new SalesIngestionError('invalid_schema', 'Unsupported sales event schema.');
  if (!validId(draft.externalEventId) || !validId(draft.externalOrderId))
    throw new SalesIngestionError('invalid_identity', 'External event and order IDs are required.');
  if (!Number.isSafeInteger(draft.revision) || draft.revision < 1)
    throw new SalesIngestionError('invalid_revision', 'Revision must be a positive safe integer.');
  if (!['sale', 'revision', 'cancellation', 'refund', 'remake', 'reopen'].includes(draft.eventType))
    throw new SalesIngestionError('invalid_event_type', 'Event type is invalid.');
  if (
    !['open', 'completed', 'canceled', 'partially_refunded', 'refunded', 'unknown'].includes(
      draft.orderStatus,
    )
  )
    throw new SalesIngestionError('invalid_order_status', 'Order status is invalid.');
  if (!['not_started', 'prepared', 'fulfilled', 'unknown'].includes(draft.preparationStatus))
    throw new SalesIngestionError('invalid_preparation_status', 'Preparation status is invalid.');
  if (!['provider', 'confirmed', 'inferred'].includes(draft.timeQuality))
    throw new SalesIngestionError('invalid_time_quality', 'Time quality is invalid.');
  const occurred = instant(draft.occurredAt);
  if (occurred === null || occurred > now)
    throw new SalesIngestionError(
      'invalid_occurrence_time',
      'Occurrence time must be valid RFC 3339 and not in the future.',
    );
  const nativeClover = source.kind === 'native' && source.provider === 'clover';
  if (
    draft.unreadable !== undefined &&
    (!nativeClover || !CLOVER_PAUSE_REASONS.has(draft.unreadable))
  )
    throw new SalesIngestionError(
      'invalid_unreadable',
      'Only a Clover order can be paused as unreadable.',
    );
  const emptyCloverCancellation =
    Array.isArray(draft.lines) &&
    draft.lines.length === 0 &&
    nativeClover &&
    draft.eventType === 'cancellation' &&
    draft.orderStatus === 'canceled' &&
    draft.preparationStatus === 'unknown';
  // An unreadable Clover order carries no lines: nothing can come off stock.
  const unreadableClover =
    draft.unreadable !== undefined && Array.isArray(draft.lines) && draft.lines.length === 0;
  if (draft.unreadable !== undefined && !unreadableClover)
    throw new SalesIngestionError('invalid_lines', 'An unreadable Clover order carries no lines.');
  if (
    !Array.isArray(draft.lines) ||
    (draft.lines.length < 1 && !emptyCloverCancellation && !unreadableClover) ||
    draft.lines.length > MAX_LINES
  )
    throw new SalesIngestionError(
      'invalid_lines',
      'Event must contain between 1 and 100 lines, except a Clover deletion tombstone.',
    );
  const lineIds = new Set<string>();
  const lines = draft.lines
    .map((line) => {
      if (
        !line ||
        !validId(line.externalLineId) ||
        !validId(line.externalItemId) ||
        (line.externalVariationId !== undefined && !validId(line.externalVariationId)) ||
        lineIds.has(line.externalLineId)
      )
        throw new SalesIngestionError('invalid_line', 'Line identities must be valid and unique.');
      if (!positiveCount(line.quantity))
        throw new SalesIngestionError(
          'invalid_quantity',
          'Line quantity must be a positive whole-number string.',
        );
      if (!Array.isArray(line.modifiers) || line.modifiers.length > MAX_MODIFIERS)
        throw new SalesIngestionError(
          'invalid_modifiers',
          'A line may contain at most 100 modifiers.',
        );
      lineIds.add(line.externalLineId);
      const modifierLineIds = new Set<string>();
      const modifiers = line.modifiers
        .map((modifier) => {
          if (
            !modifier ||
            !validId(modifier.externalModifierLineId) ||
            !validId(modifier.externalModifierId) ||
            modifierLineIds.has(modifier.externalModifierLineId)
          ) {
            throw new SalesIngestionError(
              'invalid_modifier',
              'Modifier line identities must be valid and unique within a line.',
            );
          }
          if (!positiveCount(modifier.quantity))
            throw new SalesIngestionError(
              'invalid_quantity',
              'Modifier quantity must be a positive whole-number string.',
            );
          modifierLineIds.add(modifier.externalModifierLineId);
          return { ...modifier };
        })
        .sort((a, b) => a.externalModifierLineId.localeCompare(b.externalModifierLineId));
      return { ...line, modifiers };
    })
    .sort((a, b) => a.externalLineId.localeCompare(b.externalLineId));
  return {
    schemaVersion: SALES_EVENT_CONTRACT,
    externalEventId: draft.externalEventId,
    externalOrderId: draft.externalOrderId,
    revision: draft.revision,
    eventType: draft.eventType,
    orderStatus: draft.orderStatus,
    preparationStatus: draft.preparationStatus,
    occurredAt: new Date(occurred).toISOString(),
    timeQuality: draft.timeQuality,
    lines,
    ...(draft.unreadable ? { unreadable: draft.unreadable } : {}),
  };
}

type Clock = { now(): Date };

type ServiceOptions = {
  clock?: Clock;
  idFactory?: () => string;
  afterInventoryApply?: (result: InventoryConsumptionResult) => void | Promise<void>;
};

export class SalesIngestionService {
  private readonly clock: Clock;
  private readonly idFactory: () => string;

  constructor(
    private readonly store: SalesEventStore,
    private readonly mappings: SalesMappingPort,
    private readonly inventory: InventoryConsumptionPort,
    private readonly options: ServiceOptions = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  private now() {
    return this.clock.now().toISOString();
  }

  async receive(context: TrustedReceiptContext, draft: SalesEventDraftV1): Promise<SalesReceipt> {
    if (!validId(context.companyId))
      throw new SalesIngestionError(
        'unmapped_company',
        'Trusted company binding is missing or invalid.',
      );
    validateSource(context.source);
    assertReceiptAuthorization(context);
    const receivedAt = this.now();
    const normalized = normalizeDraft(draft, Date.parse(receivedAt), context.source);
    const sourceJson = canonicalJson(
      draft.sourcePayload ?? {
        ...normalized,
        lines: normalized.lines,
      },
    );
    const byteLimit = context.sourceByteLimit ?? MAX_RETAINED_BYTES;
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || utf8Bytes(sourceJson) > byteLimit)
      throw new SalesIngestionError(
        'payload_too_large',
        'Source payload exceeds its configured UTF-8 byte limit.',
      );
    const sourceHash = await sha256(sourceJson);
    const eventKey = await sha256(
      encodedTuple([
        context.companyId,
        context.source.provider,
        context.source.environment,
        context.source.merchantId,
        normalized.externalEventId,
        String(normalized.revision),
      ]),
    );
    const lineageKey = await sha256(
      encodedTuple([
        context.companyId,
        context.source.provider,
        context.source.environment,
        context.source.merchantId,
        normalized.externalOrderId,
      ]),
    );
    const applicationKey = await sha256(encodedTuple([eventKey, APPLICATION_OPERATION]));
    const event: SalesEventV1 = {
      schemaVersion: SALES_EVENT_CONTRACT,
      companyId: context.companyId,
      source: clone(context.source),
      external: {
        externalEventId: normalized.externalEventId,
        externalOrderId: normalized.externalOrderId,
        revision: normalized.revision,
        eventIdempotencyKey: eventKey,
      },
      eventType: normalized.eventType,
      orderStatus: normalized.orderStatus,
      preparationStatus: normalized.preparationStatus,
      occurredAt: normalized.occurredAt,
      receivedAt,
      timeQuality: normalized.timeQuality,
      lines: normalized.lines,
      ...(normalized.unreadable ? { unreadable: normalized.unreadable } : {}),
      integrity: {
        sourcePayloadSha256: sourceHash,
        payloadExpiresAt: new Date(Date.parse(receivedAt) + RETENTION_MS).toISOString(),
        normalizedContractVersion: SALES_EVENT_CONTRACT,
      },
    };
    const fragment = salesEventAuditFragment(event);
    if (utf8Bytes(canonicalJson(fragment)) > MAX_RETAINED_BYTES)
      throw new SalesIngestionError(
        'retained_fragment_too_large',
        'Minimal retained fragment exceeds 65,536 UTF-8 bytes.',
      );
    await this.reconcilePredecessors(context.companyId, lineageKey, normalized.revision);
    return this.store.receive(
      context.companyId,
      { event, auditFragment: fragment, applicationKey, lineageKey },
      actorId(context.actor!),
      receivedAt,
    );
  }

  private async appliedFor(record: SalesEventRecord) {
    const result =
      (await this.inventory.lookupApplied?.(record.event.companyId, record.applicationKey)) ?? null;
    if (!result) return null;
    const confirmed = await this.store.occurrenceConfirmation(
      record.event.companyId,
      record.event.external.eventIdempotencyKey,
    );
    const occurredAt = confirmed?.occurredAt ?? record.event.occurredAt;
    if (
      result.contract !== INVENTORY_CONSUMPTION_CONTRACT ||
      result.companyId !== record.event.companyId ||
      result.idempotencyKey !== record.applicationKey ||
      result.status !== 'applied' ||
      result.replayed !== true ||
      Date.parse(result.occurredAt) !== Date.parse(occurredAt) ||
      !Array.isArray(result.selectedVersions) ||
      !Array.isArray(result.changes) ||
      !result.selectedVersions.every((selected) => {
        const line = record.event.lines.find((item) => item.externalLineId === selected?.lineId);
        return (
          line &&
          typeof selected.quantity === 'string' &&
          /^[1-9]\d*$/.test(selected.quantity) &&
          BigInt(selected.quantity) <= BigInt(line.quantity)
        );
      })
    ) {
      throw new SalesIngestionError(
        'integration_defect',
        'Recovered inventory does not match the original sales application.',
      );
    }
    return result;
  }

  private async reconcilePredecessors(
    companyId: string,
    lineageKey: string,
    beforeRevision: number,
  ) {
    if (!this.inventory.lookupApplied) return;
    for (const record of await this.store.unresolvedConsumption(
      companyId,
      lineageKey,
      beforeRevision,
    )) {
      const result = await this.appliedFor(record);
      if (result)
        await this.store.reconcileApplied(
          companyId,
          record.event.external.eventIdempotencyKey,
          result,
          this.now(),
        );
    }
  }

  private async mappedLines(record: SalesEventRecord, lines: SalesEventV1['lines']) {
    const held = new Set<HeldReason>();
    const mapped: Array<{
      lineId: string;
      recipeId: string;
      quantity: string;
      modifiers: Array<{ modifierId: string; quantity: string }>;
    }> = [];
    for (const line of lines) {
      const mapping = await this.mappings.resolveLine({
        companyId: record.event.companyId,
        source: record.event.source,
        externalItemId: line.externalItemId,
        ...(line.externalVariationId ? { externalVariationId: line.externalVariationId } : {}),
      });
      // A Not tracked line takes nothing, options included; the rest of the sale still does.
      if (mapping.status === 'not_tracked') continue;
      if (mapping.status !== 'mapped') {
        held.add(mapping.status);
        continue;
      }
      const modifierTotals = new Map<string, bigint>();
      for (const modifier of line.modifiers) {
        const result = await this.mappings.resolveModifier({
          companyId: record.event.companyId,
          source: record.event.source,
          externalItemId: line.externalItemId,
          ...(line.externalVariationId ? { externalVariationId: line.externalVariationId } : {}),
          externalModifierId: modifier.externalModifierId,
        });
        if (result.status === 'not_tracked') continue;
        if (result.status !== 'mapped') held.add(result.status);
        else
          modifierTotals.set(
            result.modifierId,
            (modifierTotals.get(result.modifierId) ?? BigInt(0)) + BigInt(modifier.quantity),
          );
      }
      const modifiers = [...modifierTotals].map(([modifierId, quantity]) => ({
        modifierId,
        quantity: String(quantity),
      }));
      mapped.push({
        lineId: line.externalLineId,
        recipeId: mapping.recipeId,
        quantity: line.quantity,
        modifiers,
      });
    }
    return { held: [...held], mapped };
  }

  private positiveDelta(current: SalesEventV1, previous: SalesEventV1 | null) {
    if (!previous) return { lines: current.lines, correction: false };
    const priorLines = new Map(previous.lines.map((line) => [line.externalLineId, line]));
    const currentLines = new Map(current.lines.map((line) => [line.externalLineId, line]));
    for (const [id, prior] of priorLines) {
      const line = currentLines.get(id);
      if (
        !line ||
        line.externalItemId !== prior.externalItemId ||
        line.externalVariationId !== prior.externalVariationId ||
        BigInt(line.quantity) < BigInt(prior.quantity)
      )
        return { lines: [], correction: true };
      const currentModifiers = new Map(
        line.modifiers.map((modifier) => [modifier.externalModifierLineId, modifier]),
      );
      for (const modifier of prior.modifiers) {
        const next = currentModifiers.get(modifier.externalModifierLineId);
        if (
          !next ||
          next.externalModifierId !== modifier.externalModifierId ||
          BigInt(next.quantity) < BigInt(modifier.quantity)
        )
          return { lines: [], correction: true };
      }
      const baseIncrease = BigInt(line.quantity) > BigInt(prior.quantity);
      const modifierIncrease = line.modifiers.some((modifier) => {
        const old = prior.modifiers.find(
          (item) => item.externalModifierLineId === modifier.externalModifierLineId,
        );
        return !old || BigInt(modifier.quantity) > BigInt(old.quantity);
      });
      if (modifierIncrease && !baseIncrease) return { lines: [], correction: true };
    }
    const deltas: SalesEventV1['lines'] = [];
    for (const line of current.lines) {
      const prior = priorLines.get(line.externalLineId);
      if (!prior) {
        deltas.push(line);
        continue;
      }
      const quantity = BigInt(line.quantity) - BigInt(prior.quantity);
      if (quantity === BigInt(0)) continue;
      const modifiers = line.modifiers.flatMap((modifier) => {
        const old = prior.modifiers.find(
          (item) => item.externalModifierLineId === modifier.externalModifierLineId,
        );
        const delta = BigInt(modifier.quantity) - BigInt(old?.quantity ?? '0');
        return delta > BigInt(0) ? [{ ...modifier, quantity: String(delta) }] : [];
      });
      deltas.push({ ...line, quantity: String(quantity), modifiers });
    }
    return { lines: deltas, correction: false };
  }

  private async policy(record: SalesEventRecord) {
    const event = record.event;
    // A Clover order Pantrack couldn't read stays paused until a person reviews it.
    if (event.unreadable)
      return {
        held: [event.unreadable] as HeldReason[],
        lines: [] as SalesEventV1['lines'],
        occurredAt: event.occurredAt,
      };
    const previous =
      (
        await this.store.latestAppliedConsumption(
          event.companyId,
          record.lineageKey,
          event.external.revision,
        )
      )?.event ?? null;
    if (event.eventType === 'cancellation' && event.lines.length === 0 && !previous)
      return {
        held: ['deleted_order_detail_unavailable'] as HeldReason[],
        lines: [] as SalesEventV1['lines'],
        occurredAt: event.occurredAt,
      };
    const confirmed = await this.store.occurrenceConfirmation(
      event.companyId,
      event.external.eventIdempotencyKey,
    );
    if (event.timeQuality === 'inferred' && !confirmed)
      return {
        held: ['ambiguous_occurrence_time'] as HeldReason[],
        lines: [] as SalesEventV1['lines'],
        occurredAt: event.occurredAt,
      };
    const occurredAt = confirmed?.occurredAt ?? event.occurredAt;
    const prepared =
      event.preparationStatus === 'prepared' || event.preparationStatus === 'fulfilled';
    if (event.eventType === 'refund' && !previous && !prepared)
      return { held: [] as HeldReason[], lines: [] as SalesEventV1['lines'], occurredAt };
    if (event.eventType === 'refund' && previous)
      return { held: [] as HeldReason[], lines: [] as SalesEventV1['lines'], occurredAt };
    if (event.eventType === 'cancellation' && event.preparationStatus === 'not_started')
      return { held: [] as HeldReason[], lines: [] as SalesEventV1['lines'], occurredAt };
    if (event.eventType === 'cancellation' && previous)
      return { held: [] as HeldReason[], lines: [] as SalesEventV1['lines'], occurredAt };
    if (!prepared)
      return {
        held: ['ambiguous_preparation'] as HeldReason[],
        lines: [] as SalesEventV1['lines'],
        occurredAt,
      };
    const delta = this.positiveDelta(event, previous);
    if (delta.correction)
      return {
        held: ['correction_required'] as HeldReason[],
        lines: [] as SalesEventV1['lines'],
        occurredAt,
      };
    return { held: [] as HeldReason[], lines: delta.lines, occurredAt };
  }

  async process(companyId: string, eventKey: string) {
    const record = await this.store.event(companyId, eventKey);
    if (!record) throw new SalesIngestionError('not_found', 'Sales event was not found.');
    await this.reconcilePredecessors(companyId, record.lineageKey, record.event.external.revision);
    const startedAt = this.now();
    const attempt: SalesAttempt = {
      attemptId: this.idFactory(),
      eventKey,
      startedAt,
      leaseExpiresAt: new Date(Date.parse(startedAt) + LEASE_MS).toISOString(),
    };
    if (!(await this.store.claim(companyId, eventKey, attempt, startedAt)))
      throw new SalesIngestionError('claim_conflict', 'Sales event is not claimable.');
    // An uncertain same-key retry reads the original result before policy or
    // current mappings. It never recalculates already committed consumption.
    let recovered: InventoryConsumptionApplied | null;
    try {
      recovered = await this.appliedFor(record);
    } catch (error) {
      const errorCode =
        error instanceof SalesIngestionError
          ? ('integration_defect' as const)
          : ('inventory_unavailable' as const);
      const complete = {
        ...attempt,
        completedAt: this.now(),
        outcome: 'failed' as const,
        errorCode,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'failed',
        complete.completedAt,
        errorCode,
      );
      return this.statusForWorker(companyId, eventKey);
    }
    if (recovered) {
      if (this.options.afterInventoryApply) await this.options.afterInventoryApply(recovered);
      const complete = {
        ...attempt,
        completedAt: this.now(),
        outcome: 'applied' as const,
        inventoryResult: recovered,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'applied',
        complete.completedAt,
        'inventory_replayed',
      );
      return this.statusForWorker(companyId, eventKey);
    }
    const policy = await this.policy(record);
    if (policy.held.length) {
      const complete = {
        ...attempt,
        completedAt: this.now(),
        outcome: 'held' as const,
        heldReasons: policy.held,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'held',
        complete.completedAt,
        policy.held.join(','),
      );
      return this.statusForWorker(companyId, eventKey);
    }
    if (!policy.lines.length) {
      const complete = { ...attempt, completedAt: this.now(), outcome: 'noop' as const };
      await this.store.completeAttempt(
        companyId,
        complete,
        'applied',
        complete.completedAt,
        'policy_noop',
      );
      return this.statusForWorker(companyId, eventKey);
    }
    const mapping = await this.mappedLines(record, policy.lines);
    if (mapping.held.length) {
      const complete = {
        ...attempt,
        completedAt: this.now(),
        outcome: 'held' as const,
        heldReasons: mapping.held,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'held',
        complete.completedAt,
        mapping.held.join(','),
      );
      return this.statusForWorker(companyId, eventKey);
    }
    // Every line was Not tracked: the sale is complete and nothing comes off stock.
    if (!mapping.mapped.length) {
      const complete = { ...attempt, completedAt: this.now(), outcome: 'noop' as const };
      await this.store.completeAttempt(
        companyId,
        complete,
        'applied',
        complete.completedAt,
        'not_tracked_noop',
      );
      return this.statusForWorker(companyId, eventKey);
    }
    const request: InventoryConsumptionRequest = {
      contract: INVENTORY_CONSUMPTION_CONTRACT,
      companyId: record.event.companyId,
      idempotencyKey: record.applicationKey,
      occurredAt: policy.occurredAt,
      lines: mapping.mapped,
    };
    let result: InventoryConsumptionResult;
    try {
      result = await this.inventory.consume(request, { eventKey, attemptId: attempt.attemptId });
    } catch {
      const complete = {
        ...attempt,
        completedAt: this.now(),
        outcome: 'failed' as const,
        errorCode: 'inventory_unavailable' as const,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'failed',
        complete.completedAt,
        complete.errorCode,
      );
      return this.statusForWorker(companyId, eventKey);
    }
    // Reject mismatched replies before callbacks, terminal state changes or
    // storing their contents in this company's audit history.
    if (
      !result ||
      result.contract !== request.contract ||
      result.companyId !== request.companyId ||
      result.idempotencyKey !== request.idempotencyKey ||
      typeof result.replayed !== 'boolean' ||
      !['applied', 'held', 'rejected'].includes(result.status) ||
      (result.status === 'applied' &&
        (Date.parse(result.occurredAt) !== Date.parse(request.occurredAt) ||
          !Array.isArray(result.selectedVersions) ||
          !Array.isArray(result.changes))) ||
      (result.status !== 'applied' &&
        (result.replayed || !Array.isArray(result.issues) || !result.issues.length))
    ) {
      const complete = {
        ...attempt,
        completedAt: this.now(),
        outcome: 'failed' as const,
        errorCode: 'integration_defect' as const,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'failed',
        complete.completedAt,
        complete.errorCode,
      );
      return this.statusForWorker(companyId, eventKey);
    }
    if (this.options.afterInventoryApply && result.status === 'applied')
      await this.options.afterInventoryApply(result);
    const completedAt = this.now();
    if (result.status === 'applied') {
      const complete = {
        ...attempt,
        completedAt,
        outcome: 'applied' as const,
        inventoryResult: result,
      };
      await this.store.completeAttempt(
        companyId,
        complete,
        'applied',
        completedAt,
        result.replayed ? 'inventory_replayed' : 'inventory_applied',
      );
    } else if (result.status === 'held') {
      const reasons = result.issues.map((issue) => issue.code as HeldReason);
      const complete = {
        ...attempt,
        completedAt,
        outcome: 'held' as const,
        heldReasons: reasons,
        issues: result.issues,
        inventoryResult: result,
      };
      await this.store.completeAttempt(companyId, complete, 'held', completedAt, reasons.join(','));
    } else {
      const codes = result.issues.map((issue) => issue.code);
      if (
        codes.some(
          (code) =>
            code === 'invalid_quantity' ||
            code === 'invalid_occurrence_time' ||
            code === 'idempotency_conflict',
        )
      ) {
        const reasons = codes.map((code) =>
          code === 'idempotency_conflict' ? 'identity_conflict' : code,
        ) as HeldReason[];
        const complete = {
          ...attempt,
          completedAt,
          outcome: 'held' as const,
          heldReasons: reasons,
          issues: result.issues,
          inventoryResult: result,
        };
        await this.store.completeAttempt(
          companyId,
          complete,
          'held',
          completedAt,
          reasons.join(','),
        );
      } else {
        const complete = {
          ...attempt,
          completedAt,
          outcome: 'failed' as const,
          issues: result.issues,
          inventoryResult: result,
          errorCode: 'integration_defect' as const,
        };
        await this.store.completeAttempt(
          companyId,
          complete,
          'failed',
          completedAt,
          complete.errorCode,
        );
      }
    }
    return this.statusForWorker(companyId, eventKey);
  }

  async recoverExpiredLeases(companyId: string) {
    const at = this.now();
    // Recovery first clears the old lease atomically. Only then can an absent
    // application mean that the expired attempt will never commit later.
    const recovered = await this.store.recoverExpired(companyId, at);
    if (this.inventory.lookupApplied) {
      for (const eventKey of recovered) {
        const record = await this.store.event(companyId, eventKey);
        if (!record)
          throw new SalesIngestionError('not_found', 'Recovered sales event was not found.');
        const result = await this.appliedFor(record);
        if (result) await this.store.reconcileApplied(companyId, eventKey, result, at);
      }
    }
    return recovered;
  }

  async recover(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const identity = assertOperator(actor, companyId);
    const options = leaseRecoveryOptions({ eventKey, limit: 1, actor: identity, reason });
    const record = await this.requiredEvent(companyId, eventKey),
      at = this.now();
    if ((await this.store.state(companyId, eventKey)) === 'processing') {
      await this.store.recoverExpired(companyId, at, options);
    }
    const state = await this.store.state(companyId, eventKey);
    if (state === 'processing')
      throw new SalesIngestionError(
        'invalid_state',
        'This sale still has an active processing lease. Refresh after it expires.',
      );
    if (state !== 'failed' && state !== 'applied')
      throw new SalesIngestionError(
        'invalid_state',
        'Only interrupted processing or failed sales may be recovered.',
      );
    if (!this.inventory.lookupApplied)
      throw new SalesIngestionError(
        'inventory_unavailable',
        'The saved inventory outcome cannot be verified. Keep this sale under review.',
      );
    // The old lease is fenced before reading the ledger. Repeated requests can
    // also recheck a failed lookup without duplicating the expiry audit.
    let result: InventoryConsumptionApplied | null;
    try {
      result = await this.appliedFor(record);
    } catch {
      throw new SalesIngestionError(
        'inventory_unavailable',
        'Saved stock changes could not be verified. Keep this sale under review and check recovery again.',
      );
    }
    if (result) await this.store.reconcileApplied(companyId, eventKey, result, at);
    return {
      ...(await this.statusForWorker(companyId, eventKey)),
      recovery: result ? 'applied' : state === 'applied' ? 'already_complete' : 'not_applied',
    };
  }

  async retry(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if ((await this.store.state(companyId, eventKey)) !== 'failed')
      throw new SalesIngestionError('invalid_state', 'Only failed events may be retried.');
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Retry reason is required.');
    const at = this.now();
    await this.store.resolve(
      companyId,
      eventKey,
      'failed',
      'received',
      {
        resolutionId: this.idFactory(),
        eventKey,
        kind: 'retry',
        actor: identity,
        reason: clean,
        at,
      },
      { auditId: this.idFactory(), eventKey, action: 'retry', actor: identity, at, reason: clean },
    );
  }

  async replay(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    const state = await this.store.state(companyId, eventKey);
    if (state !== 'held' && state !== 'dismissed')
      throw new SalesIngestionError(
        'invalid_state',
        'Only held or dismissed events may be replayed.',
      );
    if (state === 'dismissed' && (actor?.kind !== 'user' || actor.role !== 'owner'))
      throw new SalesIngestionError(
        'forbidden_role',
        'Only a company owner may replay a dismissed event.',
      );
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Replay reason is required.');
    const at = this.now();
    await this.store.resolve(
      companyId,
      eventKey,
      state,
      'received',
      {
        resolutionId: this.idFactory(),
        eventKey,
        kind: 'replay',
        actor: identity,
        reason: clean,
        at,
      },
      { auditId: this.idFactory(), eventKey, action: 'replay', actor: identity, at, reason: clean },
    );
  }

  async dismiss(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if ((await this.store.state(companyId, eventKey)) !== 'held')
      throw new SalesIngestionError('invalid_state', 'Only held events may be dismissed.');
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Dismissal reason is required.');
    const at = this.now();
    await this.store.resolve(
      companyId,
      eventKey,
      'held',
      'dismissed',
      {
        resolutionId: this.idFactory(),
        eventKey,
        kind: 'dismiss',
        actor: identity,
        reason: clean,
        at,
      },
      {
        auditId: this.idFactory(),
        eventKey,
        action: 'dismiss',
        actor: identity,
        at,
        reason: clean,
      },
    );
  }

  async dismissConflict(
    companyId: string,
    conflictId: string,
    actor: SalesActor | null,
    reason: string,
  ) {
    const conflict = await this.store.conflict(companyId, conflictId);
    if (!conflict)
      throw new SalesIngestionError('not_found', 'Identity-conflict receipt was not found.');
    const record = await this.requiredEvent(companyId, conflict.canonicalEventKey);
    const identity = assertOperator(actor, record.event.companyId);
    const clean = reason.trim();
    if (!clean)
      throw new SalesIngestionError('reason_required', 'Conflict dismissal reason is required.');
    const at = this.now();
    const resolution: SalesConflictResolution = {
      resolutionId: this.idFactory(),
      conflictId,
      canonicalEventKey: conflict.canonicalEventKey,
      kind: 'dismiss',
      actor: identity,
      reason: clean,
      at,
    };
    await this.store.dismissConflict(companyId, resolution, {
      auditId: this.idFactory(),
      eventKey: conflict.canonicalEventKey,
      conflictId,
      action: 'conflict_dismissed',
      actor: identity,
      at,
      reason: clean,
    });
    return clone(resolution);
  }

  async requestCorrection(
    companyId: string,
    eventKey: string,
    actor: SalesActor | null,
    reason: string,
  ) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if ((await this.store.state(companyId, eventKey)) !== 'applied')
      throw new SalesIngestionError(
        'invalid_state',
        'Corrections may be requested only for applied events.',
      );
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Correction reason is required.');
    const requestedAt = this.now();
    const correction: SalesCorrectionRequest = {
      correctionId: this.idFactory(),
      eventKey,
      companyId: record.event.companyId,
      status: 'pending',
      actor: identity,
      reason: clean,
      requestedAt,
    };
    await this.store.appendCorrection(companyId, correction, {
      auditId: this.idFactory(),
      eventKey,
      action: 'correction_requested',
      actor: identity,
      at: requestedAt,
      reason: clean,
    });
    return clone(correction);
  }

  async confirmOccurrence(
    companyId: string,
    eventKey: string,
    actor: SalesActor | null,
    occurredAt: string,
    reason: string,
  ) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if (
      record.event.timeQuality !== 'inferred' ||
      (await this.store.state(companyId, eventKey)) !== 'held'
    )
      throw new SalesIngestionError(
        'invalid_state',
        'Only a held event with inferred time may be confirmed.',
      );
    const parsed = instant(occurredAt);
    if (parsed === null || parsed > this.clock.now().getTime())
      throw new SalesIngestionError(
        'invalid_occurrence_time',
        'Occurrence time must be valid and not in the future.',
      );
    const clean = reason.trim();
    if (!clean)
      throw new SalesIngestionError('reason_required', 'Confirmation reason is required.');
    const confirmedAt = this.now();
    const value: SalesOccurrenceConfirmation = {
      eventKey,
      occurredAt: new Date(parsed).toISOString(),
      actor: identity,
      reason: clean,
      confirmedAt,
    };
    await this.store.confirmOccurrence(companyId, value, {
      auditId: this.idFactory(),
      eventKey,
      action: 'occurrence_confirmed',
      actor: identity,
      at: confirmedAt,
      reason: clean,
    });
    return clone(value);
  }

  async listStatus(companyId: string, actor: SalesActor | null, limit = 50) {
    if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
    if (actor.kind !== 'user' || actor.companyId !== companyId)
      throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
    return this.store.listStatus(companyId, limit);
  }

  async readHistory(companyId: string, eventKey: string, actor: SalesActor | null, limit = 50) {
    const record = await this.requiredEvent(companyId, eventKey);
    assertReadable(actor, record.event.companyId);
    return this.store.history(companyId, eventKey, limit);
  }

  async readStatus(companyId: string, eventKey: string, actor: SalesActor | null) {
    const record = await this.requiredEvent(companyId, eventKey);
    assertReadable(actor, record.event.companyId);
    return {
      eventKey,
      companyId: record.event.companyId,
      state: await this.store.state(companyId, eventKey),
      eventType: record.event.eventType,
      orderStatus: record.event.orderStatus,
      preparationStatus: record.event.preparationStatus,
      occurredAt:
        (await this.store.occurrenceConfirmation(companyId, eventKey))?.occurredAt ??
        record.event.occurredAt,
      receivedAt: record.event.receivedAt,
      revision: record.event.external.revision,
    };
  }

  private async requiredEvent(companyId: string, eventKey: string) {
    const record = await this.store.event(companyId, eventKey);
    if (!record) throw new SalesIngestionError('not_found', 'Sales event was not found.');
    return record;
  }

  private async statusForWorker(companyId: string, eventKey: string) {
    return { eventKey, state: await this.store.state(companyId, eventKey) };
  }
}
