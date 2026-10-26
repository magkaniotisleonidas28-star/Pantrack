CREATE TABLE `po_cart_deliveries` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`confirmation_id` text NOT NULL,
	`job_id` text NOT NULL,
	`delivered_at` text NOT NULL,
	`count_json` text NOT NULL,
	`count_note` text NOT NULL,
	`counted_by` text NOT NULL,
	`counted_at` text NOT NULL,
	`count_operation_id` text NOT NULL,
	`count_fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`decision_json` text,
	`decision_note` text,
	`stock_receipt` integer,
	`decided_by` text,
	`decided_at` text,
	`decision_operation_id` text,
	`decision_fingerprint` text,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`confirmation_id`) REFERENCES `po_cart_confirmations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_delivery_count_operation` ON `po_cart_deliveries` (`company_id`,`count_operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_delivery_decision_operation` ON `po_cart_deliveries` (`company_id`,`decision_operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_delivery_one_pending` ON `po_cart_deliveries` (`company_id`,`confirmation_id`) WHERE "po_cart_deliveries"."state"='counted';--> statement-breakpoint
CREATE TABLE `po_cart_delivery_guards` (
	`reason` text NOT NULL
);
--> statement-breakpoint
-- An approval inserts a reason here only when its delivery stopped pending, which aborts its batch.
CREATE TRIGGER po_cart_delivery_guard_abort BEFORE INSERT ON po_cart_delivery_guards
BEGIN SELECT RAISE(ABORT,'The delivery changed; nothing was saved'); END;
--> statement-breakpoint
-- Any current company member may count a delivery for a confirmed, within-cap supplier order.
CREATE TRIGGER po_cart_delivery_insert_guard BEFORE INSERT ON po_cart_deliveries
WHEN NEW.state IS NOT 'counted' OR NEW.decision_json IS NOT NULL OR NEW.decision_note IS NOT NULL OR NEW.stock_receipt IS NOT NULL
 OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_operation_id IS NOT NULL OR NEW.decision_fingerprint IS NOT NULL
 OR json_valid(NEW.count_json)=0 OR json_type(NEW.count_json) IS NOT 'array' OR json_array_length(NEW.count_json)<1
 OR length(NEW.count_note)>1000 OR length(NEW.count_operation_id)<1 OR length(NEW.count_fingerprint)<1
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.counted_at) IS NOT NEW.counted_at
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.delivered_at) IS NOT NEW.delivered_at OR NEW.delivered_at>NEW.counted_at
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.counted_by AND role IN ('owner','manager','employee'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_confirmations WHERE company_id=NEW.company_id AND id=NEW.confirmation_id AND job_id=NEW.job_id AND state='confirmed')
BEGIN SELECT RAISE(ABORT,'Invalid delivery count'); END;
--> statement-breakpoint
-- A pending count is decided once by an owner or manager: approved (with its receipt posted in
-- the same batch when it moves stock) or sent back for a recount with a reason. The count itself
-- never changes.
CREATE TRIGGER po_cart_delivery_decision_guard BEFORE UPDATE ON po_cart_deliveries
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.job_id IS NOT OLD.job_id
 OR NEW.delivered_at IS NOT OLD.delivered_at OR NEW.count_json IS NOT OLD.count_json OR NEW.count_note IS NOT OLD.count_note
 OR NEW.counted_by IS NOT OLD.counted_by OR NEW.counted_at IS NOT OLD.counted_at
 OR NEW.count_operation_id IS NOT OLD.count_operation_id OR NEW.count_fingerprint IS NOT OLD.count_fingerprint
 OR OLD.state IS NOT 'counted' OR NEW.state NOT IN ('approved','recount')
 OR length(NEW.decision_operation_id)<1 OR length(NEW.decision_fingerprint)<1 OR NEW.decision_operation_id IS NULL OR NEW.decision_fingerprint IS NULL
 OR NEW.decision_note IS NULL OR length(NEW.decision_note)>1000
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.decided_at) IS NOT NEW.decided_at OR NEW.decided_at<NEW.counted_at
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.decided_by AND role IN ('owner','manager'))
 OR (NEW.state='recount' AND (NEW.decision_json IS NOT NULL OR NEW.stock_receipt IS NOT NULL OR length(trim(NEW.decision_note))<1))
 OR (NEW.state='approved' AND (json_valid(NEW.decision_json) IS NOT 1 OR json_type(NEW.decision_json) IS NOT 'array'
  OR typeof(NEW.stock_receipt)!='integer' OR NEW.stock_receipt NOT IN (0,1)
  OR (NEW.stock_receipt=1)!=EXISTS (SELECT 1 FROM inventory_order_receipts WHERE company_id=NEW.company_id AND receipt_id=NEW.id AND confirmation_id=NEW.confirmation_id)))
BEGIN SELECT RAISE(ABORT,'Invalid or stale delivery decision'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_deliveries_no_delete BEFORE DELETE ON po_cart_deliveries
BEGIN SELECT RAISE(ABORT,'Delivery counts are permanent'); END;
