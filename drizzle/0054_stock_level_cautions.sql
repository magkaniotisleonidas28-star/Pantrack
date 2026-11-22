CREATE TABLE `stock_level_cautions` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`caution` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_level_caution_value" CHECK("stock_level_cautions"."caution" IN ('lean','balanced','cautious'))
);
--> statement-breakpoint
CREATE TABLE `stock_level_ignores` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`level_minor` text NOT NULL,
	`ignored_by` text NOT NULL,
	`ignored_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_level_ignore_level" CHECK("stock_level_ignores"."level_minor" GLOB '[0-9]*' AND "stock_level_ignores"."level_minor" NOT GLOB '*[^0-9]*')
);
