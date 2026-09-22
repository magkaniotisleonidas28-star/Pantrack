import {
  SALES_EVENT_CONTRACT,
  SalesIngestionError,
  canonicalSalesEvent,
  salesEventAuditFragment,
  type SalesAttempt,
  type SalesAuditEntry,
  type SalesConflictReceipt,
  type SalesConflictResolution,
  type SalesCorrectionRequest,
  type SalesEventRecord,
  type SalesEventState,
  type SalesEventStore,
  type SalesEventV1,
  type SalesHistoryEntry,
  type SalesOccurrenceConfirmation,
  type SalesReceipt,
  type SalesResolution,
  type SalesStatusSummary,
} from '@/lib/sales-ingestion';

type EventRow = {
  company_id: string;
  event_key: string;
  lineage_key: string;
  application_key: string;
  source_payload_sha256: string;
  provider: string;
  environment: string;
  merchant_id: string;
  external_event_id: string;
  external_order_id: string;
  revision: number;
  occurred_at: string;
  received_at: string;
  normalized_json: string;
  fragment_json: string | null;
  expires_at: string | null;
};

type ConflictRow = {
  conflict_id: string;
  canonical_event_key: string;
  received_at: string;
  source_payload_sha256: string;
  external_event_id: string;
  external_order_id: string;
  revision: number;
  reason: string;
};

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new SalesIngestionError('corrupt_store', `Persisted ${label} JSON is invalid.`);
  }
}

function changes(result: D1Result<unknown> | undefined) {
  return Number(result?.meta?.changes ?? result?.meta?.rows_written ?? 0);
}

function selectedChange(result: D1Result<unknown> | undefined) {
  const row = (result?.results as Array<{changed?: unknown}> | undefined)?.[0];
  return Number(row?.changed ?? 0);
}

function assertTime(value: string, label: string) {
  if (!Number.isFinite(Date.parse(value))) throw new SalesIngestionError('invalid_time', `${label} must be a valid timestamp.`);
}

function validPersistedEvent(event: SalesEventV1) {
  const text = (value: unknown) => typeof value === 'string' && value.length > 0;
  const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
  const count = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  if (!event || event.schemaVersion !== SALES_EVENT_CONTRACT || !text(event.companyId) ||
      !event.source || !['manual','csv','bridge','native'].includes(event.source.kind) ||
      ![event.source.provider,event.source.environment,event.source.connectionId,event.source.merchantId,event.source.locationId].every(text) ||
      !event.external || !text(event.external.externalEventId) || !text(event.external.externalOrderId) ||
      !text(event.external.eventIdempotencyKey) || !Number.isSafeInteger(event.external.revision) || event.external.revision < 1 ||
      !['sale','revision','cancellation','refund','remake','reopen'].includes(event.eventType) ||
      !['open','completed','canceled','partially_refunded','refunded','unknown'].includes(event.orderStatus) ||
      !['not_started','prepared','fulfilled','unknown'].includes(event.preparationStatus) ||
      !['provider','confirmed','inferred'].includes(event.timeQuality) ||
      !timestamp(event.occurredAt) || !timestamp(event.receivedAt) ||
      !Array.isArray(event.lines) || event.lines.length < 1 || !event.integrity ||
      !text(event.integrity.sourcePayloadSha256) || event.integrity.payloadExpiresAt !== null || event.integrity.normalizedContractVersion !== SALES_EVENT_CONTRACT) return false;
  const lineIds = new Set<string>();
  for (const line of event.lines) {
    if (!line || !text(line.externalLineId) || !text(line.externalItemId) ||
        (line.externalVariationId !== undefined && !text(line.externalVariationId)) ||
        !count(line.quantity) || lineIds.has(line.externalLineId) || !Array.isArray(line.modifiers)) return false;
    lineIds.add(line.externalLineId);
    const modifierIds = new Set<string>();
    for (const modifier of line.modifiers) {
      if (!modifier || !text(modifier.externalModifierLineId) || !text(modifier.externalModifierId) ||
          !count(modifier.quantity) || modifierIds.has(modifier.externalModifierLineId)) return false;
      modifierIds.add(modifier.externalModifierLineId);
    }
  }
  return true;
}

