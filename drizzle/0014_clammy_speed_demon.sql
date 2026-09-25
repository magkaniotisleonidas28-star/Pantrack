CREATE TABLE `replenishment_settings_versions` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`version` integer NOT NULL,
	`change_id` text NOT NULL,
	`inventory_config_id` text NOT NULL,
	`inventory_config_version` integer NOT NULL,
	`dimension` text NOT NULL,
	`settings_json` text NOT NULL,
	`changed_by` text NOT NULL,
	`change_reason` text NOT NULL,
	`changed_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`, `version`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`inventory_config_id`) REFERENCES `inventory_config_versions`(`company_id`,`product_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replenishment_settings_change_id` ON `replenishment_settings_versions` (`company_id`,`product_id`,`change_id`);
--> statement-breakpoint
CREATE TRIGGER `replenishment_settings_no_update` BEFORE UPDATE ON `replenishment_settings_versions`
BEGIN SELECT RAISE(ABORT, 'Replenishment settings history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `replenishment_settings_no_delete` BEFORE DELETE ON `replenishment_settings_versions`
BEGIN SELECT RAISE(ABORT, 'Replenishment settings history is immutable'); END;
