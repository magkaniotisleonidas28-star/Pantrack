CREATE TABLE `inventory_consumption_fences` (
	`company_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_id` text NOT NULL,
	`fenced_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `idempotency_key`, `attempt_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales_event_inventory_outcomes` (
	`company_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`event_key` text NOT NULL,
	`recorded_at` text NOT NULL,
	`status` text NOT NULL,
	`inventory_result_json` text,
	PRIMARY KEY(`company_id`, `attempt_id`),
	FOREIGN KEY (`company_id`,`attempt_id`) REFERENCES `sales_event_attempts`(`company_id`,`attempt_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`event_key`) REFERENCES `sales_events`(`company_id`,`event_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_event_inventory_outcome_history` ON `sales_event_inventory_outcomes` (`company_id`,`event_key`,`recorded_at`);
--> statement-breakpoint
-- A owns the fence and the stock transaction. Even an older Worker without an
-- attempt token cannot commit this application key after reconciliation.
CREATE TRIGGER `inventory_consumption_attempt_fenced`
BEFORE INSERT ON `inventory_consumption_applications`
WHEN EXISTS (
 SELECT 1 FROM `inventory_consumption_fences` f
 WHERE f.`company_id`=NEW.`company_id` AND f.`idempotency_key`=NEW.`idempotency_key`
) AND (
 json_type(NEW.`result_json`,'$._attemptId') IS NOT 'text'
 OR EXISTS (SELECT 1 FROM `inventory_consumption_fences` f
  WHERE f.`company_id`=NEW.`company_id` AND f.`idempotency_key`=NEW.`idempotency_key`
    AND f.`attempt_id`=json_extract(NEW.`result_json`,'$._attemptId'))
)
BEGIN SELECT RAISE(ABORT,'inventory_attempt_fenced'); END;
--> statement-breakpoint
CREATE TRIGGER `inventory_consumption_fence_no_update` BEFORE UPDATE ON `inventory_consumption_fences`
BEGIN SELECT RAISE(ABORT,'inventory_consumption_fence_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `inventory_consumption_fence_no_delete` BEFORE DELETE ON `inventory_consumption_fences`
BEGIN SELECT RAISE(ABORT,'inventory_consumption_fence_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `inventory_consumption_fence_no_replace` BEFORE INSERT ON `inventory_consumption_fences`
WHEN EXISTS(SELECT 1 FROM `inventory_consumption_fences` f WHERE f.`company_id`=NEW.`company_id`
 AND f.`idempotency_key`=NEW.`idempotency_key` AND f.`attempt_id`=NEW.`attempt_id`)
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER `sales_inventory_outcome_no_update` BEFORE UPDATE ON `sales_event_inventory_outcomes`
BEGIN SELECT RAISE(ABORT,'sales_inventory_outcome_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sales_inventory_outcome_no_delete` BEFORE DELETE ON `sales_event_inventory_outcomes`
BEGIN SELECT RAISE(ABORT,'sales_inventory_outcome_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sales_inventory_outcome_no_replace` BEFORE INSERT ON `sales_event_inventory_outcomes`
WHEN EXISTS(SELECT 1 FROM `sales_event_inventory_outcomes` o WHERE o.`company_id`=NEW.`company_id` AND o.`attempt_id`=NEW.`attempt_id`)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM `sales_event_inventory_outcomes` o
  WHERE o.`company_id`=NEW.`company_id` AND o.`attempt_id`=NEW.`attempt_id`
   AND (o.`event_key`<>NEW.`event_key` OR o.`status`<>NEW.`status` OR
    COALESCE(o.`inventory_result_json`,'')<>COALESCE(NEW.`inventory_result_json`,'')))
  THEN RAISE(ABORT,'inventory_outcome_conflict') END;
 SELECT RAISE(IGNORE);
END;
--> statement-breakpoint
CREATE TRIGGER `sales_inventory_outcome_guard` BEFORE INSERT ON `sales_event_inventory_outcomes`
WHEN NOT EXISTS(SELECT 1 FROM `sales_event_inventory_outcomes` o
 WHERE o.`company_id`=NEW.`company_id` AND o.`attempt_id`=NEW.`attempt_id`)
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM `sales_event_attempts` a JOIN `sales_events` e
   ON e.`company_id`=a.`company_id` AND e.`event_key`=a.`event_key`
  JOIN `inventory_consumption_fences` f ON f.`company_id`=e.`company_id`
   AND f.`idempotency_key`=e.`application_key` AND f.`attempt_id`=a.`attempt_id`
  WHERE a.`company_id`=NEW.`company_id` AND a.`attempt_id`=NEW.`attempt_id` AND a.`event_key`=NEW.`event_key`
 ) THEN RAISE(ABORT,'inventory_outcome_requires_fence') END;
 SELECT CASE WHEN NOT COALESCE((
  (NEW.`status`='not_applied' AND NEW.`inventory_result_json` IS NULL AND NOT EXISTS (
   SELECT 1 FROM `inventory_consumption_applications` i JOIN `sales_events` e
    ON i.`company_id`=e.`company_id` AND i.`idempotency_key`=e.`application_key`
   WHERE e.`company_id`=NEW.`company_id` AND e.`event_key`=NEW.`event_key`))
  OR (NEW.`status`='applied' AND EXISTS (
   SELECT 1 FROM `inventory_consumption_applications` i JOIN `sales_events` e
    ON i.`company_id`=e.`company_id` AND i.`idempotency_key`=e.`application_key`
   WHERE e.`company_id`=NEW.`company_id` AND e.`event_key`=NEW.`event_key`
    AND json_remove(NEW.`inventory_result_json`,'$.replayed')=
     json_remove(i.`result_json`,'$._claimToken','$._attemptId','$.replayed')))
 ),0) THEN RAISE(ABORT,'inventory_outcome_mismatch') END;
END;
--> statement-breakpoint
-- Replace the receipt trigger additively. Neither arrival nor a claim may
-- discard an uncertain predecessor, including a retry returned to received.
DROP TRIGGER `sales_event_state_received`;
--> statement-breakpoint
CREATE TRIGGER `sales_event_state_received` AFTER INSERT ON `sales_event_states`
BEGIN
 INSERT INTO `sales_event_transitions` (`company_id`,`transition_id`,`event_key`,`from_state`,`to_state`,`at`,`reason`,`linked_event_key`)
 VALUES (NEW.`company_id`,lower(hex(randomblob(16))),NEW.`event_key`,NULL,NEW.`state`,NEW.`updated_at`,NEW.`last_reason`,NEW.`linked_event_key`);
 UPDATE `sales_event_states` SET `state`='superseded',`lease_attempt_id`=NULL,`lease_expires_at`=NULL,
  `last_reason`='newer_revision',`linked_event_key`=NEW.`event_key`,
  `transition_actor`=NEW.`transition_actor`,`updated_at`=NEW.`updated_at`
 WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key`
  AND `event_key`<>NEW.`event_key` AND `revision`<NEW.`revision` AND `state` IN ('received','held','failed')
  AND NOT EXISTS (SELECT 1 FROM `sales_event_attempts` a
   LEFT JOIN `sales_event_attempt_results` r ON r.`company_id`=a.`company_id` AND r.`attempt_id`=a.`attempt_id`
   LEFT JOIN `sales_event_inventory_outcomes` o ON o.`company_id`=a.`company_id` AND o.`attempt_id`=a.`attempt_id`
   WHERE a.`company_id`=sales_event_states.`company_id` AND a.`event_key`=sales_event_states.`event_key`
    AND (r.`outcome` IS NULL OR r.`outcome`='failed') AND o.`attempt_id` IS NULL);
 UPDATE `sales_event_states` SET `state`='superseded',`last_reason`='stale_revision',`linked_event_key`=(
  SELECT `event_key` FROM `sales_event_states` WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key`
   AND `revision`>NEW.`revision` ORDER BY `revision` DESC LIMIT 1),`updated_at`=NEW.`updated_at`
 WHERE `company_id`=NEW.`company_id` AND `event_key`=NEW.`event_key` AND EXISTS (
  SELECT 1 FROM `sales_event_states` WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key` AND `revision`>NEW.`revision`);
END;
--> statement-breakpoint
CREATE TRIGGER `sales_event_uncertain_supersession` BEFORE UPDATE OF `state` ON `sales_event_states`
WHEN NEW.`state`='superseded' AND EXISTS (
 SELECT 1 FROM `sales_event_attempts` a
 LEFT JOIN `sales_event_attempt_results` r ON r.`company_id`=a.`company_id` AND r.`attempt_id`=a.`attempt_id`
 LEFT JOIN `sales_event_inventory_outcomes` o ON o.`company_id`=a.`company_id` AND o.`attempt_id`=a.`attempt_id`
 WHERE a.`company_id`=OLD.`company_id` AND a.`event_key`=OLD.`event_key`
  AND (r.`outcome` IS NULL OR r.`outcome`='failed') AND o.`attempt_id` IS NULL
)
BEGIN SELECT RAISE(ABORT,'inventory_outcome_unresolved'); END;
--> statement-breakpoint
CREATE TRIGGER `sales_event_uncertain_claim` BEFORE UPDATE OF `state` ON `sales_event_states`
WHEN NEW.`state`='processing' AND EXISTS (
 SELECT 1 FROM `sales_event_states` s JOIN `sales_event_attempts` a
  ON a.`company_id`=s.`company_id` AND a.`event_key`=s.`event_key`
 LEFT JOIN `sales_event_attempt_results` r ON r.`company_id`=a.`company_id` AND r.`attempt_id`=a.`attempt_id`
 LEFT JOIN `sales_event_inventory_outcomes` o ON o.`company_id`=a.`company_id` AND o.`attempt_id`=a.`attempt_id`
 WHERE s.`company_id`=NEW.`company_id` AND s.`lineage_key`=NEW.`lineage_key` AND s.`revision`<=NEW.`revision`
  AND a.`attempt_id`<>NEW.`lease_attempt_id` AND (r.`outcome` IS NULL OR r.`outcome`='failed') AND o.`attempt_id` IS NULL
)
BEGIN SELECT RAISE(ABORT,'inventory_outcome_unresolved'); END;
