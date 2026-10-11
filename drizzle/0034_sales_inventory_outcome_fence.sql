-- Preserve existing rows. A committed sales application must be reconciled,
-- never discarded as an unapplied predecessor. Used migrations remain unchanged.
DROP TRIGGER `sales_event_state_received`;
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
 SET `state`='superseded',`lease_attempt_id`=NULL,`lease_expires_at`=NULL,
  `last_reason`='newer_revision',`linked_event_key`=NEW.`event_key`,
  `transition_actor`=NEW.`transition_actor`,`updated_at`=NEW.`updated_at`
 WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key`
  AND `event_key`<>NEW.`event_key` AND `revision`<NEW.`revision`
  AND `state` IN ('received','held','failed')
  AND NOT EXISTS (
   SELECT 1 FROM `sales_events` e JOIN `inventory_consumption_applications` i
    ON i.`company_id`=e.`company_id` AND i.`idempotency_key`=e.`application_key`
   WHERE e.`company_id`=`sales_event_states`.`company_id` AND e.`event_key`=`sales_event_states`.`event_key`
  );
 UPDATE `sales_event_states`
 SET `state`='superseded',`last_reason`='stale_revision',
  `linked_event_key`=(
   SELECT `event_key` FROM `sales_event_states`
   WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key` AND `revision`>NEW.`revision`
   ORDER BY `revision` DESC LIMIT 1
  ),`updated_at`=NEW.`updated_at`
 WHERE `company_id`=NEW.`company_id` AND `event_key`=NEW.`event_key`
  AND EXISTS (
   SELECT 1 FROM `sales_event_states`
   WHERE `company_id`=NEW.`company_id` AND `lineage_key`=NEW.`lineage_key` AND `revision`>NEW.`revision`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `sales_inventory_application_fence`
BEFORE INSERT ON `inventory_consumption_applications`
WHEN EXISTS (
 SELECT 1 FROM `sales_events` e WHERE e.`company_id`=NEW.`company_id` AND e.`application_key`=NEW.`idempotency_key`
) AND NOT EXISTS (
 SELECT 1 FROM `inventory_consumption_applications` i WHERE i.`company_id`=NEW.`company_id` AND i.`idempotency_key`=NEW.`idempotency_key`
) AND NOT EXISTS (
 SELECT 1 FROM `sales_events` e JOIN `sales_event_states` s
  ON s.`company_id`=e.`company_id` AND s.`event_key`=e.`event_key`
 WHERE e.`company_id`=NEW.`company_id` AND e.`application_key`=NEW.`idempotency_key`
  AND s.`state`='processing' AND s.`lease_attempt_id`=json_extract(NEW.`result_json`,'$._salesAttemptId')
)
BEGIN
 SELECT RAISE(ABORT,'Sales inventory application no longer owns its processing lease');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_inventory_supersession_guard`
BEFORE UPDATE OF `state` ON `sales_event_states`
WHEN NEW.`state`='superseded' AND OLD.`state` IN ('received','held','failed') AND EXISTS (
 SELECT 1 FROM `sales_events` e JOIN `inventory_consumption_applications` i
  ON i.`company_id`=e.`company_id` AND i.`idempotency_key`=e.`application_key`
 WHERE e.`company_id`=OLD.`company_id` AND e.`event_key`=OLD.`event_key`
)
BEGIN
 SELECT RAISE(ABORT,'Committed sales inventory must be reconciled before supersession');
END;
