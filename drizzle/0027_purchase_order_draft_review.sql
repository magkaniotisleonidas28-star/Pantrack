CREATE TABLE `purchase_order_draft_revisions` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`snapshot_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`, `revision`),
	FOREIGN KEY (`company_id`,`order_id`,`revision`) REFERENCES `purchase_order_draft_events`(`company_id`,`order_id`,`revision`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Original create/cancel snapshots never changed. Preserve receipts and events verbatim.
INSERT INTO purchase_order_draft_revisions(company_id,order_id,revision,status,snapshot_json)
SELECT e.company_id,e.order_id,e.revision,
 CASE WHEN e.kind='cancel' THEN 'canceled' ELSE 'draft' END,h.snapshot_json
FROM purchase_order_draft_events e JOIN purchase_order_drafts h
 ON h.company_id=e.company_id AND h.id=e.order_id;
--> statement-breakpoint
DROP TRIGGER po_draft_update_guard;
--> statement-breakpoint
CREATE TRIGGER po_draft_update_guard BEFORE UPDATE ON purchase_order_drafts
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number
 OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision IS NOT OLD.revision+1 OR OLD.status NOT IN ('draft','reviewed')
 OR NOT EXISTS (
 SELECT 1 FROM purchase_order_draft_operations o JOIN purchase_order_draft_revisions r
 ON r.company_id=OLD.company_id AND r.order_id=OLD.id AND r.revision=OLD.revision
 WHERE o.company_id=NEW.company_id AND o.order_id=NEW.id
 AND json_extract(o.result_json,'$.revision')=NEW.revision AND json_extract(o.result_json,'$.status')=NEW.status
 AND json_extract(o.fingerprint,'$.input.expectedRevision')=OLD.revision
 AND json_extract(o.result_json,'$.snapshot.companyId')=NEW.company_id
 AND json_extract(o.result_json,'$.snapshot.id')=NEW.id
 AND json_extract(o.result_json,'$.snapshot.number')=NEW.number
 AND json_extract(o.result_json,'$.snapshot.supplier.id')=NEW.supplier_id
 AND json_extract(o.result_json,'$.snapshot.source')=json_extract(r.snapshot_json,'$.source')
 AND json_extract(o.result_json,'$.snapshot.contract')=json_extract(r.snapshot_json,'$.contract')
 AND json_extract(o.result_json,'$.snapshot.supplier.accountId')=json_extract(r.snapshot_json,'$.supplier.accountId')
 AND json_extract(o.result_json,'$.snapshot.supplier.locationId')=json_extract(r.snapshot_json,'$.supplier.locationId')
 AND json_extract(o.result_json,'$.snapshot.createdBy')=json_extract(r.snapshot_json,'$.createdBy')
 AND json_extract(o.result_json,'$.snapshot.createdAt')=json_extract(r.snapshot_json,'$.createdAt')
 AND ((NEW.status='draft' AND json_extract(o.fingerprint,'$.input.action')='edit'
       AND (json_extract(r.snapshot_json,'$.source')!='proposals' OR json_extract(o.result_json,'$.snapshot.lines')=json_extract(r.snapshot_json,'$.lines')))
  OR (OLD.status='draft' AND NEW.status='reviewed' AND json_extract(o.fingerprint,'$.input.action')='review'
      AND json_extract(o.result_json,'$.snapshot')=r.snapshot_json
      AND json_extract(o.result_json,'$.review.contentRevision')=OLD.revision)
  OR (NEW.status='canceled' AND json_extract(o.fingerprint,'$.input.action')='cancel'
      AND json_extract(o.result_json,'$.snapshot')=r.snapshot_json)))
BEGIN SELECT RAISE(ABORT,'PO draft snapshot is immutable or transition invalid'); END;
--> statement-breakpoint
DROP TRIGGER po_draft_event_guard;
--> statement-breakpoint
CREATE TRIGGER po_draft_event_guard BEFORE INSERT ON purchase_order_draft_events
WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM purchase_order_drafts h JOIN purchase_order_draft_operations o
 ON o.company_id=h.company_id AND o.order_id=h.id AND o.operation_id=NEW.operation_id
 WHERE h.company_id=NEW.company_id AND h.id=NEW.order_id AND h.revision=NEW.revision
 AND json_extract(o.result_json,'$.revision')=NEW.revision AND json_extract(o.result_json,'$.status')=h.status
 AND json_extract(o.fingerprint,'$.actor')=NEW.actor
 AND json_array_length(o.result_json,'$.events')=NEW.revision
 AND json_extract(o.result_json,'$.events[#-1].revision')=NEW.revision
 AND json_extract(o.result_json,'$.events[#-1].kind')=NEW.kind
 AND json_extract(o.result_json,'$.events[#-1].actor')=NEW.actor
 AND json_extract(o.result_json,'$.events[#-1].reason')=NEW.reason
 AND json_extract(o.result_json,'$.events[#-1].at')=NEW.at
 AND ((NEW.kind='create' AND h.status='draft' AND NEW.revision=1 AND json_extract(o.result_json,'$.snapshot')=h.snapshot_json)
 OR (NEW.kind='edit' AND h.status='draft' AND NEW.revision>1)
 OR (NEW.kind='review' AND h.status='reviewed' AND NEW.revision>1
  AND json_extract(o.result_json,'$.review.actor')=NEW.actor AND json_extract(o.result_json,'$.review.at')=NEW.at)
 OR (NEW.kind='cancel' AND h.status='canceled' AND NEW.revision>1)))
BEGIN SELECT RAISE(ABORT,'Invalid PO draft audit or membership'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_record_revision AFTER INSERT ON purchase_order_draft_events
BEGIN
 INSERT INTO purchase_order_draft_revisions(company_id,order_id,revision,status,snapshot_json)
 SELECT NEW.company_id,NEW.order_id,NEW.revision,json_extract(result_json,'$.status'),json_extract(result_json,'$.snapshot')
 FROM purchase_order_draft_operations WHERE company_id=NEW.company_id AND operation_id=NEW.operation_id;
END;
--> statement-breakpoint
CREATE TRIGGER po_draft_revision_guard BEFORE INSERT ON purchase_order_draft_revisions
WHEN NOT EXISTS (SELECT 1 FROM purchase_order_draft_events e JOIN purchase_order_draft_operations o
 ON o.company_id=e.company_id AND o.operation_id=e.operation_id
 WHERE e.company_id=NEW.company_id AND e.order_id=NEW.order_id AND e.revision=NEW.revision
 AND json_extract(o.result_json,'$.snapshot')=NEW.snapshot_json
 AND json_extract(o.result_json,'$.status')=NEW.status)
BEGIN SELECT RAISE(ABORT,'Invalid PO revision evidence'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_revisions_no_update BEFORE UPDATE ON purchase_order_draft_revisions
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_revisions_no_delete BEFORE DELETE ON purchase_order_draft_revisions
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;
