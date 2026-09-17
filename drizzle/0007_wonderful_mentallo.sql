CREATE TABLE `register_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`token_hash` text,
	`last_received` text
);
