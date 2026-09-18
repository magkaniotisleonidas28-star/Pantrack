CREATE TABLE `audit_log` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text,
	`data` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`accepted_at` text,
	`accepted_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_invitations_token_hash_unique` ON `company_invitations` (`token_hash`);