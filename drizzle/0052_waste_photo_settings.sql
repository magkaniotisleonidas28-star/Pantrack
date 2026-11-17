CREATE TABLE `waste_photo_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "waste_photo_settings_enabled" CHECK("waste_photo_settings"."enabled" IN (0,1))
);
