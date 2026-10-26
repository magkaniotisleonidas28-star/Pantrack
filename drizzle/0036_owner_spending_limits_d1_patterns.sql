-- D1 rejects LIKE/GLOB patterns over 50 bytes. Replace 0035's ISO-time GLOBs with an exact
-- canonical-format check; every other condition is unchanged. 0035 itself is never rewritten.
--> statement-breakpoint
DROP TRIGGER company_time_zone_insert_guard;
--> statement-breakpoint
CREATE TRIGGER company_time_zone_insert_guard BEFORE INSERT ON company_time_zones
WHEN typeof(NEW.version)!='integer' OR NEW.version!=COALESCE((SELECT MAX(version)+1 FROM company_time_zones WHERE company_id=NEW.company_id),1)
 OR length(NEW.time_zone)<1 OR length(NEW.time_zone)>64 OR NEW.time_zone GLOB '*[^A-Za-z0-9_+/-]*'
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at OR length(NEW.operation_id)!=36 OR length(NEW.fingerprint)<1
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role='owner')
BEGIN SELECT RAISE(ABORT,'Invalid company time zone'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_policy_insert_guard;
--> statement-breakpoint
CREATE TRIGGER po_cart_policy_insert_guard BEFORE INSERT ON po_cart_budget_policies
WHEN NEW.version!=COALESCE((SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id=NEW.company_id),1)
 OR typeof(NEW.per_order_minor)!='integer' OR typeof(NEW.outstanding_minor)!='integer'
 OR NEW.per_order_minor<1 OR NEW.outstanding_minor<NEW.per_order_minor OR NEW.outstanding_minor>1000000000
 OR (NEW.actor IS NULL AND (NEW.per_day_minor IS NOT NULL OR NEW.per_month_minor IS NOT NULL OR NEW.created_at IS NOT NULL
  OR NEW.operation_id IS NOT NULL OR NEW.fingerprint IS NOT NULL
  OR EXISTS (SELECT 1 FROM po_cart_budget_policies WHERE company_id=NEW.company_id AND actor IS NOT NULL)))
 OR (NEW.actor IS NOT NULL AND (typeof(NEW.per_day_minor)!='integer' OR NEW.per_day_minor<NEW.per_order_minor OR NEW.per_day_minor>1000000000
  OR (NEW.per_month_minor IS NOT NULL AND (typeof(NEW.per_month_minor)!='integer' OR NEW.per_month_minor<NEW.per_day_minor OR NEW.per_month_minor>1000000000))
  OR NEW.created_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at
  OR NEW.operation_id IS NULL OR length(NEW.operation_id)!=36 OR NEW.fingerprint IS NULL OR length(NEW.fingerprint)<1
  OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role='owner')
  OR NOT EXISTS (SELECT 1 FROM company_time_zones WHERE company_id=NEW.company_id)))
BEGIN SELECT RAISE(ABORT,'Invalid fictional cart budget policy'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_reservation_guard;
--> statement-breakpoint
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
   AND json_extract(a.payload_json,'$.window.dayStart')=strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(a.payload_json,'$.window.dayStart')) AND json_extract(a.payload_json,'$.window.dayEnd')=strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(a.payload_json,'$.window.dayEnd'))
   AND json_extract(a.payload_json,'$.window.monthStart')=strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(a.payload_json,'$.window.monthStart')) AND json_extract(a.payload_json,'$.window.monthEnd')=strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(a.payload_json,'$.window.monthEnd'))
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
