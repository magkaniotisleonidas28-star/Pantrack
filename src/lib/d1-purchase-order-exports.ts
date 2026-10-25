import {poFail} from './purchase-order-contract';
import {buildPurchaseOrderExport,purchaseOrderExportRequest,type PurchaseOrderExportSnapshot} from './purchase-order-export-contract';

/** One read snapshot binds current membership, PO revision, content and review metadata. No writes. */
export class D1PurchaseOrderExports {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>}){}

  async get(value:unknown):Promise<PurchaseOrderExportSnapshot>{
    const parsed=purchaseOrderExportRequest.safeParse(value);
    if(!parsed.success)poFail('invalid_request','Choose a company, draft and current saved revision.');
    const selection=parsed.data,actor=await this.options.identity();
    if(!actor)poFail('forbidden','Manager or owner membership is required.');
    // Starting with membership distinguishes forbidden from missing without querying another company.
    const row=await this.db.prepare(`SELECT h.company_id,h.id,h.number,h.supplier_id,
      h.revision AS current_revision,h.status AS current_status,r.status AS revision_status,r.snapshot_json,
      e.kind AS event_kind,e.actor AS event_actor,e.at AS event_at
      FROM memberships m
      LEFT JOIN purchase_order_drafts h ON h.company_id=m.company_id AND h.id=?
      LEFT JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id
        AND r.revision=h.revision AND r.revision=? AND h.status IN ('draft','reviewed')
      LEFT JOIN purchase_order_draft_events e ON e.company_id=r.company_id AND e.order_id=r.order_id AND e.revision=r.revision
      WHERE m.company_id=? AND m.user_id=? AND m.role IN ('owner','manager') LIMIT 1`)
      .bind(selection.orderId,selection.revision,selection.companyId,actor).first<Record<string,unknown>>();
    if(!row)poFail('forbidden','Manager or owner membership is required.');
    if(row.id===null)poFail('missing','PO draft not found.');
    if(row.current_revision!==selection.revision||row.current_status==='canceled') {
      poFail('conflict','The draft changed or was canceled. Reload it before exporting.');
    }
    return buildPurchaseOrderExport(row,selection);
  }
}
