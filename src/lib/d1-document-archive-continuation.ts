import { poId } from './purchase-order-contract';
import { historyExportFingerprint } from './purchase-order-history-export-contract';
import {
  archiveContinuationQuery,
  archiveContinuationResponse,
} from './document-archive-continuation-contract';
import {
  documentArchiveRequest,
  archiveTemplate,
  archiveFail,
  DocumentArchiveError,
} from './purchase-order-document-archive-contract';

type Row = {
  id: string;
  company_id: string;
  operation_id: string;
  actor_id: string;
  fingerprint: string;
  request_json: string;
  template: string;
  artifact_json: string | null;
  state: string;
};
const member = "company_id=? AND user_id=? AND role IN ('owner','manager')";
/** Read the original request only. Continuing it uses the existing fenced save command. */
export class D1DocumentArchiveContinuation {
  constructor(private readonly db: D1Database) {}
  async read(value: unknown, actorId: string) {
    try {
      const parsed = archiveContinuationQuery.safeParse(value);
      if (!parsed.success || !poId.safeParse(actorId).success) archiveFail('invalid_request');
      const q = parsed.data;
      const read = async () => {
        const results = await this.db.batch<Row>([
          this.db
            .prepare(`SELECT user_id FROM memberships WHERE ${member}`)
            .bind(q.companyId, actorId),
          this.db
            .prepare(
              `SELECT i.* FROM document_archive_intents i WHERE i.company_id=? AND i.id=? AND i.actor_id=?
            AND json_extract(i.request_json,'$.source.kind')=? AND (?='history' OR json_extract(i.request_json,'$.source.orderId')=?)
            AND EXISTS(SELECT 1 FROM memberships WHERE ${member})`,
            )
            .bind(
              q.companyId,
              q.id,
              actorId,
              q.kind,
              q.kind,
              q.orderId ?? '',
              q.companyId,
              actorId,
            ),
        ]);
        if (!results[0].results.length || !results[1].results.length) archiveFail('forbidden');
        const row = results[1].results[0];
        if (row.artifact_json) archiveFail('conflict');
        if (!['reserved', 'prepared', 'held'].includes(row.state)) archiveFail('integrity');
        return row;
      };
      const row = await read(),
        request = documentArchiveRequest.parse(JSON.parse(row.request_json));
      if (
        row.id !== q.id ||
        row.actor_id !== actorId ||
        row.company_id !== q.companyId ||
        request.companyId !== q.companyId ||
        request.operationId !== row.operation_id ||
        request.source.kind !== q.kind ||
        (request.source.kind === 'draft' && request.source.orderId !== q.orderId) ||
        row.template !== archiveTemplate(request.source.kind, request.format) ||
        row.fingerprint !== (await historyExportFingerprint({ request, actorId }))
      )
        archiveFail('integrity');
      // Digest/parse work cannot bypass a later membership change or a completed operation.
      const current = await read();
      if (
        current.request_json !== row.request_json ||
        current.operation_id !== row.operation_id ||
        current.fingerprint !== row.fingerprint ||
        current.template !== row.template
      )
        archiveFail('integrity');
      return archiveContinuationResponse.parse({ viewerId: actorId, documentId: row.id, request });
    } catch (error) {
      if (error instanceof DocumentArchiveError) throw error;
      archiveFail('storage_unavailable');
    }
  }
}
