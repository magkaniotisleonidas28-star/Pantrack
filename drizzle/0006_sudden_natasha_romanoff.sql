CREATE TABLE `clover_connections` (
	`company_id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`environment` text NOT NULL,
	`secret` text NOT NULL,
	`connected` text NOT NULL,
	`last_checked` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clover_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`environment` text NOT NULL,
	`expires` integer NOT NULL
);
