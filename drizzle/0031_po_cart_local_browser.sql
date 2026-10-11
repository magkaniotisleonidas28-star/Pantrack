CREATE TABLE `po_cart_browser_evidence` (
	`company_id` text NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`observation_json` text NOT NULL,
	`verified` integer NOT NULL,
	`reason` text NOT NULL,
	`worker_id` text NOT NULL,
	`fence` integer NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `job_id`, `kind`),
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `po_cart_jobs` ADD `browser_config_json` text;--> statement-breakpoint
ALTER TABLE `po_cart_worker_identities` ADD `consumer_kind` text DEFAULT 'fake' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_worker_insert BEFORE INSERT ON po_cart_worker_identities
WHEN NEW.consumer_kind NOT IN ('fake','local_browser')
BEGIN SELECT RAISE(ABORT,'Invalid consumer kind'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_worker_update BEFORE UPDATE ON po_cart_worker_identities
WHEN NEW.consumer_kind IS NOT OLD.consumer_kind
BEGIN SELECT RAISE(ABORT,'Immutable consumer kind'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_config_insert BEFORE INSERT ON po_cart_jobs
WHEN NEW.browser_config_json IS NOT NULL AND (NOT json_valid(NEW.browser_config_json)
 OR json_type(NEW.browser_config_json)!='object' OR (SELECT count(*) FROM json_each(NEW.browser_config_json))!=2
 OR COALESCE(json_extract(NEW.browser_config_json,'$.layout'),'') NOT IN ('rows','compact')
 OR COALESCE(json_extract(NEW.browser_config_json,'$.scenario'),'') NOT IN ('normal','unavailable','price_changed','wrong_pack','ambiguous','lost_response','login_expired','malicious'))
BEGIN SELECT RAISE(ABORT,'Invalid browser configuration'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_config_update BEFORE UPDATE ON po_cart_jobs
WHEN NEW.browser_config_json IS NOT OLD.browser_config_json
BEGIN SELECT RAISE(ABORT,'Immutable browser configuration'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_attempt BEFORE INSERT ON po_cart_attempts
WHEN EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id AND browser_config_json IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1)
BEGIN SELECT RAISE(ABORT,'Verified baseline required'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_ready BEFORE UPDATE ON po_cart_jobs
WHEN NEW.browser_config_json IS NOT NULL AND NEW.state='ready' AND (NEW.kind!='finalizeCart'
 OR NOT EXISTS (SELECT 1 FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.id AND kind='final' AND verified=1))
BEGIN SELECT RAISE(ABORT,'Final cart verification required'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_evidence_insert BEFORE INSERT ON po_cart_browser_evidence
WHEN NEW.kind NOT IN ('baseline','final') OR NEW.verified NOT IN (0,1) OR NOT json_valid(NEW.observation_json)
 OR json_type(NEW.observation_json)!='array'
 OR NOT EXISTS (SELECT 1 FROM po_cart_jobs j JOIN po_cart_owners o ON o.company_id=j.company_id AND o.job_id=j.id
 JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
 WHERE j.company_id=NEW.company_id AND j.id=NEW.job_id AND j.browser_config_json IS NOT NULL AND j.state='preparing'
 AND a.status='authorized' AND a.released_at IS NULL AND o.worker_id=NEW.worker_id AND o.fence=NEW.fence AND o.lease_until>NEW.at)
 OR (NEW.kind='baseline' AND EXISTS (SELECT 1 FROM po_cart_attempts WHERE company_id=NEW.company_id AND job_id=NEW.job_id))
 OR (NEW.kind='final' AND (NOT EXISTS (SELECT 1 FROM po_cart_browser_evidence WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND kind='baseline' AND verified=1)
 OR (SELECT count(*) FROM po_cart_results WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND outcome='verified')
 !=(SELECT json_array_length(inputs_json,'$.preflight.lines') FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id)))
BEGIN SELECT RAISE(ABORT,'Invalid browser evidence'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_evidence_update BEFORE UPDATE ON po_cart_browser_evidence
BEGIN SELECT RAISE(ABORT,'Browser evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_browser_evidence_delete BEFORE DELETE ON po_cart_browser_evidence
BEGIN SELECT RAISE(ABORT,'Browser evidence is retained'); END;
