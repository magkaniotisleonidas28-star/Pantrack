DROP TRIGGER replenishment_state_update_guard;
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
 SELECT CASE WHEN (
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
 ) IS NOT TRUE THEN RAISE(ABORT,'Invalid replenishment state transition') END;
 SELECT CASE WHEN NEW.packs!='0' AND NEW.status NOT IN ('rejected','canceled','closed')
  AND (OLD.packs='0' OR OLD.status IN ('rejected','canceled','closed'))
  AND EXISTS (SELECT 1 FROM replenishment_proposal_states s
   WHERE s.company_id=NEW.company_id AND s.product_id=NEW.product_id
    AND s.proposal_id!=NEW.proposal_id AND s.packs!='0'
    AND s.status NOT IN ('rejected','canceled','closed'))
  THEN RAISE(ABORT,'Replenishment quantity already reserved') END;
END;
