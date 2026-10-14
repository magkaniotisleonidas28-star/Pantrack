CREATE TABLE `purchase_order_draft_events` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`, `revision`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `purchase_order_drafts`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`operation_id`) REFERENCES `purchase_order_draft_operations`(`company_id`,`operation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_draft_event_operation` ON `purchase_order_draft_events` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_draft_lines` (
	`company_id` text NOT NULL,
	`order_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`product_id` text,
	`proposal_id` text,
	`source_revision` integer,
	`data_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `order_id`, `id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `purchase_order_drafts`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`proposal_id`) REFERENCES `replenishment_proposal_origins`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_order_draft_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`order_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`,`order_id`) REFERENCES `purchase_order_drafts`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_order_drafts` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`number` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_draft_number` ON `purchase_order_drafts` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `po_draft_history` ON `purchase_order_drafts` (`company_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER po_draft_initial_guard BEFORE INSERT ON purchase_order_drafts
WHEN NEW.status!='draft' OR NEW.revision!=1
 OR json_extract(NEW.snapshot_json,'$.companyId') IS NOT NEW.company_id
 OR json_extract(NEW.snapshot_json,'$.id') IS NOT NEW.id
 OR json_extract(NEW.snapshot_json,'$.number') IS NOT NEW.number
 OR json_extract(NEW.snapshot_json,'$.supplier.id') IS NOT NEW.supplier_id
 OR json_extract(NEW.snapshot_json,'$.contract') IS NOT 'pantrack.purchase-order-draft.v1'
BEGIN SELECT RAISE(ABORT,'Invalid PO draft snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_update_guard BEFORE UPDATE ON purchase_order_drafts
WHEN NEW.company_id!=OLD.company_id OR NEW.id!=OLD.id OR NEW.number!=OLD.number
 OR NEW.supplier_id!=OLD.supplier_id OR NEW.snapshot_json!=OLD.snapshot_json OR NEW.created_at!=OLD.created_at
 OR OLD.status!='draft' OR NEW.status!='canceled' OR NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'PO draft snapshot is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_no_delete BEFORE DELETE ON purchase_order_drafts
BEGIN SELECT RAISE(ABORT,'PO draft history cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_operation_guard BEFORE INSERT ON purchase_order_draft_operations
WHEN NEW.write_guard!=1
BEGIN SELECT RAISE(ABORT,'PO draft source or membership guard failed'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_event_guard BEFORE INSERT ON purchase_order_draft_events
WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM purchase_order_drafts WHERE company_id=NEW.company_id AND id=NEW.order_id AND revision=NEW.revision
  AND ((NEW.kind='create' AND status='draft' AND NEW.revision=1) OR (NEW.kind='cancel' AND status='canceled' AND NEW.revision=2)))
BEGIN SELECT RAISE(ABORT,'Invalid PO draft audit or membership'); END;
--> statement-breakpoint
CREATE TRIGGER po_draft_line_guard BEFORE INSERT ON purchase_order_draft_lines
WHEN NOT ((NEW.kind='stock' AND NEW.product_id IS NOT NULL) OR
 (NEW.kind='non_stock' AND NEW.product_id IS NULL AND NEW.proposal_id IS NULL AND NEW.source_revision IS NULL))
 OR json_extract(NEW.data_json,'$.id') IS NOT NEW.id
 OR json_extract(NEW.data_json,'$.kind') IS NOT NEW.kind
 OR json_extract(NEW.data_json,'$.productId') IS NOT NEW.product_id
BEGIN SELECT RAISE(ABORT,'Invalid PO draft line mapping'); END;

--> statement-breakpoint
CREATE TRIGGER purchase_order_draft_lines_no_update BEFORE UPDATE ON purchase_order_draft_lines
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER purchase_order_draft_lines_no_delete BEFORE DELETE ON purchase_order_draft_lines
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER purchase_order_draft_operations_no_update BEFORE UPDATE ON purchase_order_draft_operations
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER purchase_order_draft_operations_no_delete BEFORE DELETE ON purchase_order_draft_operations
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER purchase_order_draft_events_no_update BEFORE UPDATE ON purchase_order_draft_events
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;

--> statement-breakpoint
CREATE TRIGGER purchase_order_draft_events_no_delete BEFORE DELETE ON purchase_order_draft_events
BEGIN SELECT RAISE(ABORT,'PO draft evidence is immutable'); END;
