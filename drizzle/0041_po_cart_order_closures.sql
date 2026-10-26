CREATE TABLE `po_cart_order_closures` (
	`company_id` text NOT NULL,
	`confirmation_id` text NOT NULL,
	`job_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`kind` text NOT NULL,
	`release_json` text NOT NULL,
	`stock_receipt` integer NOT NULL,
	`note` text NOT NULL,
	`closed_by` text NOT NULL,
	`closed_at` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`company_id`, `confirmation_id`),
	FOREIGN KEY (`company_id`,`confirmation_id`) REFERENCES `po_cart_confirmations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_order_closure_operation` ON `po_cart_order_closures` (`company_id`,`operation_id`);--> statement-breakpoint
-- An owner or manager closes a confirmed order once, with no count waiting for review:
-- 'complete' when approved deliveries resolve every receivable line, or 'closed_short' with a
-- reason when the closure itself marks the rest as not arriving (its stock part posted through
-- the receipt port in the same batch). Afterwards no order line or incoming stock is still owed.
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
  AND c.state='confirmed' AND c.created_at<=NEW.closed_at AND r.state='reserved')
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
-- Closing frees the order's in-progress hold. Daily and monthly limits keep counting its cap.
CREATE TRIGGER po_cart_order_closure_settle AFTER INSERT ON po_cart_order_closures
BEGIN
 UPDATE po_cart_reservations SET state='settled' WHERE company_id=NEW.company_id AND authorization_id=NEW.authorization_id AND state='reserved';
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_order_closures_no_update BEFORE UPDATE ON po_cart_order_closures
BEGIN SELECT RAISE(ABORT,'Order closures are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_order_closures_no_delete BEFORE DELETE ON po_cart_order_closures
BEGIN SELECT RAISE(ABORT,'Order closures are permanent'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_reservation_release_guard;
--> statement-breakpoint
-- Unchanged from 0033, plus: a held reservation may instead become 'settled' once its order is closed.
CREATE TRIGGER po_cart_reservation_release_guard BEFORE UPDATE ON po_cart_reservations
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.total_minor IS NOT OLD.total_minor
 OR OLD.state!='reserved'
 OR NOT ((NEW.state='released' AND EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND status IN ('canceled','invalidated') AND (started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.authorization_id AND r.action='abandonVerifiedCart' AND r.authorization_revision=po_cart_authorizations.revision-1 AND r.at=po_cart_authorizations.released_at))))
  OR (NEW.state='settled' AND EXISTS (SELECT 1 FROM po_cart_order_closures WHERE company_id=NEW.company_id AND authorization_id=NEW.authorization_id)))
BEGIN SELECT RAISE(ABORT,'Unsafe cart exposure release'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_delivery_insert_guard;
--> statement-breakpoint
-- Unchanged from 0040, plus: a closed order takes no more counts.
CREATE TRIGGER po_cart_delivery_insert_guard BEFORE INSERT ON po_cart_deliveries
WHEN NEW.state IS NOT 'counted' OR NEW.decision_json IS NOT NULL OR NEW.decision_note IS NOT NULL OR NEW.stock_receipt IS NOT NULL
 OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_operation_id IS NOT NULL OR NEW.decision_fingerprint IS NOT NULL
 OR json_valid(NEW.count_json)=0 OR json_type(NEW.count_json) IS NOT 'array' OR json_array_length(NEW.count_json)<1
 OR length(NEW.count_note)>1000 OR length(NEW.count_operation_id)<1 OR length(NEW.count_fingerprint)<1
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.counted_at) IS NOT NEW.counted_at
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.delivered_at) IS NOT NEW.delivered_at OR NEW.delivered_at>NEW.counted_at
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.counted_by AND role IN ('owner','manager','employee'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_confirmations WHERE company_id=NEW.company_id AND id=NEW.confirmation_id AND job_id=NEW.job_id AND state='confirmed')
 OR EXISTS (SELECT 1 FROM po_cart_order_closures WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id)
BEGIN SELECT RAISE(ABORT,'Invalid delivery count'); END;
