CREATE TABLE `waste_suggestions` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`actor` text NOT NULL,
	`fingerprint` text NOT NULL,
	`note` text NOT NULL,
	`status` text NOT NULL,
	`provider` text,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	`entries_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`outcome` text,
	`outcome_at` text,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "waste_suggestion_status" CHECK("waste_suggestions"."status" IN ('pending','suggested','empty','failed')),
	CONSTRAINT "waste_suggestion_outcome" CHECK("waste_suggestions"."outcome" IS NULL OR "waste_suggestions"."outcome" IN ('confirmed','edited','discarded'))
);
--> statement-breakpoint
CREATE INDEX `waste_suggestion_company_created` ON `waste_suggestions` (`company_id`,`created_at`);