export class D1SalesEventStore implements SalesEventStore {
  constructor(
    private readonly db: D1Database,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  private record(row: EventRow): SalesEventRecord {
    const event = parseJson<SalesEventV1>(row.normalized_json, 'sales event');
    if (!validPersistedEvent(event) || event.companyId !== row.company_id ||
        event.external?.eventIdempotencyKey !== row.event_key ||
        event.integrity?.sourcePayloadSha256 !== row.source_payload_sha256 ||
        event.source.provider !== row.provider || event.source.environment !== row.environment || event.source.merchantId !== row.merchant_id ||
        event.external.externalEventId !== row.external_event_id || event.external.externalOrderId !== row.external_order_id ||
        event.external.revision !== row.revision || event.occurredAt !== row.occurred_at || event.receivedAt !== row.received_at ||
        typeof row.lineage_key !== 'string' || typeof row.application_key !== 'string') {
      throw new SalesIngestionError('corrupt_store', 'Persisted sales event failed its identity checks.');
    }
    let auditFragment: unknown | null = null;
    if (row.fragment_json !== null) {
      auditFragment = parseJson<unknown>(row.fragment_json, 'audit fragment');
      if (!auditFragment || typeof auditFragment !== 'object' || Array.isArray(auditFragment) || !row.expires_at || !Number.isFinite(Date.parse(row.expires_at))) {
        throw new SalesIngestionError('corrupt_store', 'Persisted audit fragment is invalid.');
      }
    }
    event.integrity.payloadExpiresAt = row.fragment_json === null ? null : row.expires_at;
    return {event, auditFragment, lineageKey: row.lineage_key, applicationKey: row.application_key};
  }

  private conflictRecord(row: ConflictRow): SalesConflictReceipt {
    if (row.reason !== 'identity_conflict') throw new SalesIngestionError('corrupt_store', 'Persisted conflict reason is invalid.');
    return {
      conflictId: row.conflict_id,
      canonicalEventKey: row.canonical_event_key,
      receivedAt: row.received_at,
      sourcePayloadSha256: row.source_payload_sha256,
      externalEventId: row.external_event_id,
      externalOrderId: row.external_order_id,
      revision: row.revision,
      reason: 'identity_conflict',
    };
  }

  private async storeConflict(companyId: string, canonicalEventKey: string, record: SalesEventRecord, at: string): Promise<SalesReceipt> {
    const event = record.event;
    const conflictId = this.idFactory();
    await this.db.prepare(`INSERT OR IGNORE INTO sales_event_conflicts(
      company_id,conflict_id,canonical_event_key,received_at,source_payload_sha256,
      external_event_id,external_order_id,revision,reason
    ) VALUES (?,?,?,?,?,?,?,?,?)`).bind(
      companyId, conflictId, canonicalEventKey, at, event.integrity.sourcePayloadSha256,
      event.external.externalEventId, event.external.externalOrderId, event.external.revision, 'identity_conflict',
    ).run();
    const conflict = await this.db.prepare(`SELECT conflict_id FROM sales_event_conflicts
      WHERE company_id=? AND canonical_event_key=? AND source_payload_sha256=?
        AND external_event_id=? AND external_order_id=? AND revision=?`).bind(
      companyId, canonicalEventKey, event.integrity.sourcePayloadSha256,
      event.external.externalEventId, event.external.externalOrderId, event.external.revision,
    ).first<{conflict_id: string}>();
    const state = await this.state(companyId, canonicalEventKey);
    if (!conflict || !state) throw new SalesIngestionError('corrupt_store', 'Conflict receipt could not be reconstructed.');
    return {kind: 'conflict', eventKey: canonicalEventKey, conflictId: conflict.conflict_id, state};
  }

  async receive(companyId: string, record: SalesEventRecord, actor: string, at: string): Promise<SalesReceipt> {
    if (record.event.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Event is not bound to this company.');
    if (record.event.receivedAt !== at) throw new SalesIngestionError('invalid_time', 'Receipt time does not match the normalized event.');
    const event = canonicalSalesEvent(record.event);
    const payloadExpiresAt = event.integrity.payloadExpiresAt;
    if (payloadExpiresAt !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payloadExpiresAt) || !Number.isFinite(Date.parse(payloadExpiresAt)))) {
      throw new SalesIngestionError('invalid_record', 'Payload expiry is not a normalized timestamp.');
    }
    event.integrity.payloadExpiresAt = null;
    if (!validPersistedEvent(event)) throw new SalesIngestionError('invalid_record', 'Sales event record is not a valid normalized document.');
    const persistedRecord: SalesEventRecord = {
      event,
      auditFragment: record.auditFragment === null ? null : salesEventAuditFragment(event),
      applicationKey: record.applicationKey,
      lineageKey: record.lineageKey,
    };
    const eventKey = event.external.eventIdempotencyKey;
    const existing = await this.db.prepare(`SELECT event_key,source_payload_sha256 FROM sales_events
      WHERE company_id=? AND event_key=?`).bind(companyId, eventKey).first<{event_key: string; source_payload_sha256: string}>();
    if (existing) {
      const state = await this.state(companyId, eventKey);
      if (!state) throw new SalesIngestionError('corrupt_store', 'Sales event state is missing.');
      return existing.source_payload_sha256 === event.integrity.sourcePayloadSha256
        ? {kind: 'duplicate', eventKey, state}
        : this.storeConflict(companyId, eventKey, persistedRecord, at);
    }
    const sameRevision = await this.db.prepare(`SELECT event_key FROM sales_events
      WHERE company_id=? AND lineage_key=? AND revision=?`).bind(companyId, persistedRecord.lineageKey, event.external.revision).first<{event_key: string}>();
    if (sameRevision) return this.storeConflict(companyId, sameRevision.event_key, persistedRecord, at);

    const statements = [
      this.db.prepare(`INSERT INTO sales_events(
        company_id,event_key,lineage_key,application_key,provider,environment,merchant_id,
        external_event_id,external_order_id,revision,occurred_at,received_at,source_payload_sha256,normalized_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        companyId,eventKey,persistedRecord.lineageKey,persistedRecord.applicationKey,event.source.provider,event.source.environment,event.source.merchantId,
        event.external.externalEventId,event.external.externalOrderId,event.external.revision,event.occurredAt,event.receivedAt,event.integrity.sourcePayloadSha256,JSON.stringify(event),
      ),
      this.db.prepare(`INSERT INTO sales_event_states(
        company_id,event_key,lineage_key,revision,state,lease_attempt_id,lease_expires_at,last_reason,linked_event_key,transition_actor,updated_at
      ) VALUES (?,?,?,?, 'received',NULL,NULL,NULL,NULL,?,?)`).bind(companyId,eventKey,persistedRecord.lineageKey,event.external.revision,actor,at),
      this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
        VALUES (?,?,?,'received',?,?,NULL,NULL)`).bind(companyId,this.idFactory(),eventKey,actor,at),
    ];
    if (persistedRecord.auditFragment !== null && payloadExpiresAt !== null) {
      statements.splice(1, 0, this.db.prepare(`INSERT INTO sales_event_fragments(company_id,event_key,fragment_json,expires_at)
        VALUES (?,?,?,?)`).bind(companyId,eventKey,JSON.stringify(persistedRecord.auditFragment),payloadExpiresAt));
    }
    try {
      await this.db.batch(statements);
    } catch {
      const raced = await this.db.prepare(`SELECT event_key,source_payload_sha256 FROM sales_events
        WHERE company_id=? AND (event_key=? OR (lineage_key=? AND revision=?)) ORDER BY event_key=? DESC LIMIT 1`).bind(
        companyId,eventKey,persistedRecord.lineageKey,event.external.revision,eventKey,
      ).first<{event_key: string; source_payload_sha256: string}>();
      if (!raced) throw new SalesIngestionError('persistence_failed', 'Sales event receipt failed.');
      if (raced.event_key === eventKey && raced.source_payload_sha256 === event.integrity.sourcePayloadSha256) {
        const state = await this.state(companyId, eventKey);
        if (!state) throw new SalesIngestionError('corrupt_store', 'Sales event state is missing.');
        return {kind: 'duplicate', eventKey, state};
      }
      return this.storeConflict(companyId, raced.event_key, persistedRecord, at);
    }
    const state = await this.state(companyId, eventKey);
    if (!state) throw new SalesIngestionError('corrupt_store', 'Sales event state is missing after receipt.');
    return {kind: 'created', eventKey, state};
  }

