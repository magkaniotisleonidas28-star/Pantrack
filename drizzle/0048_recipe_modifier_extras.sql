CREATE TABLE `recipe_modifier_extras` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`version_id` text NOT NULL,
	`group_id` text NOT NULL,
	`percent` integer NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `modifier_id`, `version_id`),
	FOREIGN KEY (`company_id`,`recipe_id`,`modifier_id`,`version_id`) REFERENCES `recipe_modifier_versions`(`company_id`,`recipe_id`,`modifier_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_modifier_extra_percent" CHECK("recipe_modifier_extras"."percent" BETWEEN 1 AND 100)
);

--> statement-breakpoint
CREATE TRIGGER `modifier_extra_draft_insert`
BEFORE INSERT ON `recipe_modifier_extras`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_modifier_versions` v
	WHERE v.`company_id`=NEW.`company_id` AND v.`recipe_id`=NEW.`recipe_id`
		AND v.`modifier_id`=NEW.`modifier_id` AND v.`id`=NEW.`version_id`
		AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Modifier extras may be added only to drafts');
END;
--> statement-breakpoint
CREATE TRIGGER `modifier_extra_no_update`
BEFORE UPDATE ON `recipe_modifier_extras`
BEGIN
	SELECT RAISE(ABORT, 'Modifier extras are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `modifier_extra_draft_delete`
BEFORE DELETE ON `recipe_modifier_extras`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_modifier_versions` v
	WHERE v.`company_id`=OLD.`company_id` AND v.`recipe_id`=OLD.`recipe_id`
		AND v.`modifier_id`=OLD.`modifier_id` AND v.`id`=OLD.`version_id`
		AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Modifier extras may be deleted only from drafts');
END;
