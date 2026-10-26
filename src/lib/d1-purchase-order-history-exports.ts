import {buildPurchaseOrderHistoryRecord} from './purchase-order-export-contract';
import {purchaseOrderHistoryWhere} from './purchase-order-history-sql';
import {buildPurchaseOrderHistoryExport,historyExportFail,purchaseOrderHistoryExportRequest,
  HISTORY_EXPORT_MAX_ORDERS,HISTORY_EXPORT_MAX_LINES,HISTORY_EXPORT_MAX_BYTES} from './purchase-order-history-export-contract';

/** One database snapshot covers all matching current revisions and authorization; no client paging. */
export class D1PurchaseOrderHistoryExports{
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>}){}
  async get(value:unknown){
    const parsed=purchaseOrderHistoryExportRequest.safeParse(value);if(!parsed.success)historyExportFail('invalid_request','Check the history export filters.');
    const {companyId,filters,expected}=parsed.data,actor=await this.options.identity();if(!actor)historyExportFail('forbidden','Owner or manager membership is required.');
    const where=purchaseOrderHistoryWhere(filters);
    const result=await this.db.prepare(`WITH history_export_allowed AS (
      SELECT user_id FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager')
    ), matched AS (
      SELECT h.company_id,h.id,h.number,h.supplier_id,h.created_at AS header_created_at,h.revision AS current_revision,h.status AS current_status,
        r.status AS revision_status,r.snapshot_json,e.kind AS event_kind,e.actor AS event_actor,e.at AS event_at,
        CASE WHEN r.order_id IS NULL OR e.kind IS NULL THEN 1 WHEN NOT json_valid(r.snapshot_json) THEN 1
          WHEN coalesce(json_type(r.snapshot_json,'$.lines'),'')!='array' THEN 1 ELSE 0 END AS bad
      FROM purchase_order_drafts h LEFT JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
      LEFT JOIN purchase_order_draft_events e ON e.company_id=r.company_id AND e.order_id=r.order_id AND e.revision=r.revision
      CROSS JOIN history_export_allowed WHERE h.company_id=? AND (r.order_id IS NULL OR (1=1 ${where.sql}))
    ), stats AS (
      SELECT count(*) AS order_count,coalesce(sum(length(CAST(snapshot_json AS BLOB))),0) AS source_bytes,
        coalesce(sum(CASE WHEN json_valid(snapshot_json) THEN coalesce(json_array_length(snapshot_json,'$.lines'),0) ELSE 0 END),0) AS line_count,
        coalesce(max(bad),0) AS bad_source FROM matched
    ) SELECT stats.*,m.* FROM history_export_allowed CROSS JOIN stats LEFT JOIN matched m
      ON stats.order_count<=? AND stats.line_count<=? AND stats.source_bytes<=? AND stats.bad_source=0
      ORDER BY m.header_created_at DESC,m.id DESC`)
      .bind(companyId,actor,companyId,...where.args,HISTORY_EXPORT_MAX_ORDERS,HISTORY_EXPORT_MAX_LINES,HISTORY_EXPORT_MAX_BYTES).all<Record<string,unknown>>();
    const first=result.results[0];if(!first)historyExportFail('forbidden','Owner or manager membership is required.');
    if(first.bad_source!==0)historyExportFail('source_invalid','A saved draft needs review before this history can be exported.');
    if(first.order_count===0)historyExportFail('empty','No saved drafts match these filters.');
    if(Number(first.order_count)>HISTORY_EXPORT_MAX_ORDERS||Number(first.line_count)>HISTORY_EXPORT_MAX_LINES||Number(first.source_bytes)>HISTORY_EXPORT_MAX_BYTES){
      historyExportFail('too_large','This history export is too large. Narrow the filters and try again.');
    }
    const records=result.results.map(row=>buildPurchaseOrderHistoryRecord(row,companyId));
    if(records.length!==first.order_count)historyExportFail('source_invalid','The history is incomplete. Refresh the results.');
    const snapshot=await buildPurchaseOrderHistoryExport(companyId,filters,records);
    if(expected&&snapshot.fingerprint!==expected)historyExportFail('changed','The matching history changed. Refresh the results before exporting again.');
    return snapshot;
  }
}
