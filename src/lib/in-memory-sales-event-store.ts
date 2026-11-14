import {
  INVENTORY_CONSUMPTION_CONTRACT,
  type InventoryConsumptionApplied,
} from '@/lib/inventory-consumption-contract';
import {
  type SalesEventState,
  type SalesTransition,
  type SalesAuditEntry,
  type SalesAttempt,
  type SalesConflictReceipt,
  type SalesResolution,
  type SalesConflictResolution,
  type SalesCorrectionRequest,
  type SalesOccurrenceConfirmation,
  type SalesLeaseRecovery,
  type SalesHistoryEntry,
  type SalesEventRecord,
  type SalesStoreSnapshot,
  type SalesReceipt,
  type SalesEventStore,
  SalesIngestionError,
  leaseRecoveryOptions,
  canonicalSalesEvent,
  salesEventAuditFragment,
  clone,
  instant,
  LEASE_MS,
} from '@/lib/sales-event-model';

export class InMemorySalesEventStore implements SalesEventStore {
  private readonly events = new Map<string, SalesEventRecord>();
  private readonly transitions: SalesTransition[] = [];
  private readonly attempts: SalesAttempt[] = [];
  private readonly conflicts: SalesConflictReceipt[] = [];
  private readonly conflictResolutions: SalesConflictResolution[] = [];
  private readonly resolutions: SalesResolution[] = [];
  private readonly audits: SalesAuditEntry[] = [];
  private readonly corrections: SalesCorrectionRequest[] = [];
  private readonly occurrenceConfirmations: SalesOccurrenceConfirmation[] = [];
  private readonly idFactory: () => string;

  constructor(snapshot?: SalesStoreSnapshot, idFactory: () => string = () => crypto.randomUUID()) {
    this.idFactory = idFactory;
    if (!snapshot) return;
    for (const record of snapshot.events)
      this.events.set(record.event.external.eventIdempotencyKey, clone(record));
    this.transitions.push(...clone(snapshot.transitions));
    this.attempts.push(...clone(snapshot.attempts));
    this.conflicts.push(...clone(snapshot.conflicts));
    this.conflictResolutions.push(...clone(snapshot.conflictResolutions));
    this.resolutions.push(...clone(snapshot.resolutions));
    this.audits.push(...clone(snapshot.audits));
    this.corrections.push(...clone(snapshot.corrections));
    this.occurrenceConfirmations.push(...clone(snapshot.occurrenceConfirmations ?? []));
  }

  private stateFor(companyId: string, eventKey: string): SalesEventState | null {
    if (this.events.get(eventKey)?.event.companyId !== companyId) return null;
    const transitions = this.transitions.filter((item) => item.eventKey === eventKey);
    return transitions.length ? transitions[transitions.length - 1].to : null;
  }

  async state(companyId: string, eventKey: string): Promise<SalesEventState | null> {
    return this.stateFor(companyId, eventKey);
  }

  async event(companyId: string, eventKey: string) {
    const value = this.events.get(eventKey);
    return value?.event.companyId === companyId ? clone(value) : null;
  }

  async occurrenceConfirmation(companyId: string, eventKey: string) {
    if (!this.events.has(eventKey) || this.events.get(eventKey)?.event.companyId !== companyId)
      return null;
    return clone(this.occurrenceConfirmations.find((item) => item.eventKey === eventKey) ?? null);
  }

  async listStatus(companyId: string, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new SalesIngestionError('invalid_limit', 'List limit must be between 1 and 100.');
    return [...this.events.values()]
      .filter((record) => record.event.companyId === companyId)
      .sort((a, b) => b.event.receivedAt.localeCompare(a.event.receivedAt))
      .slice(0, limit)
      .map((record) => {
        const event = record.event;
        const transition = this.transitions
          .filter((item) => item.eventKey === event.external.eventIdempotencyKey)
          .at(-1);
        const confirmed = this.occurrenceConfirmations.find(
          (item) => item.eventKey === event.external.eventIdempotencyKey,
        );
        return {
          eventKey: event.external.eventIdempotencyKey,
          state: transition!.to,
          sourceKind: event.source.kind,
          provider: event.source.provider,
          externalReference: event.external.externalOrderId,
          eventType: event.eventType,
          occurredAt: confirmed?.occurredAt ?? event.occurredAt,
          receivedAt: event.receivedAt,
          timeQuality: confirmed ? 'confirmed' : event.timeQuality,
          revision: event.external.revision,
          lastReason: transition?.reason ?? null,
          leaseExpiresAt:
            this.attempts.findLast(
              (attempt) =>
                attempt.eventKey === event.external.eventIdempotencyKey && !attempt.completedAt,
            )?.leaseExpiresAt ?? null,
        };
      });
  }

