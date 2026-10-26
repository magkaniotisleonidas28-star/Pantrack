CREATE TABLE `inventory_order_incoming` (
	`company_id` text NOT NULL,
	`confirmation_id` text NOT NULL,
	`line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`config_id` text NOT NULL,
	`dimension` text NOT NULL,
	`quantity_minor` text NOT NULL,
	`received_minor` text NOT NULL,
	`event_id` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `confirmation_id`, `line_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`config_id`) REFERENCES `inventory_config_versions`(`company_id`,`product_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_order_incoming_product` ON `inventory_order_incoming` (`company_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `inventory_port_guards` (
	`reason` text NOT NULL
);
--> statement-breakpoint
-- A's order-linked incoming port. Guarded port statements insert a reason here only when a
-- precondition fails, which aborts the caller's whole batch.
CREATE TRIGGER inventory_port_guard_abort BEFORE INSERT ON inventory_port_guards
BEGIN SELECT RAISE(ABORT,'Inventory changed; nothing was saved'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_order_incoming_insert_guard BEFORE INSERT ON inventory_order_incoming
WHEN NEW.quantity_minor NOT GLOB '[1-9]*' OR NEW.quantity_minor GLOB '*[^0-9]*' OR length(NEW.quantity_minor)>18
 OR NEW.received_minor IS NOT '0' OR NEW.dimension NOT IN ('count','mass','volume')
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at OR length(NEW.actor)<1
 OR NOT EXISTS (SELECT 1 FROM inventory_balances_exact WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND dimension=NEW.dimension)
BEGIN SELECT RAISE(ABORT,'Invalid order-linked incoming'); END;
--> statement-breakpoint
-- Only later receiving may grow received, never past the confirmed quantity.
CREATE TRIGGER inventory_order_incoming_update_guard BEFORE UPDATE ON inventory_order_incoming
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.line_id IS NOT OLD.line_id
 OR NEW.product_id IS NOT OLD.product_id OR NEW.config_id IS NOT OLD.config_id OR NEW.dimension IS NOT OLD.dimension
 OR NEW.quantity_minor IS NOT OLD.quantity_minor OR NEW.event_id IS NOT OLD.event_id OR NEW.actor IS NOT OLD.actor OR NEW.created_at IS NOT OLD.created_at
 OR NEW.received_minor GLOB '*[^0-9]*' OR NEW.received_minor='' OR length(NEW.received_minor)>18
 OR CAST(NEW.received_minor AS INTEGER)<CAST(OLD.received_minor AS INTEGER)
 OR CAST(NEW.received_minor AS INTEGER)>CAST(NEW.quantity_minor AS INTEGER)
BEGIN SELECT RAISE(ABORT,'Order-linked incoming is immutable except for receiving'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_order_incoming_no_delete BEFORE DELETE ON inventory_order_incoming
BEGIN SELECT RAISE(ABORT,'Order-linked incoming is immutable except for receiving'); END;
--> statement-breakpoint
-- Aggregate incoming may never drop below what confirmed orders still owe, and the unit
-- dimension cannot change while they owe anything.
CREATE TRIGGER inventory_balance_order_floor BEFORE UPDATE ON inventory_balances_exact
WHEN EXISTS (SELECT 1 FROM inventory_order_incoming WHERE company_id=NEW.company_id AND product_id=NEW.product_id)
 AND (CAST(NEW.incoming_minor AS INTEGER)<(SELECT COALESCE(SUM(CAST(quantity_minor AS INTEGER)-CAST(received_minor AS INTEGER)),0) FROM inventory_order_incoming
  WHERE company_id=NEW.company_id AND product_id=NEW.product_id)
  OR (NEW.dimension IS NOT OLD.dimension AND (SELECT COALESCE(SUM(CAST(quantity_minor AS INTEGER)-CAST(received_minor AS INTEGER)),0) FROM inventory_order_incoming
  WHERE company_id=NEW.company_id AND product_id=NEW.product_id)>0))
BEGIN SELECT RAISE(ABORT,'Incoming cannot drop below confirmed supplier orders'); END;

