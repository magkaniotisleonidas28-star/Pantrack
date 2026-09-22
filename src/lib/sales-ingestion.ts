import {
  INVENTORY_CONSUMPTION_CONTRACT,
  type ConsumptionIssue,
  type InventoryConsumptionPort,
  type InventoryConsumptionRequest,
  type InventoryConsumptionResult,
} from '@/lib/inventory-consumption-contract';

export const SALES_EVENT_CONTRACT = 'pantrack.sales.v1' as const;
const APPLICATION_OPERATION = 'inventory-consumption:v1';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MAX_RETAINED_BYTES = 65_536;
const MAX_LINES = 100;
const MAX_MODIFIERS = 100;
const MAX_ID_BYTES = 200;
const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

export type SalesSourceKind = 'manual' | 'csv' | 'bridge' | 'native';
export type SalesEventType = 'sale' | 'revision' | 'cancellation' | 'refund' | 'remake' | 'reopen';
export type SalesOrderStatus = 'open' | 'completed' | 'canceled' | 'partially_refunded' | 'refunded' | 'unknown';
export type SalesPreparationStatus = 'not_started' | 'prepared' | 'fulfilled' | 'unknown';
export type SalesTimeQuality = 'provider' | 'confirmed' | 'inferred';
export type SalesEventState = 'received' | 'processing' | 'applied' | 'held' | 'failed' | 'dismissed' | 'superseded';
export type HeldReason =
  | 'unknown_item'
  | 'unknown_variation'
  | 'unknown_modifier'
  | 'opening_count_required'
  | 'before_count_cutoff'
  | 'inventory_not_configured'
  | 'unit_unclassified'
  | 'unit_incompatible'
  | 'recipe_version_not_found'
  | 'modifier_version_not_found'
  | 'negative_modifier_result'
  | 'invalid_quantity'
  | 'invalid_occurrence_time'
  | 'ambiguous_occurrence_time'
  | 'ambiguous_preparation'
  | 'identity_conflict'
  | 'unsupported_revision'
  | 'correction_required';

export type SalesSourceBinding = {
  kind: SalesSourceKind;
  provider: string;
  environment: string;
  connectionId: string;
  merchantId: string;
  locationId: string;
};

export type SalesEventDraftV1 = {
  schemaVersion: typeof SALES_EVENT_CONTRACT;
  externalEventId: string;
  externalOrderId: string;
  revision: number;
  eventType: SalesEventType;
  orderStatus: SalesOrderStatus;
  preparationStatus: SalesPreparationStatus;
  occurredAt: string;
  timeQuality: SalesTimeQuality;
  lines: Array<{
    externalLineId: string;
    externalItemId: string;
    externalVariationId?: string;
    quantity: string;
    modifiers: Array<{
      externalModifierLineId: string;
      externalModifierId: string;
      quantity: string;
    }>;
  }>;
  /** Hashed and byte-limited, then discarded. It is never retained in the event store. */
  sourcePayload?: unknown;
};

export type SalesEventV1 = {
  schemaVersion: typeof SALES_EVENT_CONTRACT;
  companyId: string;
  source: SalesSourceBinding;
  external: {
    externalEventId: string;
    externalOrderId: string;
    revision: number;
    eventIdempotencyKey: string;
  };
  eventType: SalesEventType;
  orderStatus: SalesOrderStatus;
  preparationStatus: SalesPreparationStatus;
  occurredAt: string;
  receivedAt: string;
  timeQuality: SalesTimeQuality;
  lines: SalesEventDraftV1['lines'];
  integrity: {
    sourcePayloadSha256: string;
    payloadExpiresAt: string | null;
    normalizedContractVersion: typeof SALES_EVENT_CONTRACT;
  };
};

export type SalesUserActor = {kind: 'user'; userId: string; companyId: string; role: 'owner' | 'manager' | 'employee'};
export type SalesMachineActor = {kind: 'machine'; machineId: string; companyId: string; source: SalesSourceBinding};
export type SalesActor = SalesUserActor | SalesMachineActor;
export type TrustedReceiptContext = {
  companyId: string;
  source: SalesSourceBinding;
  actor: SalesActor | null;
  /** The authenticated adapter's configured transport limit. */
  sourceByteLimit?: number;
};

export type SalesTransition = {
  transitionId: string;
  eventKey: string;
  from: SalesEventState | null;
  to: SalesEventState;
  at: string;
  reason?: string;
  linkedEventKey?: string;
};

export type SalesAuditEntry = {
  auditId: string;
  eventKey: string;
  action: 'received' | 'retry' | 'replay' | 'dismiss' | 'conflict_dismissed' | 'correction_requested' | 'lease_expired' | 'superseded';
  actor: string;
  at: string;
  reason?: string;
  conflictId?: string;
};

export type SalesAttempt = {
  attemptId: string;
  eventKey: string;
  startedAt: string;
  completedAt?: string;
  leaseExpiresAt: string;
  outcome?: 'applied' | 'held' | 'failed' | 'noop';
  heldReasons?: HeldReason[];
  issues?: ConsumptionIssue[];
  inventoryResult?: InventoryConsumptionResult;
  errorCode?: 'interrupted' | 'inventory_unavailable' | 'integration_defect';
};

export type SalesConflictReceipt = {
  conflictId: string;
  canonicalEventKey: string;
  receivedAt: string;
  sourcePayloadSha256: string;
  externalEventId: string;
  externalOrderId: string;
  revision: number;
  reason: 'identity_conflict';
};

export type SalesResolution = {
  resolutionId: string;
  eventKey: string;
  kind: 'retry' | 'replay' | 'dismiss';
  actor: string;
  reason: string;
  at: string;
};

export type SalesConflictResolution = {
  resolutionId: string;
  conflictId: string;
  canonicalEventKey: string;
  kind: 'dismiss';
  actor: string;
  reason: string;
  at: string;
};

export type SalesCorrectionRequest = {
  correctionId: string;
  eventKey: string;
  companyId: string;
  status: 'pending';
  actor: string;
  reason: string;
  requestedAt: string;
};

export type SalesEventRecord = {
  event: SalesEventV1;
  auditFragment: unknown | null;
  applicationKey: string;
  lineageKey: string;
};

export type SalesStoreSnapshot = {
  events: SalesEventRecord[];
  transitions: SalesTransition[];
  attempts: SalesAttempt[];
  conflicts: SalesConflictReceipt[];
  conflictResolutions: SalesConflictResolution[];
  resolutions: SalesResolution[];
  audits: SalesAuditEntry[];
  corrections: SalesCorrectionRequest[];
};

