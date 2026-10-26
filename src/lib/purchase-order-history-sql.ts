import type {PurchaseOrderHistoryFilters} from './purchase-order-history-contract';
import {historyDateBounds} from './purchase-order-history-dates';

/** Fixed h/r aliases and bound values keep list/export matching identical. */
export function purchaseOrderHistoryWhere(filters:PurchaseOrderHistoryFilters){
  const clauses:string[]=[],args:string[]=[];
  if(filters.q){clauses.push("(instr(lower(h.number),lower(?))>0 OR instr(lower(json_extract(r.snapshot_json,'$.supplier.name')),lower(?))>0)");args.push(filters.q,filters.q);}
  if(filters.supplier){clauses.push("(instr(lower(h.supplier_id),lower(?))>0 OR instr(lower(json_extract(r.snapshot_json,'$.supplier.name')),lower(?))>0)");args.push(filters.supplier,filters.supplier);}
  if(filters.status){clauses.push('h.status=?');args.push(filters.status);}
  if(filters.product){
    // EXISTS selects whole orders once, even when multiple saved lines match.
    clauses.push(`EXISTS (SELECT 1 FROM json_each(r.snapshot_json,'$.lines') AS history_line WHERE
      instr(lower(coalesce(json_extract(history_line.value,'$.productId'),'')),lower(?))>0 OR
      instr(lower(coalesce(json_extract(history_line.value,'$.sku'),'')),lower(?))>0 OR
      instr(lower(coalesce(json_extract(history_line.value,'$.description'),'')),lower(?))>0)`);
    args.push(filters.product,filters.product,filters.product);
  }
  const dates=historyDateBounds(filters);
  if(dates.start){clauses.push('h.created_at>=?');args.push(dates.start);}
  if(dates.before){clauses.push('h.created_at<?');args.push(dates.before);}
  return {sql:clauses.length?'AND '+clauses.join(' AND '):'',args};
}
