CREATE TABLE `company_time_zones` (
	`company_id` text NOT NULL,
	`version` integer NOT NULL,
	`time_zone` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`company_id`, `version`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_time_zone_operation` ON `company_time_zones` (`company_id`,`operation_id`);--> statement-breakpoint
ALTER TABLE `po_cart_budget_policies` ADD `per_day_minor` integer;--> statement-breakpoint
ALTER TABLE `po_cart_budget_policies` ADD `per_month_minor` integer;--> statement-breakpoint
ALTER TABLE `po_cart_budget_policies` ADD `actor` text;--> statement-breakpoint
ALTER TABLE `po_cart_budget_policies` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `po_cart_budget_policies` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `po_cart_budget_policies` ADD `fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_policy_operation` ON `po_cart_budget_policies` (`company_id`,`operation_id`);--> statement-breakpoint
-- Owner spending limits (local fictional groundwork for C7/M10). Used migrations remain unchanged.
CREATE TRIGGER company_time_zone_insert_guard BEFORE INSERT ON company_time_zones
WHEN typeof(NEW.version)!='integer' OR NEW.version!=COALESCE((SELECT MAX(version)+1 FROM company_time_zones WHERE company_id=NEW.company_id),1)
 OR length(NEW.time_zone)<1 OR length(NEW.time_zone)>64 OR NEW.time_zone GLOB '*[^A-Za-z0-9_+/-]*'
 OR NEW.created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' OR length(NEW.operation_id)!=36 OR length(NEW.fingerprint)<1
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role='owner')
BEGIN SELECT RAISE(ABORT,'Invalid company time zone'); END;
--> statement-breakpoint
CREATE TRIGGER company_time_zones_no_update BEFORE UPDATE ON company_time_zones BEGIN SELECT RAISE(ABORT,'Company time zone history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER company_time_zones_no_delete BEFORE DELETE ON company_time_zones BEGIN SELECT RAISE(ABORT,'Company time zone history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER company_time_zone_audit AFTER INSERT ON company_time_zones
BEGIN
 INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES(lower(hex(randomblob(16))),NEW.company_id,NEW.actor,
  'company_time_zone.changed','version '||NEW.version,CAST(round((julianday(NEW.created_at)-2440587.5)*86400000) AS INTEGER));
END;
--> statement-breakpoint
DROP TRIGGER po_cart_policy_insert_guard;
--> statement-breakpoint
-- Rows without an actor keep the fictional test-policy shape and can never supersede an owner-set row.
CREATE TRIGGER po_cart_policy_insert_guard BEFORE INSERT ON po_cart_budget_policies
WHEN NEW.version!=COALESCE((SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id=NEW.company_id),1)
 OR typeof(NEW.per_order_minor)!='integer' OR typeof(NEW.outstanding_minor)!='integer'
 OR NEW.per_order_minor<1 OR NEW.outstanding_minor<NEW.per_order_minor OR NEW.outstanding_minor>1000000000
 OR (NEW.actor IS NULL AND (NEW.per_day_minor IS NOT NULL OR NEW.per_month_minor IS NOT NULL OR NEW.created_at IS NOT NULL
  OR NEW.operation_id IS NOT NULL OR NEW.fingerprint IS NOT NULL
  OR EXISTS (SELECT 1 FROM po_cart_budget_policies WHERE company_id=NEW.company_id AND actor IS NOT NULL)))
 OR (NEW.actor IS NOT NULL AND (typeof(NEW.per_day_minor)!='integer' OR NEW.per_day_minor<NEW.per_order_minor OR NEW.per_day_minor>1000000000
  OR (NEW.per_month_minor IS NOT NULL AND (typeof(NEW.per_month_minor)!='integer' OR NEW.per_month_minor<NEW.per_day_minor OR NEW.per_month_minor>1000000000))
  OR NEW.created_at IS NULL OR NEW.created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
  OR NEW.operation_id IS NULL OR length(NEW.operation_id)!=36 OR NEW.fingerprint IS NULL OR length(NEW.fingerprint)<1
  OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role='owner')
  OR NOT EXISTS (SELECT 1 FROM company_time_zones WHERE company_id=NEW.company_id)))
BEGIN SELECT RAISE(ABORT,'Invalid fictional cart budget policy'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_policy_audit AFTER INSERT ON po_cart_budget_policies WHEN NEW.actor IS NOT NULL
BEGIN
 INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES(lower(hex(randomblob(16))),NEW.company_id,NEW.actor,
  'spending_limits.changed','version '||NEW.version,CAST(round((julianday(NEW.created_at)-2440587.5)*86400000) AS INTEGER));
END;
--> statement-breakpoint
DROP TRIGGER po_cart_reservation_guard;
--> statement-breakpoint
-- Owner-set policies also cap the café's local day and month. The server derives the
-- window from the current time zone; this guard checks its shape and the sums atomically.
-- Work canceled before it started is excluded; started work always counts.
CREATE TRIGGER po_cart_reservation_guard BEFORE INSERT ON po_cart_reservations
WHEN NEW.state!='reserved' OR typeof(NEW.total_minor)!='integer' OR NEW.total_minor<1
 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations a JOIN po_cart_budget_policies p
  ON p.company_id=a.company_id AND p.version=a.policy_version
  WHERE a.company_id=NEW.company_id AND a.id=NEW.authorization_id AND a.released_at IS NULL
  AND p.version=(SELECT MAX(version) FROM po_cart_budget_policies WHERE company_id=p.company_id)
  AND NEW.total_minor=CAST(json_extract(a.payload_json,'$.preflight.capMinor') AS INTEGER)
  AND NEW.total_minor<=p.per_order_minor
  AND NEW.total_minor<=p.outstanding_minor-COALESCE((SELECT SUM(total_minor) FROM po_cart_reservations
   WHERE company_id=NEW.company_id AND state='reserved'),0)
  AND (p.actor IS NULL OR (
   json_extract(a.payload_json,'$.window.timeZoneVersion')=(SELECT MAX(version) FROM company_time_zones WHERE company_id=a.company_id)
   AND json_extract(a.payload_json,'$.window.timeZone')=(SELECT time_zone FROM company_time_zones WHERE company_id=a.company_id ORDER BY version DESC LIMIT 1)
   AND json_extract(a.payload_json,'$.window.dayStart') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' AND json_extract(a.payload_json,'$.window.dayEnd') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND json_extract(a.payload_json,'$.window.monthStart') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' AND json_extract(a.payload_json,'$.window.monthEnd') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
   AND a.created_at>=json_extract(a.payload_json,'$.window.dayStart') AND a.created_at<json_extract(a.payload_json,'$.window.dayEnd')
   AND json_extract(a.payload_json,'$.window.monthStart')<=json_extract(a.payload_json,'$.window.dayStart') AND json_extract(a.payload_json,'$.window.dayEnd')<=json_extract(a.payload_json,'$.window.monthEnd')
   AND julianday(json_extract(a.payload_json,'$.window.dayEnd'))-julianday(json_extract(a.payload_json,'$.window.dayStart')) BETWEEN 22.0/24 AND 26.0/24
   AND julianday(json_extract(a.payload_json,'$.window.monthEnd'))-julianday(json_extract(a.payload_json,'$.window.monthStart')) BETWEEN 27.9 AND 31.1
   AND NEW.total_minor<=p.per_day_minor-COALESCE((SELECT SUM(r.total_minor) FROM po_cart_reservations r JOIN po_cart_authorizations x
     ON x.company_id=r.company_id AND x.id=r.authorization_id WHERE r.company_id=NEW.company_id
     AND x.created_at>=json_extract(a.payload_json,'$.window.dayStart') AND x.created_at<json_extract(a.payload_json,'$.window.dayEnd')
     AND NOT (x.started_at IS NULL AND x.released_at IS NOT NULL)),0)
   AND (p.per_month_minor IS NULL OR NEW.total_minor<=p.per_month_minor-COALESCE((SELECT SUM(r.total_minor) FROM po_cart_reservations r JOIN po_cart_authorizations x
     ON x.company_id=r.company_id AND x.id=r.authorization_id WHERE r.company_id=NEW.company_id
     AND x.created_at>=json_extract(a.payload_json,'$.window.monthStart') AND x.created_at<json_extract(a.payload_json,'$.window.monthEnd')
     AND NOT (x.started_at IS NULL AND x.released_at IS NOT NULL)),0)))))
BEGIN SELECT RAISE(ABORT,'Cart spending policy or outstanding exposure exceeded'); END;
