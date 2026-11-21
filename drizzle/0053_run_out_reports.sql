CREATE TABLE `run_out_reports` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`product_id` text NOT NULL,
	`reported_by` text NOT NULL,
	`reporter_email` text NOT NULL,
	`note` text NOT NULL,
	`reported_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_out_report_note" CHECK(length("run_out_reports"."note") <= 200)
);
--> statement-breakpoint
CREATE INDEX `run_out_report_company_product` ON `run_out_reports` (`company_id`,`product_id`,`reported_at`);--> statement-breakpoint
CREATE TABLE `run_out_resolutions` (
	`company_id` text NOT NULL,
	`report_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`outcome` text NOT NULL,
	`count_id` text,
	`resolved_by` text NOT NULL,
	`resolved_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `report_id`),
	FOREIGN KEY (`company_id`,`report_id`) REFERENCES `run_out_reports`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "run_out_resolution_outcome" CHECK("run_out_resolutions"."outcome" IN ('confirmed','dismissed')),
	CONSTRAINT "run_out_resolution_count" CHECK(("run_out_resolutions"."outcome" = 'confirmed') = ("run_out_resolutions"."count_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `run_out_resolution_operation` ON `run_out_resolutions` (`company_id`,`operation_id`);