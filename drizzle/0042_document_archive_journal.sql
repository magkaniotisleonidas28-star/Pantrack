CREATE TABLE `document_archive_intents` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`operation_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`request_json` text NOT NULL,
	`template` text NOT NULL,
	`requested_at` text NOT NULL,
	`state` text NOT NULL,
	`token` text NOT NULL,
	`lease_until` text,
	`manifest_json` text,
	`artifact_json` text,
	`reason` text,
	`write_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_archive_request_json" CHECK(json_valid("document_archive_intents"."request_json")),
	CONSTRAINT "document_archive_state" CHECK("document_archive_intents"."state" IN ('reserved','prepared','held','ready')),
	CONSTRAINT "document_archive_manifest_json" CHECK("document_archive_intents"."manifest_json" IS NULL OR json_valid("document_archive_intents"."manifest_json")),
	CONSTRAINT "document_archive_artifact_json" CHECK("document_archive_intents"."artifact_json" IS NULL OR json_valid("document_archive_intents"."artifact_json")),
	CONSTRAINT "document_archive_fingerprint" CHECK(length("document_archive_intents"."fingerprint")=64 AND "document_archive_intents"."fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "document_archive_request_binding" CHECK(json_extract("document_archive_intents"."request_json",'$.companyId') IS "document_archive_intents"."company_id" AND json_extract("document_archive_intents"."request_json",'$.operationId') IS "document_archive_intents"."operation_id"),
	CONSTRAINT "document_archive_requested_at" CHECK("document_archive_intents"."requested_at"<="document_archive_intents"."updated_at" AND length("document_archive_intents"."requested_at")=24 AND julianday("document_archive_intents"."requested_at") IS NOT NULL),
	CONSTRAINT "document_archive_updated_at" CHECK(length("document_archive_intents"."updated_at")=24 AND julianday("document_archive_intents"."updated_at") IS NOT NULL),
	CONSTRAINT "document_archive_issued_state" CHECK(("document_archive_intents"."state"='ready')=("document_archive_intents"."artifact_json" IS NOT NULL)),
	CONSTRAINT "document_archive_lease_state" CHECK(("document_archive_intents"."state" IN ('held','ready'))=("document_archive_intents"."lease_until" IS NULL)),
	CONSTRAINT "document_archive_prepared_state" CHECK("document_archive_intents"."state"!='prepared' OR "document_archive_intents"."manifest_json" IS NOT NULL),
	CONSTRAINT "document_archive_reserved_state" CHECK("document_archive_intents"."state"!='reserved' OR "document_archive_intents"."manifest_json" IS NULL),
	CONSTRAINT "document_archive_lease_time" CHECK("document_archive_intents"."lease_until" IS NULL OR "document_archive_intents"."lease_until">"document_archive_intents"."updated_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_archive_operation` ON `document_archive_intents` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `document_archive_leases` (
	`company_id` text NOT NULL,
	`document_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `document_id`, `token`),
	FOREIGN KEY (`company_id`,`document_id`) REFERENCES `document_archive_intents`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_archive_lease_token` ON `document_archive_leases` (`token`);--> statement-breakpoint
CREATE TABLE `document_archive_observations` (
	`company_id` text NOT NULL,
	`document_id` text NOT NULL,
	`id` text NOT NULL,
	`actor_id` text NOT NULL,
	`token` text,
	`payload_json` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `document_id`, `id`),
	FOREIGN KEY (`company_id`,`document_id`) REFERENCES `document_archive_intents`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`document_id`,`token`) REFERENCES `document_archive_leases`(`company_id`,`document_id`,`token`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_archive_observation_json" CHECK(json_valid("document_archive_observations"."payload_json"))
);
--> statement-breakpoint
CREATE TRIGGER document_archive_insert_guard BEFORE INSERT ON document_archive_intents
WHEN NEW.state!='reserved' OR NEW.manifest_json IS NOT NULL OR NEW.artifact_json IS NOT NULL OR NEW.reason IS NOT NULL
 OR NEW.lease_until IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+3 minutes')
 OR NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor_id AND role IN ('owner','manager'))
