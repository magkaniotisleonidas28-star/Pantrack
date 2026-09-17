CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`user_id`, `company_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `removed_orders` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`removed_by` text NOT NULL,
	`removed_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`)
);
