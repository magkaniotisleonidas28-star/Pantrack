import { poId } from './purchase-order-contract';
import { canonicalJson } from './supplier-simulation-contract';
import { historyExportFingerprint } from './purchase-order-history-export-contract';
import { documentFileOutcome } from './document-file-observation';
import {
  issuedFileCheckCommand,
  issuedCheckObservation,
  issuedCheckPayload,
  issuedFileCheckReceipt,
  type IssuedFileCheckCommand,
} from './issued-file-check-contract';
import {
  captureArchiveArtifact,
  archiveFail,
  DocumentArchiveError,
  type DocumentArchiveArtifact,
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
  observed_json: string | null;
  observed_at: string | null;
  observed_actor: string | null;
  observed_token: string | null;
};
/** Check receipts share the append-only observation store. Atomic global-per-company ID checks fence collisions with every observation kind. */
export class D1IssuedFileChecks {
  constructor(private readonly db: D1Database) {}
  private async boundary<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof DocumentArchiveError) throw error;
      archiveFail('storage_unavailable');
    }
  }
  private async input(
    value: IssuedFileCheckCommand,
    actorId: string,
    valueArtifact: DocumentArchiveArtifact,
  ) {
    const parsed = issuedFileCheckCommand.safeParse(value);
    if (!parsed.success || !poId.safeParse(actorId).success) archiveFail('invalid_request');
    const command = parsed.data,
      artifact = captureArchiveArtifact(valueArtifact);
    if (artifact.companyId !== command.companyId || artifact.id !== command.documentId)
      archiveFail('integrity');
    return { command, artifact, fingerprint: await historyExportFingerprint(artifact) };
  }
  private statements(
    command: IssuedFileCheckCommand,
    actorId: string,
    artifact: DocumentArchiveArtifact,
  ) {
    return [
      this.db
        .prepare(`SELECT user_id FROM memberships WHERE ${member}`)
        .bind(command.companyId, actorId),
      this.db
        .prepare(
          `SELECT id FROM document_archive_intents WHERE company_id=? AND id=? AND artifact_json=? AND EXISTS(SELECT 1 FROM memberships WHERE ${member})`,
        )
        .bind(
          command.companyId,
          command.documentId,
          JSON.stringify(artifact),
          command.companyId,
          actorId,
        ),
      this.db
        .prepare(
          `SELECT o.id,o.document_id,o.actor_id,o.token,o.payload_json,d.payload_json AS observed_json,d.at AS observed_at,d.actor_id AS observed_actor,d.token AS observed_token
      FROM document_archive_observations o LEFT JOIN document_archive_observations d ON d.company_id=o.company_id AND d.document_id=o.document_id
        AND d.id=json_extract(o.payload_json,'$.check.observationId')
      WHERE o.company_id=? AND o.id=? AND EXISTS(SELECT 1 FROM memberships WHERE ${member}) ORDER BY o.rowid LIMIT 2`,
        )
        .bind(command.companyId, command.operationId, command.companyId, actorId),
    ];
  }
  private capture(
    results: D1Result<Row>[],
    command: IssuedFileCheckCommand,
    actorId: string,
    artifact: DocumentArchiveArtifact,
    fingerprint: string,
  ) {
    if (!results[0].results.length) archiveFail('forbidden');
    if (!results[1].results.length) archiveFail('integrity');
    const rows = results[2].results;
    if (!rows.length) return null;
    if (rows.length !== 1) archiveFail('conflict');
    const row = rows[0];
    let payload;
    try {
      payload = issuedCheckPayload.parse(JSON.parse(row.payload_json));
    } catch {
      archiveFail('conflict');
    }
    const { check, ...observation } = payload;
    if (
      row.document_id !== command.documentId ||
      row.actor_id !== actorId ||
      row.token !== null ||
      check.operationId !== command.operationId ||
      check.manifestFingerprint !== fingerprint ||
      !row.observed_json ||
      !row.observed_at ||
      row.observed_actor !== actorId ||
      row.observed_token !== null ||
      check.observationId === row.id
    )
      archiveFail('conflict');
    let observed;
    try {
      observed = issuedCheckObservation.parse(JSON.parse(row.observed_json));
    } catch {
      archiveFail('integrity');
    }
    if (canonicalJson(observed) !== canonicalJson(observation)) archiveFail('integrity');
    return issuedFileCheckReceipt.parse({
      contract: check.contract,
      companyId: command.companyId,
      documentId: command.documentId,
      operationId: command.operationId,
      actorId,
      checkedAt: row.observed_at,
      outcome: documentFileOutcome(artifact, observed),
    });
  }
  async find(
    value: IssuedFileCheckCommand,
    actorId: string,
    valueArtifact: DocumentArchiveArtifact,
  ) {
    return this.boundary(async () => {
      const { command, artifact, fingerprint } = await this.input(value, actorId, valueArtifact),
        results = await this.db.batch<Row>(this.statements(command, actorId, artifact));
      return this.capture(results, command, actorId, artifact, fingerprint);
    });
  }
  async record(
    value: IssuedFileCheckCommand,
    actorId: string,
    valueArtifact: DocumentArchiveArtifact,
    observation: ArchiveObservation,
    proof: ArchiveReadObservationReceipt,
  ) {
    return this.boundary(async () => {
      const { command, artifact, fingerprint } = await this.input(value, actorId, valueArtifact),
        observed = issuedCheckObservation.parse(observation);
      const payload = issuedCheckPayload.parse({
        ...observed,
        check: {
          contract: 'pantrack.issued-file-check.v1',
          operationId: command.operationId,
          manifestFingerprint: fingerprint,
          observationId: proof.id,
        },
      });
      const write = this.db
        .prepare(
          `INSERT INTO document_archive_observations(company_id,document_id,id,actor_id,token,payload_json,at)
      SELECT i.company_id,i.id,?,?,NULL,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM document_archive_intents i
      WHERE i.company_id=? AND i.id=? AND i.artifact_json=? AND EXISTS(SELECT 1 FROM memberships WHERE ${member})
      AND EXISTS(SELECT 1 FROM document_archive_observations d WHERE d.company_id=i.company_id AND d.document_id=i.id AND d.id=? AND d.actor_id=?
        AND d.token IS NULL AND d.payload_json=? AND d.at=?)
      AND NOT EXISTS(SELECT 1 FROM document_archive_observations o WHERE o.company_id=i.company_id AND o.id=?)`,
        )
        .bind(
          command.operationId,
          actorId,
          JSON.stringify(payload),
          command.companyId,
          command.documentId,
          JSON.stringify(artifact),
          command.companyId,
          actorId,
          proof.id,
          actorId,
          JSON.stringify(observed),
          proof.at,
          command.operationId,
        );
      let result;
      try {
        const results = await this.db.batch<Row>([
          write,
          ...this.statements(command, actorId, artifact),
        ]);
        result = this.capture(results.slice(1), command, actorId, artifact, fingerprint);
      } catch (error) {
        if (error instanceof DocumentArchiveError) throw error;
        result = await this.find(command, actorId, artifact);
      }
      if (!result) archiveFail('storage_unavailable');
      return result;
    });
  }
}
