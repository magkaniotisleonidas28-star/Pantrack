CREATE TABLE `company_preferences` (
	`company_id` text PRIMARY KEY NOT NULL,
	`measurement_system` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "company_preference_measurement_system" CHECK("company_preferences"."measurement_system" IN ('us','metric'))
);
