import { poId } from './purchase-order-contract';
import { canonicalJson } from './supplier-simulation-contract';
import { historyExportFingerprint } from './purchase-order-history-export-contract';
import { documentFileOutcome } from './document-file-observation';
import { issuedCheckObservation } from './issued-file-check-contract';
import {
  preparedFileCheckCommand,
  preparedFileCheckEvent,
  preparedFileCheckReceipt,
  PREPARED_FILE_CHECK_CONTRACT,
  type PreparedFileCheckCommand,
} from './prepared-file-check-contract';
import {
  archiveFail,
  DocumentArchiveError,
  captureArchiveManifest,
  documentArchiveRequest,
  type DocumentArchiveManifest,
  type ArchiveObservation,
  type ArchiveReadObservationReceipt,
} from './purchase-order-document-archive-contract';

const member = "company_id=? AND user_id=? AND role IN ('owner','manager')";
type Row = {
  id: string;
  document_id: string;
  actor_id: string;
  token: string | null;
  payload_json: string;
  at: string;
};
/** Separate, tokenless check events cannot own a save lease or satisfy publication evidence. */
export class D1PreparedFileChecks {
  constructor(private readonly db: D1Database) {}
  private async boundary<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof DocumentArchiveError) throw error;
      archiveFail('storage_unavailable');
    }
  }
  private command(value: unknown, actorId: string) {
    const parsed = preparedFileCheckCommand.safeParse(value);
    if (!parsed.success || !poId.safeParse(actorId).success) archiveFail('invalid_request');
    return parsed.data;
  }
  private async snapshot(command: PreparedFileCheckCommand, actorId: string) {
    const results = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(`SELECT user_id FROM memberships WHERE ${member}`)
        .bind(command.companyId, actorId),
      this.db
        .prepare(
          `SELECT * FROM document_archive_intents WHERE company_id=? AND id=? AND EXISTS(SELECT 1 FROM memberships WHERE ${member})`,
        )
        .bind(command.companyId, command.documentId, command.companyId, actorId),
    ]);
    if (!results[0].results.length) archiveFail('forbidden');
    const row = results[1].results[0];
    if (!row || !row.manifest_json) archiveFail('missing');
    const manifest = captureArchiveManifest(JSON.parse(String(row.manifest_json))),
      request = documentArchiveRequest.parse(JSON.parse(String(row.request_json)));
    if (
      manifest.id !== command.documentId ||
      manifest.companyId !== command.companyId ||
      manifest.actorId !== row.actor_id ||
      manifest.requestedAt !== row.requested_at ||
      manifest.template !== row.template ||
      request.companyId !== command.companyId ||
      request.operationId !== row.operation_id ||
      manifest.format !== request.format ||
      manifest.source.kind !== request.source.kind ||
      (request.source.kind === 'draft'
        ? manifest.source.records[0].id !== request.source.orderId ||
          manifest.source.records[0].revision !== request.source.revision
        : manifest.source.fingerprint !== request.source.fingerprint)
    )
      archiveFail('integrity');
    return { manifest, issued: !!row.artifact_json };
  }
  private event(row: Row, command: PreparedFileCheckCommand, actorId: string, fingerprint: string) {
    const parsed = preparedFileCheckEvent.safeParse(JSON.parse(row.payload_json));
    if (
      !parsed.success ||
      row.document_id !== command.documentId ||
      row.actor_id !== actorId ||
      row.token !== null ||
      parsed.data.operationId !== command.operationId ||
      parsed.data.manifestFingerprint !== fingerprint
    )
      archiveFail('conflict');
    return parsed.data;
  }
  private async admission(
    command: PreparedFileCheckCommand,
    actorId: string,
    manifest: DocumentArchiveManifest,
  ) {
    const fingerprint = await historyExportFingerprint(manifest),
      rows = (
        await this.db
          .prepare(
            'SELECT * FROM document_archive_observations WHERE company_id=? AND id=? ORDER BY rowid LIMIT 2',
          )
          .bind(command.companyId, command.operationId)
          .all<Row>()
      ).results;
    if (rows.length !== 1) archiveFail(rows.length ? 'conflict' : 'storage_unavailable');
    const event = this.event(rows[0], command, actorId, fingerprint);
    if (
      event.stage !== 'requested' ||
      canonicalJson(captureArchiveManifest(event.manifest)) !== canonicalJson(manifest)
    )
      archiveFail('conflict');
    return fingerprint;
  }
  private async receipt(
    command: PreparedFileCheckCommand,
    actorId: string,
    manifest: DocumentArchiveManifest,
  ) {
    const fingerprint = await this.admission(command, actorId, manifest),
      rows = (
        await this.db
          .prepare(
            `SELECT * FROM document_archive_observations WHERE company_id=? AND document_id=?
      AND json_extract(payload_json,'$.kind')='prepared_check' AND json_extract(payload_json,'$.stage')='completed' AND json_extract(payload_json,'$.operationId')=? ORDER BY rowid LIMIT 2`,
          )
          .bind(command.companyId, command.documentId, command.operationId)
          .all<Row>()
      ).results;
    if (!rows.length) return null;
    if (rows.length !== 1) archiveFail('integrity');
    const completed = this.event(rows[0], command, actorId, fingerprint);
    if (completed.stage !== 'completed') archiveFail('integrity');
    const row = await this.db
      .prepare(
        'SELECT * FROM document_archive_observations WHERE company_id=? AND document_id=? AND id=?',
      )
      .bind(command.companyId, command.documentId, completed.observationId)
      .first<Row>();
    if (!row) archiveFail('integrity');
    const observed = this.event(row, command, actorId, fingerprint);
    if (observed.stage !== 'observed') archiveFail('integrity');
    return preparedFileCheckReceipt.parse({
      contract: PREPARED_FILE_CHECK_CONTRACT,
      ...command,
      actorId,
      manifestFingerprint: fingerprint,
      checkedAt: row.at,
      outcome: documentFileOutcome(manifest, observed.observation),
    });
  }
  async start(value: unknown, actorId: string) {
    return this.boundary(async () => {
      const command = this.command(value, actorId),
        { manifest, issued } = await this.snapshot(command, actorId);
      const existing = await this.db
        .prepare('SELECT id FROM document_archive_observations WHERE company_id=? AND id=? LIMIT 1')
        .bind(command.companyId, command.operationId)
        .first();
      if (existing) {
        const check = await this.receipt(command, actorId, manifest);
        if (check) return { manifest, check };
      }
      if (issued) archiveFail('missing');
      if (!existing) {
        const payload = preparedFileCheckEvent.parse({
          kind: 'prepared_check',
          contract: PREPARED_FILE_CHECK_CONTRACT,
          stage: 'requested',
          operationId: command.operationId,
          manifestFingerprint: await historyExportFingerprint(manifest),
          manifest,
        });
        try {
          await this.db
            .prepare(
              `INSERT INTO document_archive_observations(company_id,document_id,id,actor_id,token,payload_json,at)
        SELECT company_id,id,?,?,NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM document_archive_intents WHERE company_id=? AND id=? AND manifest_json=? AND artifact_json IS NULL
        AND EXISTS(SELECT 1 FROM memberships WHERE ${member}) AND NOT EXISTS(SELECT 1 FROM document_archive_observations WHERE company_id=? AND id=?)`,
            )
            .bind(
              command.operationId,
              actorId,
              JSON.stringify(payload),
              command.companyId,
              command.documentId,
              JSON.stringify(manifest),
              command.companyId,
              actorId,
              command.companyId,
              command.operationId,
            )
            .run();
        } catch {
          await this.recheck(command, actorId, manifest, true);
          await this.admission(command, actorId, manifest);
        }
      }
      await this.recheck(command, actorId, manifest, true);
      await this.admission(command, actorId, manifest);
      return { manifest, check: await this.receipt(command, actorId, manifest) };
    });
  }
  async recheck(
    value: unknown,
    actorId: string,
    expected: DocumentArchiveManifest,
    unissued = false,
  ) {
    return this.boundary(async () => {
      const command = this.command(value, actorId),
        { manifest, issued } = await this.snapshot(command, actorId);
      if (canonicalJson(manifest) !== canonicalJson(expected)) archiveFail('integrity');
      if (unissued && issued) archiveFail('missing');
    });
  }
  async observe(
    value: unknown,
    actorId: string,
    manifest: DocumentArchiveManifest,
    observation: ArchiveObservation,
  ) {
    return this.boundary(async () => {
      const command = this.command(value, actorId),
        fingerprint = await this.admission(command, actorId, manifest),
        id = crypto.randomUUID();
      const payload = preparedFileCheckEvent.parse({
        kind: 'prepared_check',
        contract: PREPARED_FILE_CHECK_CONTRACT,
        stage: 'observed',
        operationId: command.operationId,
        manifestFingerprint: fingerprint,
        observation: issuedCheckObservation.parse(observation),
      });
      const read = this.db
        .prepare(
          'SELECT id,at FROM document_archive_observations WHERE company_id=? AND document_id=? AND id=?',
        )
        .bind(command.companyId, command.documentId, id);
      try {
        await this.db
          .prepare(
            `INSERT INTO document_archive_observations(company_id,document_id,id,actor_id,token,payload_json,at) VALUES(?,?,?,?,NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          )
          .bind(command.companyId, command.documentId, id, actorId, JSON.stringify(payload))
          .run();
      } catch {
        if (!(await read.first())) archiveFail('storage_unavailable');
      }
      const proof = await read.first<ArchiveReadObservationReceipt>();
      if (!proof) archiveFail('storage_unavailable');
      return proof;
    });
  }
  async complete(
    value: unknown,
    actorId: string,
    manifest: DocumentArchiveManifest,
    proof: ArchiveReadObservationReceipt,
  ) {
    return this.boundary(async () => {
      const command = this.command(value, actorId),
        fingerprint = await this.admission(command, actorId, manifest);
      const payload = preparedFileCheckEvent.parse({
        kind: 'prepared_check',
        contract: PREPARED_FILE_CHECK_CONTRACT,
        stage: 'completed',
        operationId: command.operationId,
        manifestFingerprint: fingerprint,
        observationId: proof.id,
      });
      try {
        await this.db
          .prepare(
            `INSERT INTO document_archive_observations(company_id,document_id,id,actor_id,token,payload_json,at)
      SELECT company_id,id,?,?,NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM document_archive_intents WHERE company_id=? AND id=? AND manifest_json=? AND artifact_json IS NULL
      AND EXISTS(SELECT 1 FROM memberships WHERE ${member}) AND NOT EXISTS(SELECT 1 FROM document_archive_observations WHERE company_id=? AND document_id=?
        AND json_extract(payload_json,'$.kind')='prepared_check' AND json_extract(payload_json,'$.stage')='completed' AND json_extract(payload_json,'$.operationId')=?)`,
          )
          .bind(
            crypto.randomUUID(),
            actorId,
            JSON.stringify(payload),
            command.companyId,
            command.documentId,
            JSON.stringify(manifest),
            command.companyId,
            actorId,
            command.companyId,
            command.documentId,
            command.operationId,
          )
          .run();
      } catch {
        await this.recheck(command, actorId, manifest);
        const saved = await this.receipt(command, actorId, manifest);
        if (saved) return saved;
        archiveFail('storage_unavailable');
      }
      await this.recheck(command, actorId, manifest);
      const saved = await this.receipt(command, actorId, manifest);
      if (!saved) archiveFail('storage_unavailable');
      return saved;
    });
  }
}
