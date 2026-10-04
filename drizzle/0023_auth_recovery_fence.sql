CREATE TABLE `auth_fence` (
	`id` integer PRIMARY KEY NOT NULL,
	`epoch` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `epoch` integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `session_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `recovery_id` text;--> statement-breakpoint
ALTER TABLE `auth_users` ADD `recovery_until` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO `auth_fence` (`id`,`epoch`) VALUES (1,0);
--> statement-breakpoint
-- Existing sessions have no pre-exchange fence. Require a fresh sign-in;
-- preserve identities, memberships, company data and security history.
DELETE FROM `auth_sessions`;
