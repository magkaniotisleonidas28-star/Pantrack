import {D1DocumentArchiveSources,captureArchiveSource} from './purchase-order-document-archive-sources';
import {purchaseOrderHistoryWhere} from './purchase-order-history-sql';
import {canonicalJson} from './supplier-simulation-contract';
import {archiveFail,DocumentArchiveError,type DocumentArchiveManifest,type DocumentArchiveRequest} from './purchase-order-document-archive-contract';

/** Revisions/events and header identity/creation time are immutable under migrations
 * 0025/0027. Thus the complete validated source stays identical while these current
 * revision/status references and the full filtered membership stay identical.
 * No large snapshot aggregate or hundreds of bound parameters are needed. */
export function documentArchiveSourceGuard(request:DocumentArchiveRequest,manifest:DocumentArchiveManifest){
  const selected=JSON.stringify(manifest.source.records);
  const expected=`SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.revision') AS revision,
    json_extract(value,'$.status') AS status FROM json_each(?)`;
  if(request.source.kind==='draft')return {sql:`EXISTS (SELECT 1 FROM purchase_order_drafts h
    JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
    JOIN purchase_order_draft_events e ON e.company_id=r.company_id AND e.order_id=r.order_id AND e.revision=r.revision
    JOIN (${expected}) wanted ON wanted.id=h.id AND wanted.revision=h.revision AND wanted.status=h.status
    WHERE h.company_id=? AND h.status IN ('draft','reviewed') AND r.status=h.status)`,args:[selected,request.companyId]};
  const where=purchaseOrderHistoryWhere(request.source.filters);
  return {sql:`NOT EXISTS (SELECT 1 FROM purchase_order_drafts h
    LEFT JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
    WHERE h.company_id=? AND (r.order_id IS NULL OR (1=1 ${where.sql}))
    AND NOT EXISTS (SELECT 1 FROM (${expected}) wanted WHERE wanted.id=h.id AND wanted.revision=h.revision AND wanted.status=h.status))
    AND NOT EXISTS (SELECT 1 FROM (${expected}) wanted WHERE NOT EXISTS (SELECT 1 FROM purchase_order_drafts h
      JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
      JOIN purchase_order_draft_events e ON e.company_id=r.company_id AND e.order_id=r.order_id AND e.revision=r.revision
      WHERE h.company_id=? AND h.id=wanted.id AND h.revision=wanted.revision AND h.status=wanted.status AND r.status=h.status ${where.sql}))`,
    args:[request.companyId,...where.args,selected,selected,request.companyId,...where.args]};
}

/** Diagnostic capture precedes the caller's persisted source-check decision. */
export async function observeDocumentArchiveSource(db:D1Database,request:DocumentArchiveRequest,actorId:string){
  try{return {proof:(await captureArchiveSource(request,await new D1DocumentArchiveSources(db).load(request,actorId))).proof,error:null};}
  catch(error){const code=error instanceof DocumentArchiveError?error.code:(error as {code?:unknown})?.code;
    return {proof:null,error:code==='forbidden'?'forbidden' as const:
      ['source_changed','missing','conflict','changed','source_invalid','empty','too_large','storage_failure'].includes(String(code))?'source_changed' as const:'storage_unavailable' as const};}
}
export function requireDocumentArchiveSource(manifest:DocumentArchiveManifest,observed:Awaited<ReturnType<typeof observeDocumentArchiveSource>>){
  if(observed.error)archiveFail(observed.error);
  if(canonicalJson(observed.proof)!==canonicalJson(manifest.source))archiveFail('source_changed');
}
