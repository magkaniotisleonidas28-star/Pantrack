CREATE TABLE `po_cart_worker_credential_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`worker_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`worker_id`) REFERENCES `po_cart_worker_identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `po_cart_worker_credentials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_worker_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`identity_version` integer NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`worker_id`) REFERENCES `po_cart_worker_identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_worker_secret_hash` ON `po_cart_worker_credentials` (`secret_hash`);--> statement-breakpoint
CREATE TABLE `po_cart_worker_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_identity_insert BEFORE INSERT ON po_cart_worker_identities BEGIN
 SELECT CASE WHEN NEW.version<>1 OR NEW.status<>'active' OR length(NEW.id)=0 OR length(NEW.supplier_id)=0 OR length(NEW.account_id)=0
 THEN RAISE(ABORT,'Invalid worker identity') END;
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_identity_update BEFORE UPDATE ON po_cart_worker_identities BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.supplier_id<>OLD.supplier_id OR NEW.account_id<>OLD.account_id
 OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('active','disabled')
 THEN RAISE(ABORT,'Immutable worker scope or invalid identity version') END;
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_identity_delete BEFORE DELETE ON po_cart_worker_identities BEGIN
 SELECT RAISE(ABORT,'Worker identities are retained');
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_credential_insert BEFORE INSERT ON po_cart_worker_credentials BEGIN
 SELECT CASE WHEN NEW.status<>'active' OR NEW.revoked_at IS NOT NULL OR length(NEW.secret_hash)<>64
 OR NEW.secret_hash GLOB '*[^0-9a-f]*' OR NEW.expires_at<=NEW.created_at
 OR NOT EXISTS(SELECT 1 FROM po_cart_worker_identities WHERE id=NEW.worker_id AND version=NEW.identity_version AND status='active')
 THEN RAISE(ABORT,'Invalid worker credential') END;
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_credential_update BEFORE UPDATE ON po_cart_worker_credentials BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.worker_id<>OLD.worker_id OR NEW.secret_hash<>OLD.secret_hash OR NEW.identity_version<>OLD.identity_version
 OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR OLD.status<>'active' OR NEW.status<>'revoked' OR NEW.revoked_at IS NULL
 THEN RAISE(ABORT,'Worker credentials only permit revocation') END;
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_credential_delete BEFORE DELETE ON po_cart_worker_credentials BEGIN
 SELECT RAISE(ABORT,'Worker credentials are retained');
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_credential_issued AFTER INSERT ON po_cart_worker_credentials BEGIN
 INSERT INTO po_cart_worker_credential_events(worker_id,credential_id,kind,at) VALUES(NEW.worker_id,NEW.id,'issued',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_credential_revoked AFTER UPDATE ON po_cart_worker_credentials BEGIN
 INSERT INTO po_cart_worker_credential_events(worker_id,credential_id,kind,at) VALUES(NEW.worker_id,NEW.id,'revoked',NEW.revoked_at);
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_event_insert BEFORE INSERT ON po_cart_worker_credential_events BEGIN
 SELECT CASE WHEN NEW.kind NOT IN ('issued','revoked','rotated') OR NOT EXISTS(
 SELECT 1 FROM po_cart_worker_credentials WHERE id=NEW.credential_id AND worker_id=NEW.worker_id)
 THEN RAISE(ABORT,'Invalid credential audit event') END;
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_event_update BEFORE UPDATE ON po_cart_worker_credential_events BEGIN
 SELECT RAISE(ABORT,'Credential audit is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_worker_event_delete BEFORE DELETE ON po_cart_worker_credential_events BEGIN
 SELECT RAISE(ABORT,'Credential audit is immutable');
END;
