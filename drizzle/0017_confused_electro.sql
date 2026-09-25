CREATE TABLE `replenishment_proposal_events` (
	`company_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`revision` integer NOT NULL,
	`change_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_status` text,
	`status` text NOT NULL,
	`packs` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	`invalidation_reason` text,
	PRIMARY KEY(`company_id`, `proposal_id`, `revision`),
	FOREIGN KEY (`company_id`,`proposal_id`) REFERENCES `replenishment_proposal_origins`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replenishment_proposal_change_id` ON `replenishment_proposal_events` (`company_id`,`change_id`);--> statement-breakpoint
CREATE TABLE `replenishment_proposal_states` (
	`company_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`product_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`packs` text NOT NULL,
	`change_id` text NOT NULL,
	`kind` text NOT NULL,
	`changed_by` text NOT NULL,
	`reason` text NOT NULL,
	`changed_at` text NOT NULL,
	`invalidation_reason` text,
	PRIMARY KEY(`company_id`, `proposal_id`),
	FOREIGN KEY (`company_id`,`proposal_id`) REFERENCES `replenishment_proposal_origins`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `replenishment_proposal_active_product` ON `replenishment_proposal_states` (`company_id`,`product_id`,`status`);
--> statement-breakpoint
INSERT INTO replenishment_proposal_states
 (company_id,proposal_id,product_id,revision,status,packs,change_id,kind,changed_by,reason,changed_at,invalidation_reason)
 SELECT company_id,id,product_id,1,initial_status,json_extract(snapshot_json,'$.explanation.recommendedPacks'),
  'origin:' || id,'create',created_by,'Proposal created',created_at,NULL
 FROM replenishment_proposal_origins;
--> statement-breakpoint
INSERT INTO replenishment_proposal_events
 (company_id,proposal_id,revision,change_id,kind,from_status,status,packs,actor,reason,at,invalidation_reason)
 SELECT company_id,proposal_id,revision,change_id,kind,NULL,status,packs,changed_by,reason,changed_at,NULL
 FROM replenishment_proposal_states;
--> statement-breakpoint
CREATE TRIGGER replenishment_origin_reservation_guard BEFORE INSERT ON replenishment_proposal_origins
BEGIN
 SELECT CASE WHEN json_extract(NEW.snapshot_json,'$.explanation.recommendedPacks') != '0'
  AND EXISTS (SELECT 1 FROM replenishment_proposal_states s
   WHERE s.company_id=NEW.company_id AND s.product_id=NEW.product_id
    AND s.packs!='0' AND s.status NOT IN ('rejected','canceled','closed'))
  THEN RAISE(ABORT,'Replenishment quantity already reserved') END;
END;
--> statement-breakpoint
CREATE TRIGGER replenishment_origin_initialize AFTER INSERT ON replenishment_proposal_origins
BEGIN
 INSERT INTO replenishment_proposal_states
  (company_id,proposal_id,product_id,revision,status,packs,change_id,kind,changed_by,reason,changed_at,invalidation_reason)
  VALUES (NEW.company_id,NEW.id,NEW.product_id,1,NEW.initial_status,
   json_extract(NEW.snapshot_json,'$.explanation.recommendedPacks'),
   'origin:' || NEW.id,'create',NEW.created_by,'Proposal created',NEW.created_at,NULL);
 INSERT INTO replenishment_proposal_events
  (company_id,proposal_id,revision,change_id,kind,from_status,status,packs,actor,reason,at,invalidation_reason)
  VALUES (NEW.company_id,NEW.id,1,'origin:' || NEW.id,'create',NULL,NEW.initial_status,
   json_extract(NEW.snapshot_json,'$.explanation.recommendedPacks'),
   NEW.created_by,'Proposal created',NEW.created_at,NULL);
END;
--> statement-breakpoint
CREATE TRIGGER replenishment_state_update_guard BEFORE UPDATE ON replenishment_proposal_states
BEGIN
 SELECT CASE WHEN NEW.company_id!=OLD.company_id OR NEW.proposal_id!=OLD.proposal_id
  OR NEW.product_id!=OLD.product_id OR NEW.revision!=OLD.revision+1
  OR NEW.change_id=OLD.change_id OR length(trim(NEW.change_id))=0
  OR length(trim(NEW.changed_by))=0 OR length(trim(NEW.reason))=0
  OR NEW.kind NOT IN ('edit','invalidate','cancel','supplier')
  OR NEW.status NOT IN ('draft','review_required','approved','sending','unknown','accepted','rejected','canceled','partially_received','closed')
  OR length(NEW.packs)=0 OR length(NEW.packs)>20 OR NEW.packs GLOB '*[^0-9]*'
  OR (length(NEW.packs)>1 AND substr(NEW.packs,1,1)='0')
  OR CAST(NEW.packs AS INTEGER)>9007199254740991
  THEN RAISE(ABORT,'Invalid replenishment state revision') END;
 SELECT CASE WHEN NOT (
  (NEW.kind='edit' AND OLD.status IN ('draft','review_required')
   AND OLD.invalidation_reason IS NULL
   AND NEW.status=OLD.status AND NEW.invalidation_reason IS OLD.invalidation_reason)
  OR (NEW.kind='invalidate' AND OLD.status NOT IN ('rejected','canceled','closed')
   AND OLD.invalidation_reason IS NULL AND NEW.packs=OLD.packs
   AND NEW.changed_by='system'
   AND NEW.invalidation_reason IN ('inventory_changed','inventory_config_changed','settings_changed','source_unavailable')
   AND NEW.status=CASE WHEN OLD.status IN ('draft','approved') THEN 'review_required' ELSE OLD.status END)
  OR (NEW.kind='cancel' AND OLD.status IN ('draft','review_required','approved')
   AND NEW.status='canceled' AND NEW.packs=OLD.packs
   AND NEW.invalidation_reason IS OLD.invalidation_reason)
  OR (NEW.kind='supplier' AND NEW.packs=OLD.packs
   AND NEW.invalidation_reason IS OLD.invalidation_reason AND (
    (OLD.status='approved' AND NEW.status='sending')
    OR (OLD.status='sending' AND NEW.status IN ('unknown','accepted','rejected'))
    OR (OLD.status='unknown' AND NEW.status IN ('accepted','rejected'))
    OR (OLD.status='accepted' AND NEW.status IN ('partially_received','closed'))
    OR (OLD.status IN ('rejected','canceled','partially_received') AND NEW.status='closed')
   ))
 ) THEN RAISE(ABORT,'Invalid replenishment state transition') END;
 SELECT CASE WHEN NEW.packs!='0' AND NEW.status NOT IN ('rejected','canceled','closed')
  AND (OLD.packs='0' OR OLD.status IN ('rejected','canceled','closed'))
  AND EXISTS (SELECT 1 FROM replenishment_proposal_states s
   WHERE s.company_id=NEW.company_id AND s.product_id=NEW.product_id
    AND s.proposal_id!=NEW.proposal_id AND s.packs!='0'
    AND s.status NOT IN ('rejected','canceled','closed'))
  THEN RAISE(ABORT,'Replenishment quantity already reserved') END;
END;
--> statement-breakpoint
CREATE TRIGGER replenishment_state_audit AFTER UPDATE ON replenishment_proposal_states
BEGIN
 INSERT INTO replenishment_proposal_events
  (company_id,proposal_id,revision,change_id,kind,from_status,status,packs,actor,reason,at,invalidation_reason)
 VALUES (NEW.company_id,NEW.proposal_id,NEW.revision,NEW.change_id,NEW.kind,
  OLD.status,NEW.status,NEW.packs,NEW.changed_by,NEW.reason,NEW.changed_at,NEW.invalidation_reason);
END;
--> statement-breakpoint
CREATE TRIGGER replenishment_state_no_delete BEFORE DELETE ON replenishment_proposal_states
BEGIN SELECT RAISE(ABORT,'Replenishment state cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER replenishment_event_no_update BEFORE UPDATE ON replenishment_proposal_events
BEGIN SELECT RAISE(ABORT,'Replenishment audit history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER replenishment_event_no_delete BEFORE DELETE ON replenishment_proposal_events
BEGIN SELECT RAISE(ABORT,'Replenishment audit history is immutable'); END;
