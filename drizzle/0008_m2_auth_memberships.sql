CREATE TABLE `auth_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	`reauthenticated_at` integer NOT NULL,
	`recovery` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires` integer NOT NULL,
	`consumed_by` text,
	`consumed_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ownership_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`from_user` text NOT NULL,
	`to_user` text NOT NULL,
	`expires` integer NOT NULL,
	`accepted_at` integer,
	`canceled_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `security_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
-- These triggers enforce atomic invariants in D1, including concurrent requests.
CREATE TRIGGER membership_last_owner_delete BEFORE DELETE ON memberships
WHEN OLD.role='owner' AND (SELECT count(*) FROM memberships WHERE company_id=OLD.company_id AND role='owner')=1
BEGIN SELECT RAISE(ABORT,'Company must retain an owner'); END;
--> statement-breakpoint
CREATE TRIGGER invitation_issuer BEFORE INSERT ON company_invitations
WHEN NEW.role NOT IN ('manager','employee') OR NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.invited_by AND role='owner')
BEGIN SELECT RAISE(ABORT,'Owner must issue invitation'); END;
--> statement-breakpoint
CREATE TRIGGER ownership_issuer BEFORE INSERT ON ownership_transfers
WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.from_user AND role='owner')
BEGIN SELECT RAISE(ABORT,'Owner must initiate transfer'); END;
--> statement-breakpoint
CREATE TRIGGER membership_last_owner_update BEFORE UPDATE ON memberships
WHEN OLD.role='owner' AND (NEW.role!='owner' OR NEW.company_id!=OLD.company_id OR NEW.user_id!=OLD.user_id)
AND (SELECT count(*) FROM memberships WHERE company_id=OLD.company_id AND role='owner')=1
BEGIN SELECT RAISE(ABORT,'Company must retain an owner'); END;
--> statement-breakpoint
CREATE TRIGGER invitation_accept AFTER UPDATE OF consumed_at ON company_invitations
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
 SELECT CASE WHEN NEW.role NOT IN ('manager','employee') OR NEW.revoked_at IS NOT NULL OR NEW.expires<=NEW.consumed_at
 OR NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.invited_by AND role='owner')
 THEN RAISE(ABORT,'Invalid invitation') END;
 INSERT INTO memberships(user_id,company_id,role) VALUES(NEW.consumed_by,NEW.company_id,NEW.role);
 INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES(lower(hex(randomblob(16))),NEW.company_id,NEW.consumed_by,'invitation.accepted',NEW.id,NEW.consumed_at);
END;
--> statement-breakpoint
CREATE TRIGGER ownership_accept AFTER UPDATE OF accepted_at ON ownership_transfers
WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
BEGIN
 SELECT CASE WHEN NEW.from_user=NEW.to_user OR NEW.canceled_at IS NOT NULL OR NEW.expires<=NEW.accepted_at
 OR NOT EXISTS(SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.from_user AND role='owner')
 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN auth_users u ON u.id=m.user_id WHERE company_id=NEW.company_id AND user_id=NEW.to_user AND role IN ('manager','employee'))
 THEN RAISE(ABORT,'Invalid ownership transfer') END;
 UPDATE memberships SET role='owner' WHERE company_id=NEW.company_id AND user_id=NEW.to_user;
 UPDATE memberships SET role='manager' WHERE company_id=NEW.company_id AND user_id=NEW.from_user;
 UPDATE ownership_transfers SET canceled_at=NEW.accepted_at WHERE company_id=NEW.company_id AND id!=NEW.id AND accepted_at IS NULL;
 UPDATE company_invitations SET revoked_at=NEW.accepted_at WHERE company_id=NEW.company_id AND invited_by=NEW.from_user AND consumed_at IS NULL;
 INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES(lower(hex(randomblob(16))),NEW.company_id,NEW.to_user,'ownership.accepted',NEW.from_user,NEW.accepted_at);
END;
