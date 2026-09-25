CREATE TABLE `clover_item_mappings` (
	`company_id` text NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	PRIMARY KEY(`company_id`, `environment`, `merchant_id`, `item_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clover_modifier_mappings` (
	`company_id` text NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`inventory_modifier_id` text NOT NULL,
	PRIMARY KEY(`company_id`, `environment`, `merchant_id`, `item_id`, `modifier_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clover_sync_state` (
	`company_id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`checkpoint` integer NOT NULL,
	`last_attempt` text,
	`last_success` text,
	`last_error` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clover_merchant_one_company` ON `clover_connections` (`environment`,`merchant_id`);