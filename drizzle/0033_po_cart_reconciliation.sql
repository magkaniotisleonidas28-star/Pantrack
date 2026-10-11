CREATE TABLE `po_cart_reconciliation_evidence` (
	`company_id` text NOT NULL,
	`session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`job_revision` integer NOT NULL,
	`authorization_revision` integer NOT NULL,
	`session_revision` integer NOT NULL,
	`fence` integer NOT NULL,
	`worker_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`identity_version` integer NOT NULL,
	`baseline_verified` integer NOT NULL,
	`final_verified` integer NOT NULL,
	`baseline_reason` text NOT NULL,
	`final_reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `session_id`),
	FOREIGN KEY (`company_id`,`session_id`) REFERENCES `po_cart_browser_sessions`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `po_cart_worker_credentials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_reconciliations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`job_revision` integer NOT NULL,
	`authorization_revision` integer NOT NULL,
	`fence` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`note` text NOT NULL,
	`at` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`,`session_id`) REFERENCES `po_cart_reconciliation_evidence`(`company_id`,`session_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_one_reconciliation` ON `po_cart_reconciliations` (`company_id`,`session_id`);
--> statement-breakpoint
DROP TRIGGER po_cart_authorization_update_guard;
--> statement-breakpoint
CREATE TRIGGER po_cart_authorization_update_guard BEFORE UPDATE ON po_cart_authorizations
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.order_id IS NOT OLD.order_id
 OR NEW.generation IS NOT OLD.generation
 OR NEW.connection_id IS NOT OLD.connection_id OR NEW.connection_version IS NOT OLD.connection_version
 OR NEW.policy_version IS NOT OLD.policy_version OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision!=OLD.revision+1 OR NEW.status NOT IN ('authorized','invalidated','canceled')
 OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at)
 OR (OLD.released_at IS NOT NULL AND NEW.released_at IS NOT OLD.released_at)
 OR (NEW.released_at IS NOT NULL AND ((NEW.started_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.id AND r.action='abandonVerifiedCart' AND r.authorization_revision=OLD.revision AND r.at=NEW.released_at)) OR NEW.status='authorized'))
 OR NOT ((OLD.status='authorized' AND NEW.status IN ('invalidated','canceled') AND NEW.started_at IS OLD.started_at)
  OR (OLD.status='invalidated' AND NEW.status='canceled' AND NEW.started_at IS OLD.started_at)
  OR (OLD.status='authorized' AND NEW.status='authorized' AND OLD.started_at IS NULL AND NEW.started_at IS NOT NULL AND OLD.released_at IS NULL)
  OR (NEW.status='canceled' AND NEW.started_at IS OLD.started_at AND OLD.released_at IS NULL AND EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.id AND r.action='abandonVerifiedCart' AND r.authorization_revision=OLD.revision AND r.at=NEW.released_at)))
BEGIN SELECT RAISE(ABORT,'Invalid cart authorization transition'); END;

--> statement-breakpoint
DROP TRIGGER po_cart_commitment_release_guard;
--> statement-breakpoint
CREATE TRIGGER po_cart_commitment_release_guard BEFORE UPDATE ON po_cart_commitments
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR NEW.product_id IS NOT OLD.product_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.quantity_json IS NOT OLD.quantity_json
 OR OLD.active!=1 OR NEW.active!=0
 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND status IN ('canceled','invalidated') AND (started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.authorization_id AND r.action='abandonVerifiedCart' AND r.authorization_revision=po_cart_authorizations.revision-1 AND r.at=po_cart_authorizations.released_at)))
BEGIN SELECT RAISE(ABORT,'Unsafe cart commitment release'); END;

--> statement-breakpoint
DROP TRIGGER po_cart_reservation_release_guard;
--> statement-breakpoint
CREATE TRIGGER po_cart_reservation_release_guard BEFORE UPDATE ON po_cart_reservations
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.total_minor IS NOT OLD.total_minor
 OR OLD.state!='reserved' OR NEW.state!='released'
 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND status IN ('canceled','invalidated') AND (started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.authorization_id AND r.action='abandonVerifiedCart' AND r.authorization_revision=po_cart_authorizations.revision-1 AND r.at=po_cart_authorizations.released_at)))
BEGIN SELECT RAISE(ABORT,'Unsafe cart exposure release'); END;

--> statement-breakpoint
DROP TRIGGER po_cart_owner_update_guard;
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
  WHERE j.company_id=OLD.company_id AND j.id=OLD.job_id AND a.released_at IS NOT NULL AND (a.started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=a.company_id AND r.authorization_id=a.id AND r.job_id=j.id AND r.action='abandonVerifiedCart' AND r.authorization_revision=a.revision-1 AND r.at=a.released_at))))
 OR (NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id
  AND supplier_id=NEW.supplier_id AND account_id=NEW.account_id))
BEGIN SELECT RAISE(ABORT,'Unsafe account cart ownership change'); END;

--> statement-breakpoint
DROP TRIGGER po_cart_job_permission_change;
--> statement-breakpoint
CREATE TRIGGER po_cart_job_permission_change AFTER UPDATE ON po_cart_authorizations
WHEN NEW.status IS NOT OLD.status OR (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.id AND r.action='abandonVerifiedCart' AND r.authorization_revision=OLD.revision AND r.at=NEW.released_at))
BEGIN
 UPDATE po_cart_jobs SET revision=revision+1,
  state = CASE WHEN NEW.status='canceled' OR NEW.released_at IS NOT NULL THEN 'canceled' ELSE 'review_needed' END ,
  kind= CASE WHEN EXISTS (SELECT 1 FROM po_cart_events WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND revision=NEW.revision AND kind='abandonVerifiedCart') THEN 'abandonVerifiedCart' ELSE NEW.status END ,actor=COALESCE((SELECT actor FROM po_cart_events WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND revision=NEW.revision),'system'),
  reason='Preparation permission changed; supplier purchase state unchanged',
  updated_at=COALESCE((SELECT at FROM po_cart_events WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND revision=NEW.revision),NEW.created_at)
 WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND (state!='canceled' OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.id AND r.action='abandonVerifiedCart' AND r.authorization_revision=OLD.revision AND r.at=NEW.released_at));
 UPDATE po_cart_owners SET job_id=NULL,worker_id=NULL,lease_until=NULL,fence=fence+1
 WHERE company_id=NEW.company_id AND job_id IN (SELECT id FROM po_cart_jobs WHERE company_id=NEW.company_id AND authorization_id=NEW.id)
  AND NEW.released_at IS NOT NULL;
 UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1
 WHERE company_id=NEW.company_id AND job_id IN (SELECT id FROM po_cart_jobs WHERE company_id=NEW.company_id AND authorization_id=NEW.id)
  AND NEW.released_at IS NULL;
END;

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
  OR (OLD.state='review_needed' AND NEW.state='ready' AND NEW.kind='acceptVerifiedCart' AND EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.job_id=NEW.id AND r.job_revision=OLD.revision AND r.action=NEW.kind AND r.at=NEW.updated_at))
  OR (OLD.state='canceled' AND NEW.state='canceled' AND NEW.kind='abandonVerifiedCart' AND EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.job_id=NEW.id AND r.job_revision=OLD.revision AND r.action=NEW.kind AND r.at=NEW.updated_at))
  OR (OLD.state='review_needed' AND NEW.state='queued' AND NEW.kind='resume'
   AND EXISTS (SELECT 1 FROM po_cart_browser_sessions s JOIN po_cart_browser_observations b
    ON b.company_id=s.company_id AND b.session_id=s.id AND b.phase='close' AND b.verified=1
    JOIN po_cart_authorizations a ON a.company_id=NEW.company_id AND a.id=NEW.authorization_id
    WHERE s.company_id=NEW.company_id AND s.job_id=NEW.id AND s.purpose='sign_in' AND s.state='closed'
    AND s.closed_at IS NOT NULL AND s.expires_at>NEW.updated_at AND a.status='authorized' AND a.started_at IS NULL AND a.released_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions n WHERE n.company_id=s.company_id AND n.job_id=s.job_id AND n.rowid>s.rowid))))
 OR (NEW.state='queued' AND EXISTS (SELECT 1 FROM po_cart_attempts WHERE company_id=NEW.company_id AND job_id=NEW.id))
 OR (NEW.state='ready' AND ((SELECT COUNT(*) FROM po_cart_results WHERE company_id=NEW.company_id AND job_id=NEW.id AND outcome='verified')
  !=json_array_length(NEW.inputs_json,'$.preflight.lines') AND NOT (NEW.kind='acceptVerifiedCart' AND EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.job_id=NEW.id AND r.job_revision=OLD.revision AND r.action=NEW.kind AND r.at=NEW.updated_at)) OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations
  WHERE company_id=NEW.company_id AND id=NEW.authorization_id AND status='authorized' AND released_at IS NULL)))
BEGIN SELECT RAISE(ABORT,'Invalid cart job transition'); END;

--> statement-breakpoint
DROP TRIGGER po_cart_browser_ready;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_ready BEFORE UPDATE ON po_cart_jobs
WHEN NEW.browser_config_json IS NOT NULL AND NEW.state='ready' AND NOT ((NEW.kind='finalizeCart' AND EXISTS (SELECT 1 FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.id AND kind='final' AND verified=1)) OR (NEW.kind='acceptVerifiedCart' AND EXISTS (SELECT 1 FROM po_cart_reconciliations r JOIN po_cart_reconciliation_evidence e ON e.company_id=r.company_id AND e.session_id=r.session_id WHERE r.company_id=NEW.company_id AND r.job_id=NEW.id AND r.job_revision=OLD.revision AND r.action=NEW.kind AND r.at=NEW.updated_at AND e.final_verified=1)))
BEGIN SELECT RAISE(ABORT,'Final cart verification required'); END;

--> statement-breakpoint
DROP TRIGGER po_cart_session_insert_guard;
--> statement-breakpoint
CREATE TRIGGER po_cart_session_insert_guard BEFORE INSERT ON po_cart_browser_sessions
WHEN NEW.revision!=1 OR NEW.state!='requested' OR NEW.purpose NOT IN ('sign_in','inspect') OR NEW.worker_id IS NOT NULL
 OR NEW.lease_until IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.fence<1
 OR NEW.expires_at!=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+30 minutes')
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.requested_by AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_jobs j JOIN po_cart_owners o ON o.company_id=j.company_id AND o.supplier_id=j.supplier_id AND o.account_id=j.account_id
 WHERE j.company_id=NEW.company_id AND j.id=NEW.job_id AND j.browser_config_json IS NOT NULL AND j.supplier_id=NEW.supplier_id AND j.account_id=NEW.account_id
 AND (j.state IN ('ready','review_needed') OR (NEW.purpose='inspect' AND j.state='canceled' AND EXISTS (SELECT 1 FROM po_cart_authorizations a WHERE a.company_id=j.company_id AND a.id=j.authorization_id AND a.released_at IS NULL))) AND o.job_id=j.id AND o.worker_id IS NULL)
BEGIN SELECT RAISE(ABORT,'Invalid human browser request'); END;

--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliation_evidence_guard BEFORE INSERT ON po_cart_reconciliation_evidence
WHEN NEW.baseline_verified NOT IN (0,1) OR NEW.final_verified NOT IN (0,1)
 OR NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions s JOIN po_cart_jobs j ON j.company_id=s.company_id AND j.id=s.job_id
 JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
 JOIN po_cart_browser_observations b ON b.company_id=s.company_id AND b.session_id=s.id AND b.phase='close'
 JOIN po_cart_worker_credentials c ON c.id=NEW.credential_id JOIN po_cart_worker_identities i ON i.id=c.worker_id
 WHERE s.company_id=NEW.company_id AND s.id=NEW.session_id AND s.job_id=NEW.job_id AND s.purpose='inspect' AND s.state='closed'
 AND s.revision=NEW.session_revision AND s.fence=NEW.fence AND s.worker_id=NEW.worker_id AND s.closed_at=NEW.at AND b.at=NEW.at
 AND j.revision=NEW.job_revision AND a.revision=NEW.authorization_revision
 AND i.id=NEW.worker_id AND i.consumer_kind='local_browser' AND i.company_id=s.company_id AND i.supplier_id=s.supplier_id AND i.account_id=s.account_id
 AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>NEW.at AND i.status='active' AND c.identity_version=i.version AND i.version=NEW.identity_version)
 OR ((NEW.baseline_verified=1 OR NEW.final_verified=1) AND ((SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1) IS NULL OR json_type((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close'))!='array' OR EXISTS (SELECT 1 FROM json_each((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close')) GROUP BY json_extract(value,'$.sku') HAVING count(*)>1)))
 OR (NEW.baseline_verified=1 AND (EXISTS (SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM json_each((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close')) x EXCEPT SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM json_each((SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1)) x) OR EXISTS (SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM json_each((SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1)) x EXCEPT SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM json_each((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close')) x)))
 OR (NEW.final_verified=1 AND (EXISTS (SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM json_each((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close')) x EXCEPT SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM (SELECT value FROM json_each((SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1)) UNION ALL SELECT value FROM json_each((SELECT json_extract(inputs_json,'$.preflight.lines') FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id))) x) OR EXISTS (SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM (SELECT value FROM json_each((SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1)) UNION ALL SELECT value FROM json_each((SELECT json_extract(inputs_json,'$.preflight.lines') FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id))) x EXCEPT SELECT json_extract(x.value,'$.sku'),json_extract(x.value,'$.unitLabel'),json_extract(x.value,'$.packs'),json_extract(x.value,'$.unitMinor') FROM json_each((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close')) x) OR (SELECT total(CAST(json_extract(value,'$.packs') AS INTEGER)*CAST(json_extract(value,'$.unitMinor') AS INTEGER)) FROM json_each((SELECT observation_json FROM po_cart_browser_observations WHERE company_id=NEW.company_id AND session_id=NEW.session_id AND phase='close')))>(SELECT CAST(json_extract(inputs_json,'$.preflight.capMinor') AS INTEGER) FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id)))
BEGIN SELECT RAISE(ABORT,'Invalid closed cart reconciliation evidence'); END;

--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliation_guard BEFORE INSERT ON po_cart_reconciliations
WHEN NEW.write_guard!=1 OR NEW.action NOT IN ('acceptVerifiedCart','abandonVerifiedCart') OR length(trim(NEW.note)) NOT BETWEEN 1 AND 500
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_reconciliation_evidence e JOIN po_cart_browser_sessions s ON s.company_id=e.company_id AND s.id=e.session_id
 JOIN po_cart_jobs j ON j.company_id=e.company_id AND j.id=e.job_id JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
 JOIN po_cart_owners o ON o.company_id=j.company_id AND o.job_id=j.id
 JOIN po_cart_worker_credentials c ON c.id=e.credential_id JOIN po_cart_worker_identities i ON i.id=c.worker_id
 WHERE e.company_id=NEW.company_id AND e.session_id=NEW.session_id AND e.job_id=NEW.job_id AND j.authorization_id=NEW.authorization_id
 AND e.job_revision=NEW.job_revision AND j.revision=NEW.job_revision AND e.authorization_revision=NEW.authorization_revision AND a.revision=NEW.authorization_revision
 AND e.session_revision=s.revision AND e.fence=NEW.fence AND o.fence=NEW.fence AND o.worker_id IS NULL AND s.state='closed'
 AND e.at<=NEW.at AND e.at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.at,'-5 minutes') AND a.released_at IS NULL
 AND c.status='active' AND c.revoked_at IS NULL AND c.expires_at>NEW.at AND i.status='active' AND c.identity_version=i.version AND i.version=e.identity_version
 AND NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions n WHERE n.company_id=s.company_id AND n.supplier_id=s.supplier_id AND n.account_id=s.account_id AND (n.rowid>s.rowid OR n.state IN ('requested','opening','open','closing')))
 AND ((NEW.action='acceptVerifiedCart' AND e.final_verified=1 AND j.state='review_needed' AND a.status='authorized')
 OR (NEW.action='abandonVerifiedCart' AND e.baseline_verified=1 AND j.state IN ('review_needed','ready','canceled'))))
BEGIN SELECT RAISE(ABORT,'Invalid cart reconciliation decision'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliation_apply AFTER INSERT ON po_cart_reconciliations
BEGIN
 UPDATE po_cart_jobs SET revision=revision+1,state='ready',kind=NEW.action,actor=NEW.actor,reason=NEW.note,updated_at=NEW.at
 WHERE company_id=NEW.company_id AND id=NEW.job_id AND NEW.action='acceptVerifiedCart';
 INSERT INTO po_cart_events SELECT NEW.company_id,NEW.authorization_id,NEW.authorization_revision+1,NEW.action,NEW.actor,NEW.note,NEW.at WHERE NEW.action='abandonVerifiedCart';
 UPDATE po_cart_authorizations SET revision=revision+1,status='canceled',released_at=NEW.at
 WHERE company_id=NEW.company_id AND id=NEW.authorization_id AND NEW.action='abandonVerifiedCart';
END;

--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliation_evidence_no_update BEFORE UPDATE ON po_cart_reconciliation_evidence BEGIN SELECT RAISE(ABORT,'Cart reconciliation history retained'); END;

--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliation_evidence_no_delete BEFORE DELETE ON po_cart_reconciliation_evidence BEGIN SELECT RAISE(ABORT,'Cart reconciliation history retained'); END;

--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliations_no_update BEFORE UPDATE ON po_cart_reconciliations BEGIN SELECT RAISE(ABORT,'Cart reconciliation history retained'); END;

--> statement-breakpoint
CREATE TRIGGER po_cart_reconciliations_no_delete BEFORE DELETE ON po_cart_reconciliations BEGIN SELECT RAISE(ABORT,'Cart reconciliation history retained'); END;
