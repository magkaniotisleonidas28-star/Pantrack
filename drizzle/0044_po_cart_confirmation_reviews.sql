CREATE TABLE `po_cart_confirmation_reviews` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`confirmation_id` text NOT NULL,
	`kind` text NOT NULL,
	`approved_total_minor` integer,
	`note` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`reauthenticated_at` text,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`confirmation_id`) REFERENCES `po_cart_confirmations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_confirmation_review_operation` ON `po_cart_confirmation_reviews` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_confirmation_one_approval` ON `po_cart_confirmation_reviews` (`company_id`,`confirmation_id`) WHERE "po_cart_confirmation_reviews"."kind"='approved';--> statement-breakpoint
-- The owner reviews an over-cap confirmation: one approval of exactly the confirmed total, password
-- confirmed within the last five minutes, while the order's spending hold is still held; or notes
-- while it stays held. Owners only; permanent.
CREATE TRIGGER po_cart_confirmation_review_insert_guard BEFORE INSERT ON po_cart_confirmation_reviews
WHEN NEW.kind NOT IN ('approved','note')
 OR length(NEW.operation_id)!=36 OR length(NEW.fingerprint)<1 OR length(NEW.note)>1000
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role='owner')
 OR NOT EXISTS (SELECT 1 FROM po_cart_confirmations c JOIN po_cart_reservations r ON r.company_id=c.company_id AND r.authorization_id=c.authorization_id
  WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id AND c.state='needs_owner_review' AND c.created_at<=NEW.created_at
  AND r.state='reserved' AND r.total_minor=c.cap_minor)
 OR EXISTS (SELECT 1 FROM po_cart_confirmation_reviews WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id AND kind='approved')
 OR COALESCE(NEW.kind='approved' AND (typeof(NEW.approved_total_minor)!='integer'
  OR NEW.approved_total_minor IS NOT (SELECT total_minor FROM po_cart_confirmations WHERE company_id=NEW.company_id AND id=NEW.confirmation_id)
  OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.reauthenticated_at) IS NOT NEW.reauthenticated_at
  OR NEW.reauthenticated_at>NEW.created_at OR julianday(NEW.created_at)-julianday(NEW.reauthenticated_at)>5.0/1440),1)
 OR (NEW.kind='note' AND (NEW.approved_total_minor IS NOT NULL OR NEW.reauthenticated_at IS NOT NULL OR length(trim(NEW.note))<1))
BEGIN SELECT RAISE(ABORT,'Invalid or stale over-cap review'); END;
--> statement-breakpoint
-- Approval raises the order's held amount from the cap to the approved total, so the in-progress,
-- daily and monthly limits count what the café will actually pay.
CREATE TRIGGER po_cart_confirmation_approval_raises_hold AFTER INSERT ON po_cart_confirmation_reviews
WHEN NEW.kind='approved'
BEGIN
 UPDATE po_cart_reservations SET total_minor=NEW.approved_total_minor WHERE company_id=NEW.company_id AND state='reserved'
  AND authorization_id=(SELECT authorization_id FROM po_cart_confirmations WHERE company_id=NEW.company_id AND id=NEW.confirmation_id);
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_confirmation_reviews_no_update BEFORE UPDATE ON po_cart_confirmation_reviews
BEGIN SELECT RAISE(ABORT,'Over-cap reviews are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_confirmation_reviews_no_delete BEFORE DELETE ON po_cart_confirmation_reviews
BEGIN SELECT RAISE(ABORT,'Over-cap reviews are permanent'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_reservation_release_guard;
--> statement-breakpoint
-- Unchanged from 0041, plus: a held amount may rise once, from the cap to an owner-approved over-cap total.
CREATE TRIGGER po_cart_reservation_release_guard BEFORE UPDATE ON po_cart_reservations
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR OLD.state!='reserved'
 OR NOT ((NEW.total_minor IS OLD.total_minor AND NEW.state='released' AND EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND status IN ('canceled','invalidated') AND (started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.authorization_id AND r.action='abandonVerifiedCart' AND r.authorization_revision=po_cart_authorizations.revision-1 AND r.at=po_cart_authorizations.released_at))))
  OR (NEW.total_minor IS OLD.total_minor AND NEW.state='settled' AND EXISTS (SELECT 1 FROM po_cart_order_closures WHERE company_id=NEW.company_id AND authorization_id=NEW.authorization_id))
  OR (NEW.state='reserved' AND typeof(NEW.total_minor)='integer' AND NEW.total_minor>OLD.total_minor AND EXISTS (SELECT 1 FROM po_cart_confirmation_reviews v JOIN po_cart_confirmations c
   ON c.company_id=v.company_id AND c.id=v.confirmation_id WHERE v.company_id=NEW.company_id AND c.authorization_id=NEW.authorization_id
   AND v.kind='approved' AND v.approved_total_minor=NEW.total_minor AND c.cap_minor=OLD.total_minor)))
BEGIN SELECT RAISE(ABORT,'Unsafe cart exposure release'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_delivery_insert_guard;
--> statement-breakpoint
-- Unchanged from 0041, plus: an owner-approved over-cap confirmation can be counted.
CREATE TRIGGER po_cart_delivery_insert_guard BEFORE INSERT ON po_cart_deliveries
WHEN NEW.state IS NOT 'counted' OR NEW.decision_json IS NOT NULL OR NEW.decision_note IS NOT NULL OR NEW.stock_receipt IS NOT NULL
 OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_operation_id IS NOT NULL OR NEW.decision_fingerprint IS NOT NULL
 OR json_valid(NEW.count_json)=0 OR json_type(NEW.count_json) IS NOT 'array' OR json_array_length(NEW.count_json)<1
 OR length(NEW.count_note)>1000 OR length(NEW.count_operation_id)<1 OR length(NEW.count_fingerprint)<1
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.counted_at) IS NOT NEW.counted_at
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.delivered_at) IS NOT NEW.delivered_at OR NEW.delivered_at>NEW.counted_at
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.counted_by AND role IN ('owner','manager','employee'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_confirmations c WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id AND c.job_id=NEW.job_id
  AND (c.state='confirmed' OR (c.state='needs_owner_review' AND EXISTS (SELECT 1 FROM po_cart_confirmation_reviews v WHERE v.company_id=c.company_id AND v.confirmation_id=c.id AND v.kind='approved'))))
 OR EXISTS (SELECT 1 FROM po_cart_order_closures WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id)
BEGIN SELECT RAISE(ABORT,'Invalid delivery count'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_order_closure_insert_guard;
--> statement-breakpoint
-- Unchanged from 0041, plus: an owner-approved over-cap order can close.
CREATE TRIGGER po_cart_order_closure_insert_guard BEFORE INSERT ON po_cart_order_closures
WHEN NEW.kind NOT IN ('complete','closed_short')
 OR length(NEW.operation_id)!=36 OR length(NEW.fingerprint)<1 OR length(NEW.note)>1000
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.closed_at) IS NOT NEW.closed_at
 OR json_valid(NEW.release_json) IS NOT 1 OR json_type(NEW.release_json) IS NOT 'array'
 OR typeof(NEW.stock_receipt)!='integer' OR NEW.stock_receipt NOT IN (0,1)
 OR (NEW.stock_receipt=1)!=EXISTS (SELECT 1 FROM inventory_order_receipts WHERE company_id=NEW.company_id AND receipt_id=NEW.operation_id AND confirmation_id=NEW.confirmation_id)
 OR (NEW.kind='complete' AND (NEW.release_json IS NOT '[]' OR NEW.stock_receipt!=0))
 OR (NEW.kind='closed_short' AND (json_array_length(NEW.release_json)<1 OR length(trim(NEW.note))<1))
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.closed_by AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_confirmations c JOIN po_cart_reservations r ON r.company_id=c.company_id AND r.authorization_id=c.authorization_id
  WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id AND c.job_id=NEW.job_id AND c.authorization_id=NEW.authorization_id
  AND (c.state='confirmed' OR (c.state='needs_owner_review' AND EXISTS (SELECT 1 FROM po_cart_confirmation_reviews v WHERE v.company_id=c.company_id AND v.confirmation_id=c.id AND v.kind='approved')))
  AND c.created_at<=NEW.closed_at AND r.state='reserved')
 OR EXISTS (SELECT 1 FROM po_cart_deliveries WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id AND state='counted')
 OR EXISTS (SELECT 1 FROM json_each(NEW.release_json) r WHERE json_type(r.value) IS NOT 'object'
  OR json_type(r.value,'$.lineId') IS NOT 'text' OR json_type(r.value,'$.releasePacks') IS NOT 'text'
  OR json_extract(r.value,'$.releasePacks') GLOB '*[^0-9]*' OR json_extract(r.value,'$.releasePacks') GLOB '0*'
  OR length(json_extract(r.value,'$.releasePacks')) NOT BETWEEN 1 AND 4
  OR (SELECT COUNT(*) FROM json_each(NEW.release_json) o WHERE json_extract(o.value,'$.lineId')=json_extract(r.value,'$.lineId'))!=1
  OR NOT EXISTS (SELECT 1 FROM po_cart_confirmations c, json_each(c.lines_json) l WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id
   AND json_extract(l.value,'$.lineId')=json_extract(r.value,'$.lineId') AND CAST(json_extract(l.value,'$.packs') AS INTEGER)>0)
  AND NOT EXISTS (SELECT 1 FROM po_cart_confirmations c, json_each(c.extras_json) x WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id
   AND 'extra-'||(x.key+1)=json_extract(r.value,'$.lineId')))
 OR EXISTS (SELECT 1 FROM (
   SELECT json_extract(l.value,'$.lineId') AS line_id,CAST(json_extract(l.value,'$.packs') AS INTEGER) AS packs
   FROM po_cart_confirmations c, json_each(c.lines_json) l WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id AND CAST(json_extract(l.value,'$.packs') AS INTEGER)>0
   UNION ALL
   SELECT 'extra-'||(x.key+1),CAST(json_extract(x.value,'$.packs') AS INTEGER)
   FROM po_cart_confirmations c, json_each(c.extras_json) x WHERE c.company_id=NEW.company_id AND c.id=NEW.confirmation_id) v
  WHERE v.packs!=COALESCE((SELECT SUM(CAST(json_extract(d.value,'$.acceptPacks') AS INTEGER)+CAST(json_extract(d.value,'$.releasePacks') AS INTEGER))
    FROM po_cart_deliveries p, json_each(p.decision_json) d WHERE p.company_id=NEW.company_id AND p.confirmation_id=NEW.confirmation_id
    AND p.state='approved' AND json_extract(d.value,'$.lineId')=v.line_id),0)
   +COALESCE((SELECT SUM(CAST(json_extract(r.value,'$.releasePacks') AS INTEGER)) FROM json_each(NEW.release_json) r WHERE json_extract(r.value,'$.lineId')=v.line_id),0))
 OR EXISTS (SELECT 1 FROM inventory_order_incoming WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id
  AND CAST(received_minor AS INTEGER)+CAST(released_minor AS INTEGER)!=CAST(quantity_minor AS INTEGER))
BEGIN SELECT RAISE(ABORT,'Invalid or stale order closure'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_commitment_release_guard;
--> statement-breakpoint
-- Unchanged from 0038, plus: an owner-approved over-cap confirmation releases the order's product holds.
CREATE TRIGGER po_cart_commitment_release_guard BEFORE UPDATE ON po_cart_commitments
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR NEW.product_id IS NOT OLD.product_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.quantity_json IS NOT OLD.quantity_json
 OR OLD.active!=1 OR NEW.active!=0
 OR (NOT EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND status IN ('canceled','invalidated') AND (started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.authorization_id AND r.action='abandonVerifiedCart' AND r.authorization_revision=po_cart_authorizations.revision-1 AND r.at=po_cart_authorizations.released_at)))
  AND NOT EXISTS (SELECT 1 FROM po_cart_confirmations c WHERE c.company_id=NEW.company_id AND c.authorization_id=NEW.authorization_id
   AND (c.state='confirmed' OR (c.state='needs_owner_review' AND EXISTS (SELECT 1 FROM po_cart_confirmation_reviews v WHERE v.company_id=c.company_id AND v.confirmation_id=c.id AND v.kind='approved')))))
BEGIN SELECT RAISE(ABORT,'Unsafe cart commitment release'); END;
