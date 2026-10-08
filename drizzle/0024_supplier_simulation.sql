CREATE TABLE `supplier_simulation_approvals` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`id` text NOT NULL,
	`quote_id` text NOT NULL,
	`quote_fingerprint` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`actor` text NOT NULL,
	`approved_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`order_id`,`quote_id`) REFERENCES `supplier_simulation_quotes`(`company_id`,`order_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_simulation_events` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`detail_json` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`, `revision`),
	FOREIGN KEY (`company_id`,`operation_id`) REFERENCES `supplier_simulation_operations`(`company_id`,`operation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_event_operation` ON `supplier_simulation_events` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `supplier_simulation_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`order_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `supplier_simulation_orders`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_simulation_orders` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`source_json` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`quote_id` text,
	`approval_id` text,
	`send_operation_id` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_simulation_quotes` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`id` text NOT NULL,
	`quote_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `supplier_simulation_orders`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_quote_order_identity` ON `supplier_simulation_quotes` (`company_id`,`order_id`,`id`);--> statement-breakpoint
CREATE TABLE `supplier_simulation_reservations` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`day` text NOT NULL,
	`currency` text NOT NULL,
	`total_minor` integer NOT NULL,
	`state` text NOT NULL,
	`reserved_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `supplier_simulation_orders`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `supplier_daily_exposure` ON `supplier_simulation_reservations` (`company_id`,`currency`,`day`,`state`);--> statement-breakpoint
CREATE TABLE `supplier_simulation_source_holds` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`product_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`active` integer NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`, `proposal_id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `supplier_simulation_orders`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`proposal_id`) REFERENCES `replenishment_proposal_origins`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_active_source_hold` ON `supplier_simulation_source_holds` (`company_id`,`proposal_id`) WHERE "supplier_simulation_source_holds"."active"=1;--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_active_product_hold` ON `supplier_simulation_source_holds` (`company_id`,`product_id`) WHERE "supplier_simulation_source_holds"."active"=1;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_quotes_no_update BEFORE UPDATE ON supplier_simulation_quotes
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_quotes_no_delete BEFORE DELETE ON supplier_simulation_quotes
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_approvals_no_update BEFORE UPDATE ON supplier_simulation_approvals
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_approvals_no_delete BEFORE DELETE ON supplier_simulation_approvals
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_operations_no_update BEFORE UPDATE ON supplier_simulation_operations
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_operations_no_delete BEFORE DELETE ON supplier_simulation_operations
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_events_no_update BEFORE UPDATE ON supplier_simulation_events
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_events_no_delete BEFORE DELETE ON supplier_simulation_events
BEGIN SELECT RAISE(ABORT,'Supplier simulation evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER supplier_simulation_operation_guard BEFORE INSERT ON supplier_simulation_operations
WHEN NEW.write_guard!=1
BEGIN SELECT RAISE(ABORT,'Supplier simulation guard failed'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_order_insert_guard BEFORE INSERT ON supplier_simulation_orders
WHEN NEW.status!='awaiting_quote' OR NEW.revision!=1 OR NEW.quote_id IS NOT NULL OR NEW.approval_id IS NOT NULL OR NEW.send_operation_id IS NOT NULL OR NEW.external_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Invalid initial supplier simulation state'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_order_update_guard BEFORE UPDATE ON supplier_simulation_orders
WHEN NEW.company_id!=OLD.company_id OR NEW.id!=OLD.id OR NEW.source_json!=OLD.source_json OR NEW.created_at!=OLD.created_at
 OR NEW.revision!=OLD.revision+1
 OR NOT (
  (OLD.status IN ('awaiting_quote','awaiting_approval','approved') AND NEW.status IN ('awaiting_approval','canceled'))
  OR (OLD.status='awaiting_approval' AND NEW.status='approved')
  OR (OLD.status='approved' AND NEW.status='sending')
  OR (OLD.status IN ('sending','unknown') AND NEW.status IN ('unknown','accepted','rejected'))
 )
 OR (NEW.status IN ('awaiting_approval','approved','sending','unknown','accepted','rejected') AND NEW.quote_id IS NULL)
 OR (NEW.status IN ('approved','sending','unknown','accepted','rejected') AND NEW.approval_id IS NULL)
 OR (NEW.status IN ('sending','unknown','accepted','rejected') AND NEW.send_operation_id IS NULL)
BEGIN SELECT RAISE(ABORT,'Invalid supplier simulation transition'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_orders_no_delete BEFORE DELETE ON supplier_simulation_orders
BEGIN SELECT RAISE(ABORT,'Supplier simulation order history cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_reservation_insert_guard BEFORE INSERT ON supplier_simulation_reservations
WHEN NEW.currency!='USD' OR NEW.total_minor<0 OR NEW.total_minor>1000000000 OR NEW.state!='reserved'
BEGIN SELECT RAISE(ABORT,'Invalid supplier simulation reservation'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_reservation_update_guard BEFORE UPDATE ON supplier_simulation_reservations
WHEN NEW.company_id!=OLD.company_id OR NEW.order_id!=OLD.order_id OR NEW.day!=OLD.day OR NEW.currency!=OLD.currency
 OR NEW.total_minor!=OLD.total_minor OR NEW.reserved_at!=OLD.reserved_at OR OLD.state!='reserved' OR NEW.state NOT IN ('spent','released')
BEGIN SELECT RAISE(ABORT,'Invalid supplier simulation reservation transition'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_reservations_no_delete BEFORE DELETE ON supplier_simulation_reservations
BEGIN SELECT RAISE(ABORT,'Supplier simulation reservation history cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_hold_insert_guard BEFORE INSERT ON supplier_simulation_source_holds
WHEN NEW.active!=1 OR NEW.source_revision<1
BEGIN SELECT RAISE(ABORT,'Invalid supplier simulation source hold'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_hold_update_guard BEFORE UPDATE ON supplier_simulation_source_holds
WHEN NEW.company_id!=OLD.company_id OR NEW.order_id!=OLD.order_id OR NEW.proposal_id!=OLD.proposal_id OR NEW.product_id!=OLD.product_id OR NEW.source_revision!=OLD.source_revision OR OLD.active!=1 OR NEW.active!=0
BEGIN SELECT RAISE(ABORT,'Invalid supplier simulation source hold transition'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_simulation_source_holds_no_delete BEFORE DELETE ON supplier_simulation_source_holds
BEGIN SELECT RAISE(ABORT,'Supplier simulation source hold history cannot be deleted'); END;
