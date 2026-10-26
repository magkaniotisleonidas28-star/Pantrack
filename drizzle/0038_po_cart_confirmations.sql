CREATE TABLE `po_cart_confirmations` (
	`company_id` text NOT NULL,
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`job_revision` integer NOT NULL,
	`authorization_id` text NOT NULL,
	`authorization_revision` integer NOT NULL,
	`order_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`account_id` text NOT NULL,
	`supplier_reference` text NOT NULL,
	`currency` text NOT NULL,
	`lines_json` text NOT NULL,
	`extras_json` text NOT NULL,
	`charges_json` text NOT NULL,
	`item_subtotal_minor` integer NOT NULL,
	`charges_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`cap_minor` integer NOT NULL,
	`expected_delivery` text NOT NULL,
	`state` text NOT NULL,
	`provenance` text NOT NULL,
	`note` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt_json` text NOT NULL,
	PRIMARY KEY(`company_id`, `id`),
	FOREIGN KEY (`company_id`,`job_id`) REFERENCES `po_cart_jobs`(`company_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`,`authorization_id`) REFERENCES `po_cart_authorizations`(`company_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_one_confirmation` ON `po_cart_confirmations` (`company_id`,`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_confirmation_reference` ON `po_cart_confirmations` (`company_id`,`supplier_id`,`account_id`,`supplier_reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `po_cart_confirmation_operation` ON `po_cart_confirmations` (`company_id`,`operation_id`);
--> statement-breakpoint
-- Supplier confirmations are manager-entered, bound to the current ready job, its active
-- authorization and held reservation, and immutable. Over-cap totals wait for owner review.
CREATE TRIGGER po_cart_confirmation_insert_guard BEFORE INSERT ON po_cart_confirmations
WHEN NEW.provenance IS NOT 'manager_entered' OR NEW.currency IS NOT 'USD'
 OR length(NEW.supplier_reference)<1 OR length(NEW.supplier_reference)>100 OR NEW.supplier_reference IS NOT trim(NEW.supplier_reference)
 OR date(NEW.expected_delivery) IS NOT NEW.expected_delivery
 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at
 OR typeof(NEW.item_subtotal_minor)!='integer' OR typeof(NEW.charges_minor)!='integer' OR typeof(NEW.cap_minor)!='integer'
 OR NEW.item_subtotal_minor<0 OR NEW.charges_minor<0 OR NEW.total_minor IS NOT NEW.item_subtotal_minor+NEW.charges_minor OR NEW.total_minor>100000000000
 OR NOT ((NEW.state='confirmed' AND NEW.total_minor<=NEW.cap_minor) OR (NEW.state='needs_owner_review' AND NEW.total_minor>NEW.cap_minor))
 OR json_valid(NEW.lines_json)=0 OR json_valid(NEW.extras_json)=0 OR json_valid(NEW.charges_json)=0
 OR NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.actor AND role IN ('owner','manager'))
 OR NOT EXISTS (SELECT 1 FROM po_cart_jobs j JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
  JOIN po_cart_reservations r ON r.company_id=a.company_id AND r.authorization_id=a.id
  WHERE j.company_id=NEW.company_id AND j.id=NEW.job_id AND j.revision=NEW.job_revision AND j.state='ready'
  AND j.authorization_id=NEW.authorization_id AND j.supplier_id=NEW.supplier_id AND j.account_id=NEW.account_id
  AND a.revision=NEW.authorization_revision AND a.status='authorized' AND a.released_at IS NULL AND a.order_id=NEW.order_id
  AND r.state='reserved' AND r.total_minor=NEW.cap_minor)
BEGIN SELECT RAISE(ABORT,'Invalid or stale supplier confirmation'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_confirmations_no_update BEFORE UPDATE ON po_cart_confirmations BEGIN SELECT RAISE(ABORT,'Supplier confirmations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER po_cart_confirmations_no_delete BEFORE DELETE ON po_cart_confirmations BEGIN SELECT RAISE(ABORT,'Supplier confirmations are immutable'); END;
--> statement-breakpoint
-- A confirmed purchase is not undone by cancelling or invalidating its preparation.
CREATE TRIGGER po_cart_confirmed_job_lock BEFORE UPDATE ON po_cart_jobs
WHEN NEW.state IS NOT OLD.state AND EXISTS (SELECT 1 FROM po_cart_confirmations WHERE company_id=NEW.company_id AND job_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'This preparation has a recorded supplier confirmation'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_commitment_release_guard;
--> statement-breakpoint
-- Unchanged from 0033, plus: a confirmed purchase releases its commitments, because
-- order-linked incoming now accounts for the confirmed quantities.
CREATE TRIGGER po_cart_commitment_release_guard BEFORE UPDATE ON po_cart_commitments
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.authorization_id IS NOT OLD.authorization_id
 OR NEW.product_id IS NOT OLD.product_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.quantity_json IS NOT OLD.quantity_json
 OR OLD.active!=1 OR NEW.active!=0
 OR (NOT EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=NEW.company_id AND id=NEW.authorization_id
  AND released_at IS NOT NULL AND status IN ('canceled','invalidated') AND (started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=NEW.company_id AND r.authorization_id=NEW.authorization_id AND r.action='abandonVerifiedCart' AND r.authorization_revision=po_cart_authorizations.revision-1 AND r.at=po_cart_authorizations.released_at)))
  AND NOT EXISTS (SELECT 1 FROM po_cart_confirmations c WHERE c.company_id=NEW.company_id AND c.authorization_id=NEW.authorization_id AND c.state='confirmed'))
BEGIN SELECT RAISE(ABORT,'Unsafe cart commitment release'); END;
--> statement-breakpoint
DROP TRIGGER po_cart_owner_update_guard;
--> statement-breakpoint
-- Unchanged from 0033, plus: a recorded supplier confirmation proves checkout, so the
-- account's cart ownership may end.
CREATE TRIGGER po_cart_owner_update_guard BEFORE UPDATE ON po_cart_owners
WHEN NEW.company_id IS NOT OLD.company_id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.account_id IS NOT OLD.account_id
 OR typeof(NEW.fence)!='integer' OR NEW.fence<OLD.fence OR NEW.fence>9007199254740991
 OR (NEW.worker_id IS NULL)!=(NEW.lease_until IS NULL)
 OR (NEW.job_id IS NULL AND NEW.worker_id IS NOT NULL)
 OR (NEW.job_id IS NOT OLD.job_id AND NEW.fence!=OLD.fence+1)
 OR (NEW.worker_id IS NOT OLD.worker_id AND NEW.fence!=OLD.fence+1)
 OR (NEW.job_id IS NOT OLD.job_id AND OLD.job_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM po_cart_confirmations c WHERE c.company_id=OLD.company_id AND c.job_id=OLD.job_id) AND NOT EXISTS (
  SELECT 1 FROM po_cart_jobs j JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id
  WHERE j.company_id=OLD.company_id AND j.id=OLD.job_id AND a.released_at IS NOT NULL AND (a.started_at IS NULL OR EXISTS (SELECT 1 FROM po_cart_reconciliations r WHERE r.company_id=a.company_id AND r.authorization_id=a.id AND r.job_id=j.id AND r.action='abandonVerifiedCart' AND r.authorization_revision=a.revision-1 AND r.at=a.released_at))))
 OR (NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=NEW.company_id AND id=NEW.job_id
  AND supplier_id=NEW.supplier_id AND account_id=NEW.account_id))
BEGIN SELECT RAISE(ABORT,'Unsafe account cart ownership change'); END;
