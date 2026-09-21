CREATE UNIQUE INDEX `inventory_config_one_active` ON `inventory_config_versions` (`company_id`,`product_id`) WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `modifier_version_one_active` ON `recipe_modifier_versions` (`company_id`,`recipe_id`,`modifier_id`) WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_version_one_active` ON `recipe_versions` (`company_id`,`recipe_id`) WHERE status = 'active';--> statement-breakpoint

CREATE TRIGGER `recipe_version_immutable_update`
BEFORE UPDATE ON `recipe_versions`
WHEN OLD.`status` <> 'draft' AND NOT (
	OLD.`status` = 'active' AND NEW.`status` = 'archived'
	AND NEW.`company_id` IS OLD.`company_id` AND NEW.`recipe_id` IS OLD.`recipe_id`
	AND NEW.`id` IS OLD.`id` AND NEW.`version` IS OLD.`version`
	AND NEW.`name` IS OLD.`name` AND NEW.`active_from` IS OLD.`active_from`
	AND NEW.`active_to` IS NOT NULL AND OLD.`active_to` IS NULL
	AND NEW.`legacy` IS OLD.`legacy` AND NEW.`created_by` IS OLD.`created_by`
	AND NEW.`created_at` IS OLD.`created_at`
)
BEGIN
	SELECT RAISE(ABORT, 'Activated recipe versions are immutable');
END;--> statement-breakpoint

CREATE TRIGGER `recipe_version_immutable_delete`
BEFORE DELETE ON `recipe_versions`
WHEN OLD.`status` <> 'draft'
BEGIN
	SELECT RAISE(ABORT, 'Activated recipe versions cannot be deleted');
END;--> statement-breakpoint

CREATE TRIGGER `recipe_ingredient_draft_insert`
BEFORE INSERT ON `recipe_version_ingredients`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_versions` v
	WHERE v.`company_id`=NEW.`company_id` AND v.`recipe_id`=NEW.`recipe_id`
		AND v.`id`=NEW.`version_id` AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Recipe ingredients may be added only to drafts');
END;--> statement-breakpoint

CREATE TRIGGER `recipe_ingredient_draft_update`
BEFORE UPDATE ON `recipe_version_ingredients`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_versions` v
	WHERE v.`company_id`=OLD.`company_id` AND v.`recipe_id`=OLD.`recipe_id`
		AND v.`id`=OLD.`version_id` AND v.`status`='draft'
) OR NOT EXISTS (
	SELECT 1 FROM `recipe_versions` v
	WHERE v.`company_id`=NEW.`company_id` AND v.`recipe_id`=NEW.`recipe_id`
		AND v.`id`=NEW.`version_id` AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Recipe ingredients may be changed only on drafts');
END;--> statement-breakpoint

CREATE TRIGGER `recipe_ingredient_draft_delete`
BEFORE DELETE ON `recipe_version_ingredients`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_versions` v
	WHERE v.`company_id`=OLD.`company_id` AND v.`recipe_id`=OLD.`recipe_id`
		AND v.`id`=OLD.`version_id` AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Recipe ingredients may be deleted only from drafts');
END;--> statement-breakpoint

CREATE TRIGGER `modifier_version_immutable_update`
BEFORE UPDATE ON `recipe_modifier_versions`
WHEN OLD.`status` <> 'draft' AND NOT (
	OLD.`status` = 'active' AND NEW.`status` = 'archived'
	AND NEW.`company_id` IS OLD.`company_id` AND NEW.`recipe_id` IS OLD.`recipe_id`
	AND NEW.`modifier_id` IS OLD.`modifier_id` AND NEW.`id` IS OLD.`id`
	AND NEW.`version` IS OLD.`version` AND NEW.`active_from` IS OLD.`active_from`
	AND NEW.`active_to` IS NOT NULL AND OLD.`active_to` IS NULL
	AND NEW.`created_by` IS OLD.`created_by` AND NEW.`created_at` IS OLD.`created_at`
)
BEGIN
	SELECT RAISE(ABORT, 'Activated modifier versions are immutable');
END;--> statement-breakpoint

CREATE TRIGGER `modifier_version_immutable_delete`
BEFORE DELETE ON `recipe_modifier_versions`
WHEN OLD.`status` <> 'draft'
BEGIN
	SELECT RAISE(ABORT, 'Activated modifier versions cannot be deleted');
END;--> statement-breakpoint

CREATE TRIGGER `modifier_delta_draft_insert`
BEFORE INSERT ON `recipe_modifier_deltas`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_modifier_versions` v
	WHERE v.`company_id`=NEW.`company_id` AND v.`recipe_id`=NEW.`recipe_id`
		AND v.`modifier_id`=NEW.`modifier_id` AND v.`id`=NEW.`version_id`
		AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Modifier deltas may be added only to drafts');
END;--> statement-breakpoint

CREATE TRIGGER `modifier_delta_draft_update`
BEFORE UPDATE ON `recipe_modifier_deltas`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_modifier_versions` v
	WHERE v.`company_id`=OLD.`company_id` AND v.`recipe_id`=OLD.`recipe_id`
		AND v.`modifier_id`=OLD.`modifier_id` AND v.`id`=OLD.`version_id`
		AND v.`status`='draft'
) OR NOT EXISTS (
	SELECT 1 FROM `recipe_modifier_versions` v
	WHERE v.`company_id`=NEW.`company_id` AND v.`recipe_id`=NEW.`recipe_id`
		AND v.`modifier_id`=NEW.`modifier_id` AND v.`id`=NEW.`version_id`
		AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Modifier deltas may be changed only on drafts');
END;--> statement-breakpoint

CREATE TRIGGER `modifier_delta_draft_delete`
BEFORE DELETE ON `recipe_modifier_deltas`
WHEN NOT EXISTS (
	SELECT 1 FROM `recipe_modifier_versions` v
	WHERE v.`company_id`=OLD.`company_id` AND v.`recipe_id`=OLD.`recipe_id`
		AND v.`modifier_id`=OLD.`modifier_id` AND v.`id`=OLD.`version_id`
		AND v.`status`='draft'
)
BEGIN
	SELECT RAISE(ABORT, 'Modifier deltas may be deleted only from drafts');
END;
