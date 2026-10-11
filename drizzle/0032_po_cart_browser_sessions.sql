CREATE TABLE `po_cart_browser_observations` (
	`company_id` text NOT NULL,
	`session_id` text NOT NULL,
	`phase` text NOT NULL,
	`observation_json` text NOT NULL,
	`verified` integer NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `session_id`, `phase`),
	FOREIGN KEY (`company_id`,`session_id`) REFERENCES `po_cart_browser_sessions`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_browser_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`,`session_id`) REFERENCES `po_cart_browser_sessions`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_browser_sessions` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`requested_by` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`fence` integer NOT NULL,
	`worker_id` text,
	`lease_until` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	`reason` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_browser_active_account` ON `po_cart_browser_sessions` (`company_id`,`supplier_id`,`account_id`) WHERE "po_cart_browser_sessions"."state" IN ('requested','opening','open','closing');
--> statement-breakpoint
DROP TRIGGER po_cart_job_update_guard;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_update_guard BEFORE UPDATE ON po_cart_jobs
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR NEW.authorization_revision IS NOT OLD.authorization_revision OR NEW.inputs_json IS NOT OLD.inputs_json
 OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.account_id IS NOT OLD.account_id OR NEW.requested_by IS NOT OLD.requested_by
 OR NEW.created_at IS NOT OLD.created_at OR NEW.revision!=OLD.revision+1
 OR NEW.purchase_state!='not_confirmed' OR NEW.delivery_state!='outstanding'
 OR NOT ((OLD.state='queued' AND NEW.state IN ('preparing','review_needed','canceled'))
  OR (OLD.state='preparing' AND NEW.state IN ('preparing','queued','review_needed','ready','canceled'))
  OR (OLD.state IN ('review_needed','ready') AND NEW.state IN ('review_needed','canceled'))
  OR (OLD.state='review_needed' AND NEW.state='queued' AND NEW.kind='resume'
   AND EXISTS (SELECT 1 FROM po_cart_browser_sessions s JOIN po_cart_browser_observations b
    ON b.company_id=s.company_id AND b.session_id=s.id AND b.phase='close' AND b.verified=1
    JOIN po_cart_authorizations a ON a.company_id=NEW.company_id AND a.id=NEW.authorization_id
    WHERE s.company_id=NEW.company_id AND s.job_id=NEW.id AND s.purpose='sign_in' AND s.state='closed'
    AND s.closed_at IS NOT NULL AND s.expires_at>NEW.updated_at AND a.status='authorized' AND a.started_at IS NULL AND a.released_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions n WHERE n.company_id=s.company_id AND n.job_id=s.job_id AND n.rowid>s.rowid))))
 OR (NEW.state='queued' AND EXISTS (SELECT 1 FROM po_cart_attempts WHERE company_id=NEW.company_id AND job_id=NEW.id))
 OR (NEW.state='ready' AND ((SELECT COUNT(*) FROM po_cart_results WHERE company_id=NEW.company_id AND job_id=NEW.id AND outcome='verified')
  !=json_array_length(NEW.inputs_json,'$.preflight.lines') OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations
  WHERE company_id=NEW.company_id AND id=NEW.authorization_id AND status='authorized' AND released_at IS NULL)))
BEGIN SELECT RAISE(ABORT,'Invalid cart job transition'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_human_blocks_owner BEFORE UPDATE ON po_cart_owners
WHEN NEW.worker_id IS NOT NULL AND EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=NEW.company_id
 AND supplier_id=NEW.supplier_id AND account_id=NEW.account_id AND state IN ('requested','opening','open','closing'))
BEGIN SELECT RAISE(ABORT,'Human browser owns account'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_insert_guard BEFORE INSERT ON po_cart_browser_sessions
WHEN NEW.revision!=1 OR NEW.state!='requested' OR NEW.purpose NOT IN ('sign_in','inspect') OR NEW.worker_id IS NOT NULL
 OR NEW.lease_until IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.fence<1
 OR NEW.expires_at!=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+30 minutes')
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.requested_by AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_jobs j JOIN po_cart_owners o ON o.company_id=j.company_id AND o.supplier_id=j.supplier_id AND o.account_id=j.account_id
 WHERE j.company_id=NEW.company_id AND j.id=NEW.job_id AND j.browser_config_json IS NOT NULL AND j.supplier_id=NEW.supplier_id AND j.account_id=NEW.account_id
 AND j.state IN ('ready','review_needed') AND o.worker_id IS NULL)
BEGIN SELECT RAISE(ABORT,'Invalid human browser request'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_update_guard BEFORE UPDATE ON po_cart_browser_sessions
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id
 OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.account_id IS NOT OLD.account_id OR NEW.purpose IS NOT OLD.purpose
 OR NEW.requested_by IS NOT OLD.requested_by OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NEW.revision!=OLD.revision+1 OR NEW.fence<OLD.fence OR NEW.fence>9007199254740991
 OR NOT ((OLD.state='requested' AND NEW.state IN ('opening','closing','expired'))
 OR (OLD.state IN ('opening','open') AND NEW.state IN ('open','closing','failed','expired'))
 OR (OLD.state='closing' AND NEW.state IN ('closing','closed','failed','expired')))
 OR (NEW.state='closed' AND (OLD.state!='closing' OR NEW.closed_at IS NULL OR NEW.purpose='sign_in' AND NOT EXISTS (
  SELECT 1 FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.id AND phase='close' AND verified=1)))
BEGIN SELECT RAISE(ABORT,'Invalid human browser transition'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_no_delete BEFORE DELETE ON po_cart_browser_sessions BEGIN SELECT RAISE(ABORT,'Browser history retained'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_operation_guard BEFORE INSERT ON po_cart_browser_operations WHEN NEW.write_guard!=1
BEGIN SELECT RAISE(ABORT,'Browser transaction guard failed'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_operations_no_update BEFORE UPDATE ON po_cart_browser_operations BEGIN SELECT RAISE(ABORT,'Browser receipt immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_operations_no_delete BEFORE DELETE ON po_cart_browser_operations BEGIN SELECT RAISE(ABORT,'Browser receipt retained'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_observation_guard BEFORE INSERT ON po_cart_browser_observations
WHEN NEW.phase NOT IN ('open','close') OR NEW.verified NOT IN (0,1) OR NOT json_valid(NEW.observation_json)
 OR NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=NEW.company_id AND id=NEW.session_id AND state IN ('opening','open','closing'))
BEGIN SELECT RAISE(ABORT,'Invalid browser observation'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_observations_no_update BEFORE UPDATE ON po_cart_browser_observations BEGIN SELECT RAISE(ABORT,'Browser observation immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_observations_no_delete BEFORE DELETE ON po_cart_browser_observations BEGIN SELECT RAISE(ABORT,'Browser observation retained'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_permission_change AFTER UPDATE ON po_cart_authorizations WHEN NEW.status IS NOT OLD.status
BEGIN
 UPDATE po_cart_browser_sessions SET revision=revision+1,state='closing',reason='permission_changed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE company_id=NEW.company_id AND job_id IN (SELECT id FROM po_cart_jobs WHERE company_id=NEW.company_id AND authorization_id=NEW.id)
 AND state IN ('requested','opening','open');
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_credential_revoked AFTER UPDATE ON po_cart_worker_credentials
WHEN NEW.status!='active' AND OLD.status='active'
BEGIN
 UPDATE po_cart_jobs SET revision=revision+1,state='review_needed',kind='inspection',actor='system',reason='Supervised browser credential revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE company_id IN (SELECT company_id FROM po_cart_browser_sessions WHERE worker_id=NEW.worker_id AND state IN ('opening','open','closing'))
 AND id IN (SELECT job_id FROM po_cart_browser_sessions WHERE worker_id=NEW.worker_id AND state IN ('opening','open','closing')) AND state='ready';
 UPDATE po_cart_browser_sessions SET revision=revision+1,state='closing',reason='credential_revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE worker_id=NEW.worker_id AND state IN ('opening','open');
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_identity_changed AFTER UPDATE ON po_cart_worker_identities
WHEN NEW.status!='active' OR NEW.version!=OLD.version
BEGIN
 UPDATE po_cart_jobs SET revision=revision+1,state='review_needed',kind='inspection',actor='system',reason='Supervised browser identity changed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE company_id=NEW.company_id AND id IN (SELECT job_id FROM po_cart_browser_sessions WHERE worker_id=NEW.id AND state IN ('opening','open','closing')) AND state='ready';
 UPDATE po_cart_browser_sessions SET revision=revision+1,state='closing',reason='credential_revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE worker_id=NEW.id AND state IN ('opening','open');
END;