BEGIN SELECT RAISE(ABORT,'Invalid archive reservation'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_update_guard BEFORE UPDATE ON document_archive_intents
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.request_json IS NOT OLD.request_json
 OR NEW.template IS NOT OLD.template OR NEW.requested_at IS NOT OLD.requested_at OR OLD.artifact_json IS NOT NULL
 OR (OLD.manifest_json IS NOT NULL AND NEW.manifest_json IS NOT OLD.manifest_json)
 OR NEW.updated_at<OLD.updated_at OR NEW.write_id IS OLD.write_id
 OR NOT (
  (NEW.token IS NOT OLD.token AND (OLD.lease_until IS NULL OR OLD.lease_until<=NEW.updated_at)
   AND NEW.state= CASE WHEN OLD.manifest_json IS NULL THEN 'reserved' ELSE 'prepared' END
   AND NEW.lease_until=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+3 minutes') AND NEW.reason IS NULL
   AND EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor_id AND role IN ('owner','manager')))
  OR (NEW.token IS OLD.token AND NEW.state='held' AND NEW.lease_until IS NULL AND NEW.manifest_json IS OLD.manifest_json AND NEW.artifact_json IS NULL AND NEW.reason IS NOT NULL)
  OR (NEW.token IS OLD.token AND OLD.lease_until>NEW.updated_at AND NEW.state='prepared' AND NEW.manifest_json IS NOT NULL
   AND NEW.artifact_json IS NULL AND NEW.lease_until IS OLD.lease_until AND NEW.reason IS OLD.reason
   AND EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor_id AND role IN ('owner','manager')))
  OR (NEW.token IS OLD.token AND OLD.state='prepared' AND OLD.lease_until>NEW.updated_at AND NEW.state='ready'
   AND NEW.manifest_json IS OLD.manifest_json AND NEW.artifact_json IS NOT NULL AND NEW.lease_until IS NULL AND NEW.reason IS NULL
   AND json_remove(NEW.artifact_json,'$.issuedAt') IS NEW.manifest_json AND json_extract(NEW.artifact_json,'$.issuedAt') IS NEW.updated_at
   AND EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor_id AND role IN ('owner','manager'))
   AND EXISTS(SELECT 1 FROM document_archive_observations o WHERE o.company_id=NEW.company_id AND o.document_id=NEW.id AND o.token=NEW.token
    AND json_extract(o.payload_json,'$.kind')='object' AND json_extract(o.payload_json,'$.present')=1
    AND json_extract(o.payload_json,'$.sha256')=json_extract(NEW.manifest_json,'$.sha256')
    AND json_extract(o.payload_json,'$.reportedSize')=json_extract(NEW.manifest_json,'$.size')
    AND json_extract(o.payload_json,'$.byteLength')=json_extract(NEW.manifest_json,'$.size')))
 )
BEGIN SELECT RAISE(ABORT,'Immutable archive identity or invalid transition'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_manifest_guard BEFORE UPDATE OF manifest_json ON document_archive_intents
WHEN NEW.manifest_json IS NOT NULL AND (
 json_extract(NEW.manifest_json,'$.companyId') IS NOT NEW.company_id OR json_extract(NEW.manifest_json,'$.id') IS NOT NEW.id
 OR json_extract(NEW.manifest_json,'$.actorId') IS NOT NEW.actor_id OR json_extract(NEW.manifest_json,'$.template') IS NOT NEW.template
 OR json_extract(NEW.manifest_json,'$.requestedAt') IS NOT NEW.requested_at
 OR json_extract(NEW.manifest_json,'$.format') IS NOT json_extract(NEW.request_json,'$.format')
 OR json_extract(NEW.manifest_json,'$.source.kind') IS NOT json_extract(NEW.request_json,'$.source.kind')
 OR json_extract(NEW.manifest_json,'$.retention') IS NOT 'retain-until-explicit-policy')
BEGIN SELECT RAISE(ABORT,'Invalid archive manifest binding'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_lease_created AFTER INSERT ON document_archive_intents
BEGIN INSERT INTO document_archive_leases VALUES(NEW.company_id,NEW.id,NEW.token,NEW.lease_until); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_lease_rotated AFTER UPDATE OF token ON document_archive_intents WHEN NEW.token IS NOT OLD.token
BEGIN INSERT INTO document_archive_leases VALUES(NEW.company_id,NEW.id,NEW.token,NEW.lease_until); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_intents_no_delete BEFORE DELETE ON document_archive_intents
BEGIN SELECT RAISE(ABORT,'Retain archive identity'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_leases_no_update BEFORE UPDATE ON document_archive_leases
BEGIN SELECT RAISE(ABORT,'Immutable archive lease'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_leases_no_delete BEFORE DELETE ON document_archive_leases
BEGIN SELECT RAISE(ABORT,'Retain archive lease'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_observation_guard BEFORE INSERT ON document_archive_observations
WHEN (NEW.token IS NULL AND NOT EXISTS(SELECT 1 FROM document_archive_intents WHERE company_id=NEW.company_id AND id=NEW.document_id AND artifact_json IS NOT NULL))
 OR (NEW.token IS NOT NULL AND NOT EXISTS(SELECT 1 FROM document_archive_intents WHERE company_id=NEW.company_id AND id=NEW.document_id AND actor_id=NEW.actor_id))
 OR coalesce(json_extract(NEW.payload_json,'$.kind'),'') NOT IN ('generation','object','read_unknown','write_unknown','source_check','hold')
BEGIN SELECT RAISE(ABORT,'Invalid archive observation'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_observations_no_update BEFORE UPDATE ON document_archive_observations
BEGIN SELECT RAISE(ABORT,'Immutable archive observation'); END;
--> statement-breakpoint
CREATE TRIGGER document_archive_observations_no_delete BEFORE DELETE ON document_archive_observations
BEGIN SELECT RAISE(ABORT,'Retain archive observation'); END;
