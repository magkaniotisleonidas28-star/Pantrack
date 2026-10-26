import {z} from 'zod';
import {poFail} from './purchase-order-contract';
import {purchaseOrderHistoryRequest} from './purchase-order-history-contract';
import {frozenCopy} from './supplier-simulation-contract';

const summary=z.object({id:z.string(),number:z.string(),supplier_id:z.string(),supplier_name:z.string(),
  status:z.enum(['draft','reviewed','canceled']),revision:z.number().int().positive(),created_at:z.string()});
type Summary=z.infer<typeof summary>;

/** One read snapshot binds company membership to the filtered page, including empty pages. */
export class D1PurchaseOrderHistory{
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>}){}
  async list(value:unknown){
    const parsed=purchaseOrderHistoryRequest.safeParse(value);
    if(!parsed.success)poFail('invalid_request','Check the history search, status, supplier and page.');
    const {companyId,offset,filters}=parsed.data,actor=await this.options.identity();
    if(!actor)poFail('forbidden','Manager or owner membership is required.');
    const clauses:string[]=[],args:(string|number)[]=[companyId,actor,companyId];
    // INSTR gives literal substring matching: %, _ and SQL-looking text remain ordinary text.
    if(filters.q){clauses.push("(instr(lower(h.number),lower(?))>0 OR instr(lower(json_extract(r.snapshot_json,'$.supplier.name')),lower(?))>0)");args.push(filters.q,filters.q);}
    if(filters.supplier){clauses.push("(instr(lower(h.supplier_id),lower(?))>0 OR instr(lower(json_extract(r.snapshot_json,'$.supplier.name')),lower(?))>0)");args.push(filters.supplier,filters.supplier);}
    if(filters.status){clauses.push('h.status=?');args.push(filters.status);}
    args.push(offset);
    const result=await this.db.prepare(`WITH allowed AS (
      SELECT user_id FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager')
    ), page AS (
      SELECT h.id,h.number,h.supplier_id,json_extract(r.snapshot_json,'$.supplier.name') AS supplier_name,
        h.status,h.revision,h.created_at
      FROM purchase_order_drafts h JOIN purchase_order_draft_revisions r
        ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
      CROSS JOIN allowed WHERE h.company_id=? ${clauses.length?'AND '+clauses.join(' AND '):''}
      ORDER BY h.created_at DESC,h.id DESC LIMIT 21 OFFSET ?
    ) SELECT page.* FROM allowed LEFT JOIN page ON 1=1 ORDER BY page.created_at DESC,page.id DESC`)
      .bind(...args).all<{[K in keyof Summary]:Summary[K]|null}>();
    if(result.results.length===0)poFail('forbidden','Manager or owner membership is required.');
    const rows=result.results.filter(row=>row.id!==null),summaries=z.array(summary).max(21).safeParse(rows);
    if(!summaries.success)poFail('storage_failure','Saved purchase-order history could not be loaded.');
    return frozenCopy({orders:summaries.data.slice(0,20),hasMore:summaries.data.length>20});
  }
}
