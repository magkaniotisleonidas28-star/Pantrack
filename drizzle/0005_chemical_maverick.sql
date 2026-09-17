CREATE TABLE `register_mappings` (
	`company_id` text NOT NULL,
	`external_key` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`company_id`, `external_key`)
);