  async claim(companyId: string, eventKey: string, attempt: SalesAttempt, at: string) {
    if (attempt.eventKey !== eventKey || attempt.startedAt !== at || !Number.isFinite(Date.parse(at)) ||
        !Number.isFinite(Date.parse(attempt.leaseExpiresAt)) || Date.parse(attempt.leaseExpiresAt) <= Date.parse(at)) return false;
    await this.db.batch([
      this.db.prepare(`UPDATE sales_event_states SET state='superseded',lease_attempt_id=NULL,lease_expires_at=NULL,
        last_reason='newer_revision',linked_event_key=?,transition_actor='worker',updated_at=?
        WHERE company_id=? AND lineage_key=(SELECT lineage_key FROM sales_event_states WHERE company_id=? AND event_key=?)
          AND revision<(SELECT revision FROM sales_event_states WHERE company_id=? AND event_key=?)
          AND state IN ('received','held','failed')`).bind(eventKey,at,companyId,companyId,eventKey,companyId,eventKey),
      this.db.prepare(`INSERT INTO sales_event_attempts(company_id,attempt_id,event_key,started_at,lease_expires_at)
        SELECT ?,?,?,?,? WHERE EXISTS(
          SELECT 1 FROM sales_event_states target WHERE target.company_id=? AND target.event_key=? AND target.state='received'
            AND NOT EXISTS(SELECT 1 FROM sales_event_states active WHERE active.company_id=target.company_id
              AND active.lineage_key=target.lineage_key AND active.state='processing')
        )`).bind(companyId,attempt.attemptId,eventKey,attempt.startedAt,attempt.leaseExpiresAt,companyId,eventKey),
      this.db.prepare(`UPDATE sales_event_states SET state='processing',lease_attempt_id=?,lease_expires_at=?,
        last_reason=NULL,linked_event_key=NULL,transition_actor='worker',updated_at=?
        WHERE company_id=? AND event_key=? AND state='received'
          AND EXISTS(SELECT 1 FROM sales_event_attempts WHERE company_id=? AND attempt_id=? AND event_key=?)`).bind(
          attempt.attemptId,attempt.leaseExpiresAt,at,companyId,eventKey,companyId,attempt.attemptId,eventKey,
        ),
    ]);
    const claimed = await this.db.prepare(`SELECT 1 AS claimed FROM sales_event_states
      WHERE company_id=? AND event_key=? AND state='processing' AND lease_attempt_id=? AND lease_expires_at=?`).bind(
      companyId,eventKey,attempt.attemptId,attempt.leaseExpiresAt,
    ).first<{claimed: number}>();
    return claimed?.claimed === 1;
  }

