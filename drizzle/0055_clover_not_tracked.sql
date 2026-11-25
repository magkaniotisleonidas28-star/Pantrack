CREATE TABLE `clover_not_tracked` (
	`company_id` text NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text,
	`marked_by` text NOT NULL,
	`marked_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `environment`, `merchant_id`, `kind`, `external_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clover_not_tracked_kind" CHECK("clover_not_tracked"."kind" IN ('item','option'))
);
--> statement-breakpoint
CREATE TABLE `clover_not_tracked_changes` (
	`company_id` text NOT NULL,
	`change_id` text NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `change_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clover_not_tracked_change_kind" CHECK("clover_not_tracked_changes"."kind" IN ('item','option')),
	CONSTRAINT "clover_not_tracked_change_action" CHECK("clover_not_tracked_changes"."action" IN ('mark','unmark'))
);
--> statement-breakpoint
CREATE INDEX `clover_not_tracked_change_history` ON `clover_not_tracked_changes` (`company_id`,`environment`,`merchant_id`,`at`);