export type SalesReceipt =
  | {kind: 'created'; eventKey: string; state: SalesEventState}
  | {kind: 'duplicate'; eventKey: string; state: SalesEventState}
  | {kind: 'conflict'; eventKey: string; conflictId: string; state: SalesEventState};

export class SalesIngestionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SalesIngestionError';
  }
}

export type SalesMappingResult =
  | {status: 'mapped'; recipeId: string}
  | {status: 'unknown_item' | 'unknown_variation'};
export type SalesModifierMappingResult = {status: 'mapped'; modifierId: string} | {status: 'unknown_modifier'};

export interface SalesMappingPort {
  resolveLine(input: {companyId: string; source: SalesSourceBinding; externalItemId: string; externalVariationId?: string}): Promise<SalesMappingResult>;
  resolveModifier(input: {companyId: string; source: SalesSourceBinding; externalItemId: string; externalVariationId?: string; externalModifierId: string}): Promise<SalesModifierMappingResult>;
}

export interface SalesEventStore {
  receive(companyId: string, record: SalesEventRecord, actor: string, at: string): Promise<SalesReceipt>;
  claim(companyId: string, eventKey: string, attempt: SalesAttempt, at: string): Promise<boolean>;
  completeAttempt(companyId: string, attempt: SalesAttempt, to: 'applied' | 'held' | 'failed', at: string, reason?: string): Promise<void>;
  transition(companyId: string, eventKey: string, from: SalesEventState, to: SalesEventState, at: string, reason?: string, linkedEventKey?: string): Promise<void>;
  resolve(companyId: string, eventKey: string, from: 'failed' | 'held', to: 'received' | 'dismissed', resolution: SalesResolution, audit: SalesAuditEntry): Promise<void>;
  appendResolution(companyId: string, value: SalesResolution): Promise<void>;
  appendAudit(companyId: string, value: SalesAuditEntry): Promise<void>;
  appendCorrection(companyId: string, value: SalesCorrectionRequest, audit: SalesAuditEntry): Promise<void>;
  state(companyId: string, eventKey: string): Promise<SalesEventState | null>;
  event(companyId: string, eventKey: string): Promise<SalesEventRecord | null>;
  conflict(companyId: string, conflictId: string): Promise<SalesConflictReceipt | null>;
  dismissConflict(companyId: string, value: SalesConflictResolution, audit: SalesAuditEntry): Promise<void>;
  latestAppliedConsumption(companyId: string, lineageKey: string, beforeRevision: number): Promise<SalesEventRecord | null>;
  processingInLineage(companyId: string, lineageKey: string, exceptEventKey?: string): Promise<boolean>;
  recoverExpired(companyId: string, now: string): Promise<string[]>;
  purgeExpiredPayloadFragments(companyId: string, now: string, limit: number): Promise<number>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function validId(value: unknown) {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && utf8Bytes(value) <= MAX_ID_BYTES && !/[\u0000-\u001f\u007f]/.test(value);
}

function positiveCount(value: unknown) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
}

function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = RFC_3339.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalize);
    if (normalized.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      const key = normalized.every(item => 'externalLineId' in (item as object))
        ? 'externalLineId'
        : normalized.every(item => 'externalModifierLineId' in (item as object)) ? 'externalModifierLineId' : null;
      if (key) return normalized.sort((a, b) => String((a as Record<string, unknown>)[key]).localeCompare(String((b as Record<string, unknown>)[key])));
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
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
  return [...new Uint8Array(bytes)].map(part => part.toString(16).padStart(2, '0')).join('');
}

function encodedTuple(values: string[]) {
  return values.map(value => `${utf8Bytes(value)}:${value}`).join('|');
}

function actorId(actor: SalesActor) {
  return actor.kind === 'user' ? `user:${actor.userId}` : `machine:${actor.machineId}`;
}

function sameSource(a: SalesSourceBinding, b: SalesSourceBinding) {
  return a.kind === b.kind && a.provider === b.provider && a.environment === b.environment && a.connectionId === b.connectionId && a.merchantId === b.merchantId && a.locationId === b.locationId;
}