  async completeAttempt(companyId: string, attempt: SalesAttempt, to: 'applied' | 'held' | 'failed', at: string, reason?: string) {
    const matchingOutcome = (to === 'applied' && (attempt.outcome === 'applied' || attempt.outcome === 'noop')) || attempt.outcome === to;
    if (!attempt.completedAt || attempt.completedAt !== at || !matchingOutcome) throw new SalesIngestionError('invalid_attempt', 'Attempt result does not match its terminal state.');
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO sales_event_attempt_results(
        company_id,attempt_id,event_key,completed_at,outcome,held_reasons_json,issues_json,inventory_result_json,error_code
      ) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(
        SELECT 1 FROM sales_event_attempts a JOIN sales_event_states s
          ON s.company_id=a.company_id AND s.event_key=a.event_key
        WHERE a.company_id=? AND a.attempt_id=? AND a.event_key=?
          AND s.state='processing' AND s.lease_attempt_id=a.attempt_id
      ) AND NOT EXISTS(SELECT 1 FROM sales_event_attempt_results WHERE company_id=? AND attempt_id=?)`).bind(
        companyId,attempt.attemptId,attempt.eventKey,attempt.completedAt,attempt.outcome,
        attempt.heldReasons ? JSON.stringify(attempt.heldReasons) : null,
        attempt.issues ? JSON.stringify(attempt.issues) : null,
        attempt.inventoryResult ? JSON.stringify(attempt.inventoryResult) : null,
        attempt.errorCode ?? null,
        companyId,attempt.attemptId,attempt.eventKey,companyId,attempt.attemptId,
      ),
      this.db.prepare('SELECT changes() AS changed'),
      this.db.prepare(`UPDATE sales_event_states SET state=?,lease_attempt_id=NULL,lease_expires_at=NULL,
        last_reason=?,linked_event_key=NULL,transition_actor='worker',updated_at=?
        WHERE company_id=? AND event_key=? AND state='processing' AND lease_attempt_id=?
          AND EXISTS(SELECT 1 FROM sales_event_attempt_results WHERE company_id=? AND attempt_id=?)`).bind(
          to,reason ?? null,at,companyId,attempt.eventKey,attempt.attemptId,companyId,attempt.attemptId,
        ),
      this.db.prepare('SELECT changes() AS changed'),
    ]);
    if (selectedChange(results[1]) !== 1 || selectedChange(results[3]) !== 1) throw new SalesIngestionError('invalid_attempt', 'Attempt is missing, complete, or no longer owns the lease.');
  }

  async transition(companyId: string, eventKey: string, from: SalesEventState, to: SalesEventState, at: string, reason?: string, linkedEventKey?: string) {
    const result = await this.db.prepare(`UPDATE sales_event_states SET state=?,lease_attempt_id=NULL,lease_expires_at=NULL,
      last_reason=?,linked_event_key=?,transition_actor='operator',updated_at=?
      WHERE company_id=? AND event_key=? AND state=?`).bind(to,reason ?? null,linkedEventKey ?? null,at,companyId,eventKey,from).run();
    if (changes(result) !== 1) throw new SalesIngestionError('invalid_state', `Expected ${from} state.`);
  }

  async resolve(companyId: string, eventKey: string, from: 'failed' | 'held', to: 'received' | 'dismissed', resolution: SalesResolution, audit: SalesAuditEntry) {
    const allowed = (from === 'failed' && to === 'received' && resolution.kind === 'retry' && audit.action === 'retry') ||
      (from === 'held' && to === 'received' && resolution.kind === 'replay' && audit.action === 'replay') ||
      (from === 'held' && to === 'dismissed' && resolution.kind === 'dismiss' && audit.action === 'dismiss');
    if (!allowed || resolution.eventKey !== eventKey || audit.eventKey !== eventKey || resolution.at !== audit.at) throw new SalesIngestionError('invalid_state', 'Resolution linkage is invalid.');
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO sales_event_resolutions(company_id,resolution_id,event_key,kind,actor,reason,at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_event_states WHERE company_id=? AND event_key=? AND state=?)`).bind(
        companyId,resolution.resolutionId,eventKey,resolution.kind,resolution.actor,resolution.reason,resolution.at,companyId,eventKey,from,
      ),
      this.db.prepare(`UPDATE sales_event_states SET state=?,lease_attempt_id=NULL,lease_expires_at=NULL,
        last_reason=?,linked_event_key=NULL,transition_actor=?,updated_at=?
        WHERE company_id=? AND event_key=? AND state=?
          AND EXISTS(SELECT 1 FROM sales_event_resolutions WHERE company_id=? AND resolution_id=?)`).bind(
        to,resolution.reason,resolution.actor,resolution.at,companyId,eventKey,from,companyId,resolution.resolutionId,
      ),
      this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
        SELECT ?,?,?,?,?,?,?,NULL WHERE EXISTS(
          SELECT 1 FROM sales_event_resolutions WHERE company_id=? AND resolution_id=?
        )`).bind(companyId,audit.auditId,eventKey,audit.action,audit.actor,audit.at,audit.reason ?? null,companyId,resolution.resolutionId),
    ]);
    if (results.some(result => changes(result) !== 1)) throw new SalesIngestionError('invalid_state', `Expected ${from} state.`);
  }

  async appendResolution(companyId: string, value: SalesResolution) {
    const result = await this.db.prepare(`INSERT INTO sales_event_resolutions(company_id,resolution_id,event_key,kind,actor,reason,at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_events WHERE company_id=? AND event_key=?)`).bind(
      companyId,value.resolutionId,value.eventKey,value.kind,value.actor,value.reason,value.at,companyId,value.eventKey,
    ).run();
    if (changes(result) !== 1) throw new SalesIngestionError('not_found', 'Sales event was not found.');
  }

  async appendAudit(companyId: string, value: SalesAuditEntry) {
    const result = await this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_events WHERE company_id=? AND event_key=?)`).bind(
      companyId,value.auditId,value.eventKey,value.action,value.actor,value.at,value.reason ?? null,value.conflictId ?? null,companyId,value.eventKey,
    ).run();
    if (changes(result) !== 1) throw new SalesIngestionError('not_found', 'Sales event was not found.');
  }

  async appendCorrection(companyId: string, value: SalesCorrectionRequest, audit: SalesAuditEntry) {
    if (value.companyId !== companyId) throw new SalesIngestionError('wrong_company', 'Correction is not bound to this company.');
    if (audit.eventKey !== value.eventKey) throw new SalesIngestionError('invalid_state', 'Correction audit linkage is invalid.');
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO sales_event_corrections(company_id,correction_id,event_key,status,actor,reason,requested_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_events WHERE company_id=? AND event_key=?)`).bind(
        companyId,value.correctionId,value.eventKey,value.status,value.actor,value.reason,value.requestedAt,companyId,value.eventKey,
      ),
      this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
        SELECT ?,?,?,?,?,?,?,NULL WHERE EXISTS(
          SELECT 1 FROM sales_event_corrections WHERE company_id=? AND correction_id=?
        )`).bind(companyId,audit.auditId,audit.eventKey,audit.action,audit.actor,audit.at,audit.reason ?? null,companyId,value.correctionId),
    ]);
    if (results.some(result => changes(result) !== 1)) throw new SalesIngestionError('not_found', 'Sales event was not found.');
  }

  async confirmOccurrence(companyId: string, value: SalesOccurrenceConfirmation, audit: SalesAuditEntry) {
    if (audit.action !== 'occurrence_confirmed' || audit.eventKey !== value.eventKey || audit.at !== value.confirmedAt) throw new SalesIngestionError('invalid_state', 'Occurrence confirmation linkage is invalid.');
    const results=await this.db.batch([
      this.db.prepare(`INSERT INTO sales_event_occurrence_confirmations(company_id,event_key,occurred_at,actor,reason,confirmed_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sales_event_states WHERE company_id=? AND event_key=? AND state='held')
        AND NOT EXISTS(SELECT 1 FROM sales_event_occurrence_confirmations WHERE company_id=? AND event_key=?)`).bind(companyId,value.eventKey,value.occurredAt,value.actor,value.reason,value.confirmedAt,companyId,value.eventKey,companyId,value.eventKey),
      this.db.prepare(`UPDATE sales_event_states SET state='received',last_reason=?,transition_actor=?,updated_at=?
        WHERE company_id=? AND event_key=? AND state='held' AND EXISTS(
          SELECT 1 FROM sales_event_occurrence_confirmations WHERE company_id=? AND event_key=?)`).bind(value.reason,value.actor,value.confirmedAt,companyId,value.eventKey,companyId,value.eventKey),
      this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
        SELECT ?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM sales_event_occurrence_confirmations WHERE company_id=? AND event_key=?)
        AND NOT EXISTS(SELECT 1 FROM sales_event_audits WHERE company_id=? AND event_key=? AND action='occurrence_confirmed')`).bind(companyId,audit.auditId,audit.eventKey,audit.action,audit.actor,audit.at,audit.reason??null,companyId,value.eventKey,companyId,value.eventKey),
    ]);
    if(results.some(result=>changes(result)!==1))throw new SalesIngestionError('invalid_state','Occurrence time is missing, already confirmed, or no longer held.');
  }

  async occurrenceConfirmation(companyId: string,eventKey: string){
    const row=await this.db.prepare(`SELECT event_key,occurred_at,actor,reason,confirmed_at FROM sales_event_occurrence_confirmations
      WHERE company_id=? AND event_key=?`).bind(companyId,eventKey).first<{event_key:string;occurred_at:string;actor:string;reason:string;confirmed_at:string}>();
    return row?{eventKey:row.event_key,occurredAt:row.occurred_at,actor:row.actor,reason:row.reason,confirmedAt:row.confirmed_at}:null;
  }

  async listStatus(companyId:string,limit:number):Promise<SalesStatusSummary[]>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SalesIngestionError('invalid_limit','List limit must be between 1 and 100.');
    const rows=await this.db.prepare(`SELECT e.event_key,s.state,json_extract(e.normalized_json,'$.source.kind') AS source_kind,
      e.provider,e.external_order_id,json_extract(e.normalized_json,'$.eventType') AS event_type,
      COALESCE(c.occurred_at,e.occurred_at) AS occurred_at,e.received_at,
      CASE WHEN c.event_key IS NULL THEN json_extract(e.normalized_json,'$.timeQuality') ELSE 'confirmed' END AS time_quality,
      e.revision,s.last_reason FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key
      LEFT JOIN sales_event_occurrence_confirmations c ON c.company_id=e.company_id AND c.event_key=e.event_key
      WHERE e.company_id=? ORDER BY e.received_at DESC,e.event_key LIMIT ?`).bind(companyId,limit).all<{event_key:string;state:SalesStatusSummary['state'];source_kind:SalesStatusSummary['sourceKind'];provider:string;external_order_id:string;event_type:SalesStatusSummary['eventType'];occurred_at:string;received_at:string;time_quality:SalesStatusSummary['timeQuality'];revision:number;last_reason:string|null}>();
    return rows.results.map(row=>({eventKey:row.event_key,state:row.state,sourceKind:row.source_kind,provider:row.provider,externalReference:row.external_order_id,eventType:row.event_type,occurredAt:row.occurred_at,receivedAt:row.received_at,timeQuality:row.time_quality,revision:row.revision,lastReason:row.last_reason}));
  }

  async history(companyId:string,eventKey:string,limit:number):Promise<SalesHistoryEntry[]>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SalesIngestionError('invalid_limit','History limit must be between 1 and 100.');
    if(!await this.event(companyId,eventKey))throw new SalesIngestionError('not_found','Sales event was not found.');
    const rows=await this.db.prepare(`SELECT kind,at,label,reason FROM (
      SELECT 'transition' AS kind,at,COALESCE(from_state,'none')||':'||to_state AS label,reason FROM sales_event_transitions WHERE company_id=? AND event_key=?
      UNION ALL SELECT 'attempt',r.completed_at,r.outcome,COALESCE(r.error_code,r.held_reasons_json) FROM sales_event_attempt_results r WHERE r.company_id=? AND r.event_key=?
      UNION ALL SELECT 'resolution',at,kind,reason FROM sales_event_resolutions WHERE company_id=? AND event_key=?
      UNION ALL SELECT 'audit',at,action,reason FROM sales_event_audits WHERE company_id=? AND event_key=?
    ) ORDER BY at DESC LIMIT ?`).bind(companyId,eventKey,companyId,eventKey,companyId,eventKey,companyId,eventKey,limit).all<{kind:SalesHistoryEntry['kind'];at:string;label:string;reason:string|null}>();
    return rows.results;
  }

  async state(companyId: string, eventKey: string) {
    const row = await this.db.prepare(`SELECT state FROM sales_event_states WHERE company_id=? AND event_key=?`).bind(companyId,eventKey).first<{state: SalesEventState}>();
    if (!row) return null;
    if (!['received','processing','applied','held','failed','dismissed','superseded'].includes(row.state)) throw new SalesIngestionError('corrupt_store', 'Persisted sales event state is invalid.');
    return row.state;
  }

  async event(companyId: string, eventKey: string) {
    const row = await this.db.prepare(`SELECT e.company_id,e.event_key,e.lineage_key,e.application_key,e.source_payload_sha256,e.normalized_json,
      e.provider,e.environment,e.merchant_id,e.external_event_id,e.external_order_id,e.revision,e.occurred_at,e.received_at,
      f.fragment_json,f.expires_at FROM sales_events e LEFT JOIN sales_event_fragments f
        ON f.company_id=e.company_id AND f.event_key=e.event_key
      WHERE e.company_id=? AND e.event_key=?`).bind(companyId,eventKey).first<EventRow>();
    return row ? this.record(row) : null;
  }

  async conflict(companyId: string, conflictId: string) {
    const row = await this.db.prepare(`SELECT conflict_id,canonical_event_key,received_at,source_payload_sha256,
      external_event_id,external_order_id,revision,reason FROM sales_event_conflicts
      WHERE company_id=? AND conflict_id=?`).bind(companyId,conflictId).first<ConflictRow>();
    return row ? this.conflictRecord(row) : null;
  }

  async dismissConflict(companyId: string, value: SalesConflictResolution, audit: SalesAuditEntry) {
    if (audit.eventKey !== value.canonicalEventKey || audit.conflictId !== value.conflictId) throw new SalesIngestionError('invalid_state', 'Conflict audit linkage is invalid.');
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO sales_event_conflict_resolutions(
        company_id,resolution_id,conflict_id,canonical_event_key,kind,actor,reason,at
      ) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(
        SELECT 1 FROM sales_event_conflicts WHERE company_id=? AND conflict_id=? AND canonical_event_key=?
      ) AND NOT EXISTS(SELECT 1 FROM sales_event_conflict_resolutions WHERE company_id=? AND conflict_id=?)`).bind(
        companyId,value.resolutionId,value.conflictId,value.canonicalEventKey,value.kind,value.actor,value.reason,value.at,
        companyId,value.conflictId,value.canonicalEventKey,companyId,value.conflictId,
      ),
      this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(
          SELECT 1 FROM sales_event_conflict_resolutions WHERE company_id=? AND resolution_id=?
        )`).bind(companyId,audit.auditId,audit.eventKey,audit.action,audit.actor,audit.at,audit.reason ?? null,audit.conflictId ?? null,companyId,value.resolutionId),
    ]);
    if (results.some(result => changes(result) !== 1)) throw new SalesIngestionError('invalid_state', 'Identity-conflict receipt is missing or already resolved.');
  }

  async latestAppliedConsumption(companyId: string, lineageKey: string, beforeRevision: number) {
    const row = await this.db.prepare(`SELECT e.company_id,e.event_key,e.lineage_key,e.application_key,e.source_payload_sha256,e.normalized_json,
      e.provider,e.environment,e.merchant_id,e.external_event_id,e.external_order_id,e.revision,e.occurred_at,e.received_at,
      f.fragment_json,f.expires_at FROM sales_events e
      JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key
      JOIN sales_event_attempts a ON a.company_id=e.company_id AND a.event_key=e.event_key
      JOIN sales_event_attempt_results r ON r.company_id=a.company_id AND r.attempt_id=a.attempt_id
      LEFT JOIN sales_event_fragments f ON f.company_id=e.company_id AND f.event_key=e.event_key
      WHERE e.company_id=? AND e.lineage_key=? AND e.revision<? AND s.state='applied' AND r.outcome='applied'
      ORDER BY e.revision DESC LIMIT 1`).bind(companyId,lineageKey,beforeRevision).first<EventRow>();
    return row ? this.record(row) : null;
  }

  async processingInLineage(companyId: string, lineageKey: string, exceptEventKey?: string) {
    const row = await this.db.prepare(`SELECT 1 AS found FROM sales_event_states
      WHERE company_id=? AND lineage_key=? AND state='processing' AND event_key<>? LIMIT 1`).bind(companyId,lineageKey,exceptEventKey ?? '').first<{found: number}>();
    return Boolean(row);
  }

  async recoverExpired(companyId: string, now: string) {
    assertTime(now, 'Recovery time');
    const rows = await this.db.prepare(`SELECT event_key,lease_attempt_id FROM sales_event_states
      WHERE company_id=? AND state='processing' AND lease_expires_at<=? ORDER BY lease_expires_at,event_key`).bind(companyId,now).all<{event_key: string; lease_attempt_id: string}>();
    const recovered: string[] = [];
    for (const row of rows.results) {
      const results = await this.db.batch([
        this.db.prepare(`INSERT INTO sales_event_attempt_results(
          company_id,attempt_id,event_key,completed_at,outcome,held_reasons_json,issues_json,inventory_result_json,error_code
        ) SELECT ?,?,?,?,'failed',NULL,NULL,NULL,'interrupted' WHERE EXISTS(
          SELECT 1 FROM sales_event_states WHERE company_id=? AND event_key=? AND state='processing'
            AND lease_attempt_id=? AND lease_expires_at<=?
        ) AND NOT EXISTS(SELECT 1 FROM sales_event_attempt_results WHERE company_id=? AND attempt_id=?)`).bind(
          companyId,row.lease_attempt_id,row.event_key,now,companyId,row.event_key,row.lease_attempt_id,now,companyId,row.lease_attempt_id,
        ),
        this.db.prepare(`UPDATE sales_event_states SET state='failed',lease_attempt_id=NULL,lease_expires_at=NULL,
          last_reason='interrupted',linked_event_key=NULL,transition_actor='system',updated_at=?
          WHERE company_id=? AND event_key=? AND state='processing' AND lease_attempt_id=?
            AND EXISTS(SELECT 1 FROM sales_event_attempt_results WHERE company_id=? AND attempt_id=?)`).bind(
          now,companyId,row.event_key,row.lease_attempt_id,companyId,row.lease_attempt_id,
        ),
        this.db.prepare(`INSERT INTO sales_event_audits(company_id,audit_id,event_key,action,actor,at,reason,conflict_id)
          SELECT ?,?,?,'lease_expired','system',?,'Processing lease expired; application is unknown.',NULL
          WHERE EXISTS(SELECT 1 FROM sales_event_attempt_results WHERE company_id=? AND attempt_id=? AND error_code='interrupted')
            AND NOT EXISTS(SELECT 1 FROM sales_event_audits WHERE company_id=? AND event_key=? AND action='lease_expired' AND at=?)`).bind(
          companyId,this.idFactory(),row.event_key,now,companyId,row.lease_attempt_id,companyId,row.event_key,now,
        ),
      ]);
      if (results.every(result => changes(result) === 1)) recovered.push(row.event_key);
    }
    return recovered;
  }

  async purgeExpiredPayloadFragments(companyId: string, now: string, limit: number) {
    assertTime(now, 'Cleanup time');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new SalesIngestionError('invalid_cleanup', 'Cleanup limit must be between 1 and 1000.');
    const rows = await this.db.prepare(`SELECT event_key FROM sales_event_fragments
      WHERE company_id=? AND expires_at<=? ORDER BY expires_at,event_key LIMIT ?`).bind(companyId,now,limit).all<{event_key: string}>();
    if (!rows.results.length) return 0;
    const results = await this.db.batch(rows.results.map(row => this.db.prepare(
      `DELETE FROM sales_event_fragments WHERE company_id=? AND event_key=? AND expires_at<=?`,
    ).bind(companyId,row.event_key,now)));
    return results.reduce((total, result) => total + changes(result), 0);
  }
}
