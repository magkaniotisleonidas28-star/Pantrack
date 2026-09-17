CREATE TABLE `payment_customers` (
	`company_id` text NOT NULL,
	`provider_scope` text NOT NULL,
	`customer_id` text NOT NULL,
	PRIMARY KEY(`company_id`, `provider_scope`)
);
