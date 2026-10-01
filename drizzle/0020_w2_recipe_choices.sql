CREATE TABLE `inventory_setup_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_version_choices` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`version_id` text NOT NULL,
	`groups_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `version_id`),
	FOREIGN KEY (`company_id`,`recipe_id`,`version_id`) REFERENCES `recipe_versions`(`company_id`,`recipe_id`,`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TRIGGER recipe_choices_no_update BEFORE UPDATE ON recipe_version_choices
BEGIN SELECT RAISE(ABORT, 'Recipe choice history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recipe_choices_no_delete BEFORE DELETE ON recipe_version_choices
BEGIN SELECT RAISE(ABORT, 'Recipe choice history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER setup_operations_no_update BEFORE UPDATE ON inventory_setup_operations
BEGIN SELECT RAISE(ABORT, 'Setup save receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER setup_operations_no_delete BEFORE DELETE ON inventory_setup_operations
BEGIN SELECT RAISE(ABORT, 'Setup save receipts are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER setup_operation_guard BEFORE INSERT ON inventory_setup_operations
WHEN NEW.write_guard <> 1
BEGIN SELECT RAISE(ABORT, 'inventory_setup_write_guard'); END;
