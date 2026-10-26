CREATE TABLE `po_draft_occurrences` (
	`company_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`week_key` text NOT NULL,
	`schedule_version` integer NOT NULL,
	`due_at` text NOT NULL,
	`time_zone` text NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`attempts` integer NOT NULL,
	`holder` text NOT NULL,
	`lease_until` text,
	`next_attempt_at` text,
	`draft_actor` text,
	`draft_input_json` text,
	`order_id` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `schedule_id`, `week_key`)
);
--> statement-breakpoint
CREATE INDEX `po_draft_occurrence_order` ON `po_draft_occurrences` (`company_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `po_draft_schedules` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`location_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`local_time` text NOT NULL,
	`margin_percent` integer NOT NULL,
	`responsible_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`, `version`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_draft_schedule_operation` ON `po_draft_schedules` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `po_draft_schedule_group` ON `po_draft_schedules` (`company_id`,`supplier_id`,`account_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `po_draft_tick_leases` (
	`company_id` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`lease_until` text NOT NULL
);
--> statement-breakpoint
-- A schedule version is appended by a current owner or manager for an active supplier, names a
-- current owner or manager as responsible, needs the company's time zone, and keeps one
-- supplier-list group per schedule (and one schedule per group).
CREATE TRIGGER po_draft_schedule_insert_guard BEFORE INSERT ON po_draft_schedules
WHEN NEW.version IS NOT COALESCE((SELECT MAX(version)+1 FROM po_draft_schedules WHERE company_id=NEW.company_id AND id=NEW.id),1)
 OR NEW.status NOT IN ('active','paused')
 OR typeof(NEW.weekday)!='integer' OR NEW.weekday NOT BETWEEN 1 AND 7
 OR length(NEW.local_time)!=5 OR NEW.local_time NOT GLOB '[0-2][0-9]:[0-5][0-9]' OR NEW.local_time>'23:59'
 OR typeof(NEW.margin_percent)!='integer' OR NEW.margin_percent NOT BETWEEN 0 AND 100
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at
 OR length(NEW.operation_id)!=36 OR length(NEW.fingerprint)<1 OR length(NEW.reason)>500
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.responsible_user_id AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM purchasing_suppliers WHERE company_id=NEW.company_id AND id=NEW.supplier_id AND status='active')
 OR NOT EXISTS (SELECT 1 FROM company_time_zones WHERE company_id=NEW.company_id)
 OR EXISTS (SELECT 1 FROM po_draft_schedules WHERE company_id=NEW.company_id AND id IS NOT NEW.id
  AND supplier_id=NEW.supplier_id AND account_id=NEW.account_id AND location_id=NEW.location_id)
 OR EXISTS (SELECT 1 FROM po_draft_schedules WHERE company_id=NEW.company_id AND id=NEW.id
  AND (supplier_id IS NOT NEW.supplier_id OR account_id IS NOT NEW.account_id OR location_id IS NOT NEW.location_id OR created_at>NEW.created_at))
BEGIN SELECT RAISE(ABORT,'Invalid or stale weekly schedule'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_schedules_no_update BEFORE UPDATE ON po_draft_schedules
BEGIN SELECT RAISE(ABORT,'Weekly schedule versions are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_schedules_no_delete BEFORE DELETE ON po_draft_schedules
BEGIN SELECT RAISE(ABORT,'Weekly schedule versions are permanent'); END;
--> statement-breakpoint
-- A week is claimed once, for the schedule's current version, on the schedule's weekday, in the
-- company's current time zone, no earlier than that version and no later than the claim.
CREATE TRIGGER po_draft_occurrence_insert_guard BEFORE INSERT ON po_draft_occurrences
WHEN NEW.state IS NOT 'running' OR NEW.attempts IS NOT 1 OR NEW.reason IS NOT NULL OR NEW.order_id IS NOT NULL
 OR NEW.draft_input_json IS NOT NULL OR NEW.draft_actor IS NOT NULL OR NEW.result_json IS NOT NULL OR NEW.next_attempt_at IS NOT NULL
 OR date(NEW.week_key) IS NOT NEW.week_key OR length(NEW.holder)<1
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.due_at) IS NOT NEW.due_at
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at OR NEW.updated_at IS NOT NEW.created_at
 OR NEW.lease_until IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.lease_until) IS NOT NEW.lease_until OR NEW.lease_until<=NEW.created_at
 OR NEW.due_at>NEW.created_at
 OR NEW.time_zone IS NOT (SELECT time_zone FROM company_time_zones WHERE company_id=NEW.company_id ORDER BY version DESC LIMIT 1)
 OR NOT EXISTS (SELECT 1 FROM po_draft_schedules s WHERE s.company_id=NEW.company_id AND s.id=NEW.schedule_id AND s.version=NEW.schedule_version
  AND s.version=(SELECT MAX(version) FROM po_draft_schedules WHERE company_id=s.company_id AND id=s.id)
  AND s.created_at<=NEW.due_at AND s.weekday=(CAST(strftime('%w',NEW.week_key) AS INTEGER)+6)%7+1)
BEGIN SELECT RAISE(ABORT,'Invalid weekly draft occurrence'); END;
--> statement-breakpoint
-- Running weeks are fenced by attempt and holder. A week may be re-claimed (after its retry time
-- or an expired lease, at most three attempts), record its draft input once, wait to retry, or
-- finish. Finished weeks never change; a drafted week names an existing draft. A rule that
-- evaluates to NULL (a missing value) counts as a refusal.
CREATE TRIGGER po_draft_occurrence_update_guard BEFORE UPDATE ON po_draft_occurrences
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.schedule_id IS NOT OLD.schedule_id OR NEW.week_key IS NOT OLD.week_key
 OR NEW.schedule_version IS NOT OLD.schedule_version OR NEW.due_at IS NOT OLD.due_at OR NEW.time_zone IS NOT OLD.time_zone
 OR NEW.created_at IS NOT OLD.created_at OR OLD.state NOT IN ('running','retry')
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at OR NEW.updated_at<OLD.updated_at OR length(NEW.holder)<1
 OR COALESCE(NOT (
  (NEW.state='running' AND NEW.attempts=OLD.attempts+1 AND NEW.attempts<=3 AND NEW.next_attempt_at IS NULL AND NEW.reason IS NULL
   AND NEW.lease_until>NEW.updated_at AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.lease_until) IS NEW.lease_until
   AND NEW.draft_input_json IS OLD.draft_input_json AND NEW.draft_actor IS OLD.draft_actor AND NEW.order_id IS NULL AND NEW.result_json IS NULL
   AND ((OLD.state='retry' AND OLD.next_attempt_at<=NEW.updated_at) OR (OLD.state='running' AND OLD.lease_until<=NEW.updated_at)))
  OR (OLD.state='running' AND NEW.state='running' AND NEW.attempts=OLD.attempts AND NEW.holder IS OLD.holder AND NEW.lease_until IS OLD.lease_until
   AND OLD.draft_input_json IS NULL AND json_valid(NEW.draft_input_json) IS 1 AND length(NEW.draft_actor)>0
   AND NEW.reason IS NULL AND NEW.order_id IS NULL AND NEW.result_json IS NULL AND NEW.next_attempt_at IS NULL)
  OR (OLD.state='running' AND NEW.state='retry' AND NEW.attempts=OLD.attempts AND OLD.attempts<3 AND NEW.holder IS OLD.holder
   AND NEW.lease_until IS NULL AND NEW.next_attempt_at>NEW.updated_at AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.next_attempt_at) IS NEW.next_attempt_at
   AND length(NEW.reason)>0 AND NEW.order_id IS NULL AND NEW.result_json IS NULL
   AND (NEW.draft_input_json IS OLD.draft_input_json OR NEW.draft_input_json IS NULL) AND NEW.draft_actor IS OLD.draft_actor)
  OR (OLD.state='running' AND NEW.attempts=OLD.attempts AND NEW.holder IS OLD.holder AND NEW.lease_until IS NULL AND NEW.next_attempt_at IS NULL
   AND NEW.draft_actor IS OLD.draft_actor AND (NEW.result_json IS NULL OR json_valid(NEW.result_json) IS 1)
   AND ((NEW.state='drafted' AND NEW.reason IS NULL AND NEW.draft_input_json IS OLD.draft_input_json AND OLD.draft_input_json IS NOT NULL
     AND EXISTS (SELECT 1 FROM purchase_order_drafts WHERE company_id=NEW.company_id AND id=NEW.order_id))
    OR (NEW.state='failed' AND OLD.attempts=3 AND length(NEW.reason)>0 AND NEW.order_id IS NULL)
    OR (NEW.state IN ('nothing_needed','skipped_paused','skipped_waiting','held') AND length(NEW.reason)>0 AND NEW.order_id IS NULL
     AND NEW.draft_input_json IS NULL)))),1)
BEGIN SELECT RAISE(ABORT,'Invalid weekly draft occurrence change'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_occurrences_no_delete BEFORE DELETE ON po_draft_occurrences
BEGIN SELECT RAISE(ABORT,'Weekly draft records are permanent'); END;
