CREATE TABLE `sales_event_correction_adjustments` (
	`company_id` text NOT NULL,
	`correction_id` text NOT NULL,
	`inventory_event_id` text NOT NULL,
	`product_id` text NOT NULL,
	`dimension` text NOT NULL,
	`quantity_minor` text NOT NULL,
	`balance_version_before` integer NOT NULL,
	`balance_version_after` integer NOT NULL,
	PRIMARY KEY(`company_id`, `correction_id`, `product_id`),
	FOREIGN KEY (`company_id`,`correction_id`) REFERENCES `sales_event_corrections`(`company_id`,`correction_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`inventory_event_id`) REFERENCES `inventory_events_exact`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_correction_inventory_event` ON `sales_event_correction_adjustments` (`company_id`,`inventory_event_id`);--> statement-breakpoint
CREATE TABLE `sales_event_correction_items` (
	`company_id` text NOT NULL,
	`correction_id` text NOT NULL,
	`product_id` text NOT NULL,
	`dimension` text NOT NULL,
	`suggested_minor` text NOT NULL,
	`approved_minor` text NOT NULL,
	`expected_balance_version` integer NOT NULL,
	PRIMARY KEY(`company_id`, `correction_id`, `product_id`),
	FOREIGN KEY (`company_id`,`correction_id`) REFERENCES `sales_event_corrections`(`company_id`,`correction_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales_event_correction_results` (
	`company_id` text NOT NULL,
	`correction_id` text NOT NULL,
	`result_json` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`applied_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `correction_id`),
	FOREIGN KEY (`company_id`,`correction_id`) REFERENCES `sales_event_corrections`(`company_id`,`correction_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales_event_occurrence_confirmations` (
	`company_id` text NOT NULL,
	`event_key` text NOT NULL,
	`occurred_at` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`confirmed_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `event_key`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