function assertOperator(actor: SalesActor | null, companyId: string) {
  if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
  if (actor.kind !== 'user' || actor.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
  if (actor.role !== 'owner' && actor.role !== 'manager') throw new SalesIngestionError('forbidden_role', 'Owner or manager permission is required.');
  return actorId(actor);
}

function assertReadable(actor: SalesActor | null, companyId: string) {
  if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
  if (actor.kind !== 'user' || actor.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
}

function validateSource(source: SalesSourceBinding) {
  if (!['manual', 'csv', 'bridge', 'native'].includes(source.kind) ||
      !validId(source.provider) || !validId(source.environment) || !validId(source.connectionId) ||
      !validId(source.merchantId) || !validId(source.locationId)) {
    throw new SalesIngestionError('invalid_source', 'Trusted source binding is invalid.');
  }
}

function assertReceiptAuthorization(context: TrustedReceiptContext) {
  const {actor, companyId, source} = context;
  if (!actor) throw new SalesIngestionError('unauthenticated', 'Authentication is required.');
  if (actor.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Actor is not bound to this company.');
  if (actor.kind === 'machine') {
    if (!sameSource(actor.source, source)) throw new SalesIngestionError('source_mismatch', 'Machine identity is not bound to this source.');
    return;
  }
  if (actor.role === 'employee') throw new SalesIngestionError('forbidden_role', 'Employees cannot receive sales events.');
  if (source.kind === 'native' || source.kind === 'bridge') throw new SalesIngestionError('source_mismatch', 'Machine-bound sources require machine authentication.');
}

function normalizeDraft(draft: SalesEventDraftV1, now: number): Omit<SalesEventV1, 'companyId' | 'source' | 'external' | 'receivedAt' | 'integrity'> & {externalEventId: string; externalOrderId: string; revision: number} {
  if (!draft || draft.schemaVersion !== SALES_EVENT_CONTRACT) throw new SalesIngestionError('invalid_schema', 'Unsupported sales event schema.');
  if (!validId(draft.externalEventId) || !validId(draft.externalOrderId)) throw new SalesIngestionError('invalid_identity', 'External event and order IDs are required.');
  if (!Number.isSafeInteger(draft.revision) || draft.revision < 1) throw new SalesIngestionError('invalid_revision', 'Revision must be a positive safe integer.');
  if (!['sale', 'revision', 'cancellation', 'refund', 'remake', 'reopen'].includes(draft.eventType)) throw new SalesIngestionError('invalid_event_type', 'Event type is invalid.');
  if (!['open', 'completed', 'canceled', 'partially_refunded', 'refunded', 'unknown'].includes(draft.orderStatus)) throw new SalesIngestionError('invalid_order_status', 'Order status is invalid.');
  if (!['not_started', 'prepared', 'fulfilled', 'unknown'].includes(draft.preparationStatus)) throw new SalesIngestionError('invalid_preparation_status', 'Preparation status is invalid.');
  if (!['provider', 'confirmed', 'inferred'].includes(draft.timeQuality)) throw new SalesIngestionError('invalid_time_quality', 'Time quality is invalid.');
  const occurred = instant(draft.occurredAt);
  if (occurred === null || occurred > now) throw new SalesIngestionError('invalid_occurrence_time', 'Occurrence time must be valid RFC 3339 and not in the future.');
  if (!Array.isArray(draft.lines) || draft.lines.length < 1 || draft.lines.length > MAX_LINES) throw new SalesIngestionError('invalid_lines', 'Event must contain between 1 and 100 lines.');
  const lineIds = new Set<string>();
  const lines = draft.lines.map(line => {
    if (!line || !validId(line.externalLineId) || !validId(line.externalItemId) ||
        (line.externalVariationId !== undefined && !validId(line.externalVariationId)) ||
        lineIds.has(line.externalLineId)) throw new SalesIngestionError('invalid_line', 'Line identities must be valid and unique.');
    if (!positiveCount(line.quantity)) throw new SalesIngestionError('invalid_quantity', 'Line quantity must be a positive whole-number string.');
    if (!Array.isArray(line.modifiers) || line.modifiers.length > MAX_MODIFIERS) throw new SalesIngestionError('invalid_modifiers', 'A line may contain at most 100 modifiers.');
    lineIds.add(line.externalLineId);
    const modifierLineIds = new Set<string>();
    const modifiers = line.modifiers.map(modifier => {
      if (!modifier || !validId(modifier.externalModifierLineId) || !validId(modifier.externalModifierId) || modifierLineIds.has(modifier.externalModifierLineId)) {
        throw new SalesIngestionError('invalid_modifier', 'Modifier line identities must be valid and unique within a line.');
      }
      if (!positiveCount(modifier.quantity)) throw new SalesIngestionError('invalid_quantity', 'Modifier quantity must be a positive whole-number string.');
      modifierLineIds.add(modifier.externalModifierLineId);
      return {...modifier};
    }).sort((a, b) => a.externalModifierLineId.localeCompare(b.externalModifierLineId));
    return {...line, modifiers};
  }).sort((a, b) => a.externalLineId.localeCompare(b.externalLineId));
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
  };
}

export function canonicalSalesEvent(event: SalesEventV1): SalesEventV1 {
  return {
    schemaVersion: event.schemaVersion,
    companyId: event.companyId,
    source: {
      kind: event.source.kind,
      provider: event.source.provider,
      environment: event.source.environment,
      connectionId: event.source.connectionId,
      merchantId: event.source.merchantId,
      locationId: event.source.locationId,
    },
    external: {
      externalEventId: event.external.externalEventId,
      externalOrderId: event.external.externalOrderId,
      revision: event.external.revision,
      eventIdempotencyKey: event.external.eventIdempotencyKey,
    },
    eventType: event.eventType,
    orderStatus: event.orderStatus,
    preparationStatus: event.preparationStatus,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    timeQuality: event.timeQuality,
    lines: event.lines.map(line => ({
      externalLineId: line.externalLineId,
      externalItemId: line.externalItemId,
      ...(line.externalVariationId === undefined ? {} : {externalVariationId: line.externalVariationId}),
      quantity: line.quantity,
      modifiers: line.modifiers.map(modifier => ({
        externalModifierLineId: modifier.externalModifierLineId,
        externalModifierId: modifier.externalModifierId,
        quantity: modifier.quantity,
      })),
    })),
    integrity: {
      sourcePayloadSha256: event.integrity.sourcePayloadSha256,
      payloadExpiresAt: event.integrity.payloadExpiresAt,
      normalizedContractVersion: event.integrity.normalizedContractVersion,
    },
  };
}

export function salesEventAuditFragment(event: SalesEventV1) {
  return {
    source: {
      kind: event.source.kind,
      provider: event.source.provider,
      environment: event.source.environment,
      connectionId: event.source.connectionId,
      merchantId: event.source.merchantId,
      locationId: event.source.locationId,
    },
    external: {
      externalEventId: event.external.externalEventId,
      externalOrderId: event.external.externalOrderId,
      revision: event.external.revision,
    },
    eventType: event.eventType,
    orderStatus: event.orderStatus,
    preparationStatus: event.preparationStatus,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    lines: event.lines,
  };
}

export class InMemorySalesEventStore implements SalesEventStore {
  private readonly events = new Map<string, SalesEventRecord>();
  private readonly transitions: SalesTransition[] = [];
  private readonly attempts: SalesAttempt[] = [];
  private readonly conflicts: SalesConflictReceipt[] = [];
  private readonly conflictResolutions: SalesConflictResolution[] = [];
  private readonly resolutions: SalesResolution[] = [];
  private readonly audits: SalesAuditEntry[] = [];
  private readonly corrections: SalesCorrectionRequest[] = [];
  private readonly idFactory: () => string;

  constructor(snapshot?: SalesStoreSnapshot, idFactory: () => string = () => crypto.randomUUID()) {
    this.idFactory = idFactory;
    if (!snapshot) return;
    for (const record of snapshot.events) this.events.set(record.event.external.eventIdempotencyKey, clone(record));
    this.transitions.push(...clone(snapshot.transitions));
    this.attempts.push(...clone(snapshot.attempts));
    this.conflicts.push(...clone(snapshot.conflicts));
    this.conflictResolutions.push(...clone(snapshot.conflictResolutions));
    this.resolutions.push(...clone(snapshot.resolutions));
    this.audits.push(...clone(snapshot.audits));
    this.corrections.push(...clone(snapshot.corrections));
  }

  private stateFor(companyId: string, eventKey: string): SalesEventState | null {
    if (this.events.get(eventKey)?.event.companyId !== companyId) return null;
    const transitions = this.transitions.filter(item => item.eventKey === eventKey);
    return transitions.length ? transitions[transitions.length - 1].to : null;
  }

  async state(companyId: string, eventKey: string): Promise<SalesEventState | null> { return this.stateFor(companyId, eventKey); }

  async event(companyId: string, eventKey: string) {
    const value = this.events.get(eventKey);
    return value?.event.companyId === companyId ? clone(value) : null;
  }

  async conflict(companyId: string, conflictId: string) {
    const value = this.conflicts.find(item => item.conflictId === conflictId);
    return value && this.events.get(value.canonicalEventKey)?.event.companyId === companyId ? clone(value) : null;
  }

  private transitionRecord(eventKey: string, from: SalesEventState | null, to: SalesEventState, at: string, reason?: string, linkedEventKey?: string) {
    this.transitions.push({transitionId: this.idFactory(), eventKey, from, to, at, ...(reason ? {reason} : {}), ...(linkedEventKey ? {linkedEventKey} : {})});
  }

  async receive(companyId: string, record: SalesEventRecord, actor: string, at: string): Promise<SalesReceipt> {
    if (record.event.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Event is not bound to this company.');
    if (record.event.receivedAt !== at) throw new SalesIngestionError('invalid_time', 'Receipt time does not match the normalized event.');
    const storedRecord: SalesEventRecord = {
      event: canonicalSalesEvent(record.event),
      auditFragment: record.auditFragment === null ? null : salesEventAuditFragment(record.event),
      applicationKey: record.applicationKey,
      lineageKey: record.lineageKey,
    };
    const eventKey = storedRecord.event.external.eventIdempotencyKey;
    const existing = this.events.get(eventKey);
    if (existing) {
      if (existing.event.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Event identity belongs to another company.');
      const state = this.stateFor(companyId, eventKey)!;
      if (existing.event.integrity.sourcePayloadSha256 === storedRecord.event.integrity.sourcePayloadSha256) return {kind: 'duplicate', eventKey, state};
      const duplicateConflict = this.conflicts.find(item => item.canonicalEventKey === eventKey && item.sourcePayloadSha256 === storedRecord.event.integrity.sourcePayloadSha256 && item.externalEventId === storedRecord.event.external.externalEventId && item.externalOrderId === storedRecord.event.external.externalOrderId && item.revision === storedRecord.event.external.revision);
      if (duplicateConflict) return {kind: 'conflict', eventKey, conflictId: duplicateConflict.conflictId, state};
      const conflict: SalesConflictReceipt = {
        conflictId: this.idFactory(), canonicalEventKey: eventKey, receivedAt: at,
        sourcePayloadSha256: storedRecord.event.integrity.sourcePayloadSha256,
        externalEventId: storedRecord.event.external.externalEventId,
        externalOrderId: storedRecord.event.external.externalOrderId,
        revision: storedRecord.event.external.revision,
        reason: 'identity_conflict',
      };
      this.conflicts.push(conflict);
      return {kind: 'conflict', eventKey, conflictId: conflict.conflictId, state};
    }
    const sameRevision = [...this.events.values()].find(item => item.event.companyId === companyId && item.lineageKey === storedRecord.lineageKey && item.event.external.revision === storedRecord.event.external.revision);
    if (sameRevision) {
      const canonicalKey = sameRevision.event.external.eventIdempotencyKey;
      const duplicateConflict = this.conflicts.find(item => item.canonicalEventKey === canonicalKey && item.sourcePayloadSha256 === storedRecord.event.integrity.sourcePayloadSha256 && item.externalEventId === storedRecord.event.external.externalEventId && item.externalOrderId === storedRecord.event.external.externalOrderId && item.revision === storedRecord.event.external.revision);
      if (duplicateConflict) return {kind: 'conflict', eventKey: canonicalKey, conflictId: duplicateConflict.conflictId, state: this.stateFor(companyId, canonicalKey)!};
      const conflict: SalesConflictReceipt = {
        conflictId: this.idFactory(), canonicalEventKey: canonicalKey, receivedAt: at,
        sourcePayloadSha256: storedRecord.event.integrity.sourcePayloadSha256,
        externalEventId: storedRecord.event.external.externalEventId,
        externalOrderId: storedRecord.event.external.externalOrderId,
        revision: storedRecord.event.external.revision,
        reason: 'identity_conflict',
      };
      this.conflicts.push(conflict);
      return {kind: 'conflict', eventKey: canonicalKey, conflictId: conflict.conflictId, state: this.stateFor(companyId, canonicalKey)!};
    }

    this.events.set(eventKey, clone(storedRecord));
    this.transitionRecord(eventKey, null, 'received', at);
    this.audits.push({auditId: this.idFactory(), eventKey, action: 'received', actor, at});
    const lineageEvents = [...this.events.values()]
      .filter(item => item.lineageKey === storedRecord.lineageKey && item.event.external.eventIdempotencyKey !== eventKey);
    const higher = lineageEvents.find(item => item.event.external.revision > storedRecord.event.external.revision);
    if (higher) this.transitionRecord(eventKey, 'received', 'superseded', at, 'stale_revision', higher.event.external.eventIdempotencyKey);
    else {
      for (const older of lineageEvents.filter(item => item.event.external.revision < storedRecord.event.external.revision)) {
        const olderKey = older.event.external.eventIdempotencyKey;
        const state = this.stateFor(companyId, olderKey);
        if (state === 'received' || state === 'held' || state === 'failed') {
          this.transitionRecord(olderKey, state, 'superseded', at, 'newer_revision', eventKey);
          this.audits.push({auditId: this.idFactory(), eventKey: olderKey, action: 'superseded', actor, at, reason: `Superseded by ${eventKey}.`});
        }
      }
    }
    return {kind: 'created', eventKey, state: this.stateFor(companyId, eventKey)!};
  }

  private processingInLineageFor(companyId: string, lineageKey: string, exceptEventKey?: string) {
    return [...this.events.values()].some(record => record.event.companyId === companyId && record.lineageKey === lineageKey && record.event.external.eventIdempotencyKey !== exceptEventKey && this.stateFor(companyId, record.event.external.eventIdempotencyKey) === 'processing');
  }

  async processingInLineage(companyId: string, lineageKey: string, exceptEventKey?: string) {
    return this.processingInLineageFor(companyId, lineageKey, exceptEventKey);
  }

  async claim(companyId: string, eventKey: string, attempt: SalesAttempt, at: string) {
    const record = this.events.get(eventKey);
    if (attempt.eventKey !== eventKey || attempt.startedAt !== at || instant(at) === null || instant(attempt.leaseExpiresAt) === null || Date.parse(attempt.leaseExpiresAt) <= Date.parse(at) ||
        !record || record.event.companyId !== companyId || this.stateFor(companyId, eventKey) !== 'received' || this.processingInLineageFor(companyId, record.lineageKey, eventKey)) return false;
    for (const older of [...this.events.values()].filter(item => item.lineageKey === record.lineageKey && item.event.external.revision < record.event.external.revision)) {
      const olderKey = older.event.external.eventIdempotencyKey;
      const state = this.stateFor(companyId, olderKey);
      if (state === 'held' || state === 'failed' || state === 'received') this.transitionRecord(olderKey, state, 'superseded', at, 'newer_revision', eventKey);
    }
    this.attempts.push(clone(attempt));
    this.transitionRecord(eventKey, 'received', 'processing', at);
    return true;
  }

  async completeAttempt(companyId: string, attempt: SalesAttempt, to: 'applied' | 'held' | 'failed', at: string, reason?: string) {
    const matchingOutcome = (to === 'applied' && (attempt.outcome === 'applied' || attempt.outcome === 'noop')) || attempt.outcome === to;
    if (!attempt.completedAt || attempt.completedAt !== at || !matchingOutcome) throw new SalesIngestionError('invalid_attempt', 'Attempt result does not match its terminal state.');
    if (this.stateFor(companyId, attempt.eventKey) !== 'processing') throw new SalesIngestionError('invalid_state', 'Event is no longer processing.');
    const index = this.attempts.findIndex(item => item.attemptId === attempt.attemptId);
    if (index < 0 || this.attempts[index].completedAt) throw new SalesIngestionError('invalid_attempt', 'Attempt is missing or already complete.');
    this.attempts[index] = clone(attempt);
    this.transitionRecord(attempt.eventKey, 'processing', to, at, reason);
  }

  async transition(companyId: string, eventKey: string, from: SalesEventState, to: SalesEventState, at: string, reason?: string, linkedEventKey?: string) {
    if (this.stateFor(companyId, eventKey) !== from) throw new SalesIngestionError('invalid_state', `Expected ${from} state.`);
    this.transitionRecord(eventKey, from, to, at, reason, linkedEventKey);
  }

  async resolve(companyId: string, eventKey: string, from: 'failed' | 'held', to: 'received' | 'dismissed', resolution: SalesResolution, audit: SalesAuditEntry) {
    const allowed = (from === 'failed' && to === 'received' && resolution.kind === 'retry' && audit.action === 'retry') ||
      (from === 'held' && to === 'received' && resolution.kind === 'replay' && audit.action === 'replay') ||
      (from === 'held' && to === 'dismissed' && resolution.kind === 'dismiss' && audit.action === 'dismiss');
    if (!allowed || resolution.eventKey !== eventKey || audit.eventKey !== eventKey || resolution.at !== audit.at || this.stateFor(companyId, eventKey) !== from) throw new SalesIngestionError('invalid_state', `Expected ${from} state.`);
    this.transitionRecord(eventKey, from, to, resolution.at, resolution.reason);
    this.resolutions.push(clone(resolution));
    this.audits.push(clone(audit));
  }

  async dismissConflict(companyId: string, value: SalesConflictResolution, audit: SalesAuditEntry) {
    if (!this.conflicts.some(item => item.conflictId === value.conflictId && item.canonicalEventKey === value.canonicalEventKey && this.events.get(item.canonicalEventKey)?.event.companyId === companyId)) {
      throw new SalesIngestionError('not_found', 'Identity-conflict receipt was not found.');
    }
    if (this.conflictResolutions.some(item => item.conflictId === value.conflictId)) {
      throw new SalesIngestionError('invalid_state', 'Identity-conflict receipt is already resolved.');
    }
    this.conflictResolutions.push(clone(value));
    this.audits.push(clone(audit));
  }

  async latestAppliedConsumption(companyId: string, lineageKey: string, beforeRevision: number) {
    const consumedEventKeys = new Set(this.attempts
      .filter(attempt => attempt.completedAt && attempt.outcome === 'applied')
      .map(attempt => attempt.eventKey));
    let match: SalesEventRecord | undefined;
    for (const record of [...this.events.values()].filter(record => record.event.companyId === companyId && record.lineageKey === lineageKey && record.event.external.revision < beforeRevision && consumedEventKeys.has(record.event.external.eventIdempotencyKey)).sort((a, b) => b.event.external.revision - a.event.external.revision)) {
      if (this.stateFor(companyId, record.event.external.eventIdempotencyKey) === 'applied') { match = record; break; }
    }
    return match ? clone(match) : null;
  }

  async appendResolution(companyId: string, value: SalesResolution) { if (!await this.event(companyId, value.eventKey)) throw new SalesIngestionError('not_found', 'Sales event was not found.'); this.resolutions.push(clone(value)); }
  async appendAudit(companyId: string, value: SalesAuditEntry) { if (!await this.event(companyId, value.eventKey)) throw new SalesIngestionError('not_found', 'Sales event was not found.'); this.audits.push(clone(value)); }
  async appendCorrection(companyId: string, value: SalesCorrectionRequest, audit: SalesAuditEntry) {
    if (value.companyId !== companyId || audit.eventKey !== value.eventKey || !this.events.has(value.eventKey) || this.events.get(value.eventKey)?.event.companyId !== companyId) throw new SalesIngestionError('not_found', 'Sales event was not found.');
    this.corrections.push(clone(value));
    this.audits.push(clone(audit));
  }

  async recoverExpired(companyId: string, now: string) {
    const nowMs = instant(now);
    if (nowMs === null) throw new SalesIngestionError('invalid_time', 'Recovery time is invalid.');
    const recovered: string[] = [];
    for (let index = 0; index < this.attempts.length; index++) {
      const attempt = this.attempts[index];
      if (this.events.get(attempt.eventKey)?.event.companyId === companyId && this.stateFor(companyId, attempt.eventKey) === 'processing' && !attempt.completedAt && Date.parse(attempt.leaseExpiresAt) <= nowMs) {
        this.attempts[index] = {...attempt, completedAt: now, outcome: 'failed', errorCode: 'interrupted'};
        this.transitionRecord(attempt.eventKey, 'processing', 'failed', now, 'interrupted');
        this.audits.push({auditId: this.idFactory(), eventKey: attempt.eventKey, action: 'lease_expired', actor: 'system', at: now, reason: 'Processing lease expired; application is unknown.'});
        recovered.push(attempt.eventKey);
      }
    }
    return recovered;
  }

  async purgeExpiredPayloadFragments(companyId: string, now: string, limit: number) {
    if (instant(now) === null || !Number.isSafeInteger(limit) || limit < 1) throw new SalesIngestionError('invalid_cleanup', 'Cleanup time and limit are invalid.');
    const expired = [...this.events.values()]
      .filter(record => record.event.companyId === companyId && record.auditFragment !== null && record.event.integrity.payloadExpiresAt !== null && record.event.integrity.payloadExpiresAt <= now)
      .sort((a, b) => a.event.integrity.payloadExpiresAt!.localeCompare(b.event.integrity.payloadExpiresAt!))
      .slice(0, limit);
    for (const record of expired) {
      record.auditFragment = null;
      record.event.integrity.payloadExpiresAt = null;
    }
    return expired.length;
  }

  snapshot(): SalesStoreSnapshot {
    return clone({events: [...this.events.values()], transitions: this.transitions, attempts: this.attempts, conflicts: this.conflicts, conflictResolutions: this.conflictResolutions, resolutions: this.resolutions, audits: this.audits, corrections: this.corrections});
  }
}

type FakeLineMapping = {companyId: string; provider: string; externalItemId: string; externalVariationId?: string; recipeId: string};
type FakeModifierMapping = FakeLineMapping & {externalModifierId: string; modifierId: string};

export class FakeSalesMappingPort implements SalesMappingPort {
  constructor(private readonly lineMappings: FakeLineMapping[] = [], private readonly modifierMappings: FakeModifierMapping[] = []) {}
  setLine(mapping: FakeLineMapping) { this.lineMappings.push(clone(mapping)); }
  setModifier(mapping: FakeModifierMapping) { this.modifierMappings.push(clone(mapping)); }
  async resolveLine(input: {companyId: string; source: SalesSourceBinding; externalItemId: string; externalVariationId?: string}): Promise<SalesMappingResult> {
    const candidates = this.lineMappings.filter(item => item.companyId === input.companyId && item.provider === input.source.provider && item.externalItemId === input.externalItemId);
    const mapping = candidates.find(item => item.externalVariationId === input.externalVariationId);
    if (mapping) return {status: 'mapped', recipeId: mapping.recipeId};
    return {status: candidates.length ? 'unknown_variation' : 'unknown_item'};
  }
  async resolveModifier(input: {companyId: string; source: SalesSourceBinding; externalItemId: string; externalVariationId?: string; externalModifierId: string}): Promise<SalesModifierMappingResult> {
    const mapping = this.modifierMappings.find(item => item.companyId === input.companyId && item.provider === input.source.provider && item.externalItemId === input.externalItemId && item.externalVariationId === input.externalVariationId && item.externalModifierId === input.externalModifierId);
    return mapping ? {status: 'mapped', modifierId: mapping.modifierId} : {status: 'unknown_modifier'};
  }
}

type Clock = {now(): Date};
type ServiceOptions = {clock?: Clock; idFactory?: () => string; afterInventoryApply?: (result: InventoryConsumptionResult) => void | Promise<void>};

export class SalesIngestionService {
  private readonly clock: Clock;
  private readonly idFactory: () => string;
  constructor(
    private readonly store: SalesEventStore,
    private readonly mappings: SalesMappingPort,
    private readonly inventory: InventoryConsumptionPort,
    private readonly options: ServiceOptions = {},
  ) {
    this.clock = options.clock ?? {now: () => new Date()};
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  private now() { return this.clock.now().toISOString(); }

  async receive(context: TrustedReceiptContext, draft: SalesEventDraftV1): Promise<SalesReceipt> {
    if (!validId(context.companyId)) throw new SalesIngestionError('unmapped_company', 'Trusted company binding is missing or invalid.');
    validateSource(context.source);
    assertReceiptAuthorization(context);
    const receivedAt = this.now();
    const normalized = normalizeDraft(draft, Date.parse(receivedAt));
    const sourceJson = canonicalJson(draft.sourcePayload ?? {
      ...normalized,
      lines: normalized.lines,
    });
    const byteLimit = context.sourceByteLimit ?? MAX_RETAINED_BYTES;
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || utf8Bytes(sourceJson) > byteLimit) throw new SalesIngestionError('payload_too_large', 'Source payload exceeds its configured UTF-8 byte limit.');
    const sourceHash = await sha256(sourceJson);
    const eventKey = await sha256(encodedTuple([context.companyId, context.source.provider, context.source.environment, context.source.merchantId, normalized.externalEventId, String(normalized.revision)]));
    const lineageKey = await sha256(encodedTuple([context.companyId, context.source.provider, context.source.environment, context.source.merchantId, normalized.externalOrderId]));
    const applicationKey = await sha256(encodedTuple([eventKey, APPLICATION_OPERATION]));
    const event: SalesEventV1 = {
      schemaVersion: SALES_EVENT_CONTRACT,
      companyId: context.companyId,
      source: clone(context.source),
      external: {externalEventId: normalized.externalEventId, externalOrderId: normalized.externalOrderId, revision: normalized.revision, eventIdempotencyKey: eventKey},
      eventType: normalized.eventType,
      orderStatus: normalized.orderStatus,
      preparationStatus: normalized.preparationStatus,
      occurredAt: normalized.occurredAt,
      receivedAt,
      timeQuality: normalized.timeQuality,
      lines: normalized.lines,
      integrity: {sourcePayloadSha256: sourceHash, payloadExpiresAt: new Date(Date.parse(receivedAt) + RETENTION_MS).toISOString(), normalizedContractVersion: SALES_EVENT_CONTRACT},
    };
    const fragment = salesEventAuditFragment(event);
    if (utf8Bytes(canonicalJson(fragment)) > MAX_RETAINED_BYTES) throw new SalesIngestionError('retained_fragment_too_large', 'Minimal retained fragment exceeds 65,536 UTF-8 bytes.');
    return this.store.receive(context.companyId, {event, auditFragment: fragment, applicationKey, lineageKey}, actorId(context.actor!), receivedAt);
  }

  private async mappedLines(record: SalesEventRecord, lines: SalesEventV1['lines']) {
    const held = new Set<HeldReason>();
    const mapped: Array<{lineId: string; recipeId: string; quantity: string; modifiers: Array<{modifierId: string; quantity: string}>}> = [];
    for (const line of lines) {
      const mapping = await this.mappings.resolveLine({companyId: record.event.companyId, source: record.event.source, externalItemId: line.externalItemId, ...(line.externalVariationId ? {externalVariationId: line.externalVariationId} : {})});
      if (mapping.status !== 'mapped') {
        held.add(mapping.status);
        continue;
      }
      const modifierTotals = new Map<string, bigint>();
      for (const modifier of line.modifiers) {
        const result = await this.mappings.resolveModifier({companyId: record.event.companyId, source: record.event.source, externalItemId: line.externalItemId, ...(line.externalVariationId ? {externalVariationId: line.externalVariationId} : {}), externalModifierId: modifier.externalModifierId});
        if (result.status !== 'mapped') held.add(result.status);
        else modifierTotals.set(result.modifierId, (modifierTotals.get(result.modifierId) ?? BigInt(0)) + BigInt(modifier.quantity));
      }
      const modifiers = [...modifierTotals].map(([modifierId, quantity]) => ({modifierId, quantity: String(quantity)}));
      mapped.push({lineId: line.externalLineId, recipeId: mapping.recipeId, quantity: line.quantity, modifiers});
    }
    return {held: [...held], mapped};
  }

  private positiveDelta(current: SalesEventV1, previous: SalesEventV1 | null) {
    if (!previous) return {lines: current.lines, correction: false};
    const priorLines = new Map(previous.lines.map(line => [line.externalLineId, line]));
    const currentLines = new Map(current.lines.map(line => [line.externalLineId, line]));
    for (const [id, prior] of priorLines) {
      const line = currentLines.get(id);
      if (!line || line.externalItemId !== prior.externalItemId || line.externalVariationId !== prior.externalVariationId || BigInt(line.quantity) < BigInt(prior.quantity)) return {lines: [], correction: true};
      const currentModifiers = new Map(line.modifiers.map(modifier => [modifier.externalModifierLineId, modifier]));
      for (const modifier of prior.modifiers) {
        const next = currentModifiers.get(modifier.externalModifierLineId);
        if (!next || next.externalModifierId !== modifier.externalModifierId || BigInt(next.quantity) < BigInt(modifier.quantity)) return {lines: [], correction: true};
      }
      const baseIncrease = BigInt(line.quantity) > BigInt(prior.quantity);
      const modifierIncrease = line.modifiers.some(modifier => {
        const old = prior.modifiers.find(item => item.externalModifierLineId === modifier.externalModifierLineId);
        return !old || BigInt(modifier.quantity) > BigInt(old.quantity);
      });
      if (modifierIncrease && !baseIncrease) return {lines: [], correction: true};
    }
    const deltas: SalesEventV1['lines'] = [];
    for (const line of current.lines) {
      const prior = priorLines.get(line.externalLineId);
      if (!prior) { deltas.push(line); continue; }
      const quantity = BigInt(line.quantity) - BigInt(prior.quantity);
      if (quantity === BigInt(0)) continue;
      const modifiers = line.modifiers.flatMap(modifier => {
        const old = prior.modifiers.find(item => item.externalModifierLineId === modifier.externalModifierLineId);
        const delta = BigInt(modifier.quantity) - BigInt(old?.quantity ?? '0');
        return delta > BigInt(0) ? [{...modifier, quantity: String(delta)}] : [];
      });
      deltas.push({...line, quantity: String(quantity), modifiers});
    }
    return {lines: deltas, correction: false};
  }

  private async policy(record: SalesEventRecord) {
    const event = record.event;
    const previous = (await this.store.latestAppliedConsumption(event.companyId, record.lineageKey, event.external.revision))?.event ?? null;
    if (event.timeQuality === 'inferred') return {held: ['ambiguous_occurrence_time'] as HeldReason[], lines: [] as SalesEventV1['lines']};
    const prepared = event.preparationStatus === 'prepared' || event.preparationStatus === 'fulfilled';
    if (event.eventType === 'refund' && !previous && !prepared) return {held: [] as HeldReason[], lines: [] as SalesEventV1['lines']};
    if (event.eventType === 'refund' && previous) return {held: [] as HeldReason[], lines: [] as SalesEventV1['lines']};
    if (event.eventType === 'cancellation' && event.preparationStatus === 'not_started') return {held: [] as HeldReason[], lines: [] as SalesEventV1['lines']};
    if (event.eventType === 'cancellation' && previous) return {held: [] as HeldReason[], lines: [] as SalesEventV1['lines']};
    if (!prepared) return {held: ['ambiguous_preparation'] as HeldReason[], lines: [] as SalesEventV1['lines']};
    const delta = this.positiveDelta(event, previous);
    if (delta.correction) return {held: ['correction_required'] as HeldReason[], lines: [] as SalesEventV1['lines']};
    return {held: [] as HeldReason[], lines: delta.lines};
  }

  async process(companyId: string, eventKey: string) {
    const record = await this.store.event(companyId, eventKey);
    if (!record) throw new SalesIngestionError('not_found', 'Sales event was not found.');
    const startedAt = this.now();
    const attempt: SalesAttempt = {attemptId: this.idFactory(), eventKey, startedAt, leaseExpiresAt: new Date(Date.parse(startedAt) + LEASE_MS).toISOString()};
    if (!await this.store.claim(companyId, eventKey, attempt, startedAt)) throw new SalesIngestionError('claim_conflict', 'Sales event is not claimable.');
    const policy = await this.policy(record);
    if (policy.held.length) {
      const complete = {...attempt, completedAt: this.now(), outcome: 'held' as const, heldReasons: policy.held};
      await this.store.completeAttempt(companyId, complete, 'held', complete.completedAt, policy.held.join(','));
      return this.statusForWorker(companyId, eventKey);
    }
    if (!policy.lines.length) {
      const complete = {...attempt, completedAt: this.now(), outcome: 'noop' as const};
      await this.store.completeAttempt(companyId, complete, 'applied', complete.completedAt, 'policy_noop');
      return this.statusForWorker(companyId, eventKey);
    }
    const mapping = await this.mappedLines(record, policy.lines);
    if (mapping.held.length) {
      const complete = {...attempt, completedAt: this.now(), outcome: 'held' as const, heldReasons: mapping.held};
      await this.store.completeAttempt(companyId, complete, 'held', complete.completedAt, mapping.held.join(','));
      return this.statusForWorker(companyId, eventKey);
    }
    const request: InventoryConsumptionRequest = {
      contract: INVENTORY_CONSUMPTION_CONTRACT,
      companyId: record.event.companyId,
      idempotencyKey: record.applicationKey,
      occurredAt: record.event.occurredAt,
      lines: mapping.mapped,
    };
    let result: InventoryConsumptionResult;
    try {
      result = await this.inventory.consume(request);
    } catch {
      const complete = {...attempt, completedAt: this.now(), outcome: 'failed' as const, errorCode: 'inventory_unavailable' as const};
      await this.store.completeAttempt(companyId, complete, 'failed', complete.completedAt, complete.errorCode);
      return this.statusForWorker(companyId, eventKey);
    }
    // Reject mismatched replies before callbacks, terminal state changes or
    // storing their contents in this company's audit history.
    if (!result || result.contract !== request.contract || result.companyId !== request.companyId ||
      result.idempotencyKey !== request.idempotencyKey || typeof result.replayed !== 'boolean' ||
      !['applied', 'held', 'rejected'].includes(result.status) ||
      (result.status === 'applied' && (Date.parse(result.occurredAt) !== Date.parse(request.occurredAt) ||
        !Array.isArray(result.selectedVersions) || !Array.isArray(result.changes))) ||
      (result.status !== 'applied' && (result.replayed || !Array.isArray(result.issues) || !result.issues.length))) {
      const complete = {...attempt, completedAt: this.now(), outcome: 'failed' as const, errorCode: 'integration_defect' as const};
      await this.store.completeAttempt(companyId, complete, 'failed', complete.completedAt, complete.errorCode);
      return this.statusForWorker(companyId, eventKey);
    }
    if (this.options.afterInventoryApply && result.status === 'applied') await this.options.afterInventoryApply(result);
    const completedAt = this.now();
    if (result.status === 'applied') {
      const complete = {...attempt, completedAt, outcome: 'applied' as const, inventoryResult: result};
      await this.store.completeAttempt(companyId, complete, 'applied', completedAt, result.replayed ? 'inventory_replayed' : 'inventory_applied');
    } else if (result.status === 'held') {
      const reasons = result.issues.map(issue => issue.code as HeldReason);
      const complete = {...attempt, completedAt, outcome: 'held' as const, heldReasons: reasons, issues: result.issues, inventoryResult: result};
      await this.store.completeAttempt(companyId, complete, 'held', completedAt, reasons.join(','));
    } else {
      const codes = result.issues.map(issue => issue.code);
      if (codes.some(code => code === 'invalid_quantity' || code === 'invalid_occurrence_time' || code === 'idempotency_conflict')) {
        const reasons = codes.map(code => code === 'idempotency_conflict' ? 'identity_conflict' : code) as HeldReason[];
        const complete = {...attempt, completedAt, outcome: 'held' as const, heldReasons: reasons, issues: result.issues, inventoryResult: result};
        await this.store.completeAttempt(companyId, complete, 'held', completedAt, reasons.join(','));
      } else {
        const complete = {...attempt, completedAt, outcome: 'failed' as const, issues: result.issues, inventoryResult: result, errorCode: 'integration_defect' as const};
        await this.store.completeAttempt(companyId, complete, 'failed', completedAt, complete.errorCode);
      }
    }
    return this.statusForWorker(companyId, eventKey);
  }

  async recoverExpiredLeases(companyId: string) {
    const at = this.now();
    return this.store.recoverExpired(companyId, at);
  }

  async retry(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if (await this.store.state(companyId, eventKey) !== 'failed') throw new SalesIngestionError('invalid_state', 'Only failed events may be retried.');
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Retry reason is required.');
    const at = this.now();
    await this.store.resolve(
      companyId,eventKey,'failed','received',
      {resolutionId: this.idFactory(), eventKey, kind: 'retry', actor: identity, reason: clean, at},
      {auditId: this.idFactory(), eventKey, action: 'retry', actor: identity, at, reason: clean},
    );
  }

  async replay(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if (await this.store.state(companyId, eventKey) !== 'held') throw new SalesIngestionError('invalid_state', 'Only held events may be replayed.');
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Replay reason is required.');
    const at = this.now();
    await this.store.resolve(
      companyId,eventKey,'held','received',
      {resolutionId: this.idFactory(), eventKey, kind: 'replay', actor: identity, reason: clean, at},
      {auditId: this.idFactory(), eventKey, action: 'replay', actor: identity, at, reason: clean},
    );
  }

  async dismiss(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if (await this.store.state(companyId, eventKey) !== 'held') throw new SalesIngestionError('invalid_state', 'Only held events may be dismissed.');
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Dismissal reason is required.');
    const at = this.now();
    await this.store.resolve(
      companyId,eventKey,'held','dismissed',
      {resolutionId: this.idFactory(), eventKey, kind: 'dismiss', actor: identity, reason: clean, at},
      {auditId: this.idFactory(), eventKey, action: 'dismiss', actor: identity, at, reason: clean},
    );
  }

  async dismissConflict(companyId: string, conflictId: string, actor: SalesActor | null, reason: string) {
    const conflict = await this.store.conflict(companyId, conflictId);
    if (!conflict) throw new SalesIngestionError('not_found', 'Identity-conflict receipt was not found.');
    const record = await this.requiredEvent(companyId, conflict.canonicalEventKey);
    const identity = assertOperator(actor, record.event.companyId);
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Conflict dismissal reason is required.');
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
    await this.store.dismissConflict(companyId, resolution, {auditId: this.idFactory(), eventKey: conflict.canonicalEventKey, conflictId, action: 'conflict_dismissed', actor: identity, at, reason: clean});
    return clone(resolution);
  }

  async requestCorrection(companyId: string, eventKey: string, actor: SalesActor | null, reason: string) {
    const record = await this.requiredEvent(companyId, eventKey);
    const identity = assertOperator(actor, record.event.companyId);
    if (await this.store.state(companyId, eventKey) !== 'applied') throw new SalesIngestionError('invalid_state', 'Corrections may be requested only for applied events.');
    const clean = reason.trim();
    if (!clean) throw new SalesIngestionError('reason_required', 'Correction reason is required.');
    const requestedAt = this.now();
    const correction: SalesCorrectionRequest = {correctionId: this.idFactory(), eventKey, companyId: record.event.companyId, status: 'pending', actor: identity, reason: clean, requestedAt};
    await this.store.appendCorrection(companyId, correction, {auditId: this.idFactory(), eventKey, action: 'correction_requested', actor: identity, at: requestedAt, reason: clean});
    return clone(correction);
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
      occurredAt: record.event.occurredAt,
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
    return {eventKey, state: await this.store.state(companyId, eventKey)};
  }
}
