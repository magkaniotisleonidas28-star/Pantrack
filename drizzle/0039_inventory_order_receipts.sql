CREATE TABLE `inventory_order_receipts` (
	`company_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`confirmation_id` text NOT NULL,
	`line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`accepted_minor` text NOT NULL,
	`released_minor` text NOT NULL,
	`excess_minor` text NOT NULL,
	`stock_added` integer NOT NULL,
	`delivered_at` text NOT NULL,
	`event_id` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `receipt_id`, `line_id`),
	FOREIGN KEY (`company_id`,`confirmation_id`,`line_id`) REFERENCES `inventory_order_incoming`(`company_id`,`confirmation_id`,`line_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_order_receipts_line` ON `inventory_order_receipts` (`company_id`,`confirmation_id`,`line_id`);--> statement-breakpoint
ALTER TABLE `inventory_order_incoming` ADD `released_minor` text DEFAULT '0' NOT NULL;--> statement-breakpoint
-- A's receipt posting. Each approved receipt line is permanent; inserting it grows the order line's
-- received (accepted into stock) and released (will not arrive) totals, so the two always agree.
DROP TRIGGER inventory_order_incoming_insert_guard;
--> statement-breakpoint
CREATE TRIGGER inventory_order_incoming_insert_guard BEFORE INSERT ON inventory_order_incoming
WHEN NEW.quantity_minor NOT GLOB '[1-9]*' OR NEW.quantity_minor GLOB '*[^0-9]*' OR length(NEW.quantity_minor)>18
 OR NEW.received_minor IS NOT '0' OR NEW.released_minor IS NOT '0' OR NEW.dimension NOT IN ('count','mass','volume')
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at OR length(NEW.actor)<1
 OR NOT EXISTS (SELECT 1 FROM inventory_balances_exact WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND dimension=NEW.dimension)
BEGIN SELECT RAISE(ABORT,'Invalid order-linked incoming'); END;
--> statement-breakpoint
DROP TRIGGER inventory_order_incoming_update_guard;
--> statement-breakpoint
-- Only approved receipts change an order line, and its totals must equal its receipt ledger.
CREATE TRIGGER inventory_order_incoming_update_guard BEFORE UPDATE ON inventory_order_incoming
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.line_id IS NOT OLD.line_id
 OR NEW.product_id IS NOT OLD.product_id OR NEW.config_id IS NOT OLD.config_id OR NEW.dimension IS NOT OLD.dimension
 OR NEW.quantity_minor IS NOT OLD.quantity_minor OR NEW.event_id IS NOT OLD.event_id OR NEW.actor IS NOT OLD.actor OR NEW.created_at IS NOT OLD.created_at
 OR NEW.received_minor GLOB '*[^0-9]*' OR NEW.received_minor='' OR NEW.received_minor GLOB '0?*' OR length(NEW.received_minor)>18
 OR NEW.released_minor GLOB '*[^0-9]*' OR NEW.released_minor='' OR NEW.released_minor GLOB '0?*' OR length(NEW.released_minor)>18
 OR CAST(NEW.received_minor AS INTEGER)<CAST(OLD.received_minor AS INTEGER)
 OR CAST(NEW.released_minor AS INTEGER)<CAST(OLD.released_minor AS INTEGER)
 OR CAST(NEW.received_minor AS INTEGER)+CAST(NEW.released_minor AS INTEGER)>CAST(NEW.quantity_minor AS INTEGER)
 OR CAST(NEW.received_minor AS INTEGER) IS NOT (SELECT COALESCE(SUM(CAST(accepted_minor AS INTEGER)),0) FROM inventory_order_receipts
  WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id AND line_id=NEW.line_id)
 OR CAST(NEW.released_minor AS INTEGER) IS NOT (SELECT COALESCE(SUM(CAST(released_minor AS INTEGER)),0) FROM inventory_order_receipts
  WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id AND line_id=NEW.line_id)
BEGIN SELECT RAISE(ABORT,'Order-linked incoming is immutable except through approved receipts'); END;
--> statement-breakpoint
DROP TRIGGER inventory_balance_order_floor;
--> statement-breakpoint
-- Aggregate incoming may never drop below what confirmed orders still owe (confirmed minus received
-- minus released), and the unit dimension cannot change while they owe anything.
CREATE TRIGGER inventory_balance_order_floor BEFORE UPDATE ON inventory_balances_exact
WHEN EXISTS (SELECT 1 FROM inventory_order_incoming WHERE company_id=NEW.company_id AND product_id=NEW.product_id)
 AND (CAST(NEW.incoming_minor AS INTEGER)<(SELECT COALESCE(SUM(CAST(quantity_minor AS INTEGER)-CAST(received_minor AS INTEGER)-CAST(released_minor AS INTEGER)),0)
  FROM inventory_order_incoming WHERE company_id=NEW.company_id AND product_id=NEW.product_id)
  OR (NEW.dimension IS NOT OLD.dimension AND (SELECT COALESCE(SUM(CAST(quantity_minor AS INTEGER)-CAST(received_minor AS INTEGER)-CAST(released_minor AS INTEGER)),0)
  FROM inventory_order_incoming WHERE company_id=NEW.company_id AND product_id=NEW.product_id)>0))
BEGIN SELECT RAISE(ABORT,'Incoming cannot drop below confirmed supplier orders'); END;
--> statement-breakpoint
-- Amounts are canonical whole minors and at least one is positive. Excess (more than the order
-- owes) is allowed only when this receipt accepts the rest of the line and releases nothing.
CREATE TRIGGER inventory_order_receipt_insert_guard BEFORE INSERT ON inventory_order_receipts
WHEN NEW.accepted_minor GLOB '*[^0-9]*' OR NEW.accepted_minor='' OR NEW.accepted_minor GLOB '0?*' OR length(NEW.accepted_minor)>18
 OR NEW.released_minor GLOB '*[^0-9]*' OR NEW.released_minor='' OR NEW.released_minor GLOB '0?*' OR length(NEW.released_minor)>18
 OR NEW.excess_minor GLOB '*[^0-9]*' OR NEW.excess_minor='' OR NEW.excess_minor GLOB '0?*' OR length(NEW.excess_minor)>18
 OR (NEW.accepted_minor='0' AND NEW.released_minor='0' AND NEW.excess_minor='0')
 OR typeof(NEW.stock_added)!='integer' OR NEW.stock_added NOT IN (0,1)
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.delivered_at) IS NOT NEW.delivered_at OR NEW.delivered_at>NEW.created_at
 OR length(NEW.actor)<1 OR NEW.event_id IS NOT 'order-receipt:'||NEW.receipt_id||':'||NEW.product_id
 OR NOT EXISTS (SELECT 1 FROM inventory_order_incoming o WHERE o.company_id=NEW.company_id AND o.confirmation_id=NEW.confirmation_id
  AND o.line_id=NEW.line_id AND o.product_id=NEW.product_id
  AND CAST(o.received_minor AS INTEGER)+CAST(o.released_minor AS INTEGER)+CAST(NEW.accepted_minor AS INTEGER)+CAST(NEW.released_minor AS INTEGER)<=CAST(o.quantity_minor AS INTEGER)
  AND (NEW.excess_minor='0' OR (NEW.released_minor='0' AND NEW.accepted_minor!='0'
   AND CAST(o.received_minor AS INTEGER)+CAST(o.released_minor AS INTEGER)+CAST(NEW.accepted_minor AS INTEGER)=CAST(o.quantity_minor AS INTEGER))))
BEGIN SELECT RAISE(ABORT,'Invalid order receipt'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_order_receipt_apply AFTER INSERT ON inventory_order_receipts
BEGIN
 UPDATE inventory_order_incoming
 SET received_minor=CAST(CAST(received_minor AS INTEGER)+CAST(NEW.accepted_minor AS INTEGER) AS TEXT),
  released_minor=CAST(CAST(released_minor AS INTEGER)+CAST(NEW.released_minor AS INTEGER) AS TEXT)
 WHERE company_id=NEW.company_id AND confirmation_id=NEW.confirmation_id AND line_id=NEW.line_id;
END;
--> statement-breakpoint
CREATE TRIGGER inventory_order_receipts_no_update BEFORE UPDATE ON inventory_order_receipts
BEGIN SELECT RAISE(ABORT,'Order receipts are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_order_receipts_no_delete BEFORE DELETE ON inventory_order_receipts
BEGIN SELECT RAISE(ABORT,'Order receipts are permanent'); END;
