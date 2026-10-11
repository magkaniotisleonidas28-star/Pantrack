/** Shared by descriptive readiness and the atomic proposal write predicate.
 * References are fixed internal SQL expressions, never request data. Clover
 * outcomes from any merchant/environment can affect this company's stock. */
export function unresolvedCloverSalesSql(companyReference: '?' | 's.company_id'): string {
  return `(EXISTS (
    SELECT 1 FROM sales_events e LEFT JOIN sales_event_states t
      ON t.company_id=e.company_id AND t.event_key=e.event_key
    WHERE e.company_id=${companyReference} AND e.provider='clover' AND (
      t.state IS NULL OR t.state IN ('received','processing','held','failed') OR (
        t.state IN ('dismissed','superseded') AND EXISTS (
          SELECT 1 FROM inventory_consumption_applications i
          WHERE i.company_id=e.company_id AND i.idempotency_key=e.application_key
        ) AND NOT EXISTS (
          SELECT 1 FROM sales_event_attempt_results r
          WHERE r.company_id=e.company_id AND r.event_key=e.event_key AND r.outcome='applied'
        )
      )
    )
  ) OR EXISTS (
    SELECT 1 FROM sales_event_conflicts f JOIN sales_events e
      ON e.company_id=f.company_id AND e.event_key=f.canonical_event_key
    WHERE f.company_id=${companyReference} AND e.provider='clover' AND NOT EXISTS (
      SELECT 1 FROM sales_event_conflict_resolutions r
      WHERE r.company_id=f.company_id AND r.conflict_id=f.conflict_id
        AND r.canonical_event_key=f.canonical_event_key AND r.kind='dismiss'
    )
  ))`;
}
