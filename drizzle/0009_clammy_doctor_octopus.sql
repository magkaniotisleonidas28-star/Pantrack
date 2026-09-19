CREATE TABLE `inventory_balances_exact` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`config_id` text NOT NULL,
	`dimension` text NOT NULL,
	`on_hand_minor` text NOT NULL,
	`incoming_minor` text NOT NULL,
	`estimated_used_minor` text NOT NULL,
	`version` integer NOT NULL,
	`latest_count_effective_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`config_id`) REFERENCES `inventory_config_versions`(`company_id`,`product_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_config_versions` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`stock_unit_id` text NOT NULL,
	`stock_unit_version` integer NOT NULL,
	`purchase_unit_label` text NOT NULL,
	`purchase_quantity_minor` text,
	`legacy_units_per_pack` text,
	`effective_from` text NOT NULL,
	`replaced_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`stock_unit_id`,`stock_unit_version`) REFERENCES `product_unit_versions`(`company_id`,`product_id`,`unit_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_config_company_product_version` ON `inventory_config_versions` (`company_id`,`product_id`,`version`);--> statement-breakpoint
CREATE INDEX `inventory_config_effective_lookup` ON `inventory_config_versions` (`company_id`,`product_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `inventory_consumption_applications` (
	`company_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`contract` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`occurred_at` text NOT NULL,
	`result_json` text NOT NULL,
	`applied_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `idempotency_key`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_events_exact` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`product_id` text NOT NULL,
	`config_id` text NOT NULL,
	`action` text NOT NULL,
	`dimension` text NOT NULL,
	`quantity_minor` text,
	`entered_amount` text,
	`entered_unit_id` text,
	`balance_version_before` integer NOT NULL,
	`balance_version_after` integer NOT NULL,
	`effective_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`actor` text NOT NULL,
	`note` text NOT NULL,
	`consumption_key` text,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`config_id`) REFERENCES `inventory_config_versions`(`company_id`,`product_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`consumption_key`) REFERENCES `inventory_consumption_applications`(`company_id`,`idempotency_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_events_exact_product_time` ON `inventory_events_exact` (`company_id`,`product_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `inventory_reconciliations` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`product_id` text NOT NULL,
	`config_id` text NOT NULL,
	`dimension` text,
	`measured_minor` text,
	`entered_amount` text NOT NULL,
	`entered_unit_id` text,
	`legacy_unit_label` text,
	`estimate_before_minor` text,
	`variance_minor` text,
	`effective_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`actor` text NOT NULL,
	`note` text NOT NULL,
	`opening` integer NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`config_id`) REFERENCES `inventory_config_versions`(`company_id`,`product_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_reconciliation_product_time` ON `inventory_reconciliations` (`company_id`,`product_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `product_unit_versions` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`dimension` text,
	`label` text NOT NULL,
	`numerator` text,
	`denominator` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`retired_at` text,
	PRIMARY KEY(`company_id`, `product_id`, `unit_id`, `version`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_lineages` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_modifier_deltas` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`version_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`unit_version` integer NOT NULL,
	`dimension` text NOT NULL,
	`quantity_minor` text NOT NULL,
	`entered_amount` text NOT NULL,
	`entered_unit_id` text NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `modifier_id`, `version_id`, `position`),
	FOREIGN KEY (`company_id`,`recipe_id`,`modifier_id`,`version_id`) REFERENCES `recipe_modifier_versions`(`company_id`,`recipe_id`,`modifier_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`unit_id`,`unit_version`) REFERENCES `product_unit_versions`(`company_id`,`product_id`,`unit_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_modifier_lineages` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `id`),
	FOREIGN KEY (`company_id`,`recipe_id`) REFERENCES `recipe_lineages`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_modifier_versions` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`active_from` text,
	`active_to` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `modifier_id`, `id`),
	FOREIGN KEY (`company_id`,`recipe_id`,`modifier_id`) REFERENCES `recipe_modifier_lineages`(`company_id`,`recipe_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modifier_version_company_recipe_modifier_number` ON `recipe_modifier_versions` (`company_id`,`recipe_id`,`modifier_id`,`version`);--> statement-breakpoint
CREATE INDEX `modifier_version_active_lookup` ON `recipe_modifier_versions` (`company_id`,`recipe_id`,`modifier_id`,`active_from`,`active_to`);--> statement-breakpoint
CREATE TABLE `recipe_version_ingredients` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`version_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text,
	`unit_version` integer,
	`dimension` text,
	`quantity_minor` text,
	`entered_amount` text NOT NULL,
	`entered_unit_id` text,
	`legacy_unit_label` text,
	PRIMARY KEY(`company_id`, `recipe_id`, `version_id`, `position`),
	FOREIGN KEY (`company_id`,`recipe_id`,`version_id`) REFERENCES `recipe_versions`(`company_id`,`recipe_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`,`unit_id`,`unit_version`) REFERENCES `product_unit_versions`(`company_id`,`product_id`,`unit_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_versions` (
	`company_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`active_from` text,
	`active_to` text,
	`legacy` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `recipe_id`, `id`),
	FOREIGN KEY (`company_id`,`recipe_id`) REFERENCES `recipe_lineages`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_version_company_recipe_number` ON `recipe_versions` (`company_id`,`recipe_id`,`version`);--> statement-breakpoint
CREATE INDEX `recipe_version_active_lookup` ON `recipe_versions` (`company_id`,`recipe_id`,`active_from`,`active_to`);--> statement-breakpoint

-- Preserve every existing stock-unit label without guessing its dimension.
INSERT INTO `product_unit_versions` (
	`company_id`,`product_id`,`unit_id`,`version`,`kind`,`dimension`,`label`,
	`numerator`,`denominator`,`created_by`,`created_at`,`retired_at`
)
SELECT
	i.`company_id`,i.`product_id`,'legacy-stock',1,'legacy_unclassified',NULL,
	COALESCE(CAST(json_extract(i.`data`,'$.settings.unit') AS text),''),
	NULL,NULL,'migration:0009',
	COALESCE(NULLIF(CAST(json_extract(i.`data`,'$.updated') AS text),''),'1970-01-01T00:00:00.000Z'),
	NULL
FROM `inventory` i;--> statement-breakpoint

-- Record a compatibility configuration. Canonical pack quantities remain null
-- until a manager classifies the legacy unit.
INSERT INTO `inventory_config_versions` (
	`company_id`,`product_id`,`id`,`version`,`status`,`stock_unit_id`,
	`stock_unit_version`,`purchase_unit_label`,`purchase_quantity_minor`,
	`legacy_units_per_pack`,`effective_from`,`replaced_at`,`created_by`,`created_at`
)
SELECT
	i.`company_id`,i.`product_id`,'legacy',1,'legacy_unclassified','legacy-stock',1,
	COALESCE((
		SELECT CAST(json_extract(p.`data`,'$.unit') AS text)
		FROM `products` p
		WHERE p.`owner`=i.`company_id` AND p.`id`=i.`product_id`
	),''),
	NULL,
	CAST(json_extract(i.`data`,'$.settings.unitsPerPack') AS text),
	'1970-01-01T00:00:00.000Z',NULL,'migration:0009',
	COALESCE(NULLIF(CAST(json_extract(i.`data`,'$.updated') AS text),''),'1970-01-01T00:00:00.000Z')
FROM `inventory` i;--> statement-breakpoint

-- Preserve recipe identities and their current JSON values as immutable legacy
-- version 1 records. Legacy versions remain ineligible for exact consumption.
INSERT INTO `recipe_lineages` (`company_id`,`id`,`created_by`,`created_at`)
SELECT r.`company_id`,r.`id`,'migration:0009','1970-01-01T00:00:00.000Z'
FROM `recipes` r;--> statement-breakpoint

INSERT INTO `recipe_versions` (
	`company_id`,`recipe_id`,`id`,`version`,`status`,`name`,`active_from`,
	`active_to`,`legacy`,`created_by`,`created_at`
)
SELECT
	r.`company_id`,r.`id`,'legacy',1,'active',
	COALESCE(CAST(json_extract(r.`data`,'$.name') AS text),''),
	'1970-01-01T00:00:00.000Z',NULL,1,'migration:0009','1970-01-01T00:00:00.000Z'
FROM `recipes` r;--> statement-breakpoint

INSERT INTO `recipe_version_ingredients` (
	`company_id`,`recipe_id`,`version_id`,`position`,`product_id`,`unit_id`,
	`unit_version`,`dimension`,`quantity_minor`,`entered_amount`,
	`entered_unit_id`,`legacy_unit_label`
)
SELECT
	r.`company_id`,r.`id`,'legacy',CAST(j.`key` AS integer),
	CAST(json_extract(j.`value`,'$.productId') AS text),
	CASE WHEN EXISTS(
		SELECT 1 FROM `product_unit_versions` u
		WHERE u.`company_id`=r.`company_id`
		AND u.`product_id`=CAST(json_extract(j.`value`,'$.productId') AS text)
		AND u.`unit_id`='legacy-stock' AND u.`version`=1
	) THEN 'legacy-stock' ELSE NULL END,
	CASE WHEN EXISTS(
		SELECT 1 FROM `product_unit_versions` u
		WHERE u.`company_id`=r.`company_id`
		AND u.`product_id`=CAST(json_extract(j.`value`,'$.productId') AS text)
		AND u.`unit_id`='legacy-stock' AND u.`version`=1
	) THEN 1 ELSE NULL END,
	NULL,NULL,
	COALESCE(CAST(json_extract(j.`value`,'$.quantity') AS text),''),
	NULL,
	CAST(json_extract(j.`value`,'$.unit') AS text)
FROM `recipes` r, json_each(r.`data`,'$.ingredients') j;--> statement-breakpoint

-- Existing count events have no estimate-before or variance. Preserve the
-- measured value and unit as legacy input, and mark only the earliest count for
-- each company/product as the opening reconciliation.
INSERT INTO `inventory_reconciliations` (
	`company_id`,`id`,`product_id`,`config_id`,`dimension`,`measured_minor`,
	`entered_amount`,`entered_unit_id`,`legacy_unit_label`,
	`estimate_before_minor`,`variance_minor`,`effective_at`,`recorded_at`,
	`actor`,`note`,`opening`
)
SELECT
	e.`company_id`,'legacy:' || e.`id`,e.`product_id`,'legacy',NULL,NULL,
	COALESCE(CAST(json_extract(e.`data`,'$.quantity') AS text),''),NULL,
	CAST(json_extract(i.`data`,'$.settings.unit') AS text),NULL,NULL,
	e.`created`,e.`created`,
	COALESCE(NULLIF(CAST(json_extract(e.`data`,'$.actor') AS text),''),'migration:0009'),
	COALESCE(CAST(json_extract(e.`data`,'$.note') AS text),''),
	CASE WHEN NOT EXISTS(
		SELECT 1 FROM `inventory_events` earlier
		WHERE earlier.`company_id`=e.`company_id`
		AND earlier.`product_id`=e.`product_id`
		AND json_extract(earlier.`data`,'$.action')='count'
		AND (earlier.`created`<e.`created` OR (earlier.`created`=e.`created` AND earlier.`id`<e.`id`))
	) THEN 1 ELSE 0 END
FROM `inventory_events` e
JOIN `inventory` i ON i.`company_id`=e.`company_id` AND i.`product_id`=e.`product_id`
WHERE json_extract(e.`data`,'$.action')='count';
