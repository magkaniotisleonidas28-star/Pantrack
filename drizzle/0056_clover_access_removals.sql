CREATE TABLE `clover_access_removals` (
	`company_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`reason` text NOT NULL,
	`removed_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clover_access_removal_reason" CHECK("clover_access_removals"."reason" IN ('app_removed','access_refused'))
);
