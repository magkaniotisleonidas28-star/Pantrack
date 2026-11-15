CREATE TABLE `recipe_option_links` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`set_id` text NOT NULL,
	`position` integer NOT NULL,
	`overrides_json` text NOT NULL,
	`applied_revision` integer,
	`linked_by` text NOT NULL,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `set_id`),
	FOREIGN KEY (`company_id`,`recipe_id`) REFERENCES `recipe_lineages`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`set_id`) REFERENCES `recipe_option_sets`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_option_link_set` ON `recipe_option_links` (`company_id`,`set_id`);--> statement-breakpoint
CREATE TABLE `recipe_option_set_revisions` (
	`company_id` text NOT NULL,
	`set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`choices_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `set_id`, `revision`),
	FOREIGN KEY (`company_id`,`set_id`) REFERENCES `recipe_option_sets`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_option_set_revision_operation` ON `recipe_option_set_revisions` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `recipe_option_sets` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`revision` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`choices_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_option_set_kind" CHECK("recipe_option_sets"."kind" IN ('one','addons'))
);
