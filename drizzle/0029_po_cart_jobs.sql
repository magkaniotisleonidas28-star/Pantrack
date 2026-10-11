CREATE TABLE `po_cart_attempts` (
	`company_id` text NOT NULL,
	`job_id` text NOT NULL,
	`id` text NOT NULL,
	`line_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`fence` integer NOT NULL,
	`intent_json` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `job_id`, `id`),
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_line_attempt` ON `po_cart_attempts` (`company_id`,`job_id`,`line_id`);--> statement-breakpoint
CREATE TABLE `po_cart_job_events` (
	`company_id` text NOT NULL,
	`job_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `job_id`, `revision`),
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_job_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`job_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_jobs` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`authorization_revision` integer NOT NULL,
	`inputs_json` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`purchase_state` text NOT NULL,
	`delivery_state` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_job_authorization` ON `po_cart_jobs` (`company_id`,`authorization_id`);--> statement-breakpoint
CREATE TABLE `po_cart_owners` (
	`company_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`job_id` text,
	`fence` integer NOT NULL,
	`worker_id` text,
	`lease_until` text,
	PRIMARY KEY(`company_id`, `supplier_id`, `account_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_owned_job` ON `po_cart_owners` (`company_id`,`job_id`);--> statement-breakpoint
CREATE TABLE `po_cart_results` (
	`company_id` text NOT NULL,
	`job_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`outcome` text NOT NULL,
	`observation_json` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `job_id`, `attempt_id`),
	FOREIGN KEY (`company_id`,`job_id`,`attempt_id`) REFERENCES `po_cart_attempts`(`company_id`,`job_id`,`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TRIGGER po_cart_job_insert_guard BEFORE INSERT ON po_cart_jobs
WHEN NEW.revision!=1 OR NEW.state!='queued' OR NEW.purchase_state!='not_confirmed' OR NEW.delivery_state!='outstanding'
 OR NEW.kind!='enqueue' OR NEW.actor IS NOT NEW.requested_by
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.requested_by AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations a WHERE a.company_id=NEW.company_id AND a.id=NEW.authorization_id
  AND a.revision=NEW.authorization_revision AND a.status='authorized' AND a.started_at IS NULL AND a.released_at IS NULL
  AND a.payload_json=NEW.inputs_json AND json_extract(a.payload_json,'$.preflight.connection.supplierId')=NEW.supplier_id
  AND json_extract(a.payload_json,'$.preflight.connection.accountId')=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'Invalid cart job authorization'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_update_guard BEFORE UPDATE ON po_cart_jobs
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR NEW.authorization_revision IS NOT OLD.authorization_revision OR NEW.inputs_json IS NOT OLD.inputs_json
 OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.account_id IS NOT OLD.account_id OR NEW.requested_by IS NOT OLD.requested_by
 OR NEW.created_at IS NOT OLD.created_at OR NEW.revision!=OLD.revision+1
 OR NEW.purchase_state!='not_confirmed' OR NEW.delivery_state!='outstanding'
 OR NOT ((OLD.state='queued' AND NEW.state IN ('preparing','review_needed','canceled'))
  OR (OLD.state='preparing' AND NEW.state IN ('preparing','queued','review_needed','ready','canceled'))
  OR (OLD.state IN ('review_needed','ready') AND NEW.state IN ('review_needed','canceled')))
 OR (NEW.state='queued' AND EXISTS (SELECT 1 FROM po_cart_attempts WHERE company_id=NEW.company_id AND job_id=NEW.id))
 OR (NEW.state='ready' AND ((SELECT COUNT(*) FROM po_cart_results WHERE company_id=NEW.company_id AND job_id=NEW.id AND outcome='verified')
  !=json_array_length(NEW.inputs_json,'$.preflight.lines') OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations
  WHERE company_id=NEW.company_id AND id=NEW.authorization_id AND status='authorized' AND released_at IS NULL)))
BEGIN SELECT RAISE(ABORT,'Invalid cart job transition'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_insert_event AFTER INSERT ON po_cart_jobs
BEGIN INSERT INTO po_cart_job_events VALUES(NEW.company_id,NEW.id,NEW.revision,NEW.kind,NEW.actor,NEW.reason,NEW.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_update_event AFTER UPDATE ON po_cart_jobs
BEGIN INSERT INTO po_cart_job_events VALUES(NEW.company_id,NEW.id,NEW.revision,NEW.kind,NEW.actor,NEW.reason,NEW.updated_at); END;
--> statement-breakpoint
-- Changing permission stops dependent work within the same transaction, even through the old API.
CREATE TRIGGER po_cart_job_permission_change AFTER UPDATE ON po_cart_authorizations
WHEN NEW.status IS NOT OLD.status
BEGIN
 UPDATE po_cart_jobs SET revision=revision+1,
  state = CASE WHEN NEW.status='canceled' OR NEW.released_at IS NOT NULL THEN 'canceled' ELSE 'review_needed' END,
  kind=NEW.status,actor=COALESCE((SELECT actor FROM po_cart_events WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND revision=NEW.revision),'system'),
  reason='Preparation permission changed; supplier purchase state unchanged',
  updated_at=COALESCE((SELECT at FROM po_cart_events WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND revision=NEW.revision),NEW.created_at)
 WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND state!='canceled';
 UPDATE po_cart_owners SET job_id=NULL,worker_id=NULL,lease_until=NULL,fence=fence+1
 WHERE company_id=NEW.company_id AND job_id IN (SELECT id FROM po_cart_jobs WHERE company_id=NEW.company_id AND authorization_id=NEW.id)
  AND NEW.released_at IS NOT NULL AND NEW.started_at IS NULL;
 UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1
 WHERE company_id=NEW.company_id AND job_id IN (SELECT id FROM po_cart_jobs WHERE company_id=NEW.company_id AND authorization_id=NEW.id)
  AND NEW.released_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_owner_insert_guard BEFORE INSERT ON po_cart_owners
WHEN NEW.job_id IS NULL OR NEW.fence!=0 OR NEW.worker_id IS NOT NULL OR NEW.lease_until IS NOT NULL
 OR NOT EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id
  AND supplier_id=NEW.supplier_id AND account_id=NEW.account_id AND state='queued')
BEGIN SELECT RAISE(ABORT,'Invalid account cart owner'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_owner_update_guard BEFORE UPDATE ON po_cart_owners
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.account_id IS NOT OLD.account_id
 OR typeof(NEW.fence)!='integer' OR NEW.fence<OLD.fence OR NEW.fence>9007199254740991
 OR (NEW.worker_id IS NULL)!=(NEW.lease_until IS NULL)
 OR (NEW.job_id IS NULL AND NEW.worker_id IS NOT NULL)
 OR (NEW.job_id IS NOT OLD.job_id AND NEW.fence!=OLD.fence+1)
 OR (NEW.worker_id IS NOT OLD.worker_id AND NEW.fence!=OLD.fence+1)
 OR (NEW.job_id IS NOT OLD.job_id AND OLD.job_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM po_cart_jobs j JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
  WHERE j.company_id=OLD.company_id AND j.id=OLD.job_id AND a.started_at IS NULL AND a.released_at IS NOT NULL))
 OR (NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id
  AND supplier_id=NEW.supplier_id AND account_id=NEW.account_id))
BEGIN SELECT RAISE(ABORT,'Unsafe account cart ownership change'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_attempt_guard BEFORE INSERT ON po_cart_attempts
WHEN NOT EXISTS (SELECT 1 FROM po_cart_jobs j JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
 JOIN po_cart_owners o ON o.company_id=j.company_id AND o.job_id=j.id, json_each(j.inputs_json,'$.preflight.lines') l
 WHERE j.company_id=NEW.company_id AND j.id=NEW.job_id AND j.state='preparing'
 AND a.status='authorized' AND a.started_at IS NOT NULL AND a.released_at IS NULL
 AND o.worker_id=NEW.worker_id AND o.fence=NEW.fence AND o.lease_until>NEW.at
 AND json_extract(l.value,'$.lineId')=NEW.line_id AND json(l.value)=json(NEW.intent_json))
 OR EXISTS (SELECT 1 FROM po_cart_attempts a WHERE a.company_id=NEW.company_id AND a.job_id=NEW.job_id
  AND NOT EXISTS (SELECT 1 FROM po_cart_results r WHERE r.company_id=a.company_id AND r.job_id=a.job_id AND r.attempt_id=a.id AND r.outcome='verified'))
BEGIN SELECT RAISE(ABORT,'Invalid, unfenced or overlapping cart attempt'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_result_guard BEFORE INSERT ON po_cart_results
WHEN NEW.outcome NOT IN ('verified','uncertain','rejected')
 OR NOT EXISTS (SELECT 1 FROM po_cart_attempts a JOIN po_cart_jobs j ON j.company_id=a.company_id AND j.id=a.job_id
  JOIN po_cart_owners o ON o.company_id=j.company_id AND o.job_id=j.id
  WHERE a.company_id=NEW.company_id AND a.job_id=NEW.job_id AND a.id=NEW.attempt_id AND j.state='preparing'
  AND o.worker_id=a.worker_id AND o.fence=a.fence AND o.lease_until>NEW.at
  AND (NEW.outcome!='verified' OR json(NEW.observation_json)=json(a.intent_json)))
BEGIN SELECT RAISE(ABORT,'Invalid or stale cart result'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_operation_guard BEFORE INSERT ON po_cart_job_operations
WHEN NEW.write_guard!=1
BEGIN SELECT RAISE(ABORT,'Cart job transaction guard failed'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_attempts_no_update BEFORE UPDATE ON po_cart_attempts BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_attempts_no_delete BEFORE DELETE ON po_cart_attempts BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_results_no_update BEFORE UPDATE ON po_cart_results BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_results_no_delete BEFORE DELETE ON po_cart_results BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_operations_no_update BEFORE UPDATE ON po_cart_job_operations BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_operations_no_delete BEFORE DELETE ON po_cart_job_operations BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_events_no_update BEFORE UPDATE ON po_cart_job_events BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_events_no_delete BEFORE DELETE ON po_cart_job_events BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_jobs_no_delete BEFORE DELETE ON po_cart_jobs BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_owners_no_delete BEFORE DELETE ON po_cart_owners BEGIN SELECT RAISE(ABORT,'Cart job history is immutable'); END;
