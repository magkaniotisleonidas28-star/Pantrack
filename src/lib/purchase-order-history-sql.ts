import type {PurchaseOrderHistoryFilters} from './purchase-order-history-contract';
import {historyDateBounds} from './purchase-order-history-dates';

/** Fixed h/r aliases and bound values keep list/export matching identical. */
export function purchaseOrderHistoryWhere(filters:PurchaseOrderHistoryFilters){
  const clauses:string[]=[],args:string[]=[];
  if(filters.q){clauses.push("(instr(lower(h.number),lower(?))>0 OR instr(lower(json_extract(r.snapshot_json,'$.supplier.name')),lower(?))>0)");args.push(filters.q,filters.q);}
  if(filters.supplier){clauses.push("(instr(lower(h.supplier_id),lower(?))>0 OR instr(lower(json_extract(r.snapshot_json,'$.supplier.name')),lower(?))>0)");args.push(filters.supplier,filters.supplier);}
  if(filters.status){clauses.push('h.status=?');args.push(filters.status);}
  const dates=historyDateBounds(filters);
  if(dates.start){clauses.push('h.created_at>=?');args.push(dates.start);}
  if(dates.before){clauses.push('h.created_at<?');args.push(dates.before);}
  return {sql:clauses.length?'AND '+clauses.join(' AND '):'',args};
}
