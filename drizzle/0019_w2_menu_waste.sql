CREATE TABLE `waste_entries` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`request_json` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`item_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`reason` text NOT NULL,
	`mode` text NOT NULL,
	`actor` text NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text NOT NULL,
	`claim_token` text NOT NULL,
	`consumption_key` text,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`consumption_key`) REFERENCES `inventory_consumption_applications`(`company_id`,`idempotency_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `waste_entry_company_time` ON `waste_entries` (`company_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `waste_menu_products` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`offered` integer NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`),
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waste_menu_product_operation` ON `waste_menu_products` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `waste_sale_allocations` (
	`company_id` text NOT NULL,
	`application_key` text NOT NULL,
	`line_id` text NOT NULL,
	`capacity` integer NOT NULL,
	`claimed` integer NOT NULL,
	PRIMARY KEY(`company_id`, `application_key`, `line_id`),
	FOREIGN KEY (`company_id`,`application_key`) REFERENCES `inventory_consumption_applications`(`company_id`,`idempotency_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `waste_sale_links` (
	`company_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`application_key` text NOT NULL,
	`line_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`claim_token` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `entry_id`),
	FOREIGN KEY (`company_id`,`entry_id`) REFERENCES `waste_entries`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`application_key`,`line_id`) REFERENCES `waste_sale_allocations`(`company_id`,`application_key`,`line_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waste_sale_link_operation` ON `waste_sale_links` (`company_id`,`operation_id`);
--> statement-breakpoint
CREATE TRIGGER waste_entries_no_update BEFORE UPDATE ON waste_entries BEGIN SELECT RAISE(ABORT, 'Waste entries are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER waste_entries_no_delete BEFORE DELETE ON waste_entries BEGIN SELECT RAISE(ABORT, 'Waste entries are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER waste_sale_links_no_update BEFORE UPDATE ON waste_sale_links BEGIN SELECT RAISE(ABORT, 'Waste links are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER waste_sale_links_no_delete BEFORE DELETE ON waste_sale_links BEGIN SELECT RAISE(ABORT, 'Waste links are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER waste_allocation_insert_bounds BEFORE INSERT ON waste_sale_allocations
WHEN NEW.capacity <= 0 OR NEW.claimed < 0 OR NEW.claimed > NEW.capacity
BEGIN SELECT RAISE(ABORT, 'Invalid waste allocation bounds'); END;
--> statement-breakpoint
CREATE TRIGGER waste_allocation_update_bounds BEFORE UPDATE ON waste_sale_allocations
WHEN NEW.company_id <> OLD.company_id OR NEW.application_key <> OLD.application_key OR NEW.line_id <> OLD.line_id
 OR NEW.capacity <> OLD.capacity OR NEW.claimed < OLD.claimed OR NEW.claimed > NEW.capacity
BEGIN SELECT RAISE(ABORT, 'Invalid waste allocation update'); END;
--> statement-breakpoint
CREATE TRIGGER waste_allocation_no_delete BEFORE DELETE ON waste_sale_allocations
BEGIN SELECT RAISE(ABORT, 'Waste allocations are immutable'); END;
