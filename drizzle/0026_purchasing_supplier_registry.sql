CREATE TABLE `purchasing_mapping_versions` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`data_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`, `version`),
	FOREIGN KEY (`company_id`,`id`) REFERENCES `purchasing_mappings`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchasing_mappings` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`location_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`supplier_id`) REFERENCES `purchasing_suppliers`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`product_id`) REFERENCES `products`(`owner`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchasing_active_sku` ON `purchasing_mappings` (`company_id`,`supplier_id`,`account_id`,`location_id`,`sku`) WHERE "purchasing_mappings"."status"='active';--> statement-breakpoint
CREATE INDEX `purchasing_mapping_list` ON `purchasing_mappings` (`company_id`,`supplier_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `purchasing_registry_events` (
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`version` integer NOT NULL,
	`operation_id` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`company_id`, `kind`, `entity_id`, `version`),
	FOREIGN KEY (`company_id`,`operation_id`) REFERENCES `purchasing_registry_operations`(`company_id`,`operation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchasing_registry_event_operation` ON `purchasing_registry_events` (`company_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `purchasing_registry_operations` (
	`company_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`write_guard` integer NOT NULL,
	PRIMARY KEY(`company_id`, `operation_id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchasing_supplier_versions` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`data_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`, `version`),
	FOREIGN KEY (`company_id`,`id`) REFERENCES `purchasing_suppliers`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchasing_suppliers` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchasing_supplier_list` ON `purchasing_suppliers` (`company_id`,`updated_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER purchasing_supplier_initial_guard BEFORE INSERT ON purchasing_suppliers
WHEN NEW.version!=1 OR NEW.status!='active'
BEGIN SELECT RAISE(ABORT,'Invalid supplier head'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_supplier_update_guard BEFORE UPDATE ON purchasing_suppliers
WHEN NEW.company_id!=OLD.company_id OR NEW.id!=OLD.id OR NEW.version!=OLD.version+1
 OR OLD.status!='active' OR NEW.status NOT IN ('active','archived')
BEGIN SELECT RAISE(ABORT,'Invalid supplier version transition'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_mapping_initial_guard BEFORE INSERT ON purchasing_mappings
WHEN NEW.version!=1 OR NEW.status!='active'
BEGIN SELECT RAISE(ABORT,'Invalid mapping head'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_mapping_update_guard BEFORE UPDATE ON purchasing_mappings
WHEN NEW.company_id!=OLD.company_id OR NEW.id!=OLD.id OR NEW.version!=OLD.version+1
 OR NEW.supplier_id!=OLD.supplier_id OR NEW.account_id!=OLD.account_id OR NEW.location_id!=OLD.location_id OR NEW.product_id!=OLD.product_id
 OR OLD.status!='active' OR NEW.status NOT IN ('active','archived')
BEGIN SELECT RAISE(ABORT,'Invalid mapping version transition'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_supplier_version_guard BEFORE INSERT ON purchasing_supplier_versions
WHEN json_extract(NEW.data_json,'$.companyId') IS NOT NEW.company_id
 OR json_extract(NEW.data_json,'$.id') IS NOT NEW.id OR json_extract(NEW.data_json,'$.version') IS NOT NEW.version
 OR NOT EXISTS (SELECT 1 FROM purchasing_suppliers h WHERE h.company_id=NEW.company_id AND h.id=NEW.id AND h.version=NEW.version
  AND h.status=json_extract(NEW.data_json,'$.status') AND h.name=json_extract(NEW.data_json,'$.profile.name'))
BEGIN SELECT RAISE(ABORT,'Invalid supplier version snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_mapping_version_guard BEFORE INSERT ON purchasing_mapping_versions
WHEN json_extract(NEW.data_json,'$.companyId') IS NOT NEW.company_id
 OR json_extract(NEW.data_json,'$.id') IS NOT NEW.id OR json_extract(NEW.data_json,'$.version') IS NOT NEW.version
 OR NOT EXISTS (SELECT 1 FROM purchasing_mappings h WHERE h.company_id=NEW.company_id AND h.id=NEW.id AND h.version=NEW.version
  AND h.status=json_extract(NEW.data_json,'$.status') AND h.supplier_id=json_extract(NEW.data_json,'$.supplierId')
  AND h.account_id=json_extract(NEW.data_json,'$.accountId') AND h.location_id=json_extract(NEW.data_json,'$.locationId')
  AND h.product_id=json_extract(NEW.data_json,'$.productId') AND h.sku=json_extract(NEW.data_json,'$.sku'))
BEGIN SELECT RAISE(ABORT,'Invalid mapping version snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_registry_operation_guard BEFORE INSERT ON purchasing_registry_operations
WHEN NEW.write_guard!=1
BEGIN SELECT RAISE(ABORT,'Registry source or membership guard failed'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_registry_event_guard BEFORE INSERT ON purchasing_registry_events
WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role IN ('owner','manager'))
 OR NOT ((NEW.kind='profile' AND EXISTS (SELECT 1 FROM purchasing_supplier_versions WHERE company_id=NEW.company_id AND id=NEW.entity_id AND version=NEW.version AND json_extract(data_json,'$.actor')=NEW.actor AND json_extract(data_json,'$.reason')=NEW.reason AND json_extract(data_json,'$.at')=NEW.at))
  OR (NEW.kind='mapping' AND EXISTS (SELECT 1 FROM purchasing_mapping_versions WHERE company_id=NEW.company_id AND id=NEW.entity_id AND version=NEW.version AND json_extract(data_json,'$.actor')=NEW.actor AND json_extract(data_json,'$.reason')=NEW.reason AND json_extract(data_json,'$.at')=NEW.at)))
BEGIN SELECT RAISE(ABORT,'Invalid registry audit or membership'); END;
--> statement-breakpoint
-- Additive compatibility: v1 drafts remain readable; only the registry source uses v2.
DROP TRIGGER po_draft_initial_guard;
--> statement-breakpoint
CREATE TRIGGER po_draft_initial_guard BEFORE INSERT ON purchase_order_drafts
WHEN NEW.status!='draft' OR NEW.revision!=1
 OR json_extract(NEW.snapshot_json,'$.companyId') IS NOT NEW.company_id
 OR json_extract(NEW.snapshot_json,'$.id') IS NOT NEW.id
 OR json_extract(NEW.snapshot_json,'$.number') IS NOT NEW.number
 OR json_extract(NEW.snapshot_json,'$.supplier.id') IS NOT NEW.supplier_id
 OR COALESCE(json_extract(NEW.snapshot_json,'$.contract'),'') NOT IN ('pantrack.purchase-order-draft.v1','pantrack.purchase-order-draft.v2')
 OR (json_extract(NEW.snapshot_json,'$.contract')='pantrack.purchase-order-draft.v2' AND json_extract(NEW.snapshot_json,'$.source') IS NOT 'registry')
BEGIN SELECT RAISE(ABORT,'Invalid PO draft snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_supplier_versions_no_update BEFORE UPDATE ON purchasing_supplier_versions
BEGIN SELECT RAISE(ABORT,'Registry evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_supplier_versions_no_delete BEFORE DELETE ON purchasing_supplier_versions
BEGIN SELECT RAISE(ABORT,'Registry evidence cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_mapping_versions_no_update BEFORE UPDATE ON purchasing_mapping_versions
BEGIN SELECT RAISE(ABORT,'Registry evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_mapping_versions_no_delete BEFORE DELETE ON purchasing_mapping_versions
BEGIN SELECT RAISE(ABORT,'Registry evidence cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_registry_operations_no_update BEFORE UPDATE ON purchasing_registry_operations
BEGIN SELECT RAISE(ABORT,'Registry evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_registry_operations_no_delete BEFORE DELETE ON purchasing_registry_operations
BEGIN SELECT RAISE(ABORT,'Registry evidence cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_registry_events_no_update BEFORE UPDATE ON purchasing_registry_events
BEGIN SELECT RAISE(ABORT,'Registry evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_registry_events_no_delete BEFORE DELETE ON purchasing_registry_events
BEGIN SELECT RAISE(ABORT,'Registry evidence cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_suppliers_no_delete BEFORE DELETE ON purchasing_suppliers
BEGIN SELECT RAISE(ABORT,'Registry evidence cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER purchasing_mappings_no_delete BEFORE DELETE ON purchasing_mappings
BEGIN SELECT RAISE(ABORT,'Registry evidence cannot be deleted'); END;
