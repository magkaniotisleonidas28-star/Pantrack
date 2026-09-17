CREATE TABLE `automation_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`last_run` text,
	`scheduler_hash` text,
	`lease_until` text
);
--> statement-breakpoint
CREATE TABLE `purchasing_jobs` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`spend_day` text,
	`amount` integer NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`company_id`, `fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `vendor_connections` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`company_id`, `id`)
);
