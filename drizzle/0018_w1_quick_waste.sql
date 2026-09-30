CREATE TABLE `waste_shortcuts` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`config_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`shortcuts_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`),
	FOREIGN KEY (`company_id`,`product_id`,`config_id`) REFERENCES `inventory_config_versions`(`company_id`,`product_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waste_shortcuts_operation` ON `waste_shortcuts` (`company_id`,`operation_id`);--> statement-breakpoint
ALTER TABLE `inventory_events_exact` ADD `waste_reason` text;