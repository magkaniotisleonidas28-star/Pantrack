CREATE TABLE `replenishment_proposal_origins` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`create_id` text NOT NULL,
	`product_id` text NOT NULL,
	`initial_status` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replenishment_proposal_create_id` ON `replenishment_proposal_origins` (`company_id`,`create_id`);--> statement-breakpoint
CREATE INDEX `replenishment_proposal_product` ON `replenishment_proposal_origins` (`company_id`,`product_id`);
--> statement-breakpoint
CREATE TRIGGER `replenishment_proposal_origin_no_update` BEFORE UPDATE ON `replenishment_proposal_origins`
BEGIN SELECT RAISE(ABORT, 'Replenishment proposal origins are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `replenishment_proposal_origin_no_delete` BEFORE DELETE ON `replenishment_proposal_origins`
BEGIN SELECT RAISE(ABORT, 'Replenishment proposal origins are immutable'); END;
