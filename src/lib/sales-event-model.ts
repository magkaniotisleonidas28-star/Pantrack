import { UserFacingError } from '@/lib/user-facing-error';
import type {
  ConsumptionIssue,
  InventoryConsumptionApplied,
  InventoryConsumptionResult,
} from '@/lib/inventory-consumption-contract';

export const SALES_EVENT_CONTRACT = 'pantrack.sales.v1' as const;

export const LEASE_MS = 5 * 60 * 1000;

const MAX_ID_BYTES = 200;

const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

export type SalesSourceKind = 'manual' | 'csv' | 'bridge' | 'native';

export type SalesEventType = 'sale' | 'revision' | 'cancellation' | 'refund' | 'remake' | 'reopen';

export type SalesOrderStatus =
  'open' | 'completed' | 'canceled' | 'partially_refunded' | 'refunded' | 'unknown';

export type SalesPreparationStatus = 'not_started' | 'prepared' | 'fulfilled' | 'unknown';

export type SalesTimeQuality = 'provider' | 'confirmed' | 'inferred';

export type SalesEventState =
  'received' | 'processing' | 'applied' | 'held' | 'failed' | 'dismissed' | 'superseded';

/**
 * A Clover order Pantrack can't read safely is received as its own paused sale
 * with one of these reasons, so syncing moves on (decision 0012, step P1).
 */
export type CloverPauseReason =
  | 'clover_custom_amount'
  | 'clover_sold_by_weight'
  | 'clover_order_too_large'
  | 'clover_refund_mismatch'
  | 'clover_unreadable_order';

export const CLOVER_PAUSE_REASONS: ReadonlySet<string> = new Set<CloverPauseReason>([
  'clover_custom_amount',
  'clover_sold_by_weight',
  'clover_order_too_large',
  'clover_refund_mismatch',
  'clover_unreadable_order',
]);

export type HeldReason =
  | CloverPauseReason
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
  | 'required_choice_missing'
  | 'invalid_quantity'
  | 'invalid_occurrence_time'
  | 'ambiguous_occurrence_time'
  | 'ambiguous_preparation'
  | 'deleted_order_detail_unavailable'
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
  /** Native Clover only: the order couldn't be read, so it is held with no lines. */
  unreadable?: CloverPauseReason;
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
  unreadable?: CloverPauseReason;
  integrity: {
    sourcePayloadSha256: string;
    payloadExpiresAt: string | null;
    normalizedContractVersion: typeof SALES_EVENT_CONTRACT;
  };
};

export type SalesUserActor = {
  kind: 'user';
  userId: string;
  companyId: string;
  role: 'owner' | 'manager' | 'employee';
};

export type SalesMachineActor = {
  kind: 'machine';
  machineId: string;
  companyId: string;
  source: SalesSourceBinding;
};

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
  action:
    | 'received'
    | 'retry'
    | 'replay'
    | 'dismiss'
    | 'conflict_dismissed'
    | 'correction_requested'
    | 'correction_applied'
    | 'occurrence_confirmed'
    | 'lease_expired'
    | 'superseded'
    | 'inventory_reconciled';
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
  status: 'pending' | 'applied';
  actor: string;
  reason: string;
  requestedAt: string;
};

export type SalesOccurrenceConfirmation = {
  eventKey: string;
  occurredAt: string;
  actor: string;
  reason: string;
  confirmedAt: string;
};

export type SalesStatusSummary = {
  eventKey: string;
  state: SalesEventState;
  sourceKind: SalesSourceKind;
  provider: string;
  externalReference: string;
  eventType: SalesEventType;
  occurredAt: string;
  receivedAt: string;
  timeQuality: SalesTimeQuality;
  revision: number;
  lastReason: string | null;
  leaseExpiresAt?: string | null;
};

export type SalesLeaseRecovery = {
  eventKey?: string;
  limit?: number;
  actor?: string;
  reason?: string;
};

export function leaseRecoveryOptions(options: SalesLeaseRecovery = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new SalesIngestionError('invalid_limit', 'Recovery limit must be between 1 and 100.');
  if (options.eventKey !== undefined && !validId(options.eventKey))
    throw new SalesIngestionError('invalid_identity', 'Recovery event identity is invalid.');
  if (options.actor !== undefined && !validId(options.actor))
    throw new SalesIngestionError('invalid_identity', 'Recovery actor is invalid.');
  if (
    options.reason !== undefined &&
    (!options.reason.trim() || options.reason.trim().length > 500)
  )
    throw new SalesIngestionError(
      'reason_required',
      'A recovery reason of up to 500 characters is required.',
    );
  return {
    limit,
    eventKey: options.eventKey,
    actor: options.actor ?? 'system',
    reason: options.reason?.trim() ?? 'Processing lease expired; application is unknown.',
  };
}

