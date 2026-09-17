CREATE TABLE `inventory` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_events` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`product_id` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `sales_imports` (
	`company_id` text NOT NULL,
	`reference` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`company_id`, `reference`)
);
