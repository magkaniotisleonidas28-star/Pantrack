CREATE TABLE `clover_option_links` (
	`company_id` text NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`set_id` text NOT NULL,
	`choice_id` text NOT NULL,
	`modifier_name` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `environment`, `merchant_id`, `modifier_id`, `set_id`),
	FOREIGN KEY (`company_id`,`set_id`) REFERENCES `recipe_option_sets`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clover_option_link_set` ON `clover_option_links` (`company_id`,`set_id`);