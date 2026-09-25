CREATE TABLE `clover_webhook_challenges` (
	`company_id` text PRIMARY KEY NOT NULL,
	`code_encrypted` text NOT NULL,
	`captured_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
