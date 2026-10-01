ALTER TABLE `inventory_config_versions` ADD `purchase_entered_amount` text;--> statement-breakpoint
ALTER TABLE `inventory_config_versions` ADD `purchase_entered_unit_id` text;
--> statement-breakpoint
CREATE TRIGGER inventory_pack_history_no_update
BEFORE UPDATE OF stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,purchase_entered_amount,purchase_entered_unit_id ON inventory_config_versions
WHEN OLD.status <> 'pending'
BEGIN SELECT RAISE(ABORT, 'Saved package conversion is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_pack_history_no_delete
BEFORE DELETE ON inventory_config_versions WHEN OLD.status <> 'pending'
BEGIN SELECT RAISE(ABORT, 'Saved package conversion cannot be deleted'); END;
