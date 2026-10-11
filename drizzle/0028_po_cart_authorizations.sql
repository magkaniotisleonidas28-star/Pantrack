CREATE TABLE `po_cart_authorizations` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`order_id` text NOT NULL,
	`generation` integer NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`connection_id` text NOT NULL,
	`connection_version` integer NOT NULL,
	`policy_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`released_at` text,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `purchase_order_drafts`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`connection_id`,`connection_version`) REFERENCES `po_cart_connections`(`company_id`,`id`,`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`policy_version`) REFERENCES `po_cart_budget_policies`(`company_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_unreleased_order` ON `po_cart_authorizations` (`company_id`,`order_id`) WHERE "po_cart_authorizations"."released_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_order_history` ON `po_cart_authorizations` (`company_id`,`order_id`,`generation`);--> statement-breakpoint
CREATE TABLE `po_cart_budget_policies` (
	`company_id` text NOT NULL,
	`version` integer NOT NULL,
	`per_order_minor` integer NOT NULL,
	`outstanding_minor` integer NOT NULL,
	PRIMARY KEY(`company_id`, `version`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_commitments` (
	`company_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`product_id` text NOT NULL,
	`proposal_id` text,
	`quantity_json` text NOT NULL,
	`active` integer NOT NULL,
	PRIMARY KEY(`company_id`, `authorization_id`, `product_id`),
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`proposal_id`) REFERENCES `replenishment_proposal_origins`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_active_product` ON `po_cart_commitments` (`company_id`,`product_id`) WHERE "po_cart_commitments"."active"=1;--> statement-breakpoint
CREATE TABLE `po_cart_connections` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`data_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`, `version`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_events` (
	`company_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `authorization_id`, `revision`),
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `po_cart_reservations` (
	`company_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`total_minor` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`company_id`, `authorization_id`),
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `po_cart_exposure` ON `po_cart_reservations` (`company_id`,`state`);
--> statement-breakpoint
CREATE TRIGGER po_cart_connection_insert_guard BEFORE INSERT ON po_cart_connections
WHEN NEW.version<1 OR NEW.version!=COALESCE((SELECT MAX(version)+1 FROM po_cart_connections WHERE company_id=NEW.company_id AND id=NEW.id),1)
 OR json_extract(NEW.data_json,'$.companyId') IS NOT NEW.company_id
 OR json_extract(NEW.data_json,'$.id') IS NOT NEW.id OR json_extract(NEW.data_json,'$.version') IS NOT NEW.version
 OR json_extract(NEW.data_json,'$.mode') IS NOT 'fictional'
BEGIN SELECT RAISE(ABORT,'Invalid fictional connection version'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_policy_insert_guard BEFORE INSERT ON po_cart_budget_policies
WHEN NEW.version!=COALESCE((SELECT MAX(version)+1 FROM po_cart_budget_policies WHERE company_id=NEW.company_id),1)
 OR typeof(NEW.per_order_minor)!='integer' OR typeof(NEW.outstanding_minor)!='integer'
 OR NEW.per_order_minor<1 OR NEW.outstanding_minor<NEW.per_order_minor OR NEW.outstanding_minor>1000000000
BEGIN SELECT RAISE(ABORT,'Invalid fictional cart budget policy'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_operation_guard BEFORE INSERT ON po_cart_operations
WHEN NEW.write_guard!=1
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id
  AND user_id=json_extract(NEW.fingerprint,'$.actor') AND role IN ('owner','manager'))
BEGIN SELECT RAISE(ABORT,'Cart authorization guard or membership changed'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_authorization_insert_guard BEFORE INSERT ON po_cart_authorizations
WHEN NEW.revision!=1 OR NEW.status!='authorized' OR NEW.started_at IS NOT NULL OR NEW.released_at IS NOT NULL
 OR NEW.generation!=COALESCE((SELECT MAX(generation)+1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND order_id=NEW.order_id),1)
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id
  AND user_id=json_extract(NEW.payload_json,'$.preflight.actor') AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM purchase_order_drafts p WHERE p.company_id=NEW.company_id AND p.id=NEW.order_id
  AND p.status='reviewed' AND p.revision=json_extract(NEW.payload_json,'$.preflight.request.expectedRevision')
  AND p.snapshot_json=json_extract(NEW.payload_json,'$.snapshot'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_connections c WHERE c.company_id=NEW.company_id AND c.id=NEW.connection_id
  AND c.version=NEW.connection_version AND c.version=(SELECT MAX(version) FROM po_cart_connections WHERE company_id=c.company_id AND id=c.id)
  AND json(c.data_json)=json_extract(NEW.payload_json,'$.preflight.connection')
  AND json_extract(c.data_json,'$.mode')='fictional' AND json_extract(c.data_json,'$.status')='active'
  AND json_extract(c.data_json,'$.paused')=0)
 OR NEW.policy_version!=(SELECT MAX(version) FROM po_cart_budget_policies WHERE company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'Invalid or stale cart authorization'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_authorization_claims AFTER INSERT ON po_cart_authorizations
BEGIN
 INSERT INTO po_cart_reservations(company_id,authorization_id,total_minor,state)
 VALUES(NEW.company_id,NEW.id,CAST(json_extract(NEW.payload_json,'$.preflight.capMinor') AS INTEGER),'reserved');
 INSERT INTO po_cart_commitments(company_id,authorization_id,product_id,proposal_id,quantity_json,active)
 SELECT NEW.company_id,NEW.id,json_extract(value,'$.productId'),json_extract(value,'$.proposal.proposalId'),
  json_extract(value,'$.stockQuantity'),1 FROM json_each(NEW.payload_json,'$.snapshot.lines') WHERE json_extract(value,'$.kind')='stock';
END;
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
   WHERE company_id=NEW.company_id AND state='reserved'),0))
BEGIN SELECT RAISE(ABORT,'Cart spending policy or outstanding exposure exceeded'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_commitment_guard BEFORE INSERT ON po_cart_commitments
WHEN NEW.active!=1 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations a, json_each(a.payload_json,'$.snapshot.lines') l
 WHERE a.company_id=NEW.company_id AND a.id=NEW.authorization_id AND a.released_at IS NULL
 AND json_extract(l.value,'$.kind')='stock' AND json_extract(l.value,'$.productId')=NEW.product_id
 AND json_extract(l.value,'$.stockQuantity')=NEW.quantity_json
 AND json_extract(l.value,'$.proposal.proposalId') IS NEW.proposal_id)
 OR EXISTS (SELECT 1 FROM replenishment_proposal_states s WHERE s.company_id=NEW.company_id AND s.product_id=NEW.product_id
  AND s.proposal_id IS NOT NEW.proposal_id AND s.packs!='0' AND s.status NOT IN ('rejected','canceled','closed'))
 OR EXISTS (SELECT 1 FROM supplier_simulation_source_holds s WHERE s.company_id=NEW.company_id AND s.product_id=NEW.product_id AND s.active=1)
BEGIN SELECT RAISE(ABORT,'Product already committed or invalid PO commitment'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_authorization_update_guard BEFORE UPDATE ON po_cart_authorizations
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id OR NEW.order_id IS NOT OLD.order_id
 OR NEW.generation IS NOT OLD.generation
 OR NEW.connection_id IS NOT OLD.connection_id OR NEW.connection_version IS NOT OLD.connection_version
 OR NEW.policy_version IS NOT OLD.policy_version OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision!=OLD.revision+1 OR NEW.status NOT IN ('authorized','invalidated','canceled')
 OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at)
 OR (OLD.released_at IS NOT NULL AND NEW.released_at IS NOT OLD.released_at)
 OR (NEW.released_at IS NOT NULL AND (NEW.started_at IS NOT NULL OR NEW.status='authorized'))
 OR NOT ((OLD.status='authorized' AND NEW.status IN ('invalidated','canceled') AND NEW.started_at IS OLD.started_at)
  OR (OLD.status='invalidated' AND NEW.status='canceled' AND NEW.started_at IS OLD.started_at)
  OR (OLD.status='authorized' AND NEW.status='authorized' AND OLD.started_at IS NULL AND NEW.started_at IS NOT NULL AND OLD.released_at IS NULL))
BEGIN SELECT RAISE(ABORT,'Invalid cart authorization transition'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_authorization_release AFTER UPDATE ON po_cart_authorizations
WHEN OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
BEGIN
 UPDATE po_cart_commitments SET active=0 WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND active=1;
 UPDATE po_cart_reservations SET state='released' WHERE company_id=NEW.company_id AND authorization_id=NEW.id AND state='reserved';
END;
--> statement-breakpoint
CREATE TRIGGER po_cart_commitment_release_guard BEFORE UPDATE ON po_cart_commitments
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR NEW.product_id IS NOT OLD.product_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.quantity_json IS NOT OLD.quantity_json
 OR OLD.active!=1 OR NEW.active!=0
 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND started_at IS NULL AND status IN ('canceled','invalidated'))
BEGIN SELECT RAISE(ABORT,'Unsafe cart commitment release'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_reservation_release_guard BEFORE UPDATE ON po_cart_reservations
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.total_minor IS NOT OLD.total_minor
 OR OLD.state!='reserved' OR NEW.state!='released'
 OR NOT EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND started_at IS NULL AND status IN ('canceled','invalidated'))
BEGIN SELECT RAISE(ABORT,'Unsafe cart exposure release'); END;
--> statement-breakpoint
-- PO transition and permission invalidation share the draft transaction, including its audit.
CREATE TRIGGER po_cart_invalidate_on_po_change AFTER UPDATE ON purchase_order_drafts
WHEN NEW.revision!=OLD.revision
BEGIN
 INSERT INTO po_cart_events(company_id,authorization_id,revision,kind,actor,reason,at)
 SELECT a.company_id,a.id,a.revision+1,'invalidated',json_extract(o.fingerprint,'$.actor'),
  'PO revision changed; preparation permission invalidated',json_extract(o.result_json,'$.events[#-1].at')
 FROM po_cart_authorizations a JOIN purchase_order_draft_operations o
  ON o.company_id=NEW.company_id AND o.order_id=NEW.id AND json_extract(o.result_json,'$.revision')=NEW.revision
 WHERE a.company_id=NEW.company_id AND a.order_id=NEW.id AND a.status='authorized';
 UPDATE po_cart_authorizations SET status='invalidated',revision=revision+1,
  released_at = CASE WHEN started_at IS NULL THEN
   (SELECT json_extract(result_json,'$.events[#-1].at') FROM purchase_order_draft_operations
    WHERE company_id=NEW.company_id AND order_id=NEW.id AND json_extract(result_json,'$.revision')=NEW.revision) ELSE NULL END
 WHERE company_id=NEW.company_id AND order_id=NEW.id AND status='authorized';
END;
--> statement-breakpoint
-- A/C handoff: a linked proposal is one quantity, but may not independently send/edit it.
CREATE TRIGGER po_cart_block_proposal_origin BEFORE INSERT ON replenishment_proposal_origins
WHEN EXISTS (SELECT 1 FROM po_cart_commitments WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND active=1)
BEGIN SELECT RAISE(ABORT,'Product held by PO preparation'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_block_proposal_insert BEFORE INSERT ON replenishment_proposal_states
WHEN NEW.packs!='0' AND NEW.status NOT IN ('rejected','canceled','closed')
 AND EXISTS (SELECT 1 FROM po_cart_commitments WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND active=1)
BEGIN SELECT RAISE(ABORT,'Product held by PO preparation'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_block_proposal_update BEFORE UPDATE ON replenishment_proposal_states
WHEN NEW.kind NOT IN ('invalidate','cancel') AND NEW.packs!='0' AND NEW.status NOT IN ('rejected','canceled','closed')
 AND (NEW.status IS NOT OLD.status OR NEW.packs IS NOT OLD.packs)
 AND EXISTS (SELECT 1 FROM po_cart_commitments WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND active=1)
BEGIN SELECT RAISE(ABORT,'Product held by PO preparation'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_block_simulation_hold BEFORE INSERT ON supplier_simulation_source_holds
WHEN NEW.active=1 AND EXISTS (SELECT 1 FROM po_cart_commitments WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND active=1)
BEGIN SELECT RAISE(ABORT,'Product held by PO preparation'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_connections_no_update BEFORE UPDATE ON po_cart_connections BEGIN SELECT RAISE(ABORT,'Cart configuration is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_connections_no_delete BEFORE DELETE ON po_cart_connections BEGIN SELECT RAISE(ABORT,'Cart configuration is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_policies_no_update BEFORE UPDATE ON po_cart_budget_policies BEGIN SELECT RAISE(ABORT,'Cart configuration is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_policies_no_delete BEFORE DELETE ON po_cart_budget_policies BEGIN SELECT RAISE(ABORT,'Cart configuration is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_operations_no_update BEFORE UPDATE ON po_cart_operations BEGIN SELECT RAISE(ABORT,'Cart audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_operations_no_delete BEFORE DELETE ON po_cart_operations BEGIN SELECT RAISE(ABORT,'Cart audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_events_no_update BEFORE UPDATE ON po_cart_events BEGIN SELECT RAISE(ABORT,'Cart audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_events_no_delete BEFORE DELETE ON po_cart_events BEGIN SELECT RAISE(ABORT,'Cart audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_authorizations_no_delete BEFORE DELETE ON po_cart_authorizations BEGIN SELECT RAISE(ABORT,'Cart history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_commitments_no_delete BEFORE DELETE ON po_cart_commitments BEGIN SELECT RAISE(ABORT,'Cart history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_reservations_no_delete BEFORE DELETE ON po_cart_reservations BEGIN SELECT RAISE(ABORT,'Cart history is immutable'); END;