  async history(companyId: string, eventKey: string, limit: number) {
    if (!(await this.event(companyId, eventKey)))
      throw new SalesIngestionError('not_found', 'Sales event was not found.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new SalesIngestionError('invalid_limit', 'History limit must be between 1 and 100.');
    const values: SalesHistoryEntry[] = [
      ...this.transitions
        .filter((item) => item.eventKey === eventKey)
        .map((item) => ({
          kind: 'transition' as const,
          at: item.at,
          label: `${item.from ?? 'none'}:${item.to}`,
          reason: item.reason ?? null,
        })),
      ...this.attempts
        .filter((item) => item.eventKey === eventKey && item.completedAt)
        .map((item) => ({
          kind: 'attempt' as const,
          at: item.completedAt!,
          label: item.outcome ?? 'unknown',
          reason: item.errorCode ?? item.heldReasons?.join(',') ?? null,
        })),
      ...this.resolutions
        .filter((item) => item.eventKey === eventKey)
        .map((item) => ({
          kind: 'resolution' as const,
          at: item.at,
          label: item.kind,
          reason: item.reason,
        })),
      ...this.audits
        .filter((item) => item.eventKey === eventKey)
        .map((item) => ({
          kind: 'audit' as const,
          at: item.at,
          label: item.action,
          reason: item.reason ?? null,
        })),
    ];
    return clone(values.sort((left, right) => right.at.localeCompare(left.at)).slice(0, limit));
  }

  async conflict(companyId: string, conflictId: string) {
    const value = this.conflicts.find((item) => item.conflictId === conflictId);
    return value && this.events.get(value.canonicalEventKey)?.event.companyId === companyId
      ? clone(value)
      : null;
  }

  private transitionRecord(
    eventKey: string,
    from: SalesEventState | null,
    to: SalesEventState,
    at: string,
    reason?: string,
    linkedEventKey?: string,
  ) {
    this.transitions.push({
      transitionId: this.idFactory(),
      eventKey,
      from,
      to,
      at,
      ...(reason ? { reason } : {}),
      ...(linkedEventKey ? { linkedEventKey } : {}),
    });
  }

  async receive(
    companyId: string,
    record: SalesEventRecord,
    actor: string,
    at: string,
  ): Promise<SalesReceipt> {
    if (record.event.companyId !== companyId)
      throw new SalesIngestionError('wrong_company', 'Event is not bound to this company.');
    if (record.event.receivedAt !== at)
      throw new SalesIngestionError(
        'invalid_time',
        'Receipt time does not match the normalized event.',
      );
    const storedRecord: SalesEventRecord = {
      event: canonicalSalesEvent(record.event),
      auditFragment: record.auditFragment === null ? null : salesEventAuditFragment(record.event),
      applicationKey: record.applicationKey,
      lineageKey: record.lineageKey,
    };
    const eventKey = storedRecord.event.external.eventIdempotencyKey;
    const existing = this.events.get(eventKey);
    if (existing) {
      if (existing.event.companyId !== companyId)
        throw new SalesIngestionError(
          'wrong_company',
          'Event identity belongs to another company.',
        );
      const state = this.stateFor(companyId, eventKey)!;
      if (
        existing.event.integrity.sourcePayloadSha256 ===
        storedRecord.event.integrity.sourcePayloadSha256
      )
        return { kind: 'duplicate', eventKey, state };
      const duplicateConflict = this.conflicts.find(
        (item) =>
          item.canonicalEventKey === eventKey &&
          item.sourcePayloadSha256 === storedRecord.event.integrity.sourcePayloadSha256 &&
          item.externalEventId === storedRecord.event.external.externalEventId &&
          item.externalOrderId === storedRecord.event.external.externalOrderId &&
          item.revision === storedRecord.event.external.revision,
      );
      if (duplicateConflict)
        return { kind: 'conflict', eventKey, conflictId: duplicateConflict.conflictId, state };
      const conflict: SalesConflictReceipt = {
        conflictId: this.idFactory(),
        canonicalEventKey: eventKey,
        receivedAt: at,
        sourcePayloadSha256: storedRecord.event.integrity.sourcePayloadSha256,
        externalEventId: storedRecord.event.external.externalEventId,
        externalOrderId: storedRecord.event.external.externalOrderId,
        revision: storedRecord.event.external.revision,
        reason: 'identity_conflict',
      };
      this.conflicts.push(conflict);
      return { kind: 'conflict', eventKey, conflictId: conflict.conflictId, state };
    }
    const sameRevision = [...this.events.values()].find(
      (item) =>
        item.event.companyId === companyId &&
        item.lineageKey === storedRecord.lineageKey &&
        item.event.external.revision === storedRecord.event.external.revision,
    );
    if (sameRevision) {
      const canonicalKey = sameRevision.event.external.eventIdempotencyKey;
      const duplicateConflict = this.conflicts.find(
        (item) =>
          item.canonicalEventKey === canonicalKey &&
          item.sourcePayloadSha256 === storedRecord.event.integrity.sourcePayloadSha256 &&
          item.externalEventId === storedRecord.event.external.externalEventId &&
          item.externalOrderId === storedRecord.event.external.externalOrderId &&
          item.revision === storedRecord.event.external.revision,
      );
      if (duplicateConflict)
        return {
          kind: 'conflict',
          eventKey: canonicalKey,
          conflictId: duplicateConflict.conflictId,
          state: this.stateFor(companyId, canonicalKey)!,
        };
      const conflict: SalesConflictReceipt = {
        conflictId: this.idFactory(),
        canonicalEventKey: canonicalKey,
        receivedAt: at,
        sourcePayloadSha256: storedRecord.event.integrity.sourcePayloadSha256,
        externalEventId: storedRecord.event.external.externalEventId,
        externalOrderId: storedRecord.event.external.externalOrderId,
        revision: storedRecord.event.external.revision,
        reason: 'identity_conflict',
      };
      this.conflicts.push(conflict);
      return {
        kind: 'conflict',
        eventKey: canonicalKey,
        conflictId: conflict.conflictId,
        state: this.stateFor(companyId, canonicalKey)!,
      };
    }

    this.events.set(eventKey, clone(storedRecord));
    this.transitionRecord(eventKey, null, 'received', at);
    this.audits.push({ auditId: this.idFactory(), eventKey, action: 'received', actor, at });
    const lineageEvents = [...this.events.values()].filter(
      (item) =>
        item.lineageKey === storedRecord.lineageKey &&
        item.event.external.eventIdempotencyKey !== eventKey,
    );
    const higher = lineageEvents.find(
      (item) => item.event.external.revision > storedRecord.event.external.revision,
    );
    if (higher)
      this.transitionRecord(
        eventKey,
        'received',
        'superseded',
        at,
        'stale_revision',
        higher.event.external.eventIdempotencyKey,
      );
    else {
      for (const older of lineageEvents.filter(
        (item) => item.event.external.revision < storedRecord.event.external.revision,
      )) {
        const olderKey = older.event.external.eventIdempotencyKey;
        const state = this.stateFor(companyId, olderKey);
        if (state === 'received' || state === 'held' || state === 'failed') {
          this.transitionRecord(olderKey, state, 'superseded', at, 'newer_revision', eventKey);
          this.audits.push({
            auditId: this.idFactory(),
            eventKey: olderKey,
            action: 'superseded',
            actor,
            at,
            reason: `Superseded by ${eventKey}.`,
          });
        }
      }
    }
    return { kind: 'created', eventKey, state: this.stateFor(companyId, eventKey)! };
  }

  private processingInLineageFor(companyId: string, lineageKey: string, exceptEventKey?: string) {
    return [...this.events.values()].some(
      (record) =>
        record.event.companyId === companyId &&
        record.lineageKey === lineageKey &&
        record.event.external.eventIdempotencyKey !== exceptEventKey &&
        this.stateFor(companyId, record.event.external.eventIdempotencyKey) === 'processing',
    );
  }

  async processingInLineage(companyId: string, lineageKey: string, exceptEventKey?: string) {
    return this.processingInLineageFor(companyId, lineageKey, exceptEventKey);
  }

  async claim(companyId: string, eventKey: string, attempt: SalesAttempt, at: string) {
    const record = this.events.get(eventKey);
    if (
      attempt.eventKey !== eventKey ||
      attempt.startedAt !== at ||
      instant(at) === null ||
      instant(attempt.leaseExpiresAt) === null ||
      Date.parse(attempt.leaseExpiresAt) <= Date.parse(at) ||
      !record ||
      record.event.companyId !== companyId ||
      this.stateFor(companyId, eventKey) !== 'received' ||
      this.processingInLineageFor(companyId, record.lineageKey, eventKey)
    )
      return false;
    for (const older of [...this.events.values()].filter(
      (item) =>
        item.lineageKey === record.lineageKey &&
        item.event.external.revision < record.event.external.revision,
    )) {
      const olderKey = older.event.external.eventIdempotencyKey;
      const state = this.stateFor(companyId, olderKey);
      if (state === 'held' || state === 'failed' || state === 'received')
        this.transitionRecord(olderKey, state, 'superseded', at, 'newer_revision', eventKey);
    }
    this.attempts.push(clone(attempt));
    this.transitionRecord(eventKey, 'received', 'processing', at);
    return true;
  }

  async completeAttempt(
    companyId: string,
    attempt: SalesAttempt,
    to: 'applied' | 'held' | 'failed',
    at: string,
    reason?: string,
  ) {
    const matchingOutcome =
      (to === 'applied' && (attempt.outcome === 'applied' || attempt.outcome === 'noop')) ||
      attempt.outcome === to;
    if (!attempt.completedAt || attempt.completedAt !== at || !matchingOutcome)
      throw new SalesIngestionError(
        'invalid_attempt',
        'Attempt result does not match its terminal state.',
      );
    if (this.stateFor(companyId, attempt.eventKey) !== 'processing')
      throw new SalesIngestionError('invalid_state', 'Event is no longer processing.');
    const index = this.attempts.findIndex((item) => item.attemptId === attempt.attemptId);
    if (index < 0 || this.attempts[index].completedAt)
      throw new SalesIngestionError('invalid_attempt', 'Attempt is missing or already complete.');
    this.attempts[index] = clone(attempt);
    this.transitionRecord(attempt.eventKey, 'processing', to, at, reason);
  }

  async transition(
    companyId: string,
    eventKey: string,
    from: SalesEventState,
    to: SalesEventState,
    at: string,
    reason?: string,
    linkedEventKey?: string,
  ) {
    if (this.stateFor(companyId, eventKey) !== from)
      throw new SalesIngestionError('invalid_state', `Expected ${from} state.`);
    this.transitionRecord(eventKey, from, to, at, reason, linkedEventKey);
  }

  async resolve(
    companyId: string,
    eventKey: string,
    from: 'failed' | 'held' | 'dismissed',
    to: 'received' | 'dismissed',
    resolution: SalesResolution,
    audit: SalesAuditEntry,
  ) {
    const allowed =
      (from === 'failed' &&
        to === 'received' &&
        resolution.kind === 'retry' &&
        audit.action === 'retry') ||
      (from === 'held' &&
        to === 'received' &&
        resolution.kind === 'replay' &&
        audit.action === 'replay') ||
      (from === 'dismissed' &&
        to === 'received' &&
        resolution.kind === 'replay' &&
        audit.action === 'replay') ||
      (from === 'held' &&
        to === 'dismissed' &&
        resolution.kind === 'dismiss' &&
        audit.action === 'dismiss');
    if (
      !allowed ||
      resolution.eventKey !== eventKey ||
      audit.eventKey !== eventKey ||
      resolution.at !== audit.at ||
      this.stateFor(companyId, eventKey) !== from
    )
      throw new SalesIngestionError('invalid_state', `Expected ${from} state.`);
    this.transitionRecord(eventKey, from, to, resolution.at, resolution.reason);
    this.resolutions.push(clone(resolution));
    this.audits.push(clone(audit));
  }

  async dismissConflict(companyId: string, value: SalesConflictResolution, audit: SalesAuditEntry) {
    if (
      !this.conflicts.some(
        (item) =>
          item.conflictId === value.conflictId &&
          item.canonicalEventKey === value.canonicalEventKey &&
          this.events.get(item.canonicalEventKey)?.event.companyId === companyId,
      )
    ) {
      throw new SalesIngestionError('not_found', 'Identity-conflict receipt was not found.');
    }
    if (this.conflictResolutions.some((item) => item.conflictId === value.conflictId)) {
      throw new SalesIngestionError(
        'invalid_state',
        'Identity-conflict receipt is already resolved.',
      );
    }
    this.conflictResolutions.push(clone(value));
    this.audits.push(clone(audit));
  }

  async latestAppliedConsumption(companyId: string, lineageKey: string, beforeRevision: number) {
    const consumedEventKeys = new Set(
      this.attempts
        .filter((attempt) => attempt.completedAt && attempt.outcome === 'applied')
        .map((attempt) => attempt.eventKey),
    );
    let match: SalesEventRecord | undefined;
    for (const record of [...this.events.values()]
      .filter(
        (record) =>
          record.event.companyId === companyId &&
          record.lineageKey === lineageKey &&
          record.event.external.revision < beforeRevision &&
          consumedEventKeys.has(record.event.external.eventIdempotencyKey),
      )
      .sort((a, b) => b.event.external.revision - a.event.external.revision)) {
      match = record;
      break;
    }
    return match ? clone(match) : null;
  }

  async unresolvedConsumption(companyId: string, lineageKey: string, beforeRevision: number) {
    return clone(
      [...this.events.values()].filter(
        (record) =>
          record.event.companyId === companyId &&
          record.lineageKey === lineageKey &&
          record.event.external.revision < beforeRevision &&
          ['received', 'held', 'failed', 'superseded'].includes(
            this.stateFor(companyId, record.event.external.eventIdempotencyKey) ?? '',
          ),
      ),
    );
  }

  async reconcileApplied(
    companyId: string,
    eventKey: string,
    result: InventoryConsumptionApplied,
    at: string,
  ) {
    const record = await this.event(companyId, eventKey);
    if (
      !record ||
      result.companyId !== companyId ||
      result.idempotencyKey !== record.applicationKey ||
      result.contract !== INVENTORY_CONSUMPTION_CONTRACT ||
      result.status !== 'applied' ||
      !result.replayed
    ) {
      throw new SalesIngestionError(
        'corrupt_store',
        'Reconciled inventory does not belong to this event.',
      );
    }
    const state = this.stateFor(companyId, eventKey);
    if (
      !state ||
      !['received', 'held', 'failed', 'superseded'].includes(state) ||
      this.attempts.some(
        (attempt) => attempt.eventKey === eventKey && attempt.outcome === 'applied',
      )
    )
      return false;
    this.attempts.push({
      attemptId: this.idFactory(),
      eventKey,
      startedAt: at,
      leaseExpiresAt: new Date(Date.parse(at) + LEASE_MS).toISOString(),
      completedAt: at,
      outcome: 'applied',
      inventoryResult: clone(result),
    });
    if (state !== 'superseded')
      this.transitionRecord(eventKey, state, 'applied', at, 'inventory_reconciled');
    this.audits.push({
      auditId: this.idFactory(),
      eventKey,
      action: 'inventory_reconciled',
      actor: 'system',
      at,
      reason: 'Recovered the original committed inventory result; no stock changed.',
    });
    return true;
  }

  async appendResolution(companyId: string, value: SalesResolution) {
    if (!(await this.event(companyId, value.eventKey)))
      throw new SalesIngestionError('not_found', 'Sales event was not found.');
    this.resolutions.push(clone(value));
  }

  async appendAudit(companyId: string, value: SalesAuditEntry) {
    if (!(await this.event(companyId, value.eventKey)))
      throw new SalesIngestionError('not_found', 'Sales event was not found.');
    this.audits.push(clone(value));
  }

  async appendCorrection(companyId: string, value: SalesCorrectionRequest, audit: SalesAuditEntry) {
    if (
      value.companyId !== companyId ||
      audit.eventKey !== value.eventKey ||
      !this.events.has(value.eventKey) ||
      this.events.get(value.eventKey)?.event.companyId !== companyId
    )
      throw new SalesIngestionError('not_found', 'Sales event was not found.');
    this.corrections.push(clone(value));
    this.audits.push(clone(audit));
  }

  async confirmOccurrence(
    companyId: string,
    value: SalesOccurrenceConfirmation,
    audit: SalesAuditEntry,
  ) {
    if (
      audit.action !== 'occurrence_confirmed' ||
      audit.eventKey !== value.eventKey ||
      this.stateFor(companyId, value.eventKey) !== 'held' ||
      this.occurrenceConfirmations.some((item) => item.eventKey === value.eventKey)
    ) {
      throw new SalesIngestionError(
        'invalid_state',
        'Occurrence time cannot be confirmed for this event.',
      );
    }
    this.occurrenceConfirmations.push(clone(value));
    this.transitionRecord(value.eventKey, 'held', 'received', value.confirmedAt, value.reason);
    this.audits.push(clone(audit));
  }

  async recoverExpired(companyId: string, now: string, options: SalesLeaseRecovery = {}) {
    const nowMs = instant(now);
    if (nowMs === null) throw new SalesIngestionError('invalid_time', 'Recovery time is invalid.');
    const { eventKey, limit, actor, reason } = leaseRecoveryOptions(options);
    const recovered: string[] = [];
    for (let index = 0; index < this.attempts.length; index++) {
      const attempt = this.attempts[index];
      if (
        recovered.length < limit &&
        (!eventKey || attempt.eventKey === eventKey) &&
        this.events.get(attempt.eventKey)?.event.companyId === companyId &&
        this.stateFor(companyId, attempt.eventKey) === 'processing' &&
        !attempt.completedAt &&
        Date.parse(attempt.leaseExpiresAt) <= nowMs
      ) {
        this.attempts[index] = {
          ...attempt,
          completedAt: now,
          outcome: 'failed',
          errorCode: 'interrupted',
        };
        this.transitionRecord(attempt.eventKey, 'processing', 'failed', now, 'interrupted');
        this.audits.push({
          auditId: this.idFactory(),
          eventKey: attempt.eventKey,
          action: 'lease_expired',
          actor,
          at: now,
          reason,
        });
        recovered.push(attempt.eventKey);
      }
    }
    return recovered;
  }

  async purgeExpiredPayloadFragments(companyId: string, now: string, limit: number) {
    if (instant(now) === null || !Number.isSafeInteger(limit) || limit < 1)
      throw new SalesIngestionError('invalid_cleanup', 'Cleanup time and limit are invalid.');
    const expired = [...this.events.values()]
      .filter(
        (record) =>
          record.event.companyId === companyId &&
          record.auditFragment !== null &&
          record.event.integrity.payloadExpiresAt !== null &&
          record.event.integrity.payloadExpiresAt <= now,
      )
      .sort((a, b) =>
        a.event.integrity.payloadExpiresAt!.localeCompare(b.event.integrity.payloadExpiresAt!),
      )
      .slice(0, limit);
    for (const record of expired) {
      record.auditFragment = null;
      record.event.integrity.payloadExpiresAt = null;
    }
    return expired.length;
  }

  snapshot(): SalesStoreSnapshot {
    return clone({
      events: [...this.events.values()],
      transitions: this.transitions,
      attempts: this.attempts,
      conflicts: this.conflicts,
      conflictResolutions: this.conflictResolutions,
      resolutions: this.resolutions,
      audits: this.audits,
      corrections: this.corrections,
      occurrenceConfirmations: this.occurrenceConfirmations,
    });
  }
}
