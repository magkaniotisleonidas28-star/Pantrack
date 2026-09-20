CREATE TABLE `sales_event_attempt_results` (
	`company_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`event_key` text NOT NULL,
	`completed_at` text NOT NULL,
	`outcome` text NOT NULL,
	`held_reasons_json` text,
	`issues_json` text,
	`inventory_result_json` text,
	`error_code` text,
	PRIMARY KEY(`company_id`, `attempt_id`),
	FOREIGN KEY (`company_id`,`attempt_id`) REFERENCES `sales_event_attempts`(`company_id`,`attempt_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_attempt_result_history` ON `sales_event_attempt_results` (`company_id`,`event_key`,`completed_at`);--> statement-breakpoint
CREATE TABLE `sales_event_attempts` (
	`company_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`event_key` text NOT NULL,
	`started_at` text NOT NULL,
	`lease_expires_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `attempt_id`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_attempt_history` ON `sales_event_attempts` (`company_id`,`event_key`,`started_at`);--> statement-breakpoint
CREATE TABLE `sales_event_audits` (
	`company_id` text NOT NULL,
	`audit_id` text NOT NULL,
	`event_key` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	`reason` text,
	`conflict_id` text,
	PRIMARY KEY(`company_id`, `audit_id`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`conflict_id`) REFERENCES `sales_event_conflicts`(`company_id`,`conflict_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_audit_history` ON `sales_event_audits` (`company_id`,`event_key`,`at`);--> statement-breakpoint
CREATE TABLE `sales_event_conflict_resolutions` (
	`company_id` text NOT NULL,
	`resolution_id` text NOT NULL,
	`conflict_id` text NOT NULL,
	`canonical_event_key` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `resolution_id`),
	FOREIGN KEY (`company_id`,`conflict_id`) REFERENCES `sales_event_conflicts`(`company_id`,`conflict_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`canonical_event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_event_conflict_resolution` ON `sales_event_conflict_resolutions` (`company_id`,`conflict_id`);--> statement-breakpoint
CREATE TABLE `sales_event_conflicts` (
	`company_id` text NOT NULL,
	`conflict_id` text NOT NULL,
	`canonical_event_key` text NOT NULL,
	`received_at` text NOT NULL,
	`source_payload_sha256` text NOT NULL,
	`external_event_id` text NOT NULL,
	`external_order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`reason` text NOT NULL,
	PRIMARY KEY(`company_id`, `conflict_id`),
	FOREIGN KEY (`company_id`,`canonical_event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_event_conflict_receipt` ON `sales_event_conflicts` (`company_id`,`canonical_event_key`,`source_payload_sha256`,`external_event_id`,`external_order_id`,`revision`);--> statement-breakpoint
CREATE INDEX `sales_event_conflict_reads` ON `sales_event_conflicts` (`company_id`,`canonical_event_key`,`received_at`);--> statement-breakpoint
CREATE TABLE `sales_event_corrections` (
	`company_id` text NOT NULL,
	`correction_id` text NOT NULL,
	`event_key` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`requested_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `correction_id`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_pending_corrections` ON `sales_event_corrections` (`company_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `sales_event_fragments` (
	`company_id` text NOT NULL,
	`event_key` text NOT NULL,
	`fragment_json` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `event_key`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_fragment_expiry` ON `sales_event_fragments` (`company_id`,`expires_at`,`event_key`);--> statement-breakpoint
CREATE TABLE `sales_event_resolutions` (
	`company_id` text NOT NULL,
	`resolution_id` text NOT NULL,
	`event_key` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `resolution_id`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_resolution_history` ON `sales_event_resolutions` (`company_id`,`event_key`,`at`);--> statement-breakpoint
CREATE TABLE `sales_event_states` (
	`company_id` text NOT NULL,
	`event_key` text NOT NULL,
	`lineage_key` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`lease_attempt_id` text,
	`lease_expires_at` text,
	`last_reason` text,
	`linked_event_key` text,
	`transition_actor` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `event_key`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`linked_event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_claimable` ON `sales_event_states` (`company_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `sales_event_active_leases` ON `sales_event_states` (`company_id`,`state`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `sales_event_lineage_state` ON `sales_event_states` (`company_id`,`lineage_key`,`revision`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_event_one_processing_lineage` ON `sales_event_states` (`company_id`,`lineage_key`) WHERE state = 'processing';--> statement-breakpoint
CREATE TABLE `sales_event_transitions` (
	`company_id` text NOT NULL,
	`transition_id` text NOT NULL,
	`event_key` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`at` text NOT NULL,
	`reason` text,
	`linked_event_key` text,
	PRIMARY KEY(`company_id`, `transition_id`),
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`linked_event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_transition_history` ON `sales_event_transitions` (`company_id`,`event_key`,`at`);--> statement-breakpoint
CREATE TABLE `sales_events` (
	`company_id` text NOT NULL,
	`event_key` text NOT NULL,
	`lineage_key` text NOT NULL,
	`application_key` text NOT NULL,
	`provider` text NOT NULL,
	`environment` text NOT NULL,
	`merchant_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`external_order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	`source_payload_sha256` text NOT NULL,
	`normalized_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `event_key`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_event_identity` ON `sales_events` (`company_id`,`provider`,`environment`,`merchant_id`,`external_event_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_event_lineage_revision` ON `sales_events` (`company_id`,`lineage_key`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_event_application_key` ON `sales_events` (`company_id`,`application_key`);--> statement-breakpoint
CREATE INDEX `sales_event_lineage_lookup` ON `sales_events` (`company_id`,`lineage_key`,`revision`);
--> statement-breakpoint
CREATE TRIGGER `sales_event_state_received`
AFTER INSERT ON `sales_event_states`
BEGIN
	INSERT INTO `sales_event_transitions` (
		`company_id`,`transition_id`,`event_key`,`from_state`,`to_state`,`at`,`reason`,`linked_event_key`
	) VALUES (
		NEW.`company_id`,lower(hex(randomblob(16))),NEW.`event_key`,NULL,NEW.`state`,NEW.`updated_at`,NEW.`last_reason`,NEW.`linked_event_key`
	);
	UPDATE `sales_event_states`
	SET `state`='superseded', `lease_attempt_id`=NULL, `lease_expires_at`=NULL,
		`last_reason`='newer_revision', `linked_event_key`=NEW.`event_key`,
		`transition_actor`=NEW.`transition_actor`, `updated_at`=NEW.`updated_at`
	WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key`
		AND `event_key`<>NEW.`event_key` AND `revision`<NEW.`revision`
		AND `state` IN ('received','held','failed');
	UPDATE `sales_event_states`
	SET `state`='superseded', `last_reason`='stale_revision',
		`linked_event_key`=(
			SELECT `event_key` FROM `sales_event_states`
			WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key`
				AND `revision`>NEW.`revision`
			ORDER BY `revision` DESC LIMIT 1
		), `updated_at`=NEW.`updated_at`
	WHERE `company_id`=NEW.`company_id` AND `event_key`=NEW.`event_key`
		AND EXISTS (
			SELECT 1 FROM `sales_event_states`
			WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key`
				AND `revision`>NEW.`revision`
		);
END;
--> statement-breakpoint
CREATE TRIGGER `sales_event_state_transitioned`
AFTER UPDATE OF `state` ON `sales_event_states`
WHEN OLD.`state`<>NEW.`state`
BEGIN
	INSERT INTO `sales_event_transitions` (
		`company_id`,`transition_id`,`event_key`,`from_state`,`to_state`,`at`,`reason`,`linked_event_key`
	) VALUES (
		NEW.`company_id`,lower(hex(randomblob(16))),NEW.`event_key`,OLD.`state`,NEW.`state`,NEW.`updated_at`,NEW.`last_reason`,NEW.`linked_event_key`
	);
	INSERT INTO `sales_event_audits` (
		`company_id`,`audit_id`,`event_key`,`action`,`actor`,`at`,`reason`,`conflict_id`
	)
	SELECT NEW.`company_id`,lower(hex(randomblob(16))),NEW.`event_key`,'superseded',
		NEW.`transition_actor`,NEW.`updated_at`,'Superseded by '||NEW.`linked_event_key`||'.',NULL
	WHERE NEW.`state`='superseded';
END;