export type SalesHistoryEntry = {
  kind: 'transition' | 'attempt' | 'resolution' | 'audit';
  at: string;
  label: string;
  reason: string | null;
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
  occurrenceConfirmations?: SalesOccurrenceConfirmation[];
};

export type SalesReceipt =
  | { kind: 'created'; eventKey: string; state: SalesEventState }
  | { kind: 'duplicate'; eventKey: string; state: SalesEventState }
  | { kind: 'conflict'; eventKey: string; conflictId: string; state: SalesEventState };

export class SalesIngestionError extends UserFacingError {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SalesIngestionError';
  }
}

export type SalesMappingResult =
  { status: 'mapped'; recipeId: string } | { status: 'unknown_item' | 'unknown_variation' };

export type SalesModifierMappingResult =
  { status: 'mapped'; modifierId: string } | { status: 'unknown_modifier' };

export interface SalesMappingPort {
  resolveLine(input: {
    companyId: string;
    source: SalesSourceBinding;
    externalItemId: string;
    externalVariationId?: string;
  }): Promise<SalesMappingResult>;
  resolveModifier(input: {
    companyId: string;
    source: SalesSourceBinding;
    externalItemId: string;
    externalVariationId?: string;
    externalModifierId: string;
  }): Promise<SalesModifierMappingResult>;
}

export interface SalesEventStore {
  receive(
    companyId: string,
    record: SalesEventRecord,
    actor: string,
    at: string,
  ): Promise<SalesReceipt>;
  claim(companyId: string, eventKey: string, attempt: SalesAttempt, at: string): Promise<boolean>;
  completeAttempt(
    companyId: string,
    attempt: SalesAttempt,
    to: 'applied' | 'held' | 'failed',
    at: string,
    reason?: string,
  ): Promise<void>;
  transition(
    companyId: string,
    eventKey: string,
    from: SalesEventState,
    to: SalesEventState,
    at: string,
    reason?: string,
    linkedEventKey?: string,
  ): Promise<void>;
  resolve(
    companyId: string,
    eventKey: string,
    from: 'failed' | 'held' | 'dismissed',
    to: 'received' | 'dismissed',
    resolution: SalesResolution,
    audit: SalesAuditEntry,
  ): Promise<void>;
  appendResolution(companyId: string, value: SalesResolution): Promise<void>;
  appendAudit(companyId: string, value: SalesAuditEntry): Promise<void>;
  appendCorrection(
    companyId: string,
    value: SalesCorrectionRequest,
    audit: SalesAuditEntry,
  ): Promise<void>;
  confirmOccurrence(
    companyId: string,
    value: SalesOccurrenceConfirmation,
    audit: SalesAuditEntry,
  ): Promise<void>;
  occurrenceConfirmation(
    companyId: string,
    eventKey: string,
  ): Promise<SalesOccurrenceConfirmation | null>;
  listStatus(companyId: string, limit: number): Promise<SalesStatusSummary[]>;
  history(companyId: string, eventKey: string, limit: number): Promise<SalesHistoryEntry[]>;
  state(companyId: string, eventKey: string): Promise<SalesEventState | null>;
  event(companyId: string, eventKey: string): Promise<SalesEventRecord | null>;
  conflict(companyId: string, conflictId: string): Promise<SalesConflictReceipt | null>;
  dismissConflict(
    companyId: string,
    value: SalesConflictResolution,
    audit: SalesAuditEntry,
  ): Promise<void>;
  latestAppliedConsumption(
    companyId: string,
    lineageKey: string,
    beforeRevision: number,
  ): Promise<SalesEventRecord | null>;
  unresolvedConsumption(
    companyId: string,
    lineageKey: string,
    beforeRevision: number,
  ): Promise<SalesEventRecord[]>;
  reconcileApplied(
    companyId: string,
    eventKey: string,
    result: InventoryConsumptionApplied,
    at: string,
  ): Promise<boolean>;
  processingInLineage(
    companyId: string,
    lineageKey: string,
    exceptEventKey?: string,
  ): Promise<boolean>;
  recoverExpired(companyId: string, now: string, options?: SalesLeaseRecovery): Promise<string[]>;
  purgeExpiredPayloadFragments(companyId: string, now: string, limit: number): Promise<number>;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    utf8Bytes(value) <= MAX_ID_BYTES &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function instant(value: unknown): number | null {
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
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    lines: event.lines.map((line) => ({
      externalLineId: line.externalLineId,
      externalItemId: line.externalItemId,
      ...(line.externalVariationId === undefined
        ? {}
        : { externalVariationId: line.externalVariationId }),
      quantity: line.quantity,
      modifiers: line.modifiers.map((modifier) => ({
        externalModifierLineId: modifier.externalModifierLineId,
        externalModifierId: modifier.externalModifierId,
        quantity: modifier.quantity,
      })),
    })),
    ...(event.unreadable ? { unreadable: event.unreadable } : {}),
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
