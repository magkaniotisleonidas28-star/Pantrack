-- Tokenless prepared checks have their own admitted identity. They never satisfy
-- the existing publication trigger, which requires the original save lease token.
DROP TRIGGER document_archive_observation_guard;
--> statement-breakpoint
CREATE TRIGGER document_archive_observation_guard BEFORE INSERT ON document_archive_observations
WHEN (NEW.token IS NULL AND json_extract(NEW.payload_json,'$.kind') IS NOT 'prepared_check'
 AND NOT EXISTS(SELECT 1 FROM document_archive_intents WHERE company_id=NEW.company_id AND id=NEW.document_id AND artifact_json IS NOT NULL))
 OR (NEW.token IS NOT NULL AND NOT EXISTS(SELECT 1 FROM document_archive_intents WHERE company_id=NEW.company_id AND id=NEW.document_id AND actor_id=NEW.actor_id))
 OR coalesce(json_extract(NEW.payload_json,'$.kind'),'') NOT IN ('generation','object','read_unknown','write_unknown','source_check','hold','prepared_check')
 OR (json_extract(NEW.payload_json,'$.kind')='prepared_check' AND (
  NEW.token IS NOT NULL
  OR coalesce(json_extract(NEW.payload_json,'$.contract')!='pantrack.prepared-file-check.v1'
   OR json_type(NEW.payload_json,'$.operationId')!='text' OR length(json_extract(NEW.payload_json,'$.operationId'))!=36
   OR json_type(NEW.payload_json,'$.manifestFingerprint')!='text' OR length(json_extract(NEW.payload_json,'$.manifestFingerprint'))!=64
   OR json_extract(NEW.payload_json,'$.manifestFingerprint') GLOB '*[^0-9a-f]*'
   OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.at) IS NOT NEW.at,1)
  OR NOT EXISTS(SELECT 1 FROM document_archive_intents i WHERE i.company_id=NEW.company_id AND i.id=NEW.document_id AND i.manifest_json IS NOT NULL)
  OR coalesce(NOT (
   (json_extract(NEW.payload_json,'$.stage')='requested'
    AND NEW.id=json_extract(NEW.payload_json,'$.operationId')
    AND NOT EXISTS(SELECT 1 FROM document_archive_observations o WHERE o.company_id=NEW.company_id AND o.id=NEW.id)
    AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=NEW.company_id AND m.user_id=NEW.actor_id AND m.role IN ('owner','manager'))
    AND EXISTS(SELECT 1 FROM document_archive_intents i WHERE i.company_id=NEW.company_id AND i.id=NEW.document_id
     AND i.artifact_json IS NULL AND i.manifest_json=json_extract(NEW.payload_json,'$.manifest')))
   OR (json_extract(NEW.payload_json,'$.stage') IN ('observed','completed')
    AND NEW.id!=json_extract(NEW.payload_json,'$.operationId')
    AND EXISTS(SELECT 1 FROM document_archive_observations r WHERE r.company_id=NEW.company_id AND r.document_id=NEW.document_id
     AND r.id=json_extract(NEW.payload_json,'$.operationId') AND r.actor_id=NEW.actor_id AND r.token IS NULL AND r.at<=NEW.at
     AND json_extract(r.payload_json,'$.kind')='prepared_check' AND json_extract(r.payload_json,'$.contract')='pantrack.prepared-file-check.v1'
     AND json_extract(r.payload_json,'$.stage')='requested' AND json_extract(r.payload_json,'$.operationId')=r.id
     AND json_extract(r.payload_json,'$.manifestFingerprint')=json_extract(NEW.payload_json,'$.manifestFingerprint'))
    AND (
     (json_extract(NEW.payload_json,'$.stage')='observed'
      AND json_type(NEW.payload_json,'$.observation')='object'
      AND (json_extract(NEW.payload_json,'$.observation.kind')='read_unknown'
       OR (json_extract(NEW.payload_json,'$.observation.kind')='object'
        AND json_type(NEW.payload_json,'$.observation.present') IN ('true','false')
        AND json_type(NEW.payload_json,'$.observation.reportedSize') IN ('integer','null')
        AND json_type(NEW.payload_json,'$.observation.byteLength') IN ('integer','null')
        AND (json_type(NEW.payload_json,'$.observation.byteLength')='null' OR json_extract(NEW.payload_json,'$.observation.byteLength')>=0)
        AND (json_type(NEW.payload_json,'$.observation.sha256')='null'
         OR (json_type(NEW.payload_json,'$.observation.sha256')='text' AND length(json_extract(NEW.payload_json,'$.observation.sha256'))=64
          AND json_extract(NEW.payload_json,'$.observation.sha256') NOT GLOB '*[^0-9a-f]*')))))
     OR (json_extract(NEW.payload_json,'$.stage')='completed'
      AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=NEW.company_id AND m.user_id=NEW.actor_id AND m.role IN ('owner','manager'))
      AND EXISTS(SELECT 1 FROM document_archive_intents i JOIN document_archive_observations r ON r.company_id=i.company_id AND r.document_id=i.id
       WHERE i.company_id=NEW.company_id AND i.id=NEW.document_id AND i.artifact_json IS NULL
       AND r.id=json_extract(NEW.payload_json,'$.operationId') AND i.manifest_json=json_extract(r.payload_json,'$.manifest'))
      AND EXISTS(SELECT 1 FROM document_archive_observations d WHERE d.company_id=NEW.company_id AND d.document_id=NEW.document_id
       AND d.id=json_extract(NEW.payload_json,'$.observationId') AND d.actor_id=NEW.actor_id AND d.token IS NULL AND d.at<=NEW.at
       AND json_extract(d.payload_json,'$.kind')='prepared_check' AND json_extract(d.payload_json,'$.contract')='pantrack.prepared-file-check.v1'
       AND json_extract(d.payload_json,'$.stage')='observed' AND json_extract(d.payload_json,'$.operationId')=json_extract(NEW.payload_json,'$.operationId')
       AND json_extract(d.payload_json,'$.manifestFingerprint')=json_extract(NEW.payload_json,'$.manifestFingerprint'))
      AND NOT EXISTS(SELECT 1 FROM document_archive_observations o WHERE o.company_id=NEW.company_id
       AND json_extract(o.payload_json,'$.kind')='prepared_check' AND json_extract(o.payload_json,'$.stage')='completed'
       AND json_extract(o.payload_json,'$.operationId')=json_extract(NEW.payload_json,'$.operationId')))
    ))
  ),1)
 ))
BEGIN SELECT RAISE(ABORT,'Invalid archive observation'); END;
