'use client';
import {Button} from '@/components/ui/button';
import type {ArchivePreparationEvidence} from '@/lib/document-archive-preparation-contract';

const outcomes={matched:'The last recorded check matched the prepared details.',missing:'The file was not found at the last recorded check.',
  damaged:'The last recorded contents differed from the prepared details.',unavailable:'The last recorded read could not confirm the file.',write_unconfirmed:'Storage did not confirm the earlier write.'};
export default function DocumentPreparationEvidence({evidence,disabled,onRefresh}:{evidence:ArchivePreparationEvidence;disabled:boolean;onRefresh:()=>void}){
  if(evidence.state==='issued')return null;
  return <section aria-label="Prepared file evidence">
    <h4>Prepared file evidence</h4>
    <p>Opening this panel reads stored records only. The file may have changed since the recorded check. Continuing or issuing a save is a separate action.</p>
    {evidence.state==='not_recorded'?<p>No durable preparation record is stored for this save. The existing save process determines what can safely happen next.</p>:<>
      <p><strong>Preparation recorded; copy not issued.</strong></p>
      <dl><dt>Expected file</dt><dd>{evidence.expected.format==='pdf'?'PDF':'Excel'} · {evidence.expected.size.toLocaleString()} bytes</dd>
        <dt>Original source</dt><dd>{evidence.expected.sourceKind==='draft'?'Saved draft':`Saved history · ${evidence.expected.sourceRecordCount} ${evidence.expected.sourceRecordCount===1?'order':'orders'}`}</dd></dl>
      {evidence.latestStorageEvidence?<p>{outcomes[evidence.latestStorageEvidence.outcome]}{' '}<time dateTime={evidence.latestStorageEvidence.at}>{new Date(evidence.latestStorageEvidence.at).toLocaleString()}</time>.</p>:<p>No file-storage observation has been recorded for this prepared file.</p>}
      <p>A matching check alone does not issue or approve this copy.</p>
      <details><summary>File identifiers</summary><dl>
        <dt>Expected SHA-256</dt><dd className="break-all">{evidence.expected.sha256}</dd>
        <dt>Original source fingerprint</dt><dd className="break-all">{evidence.expected.sourceFingerprint}</dd>
        <dt>Template version</dt><dd className="break-all">{evidence.expected.template}</dd>
      </dl></details>
    </>}
    <Button type="button" variant="outline" disabled={disabled} onClick={onRefresh}>Refresh evidence</Button>
  </section>;
}
