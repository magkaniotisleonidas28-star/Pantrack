# C4 saved-document recovery policy and implementation handoff

Recorded: 2026-11-01. Outcome: a reviewable policy for one C4 document-recovery
workstream. This document defines future behavior; it adds no recovery command,
permission, database migration, file write, deletion or hosted activation.

**Product choice pending:** formal replacements are proposed as company-owner
only. The owner was asked whether managers should also authorize them; no answer
is recorded yet. This default is a proposal, not an accepted owner decision.
The next issued-file verification slice can proceed without that choice because
it uses the existing owner/manager read permission and creates no replacement.
C4/C5/M8 remain open.

Subsequent implementation: the [explicit issued-file check](C4_ISSUED_FILE_CHECK_LOCAL_EVIDENCE.md)
now implements the first slice below using the existing observation store, with
no schema change. This policy retains its original requirements and evidence;
the linked handoff records the implementation's separate current verification.

The subsequent [server-assisted continuation](C4_DOCUMENT_SAVE_CONTINUATION_LOCAL_EVIDENCE.md)
now retrieves the original request from the journal for its original current
owner/manager, including after losing the tab's recovery record. The implementation
reuses the existing save engine and adds no replacement authority or schema.

The later [prepared-file evidence view](C4_PREPARED_FILE_EVIDENCE_LOCAL_EVIDENCE.md)
now exposes retained preparation details and storage observations without reading
objects or changing rows. Fresh prepared-object verification remains a separate
future action; this metadata view never issues, retries or replaces a save.

## Reuse the existing behavior

The [archive lifecycle](../src/lib/purchase-order-document-archive.ts),
[D1 journal](../src/lib/d1-document-archive-journal.ts),
[browser recovery](../src/lib/purchase-order-archive-client.ts) and
[review screen](C4_DOCUMENT_ARCHIVE_REVIEW_LOCAL_EVIDENCE.md) already provide:

- A company/operation/request/original-actor identity that cannot be reassigned.
  Retry uses exactly that identity, not a newly generated operation ID.
- Original-actor retry while that person still has owner/manager access. A
  prepared save reads its exact stored object and never renders or puts again.
  Before a manifest exists, the normal guarded generation path can run again.
  A lost prepare acknowledgment must be resolved from durable journal state.
- Exact historical reads after edits or cancellation, with current company/role
  checks, bounded bytes, SHA-256/size checks and retained observations.
- Append-only evidence and read-only review of waiting/held/missing/damaged
  results. Refreshing that review does not perform a new file check.

The [strict archive command](../src/lib/purchase-order-document-archive-contract.ts)
does not accept replacement links, supplied roles, bytes or storage keys. Future
recovery controls must not silently reinterpret that existing command.

Existing evidence is in the [archive contract](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md),
[D1 evidence](C4_DOCUMENT_ARCHIVE_D1_LOCAL_EVIDENCE.md),
[app controls](C4_DOCUMENT_ARCHIVE_APP_LOCAL_EVIDENCE.md),
[native lifecycle cases](../tests/helpers/document-archive-review.mjs) and
[recovery/race tests](../tests/purchase-order-document-archive.mjs).
Those tests were inspected, not rerun for this documentation task. The review
feature's separate [GitHub run](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/41272603111)
passed for `1937c12`; it does not prove any proposed recovery behavior below.

## Three distinct actions

| Action | Identity and permission | Effects and limits |
| --- | --- | --- |
| Check an issued file now | Current company owner or manager; same document and immutable manifest. Future explicit action. | Read and verify the exact existing object; append a check result. Do not render, put, publish, replace or change business data. |
| Continue an interrupted save | Original actor, still a current company owner/manager; exact original operation and command. Existing behavior. | Reuse the journal's fenced attempt and source checks. A prepared operation only verifies its existing object. Another owner cannot impersonate the original actor. |
| Issue a linked replacement | Proposed owner-only authority, pending the choice above. New operation/document identity and current source. Future separate action. | Issue a new copy and retain a permanent link/reason. Never claim to restore the original bytes or make the old file healthy. |

Ordinary **Save PDF/Excel copy** already remains available to current owners and
managers for an exportable current source. It creates another ordinary document;
it does not authorize a formal replacement, resolve an old hold or establish
replacement history. The proposed owner-only rule must not be described as a
restriction on those existing ordinary saves.
No recovery action may change PO approval, stock, spending holds, confirmation,
delivery or supplier order state.

## What each recorded outcome permits

| Recorded situation | Permitted response |
| --- | --- |
| Save is still active | Wait or read the recorded status. The original request may return busy. Do not launch a competing save or treat browser cancellation as canceling the server write. |
| Save is expired/unconfirmed, with no manifest | Original actor may retry the exact command through the existing guarded generation path. A missing manifest must be established from the journal; a lost acknowledgment alone is insufficient. |
| Manifest exists and write/read outcome is unknown | Original-actor retry checks that exact object. Matching bytes can publish only if current access, lease and complete source checks still pass. Missing, mismatched or unavailable bytes stay held; never render or put again under that identity. |
| Source changed before issue, or access was lost | Refuse unauthorized reads/continuation. Publishing an unissued copy still requires its complete source to match. Restored access/source must pass every original guard; do not transfer the actor. A separate current-data copy needs its own identity. |
| Browser tab/recovery record was lost | Issued copies remain in the server catalog. An unissued operation remains visible in review. Do not guess an operation ID or create a fresh save as an invisible retry. Server-assisted continuation needs its own scoped implementation and the original actor. |
| Issued file is missing, mismatched or unreadable | A fresh issued-file check may append new evidence. Keep the immutable artifact and earlier failure. An unavailable provider response is uncertainty, not proof that no file exists. |
| A later check matches the original manifest | Report the check's identity/time. The current warning may clear, as review already supports; retain every earlier failed check. No replacement or repair is implied. |
| Draft changed or was canceled after issue | The verified old copy remains readable. Current-draft replacement cannot use a canceled or stale draft. A new history export may include canceled records only under the existing labeled history contract. |

## Rules for a future formal replacement

1. **Explicit intent and a reason.** Show the original's recorded problem, the
   proposed current source and the proposed approver. State that this is a new
   copy and the original may still exist or later become available. No automatic
   replacement, background retry or replacement triggered by opening review.
2. **Current company authority.** Enforce the selected role on the server and in
   the committing SQL. Recheck session, company and source at each sensitive
   boundary. Employee/anonymous/wrong-company requests fail before storage work.
   Owner authority never bypasses original-actor restrictions on continuation.
3. **No overwrite or invented history.** Keep the old document ID, operation,
   actor, source proof, template, hash, size, issue time, object and observations.
   Never delete/recreate an old object to make a retry pass. Metadata and an old
   PO revision do not prove that rendering can reproduce the original file.
4. **Fresh, truthful source.** Use the same source kind and format. A draft uses
   the same draft ID at a currently exportable revision. History uses the retained
   criteria with a freshly captured complete result and fingerprint, under the
   existing size limits. Clearly show changed revisions/matching records. Do not
   label current data as the exact historical original.
5. **Permanent lineage and stable replay.** Persist the new action ID, company,
   approver, reason, original reference and exact proposed source before any new
   object write. Bind a new archive operation/document to that action. Replaying
   the same action returns its existing outcome; changed actor/source/format or
   reason conflicts. Do not create another copy after an uncertain response.
6. **One issued direct replacement per original.** At most one replacement
   action may be active. Superseding a held, unissued candidate needs an explicit
   authorized reason after its active leases end; atomically fence its action
   from later publication when admitting the new action. Retain the candidate
   and any uncertain object. If safe fencing cannot be proved, keep the hold.
   Concurrent attempts cannot issue sibling replacements. A later failure of an
   issued replacement is handled against that new document, forming an acyclic
   chain. Every link stays within one company. Do not attach an unrelated
   pre-existing ordinary copy after the fact.
7. **Unknown stays unknown.** Refuse replacement while the original save's lease
   is active. Afterward, unresolved outcomes remain explicitly recorded even if
   an authorized new copy is issued. A replacement link does not make the old
   file healthy, prove an unknown write failed, or silently close its hold.
8. **Audit without credentials.** Retain actor, action/reference IDs, source
   identity, safe reason, check observations, result and timing. Persist inputs
   before refusal decisions. Exclude file bytes, credentials, lease tokens,
   storage URLs and raw provider errors from browser responses and general logs.

These lineage, approval and command receipts do **not** exist in the current
archive interfaces. A future implementation must add a focused contract and any
necessary additive migration after checking the shared schema queue. Do not
rewrite `0042`, reserve a migration number here, extend the old strict command
silently, or store replacement metadata by editing an immutable artifact.

No in-app delete, object overwrite, bulk cleanup, retention expiry or backup
restoration is authorized. Retention remains `retain-until-explicit-policy`;
no legal duration or production storage promise is established. Backup restore,
forensic repair, customer deletion and hosted operations require separate scoped
decisions/runbooks. A technical policy is not permission to perform them.

## Next bounded implementation: check an issued file now

Add an explicit **Check file now** action to the existing review, limited to
issued copies and current company owners/managers. Reuse the existing bounded
verification path instead of writing a second renderer or verifier. Keep the
existing Refresh action as a journal read; it must not begin scanning files.

Use a company-guarded POST with CSRF protection, document identity and a stable
check operation ID captured before dispatch. The command must bind the company,
document and requesting actor on the server. Return the recorded check identity,
time and safe outcome so a concurrent check is not mistaken for this request's
result. A replay returns that check's recorded result; a new explicit check gets
a new ID and a new observation. Reject collisions with another actor, document,
command or non-check observation. Audit records remain append-only.
Concurrent duplicate checks may perform the same read more than once; they must
settle on one durable result for that ID and never create or modify a file.

Reuse the existing observation store where its invariants support this safely;
do not promise a schema-free implementation before the exact receipt/atomicity
contract is inspected. Any needed schema work must use a new queued migration.
Never publish an unissued intent through this action. Prepared/unissued file
inspection and server-assisted original-request continuation are later separate
slices, not hidden additions to this issued-only check.

| Required acceptance case | Evidence to produce in that implementation |
| --- | --- |
| Anonymous, employee, another company, forged identity, missing CSRF | Refusal through the actual route and actual D1 authorization; no object work. |
| Valid PDF and Excel, draft and history copies | Native D1/R2 verification of the exact immutable file, including after source edit/cancellation. |
| Missing, corrupt, oversized or unavailable file | Persist safe observation before returning a held/uncertain result; no publish, generation, put or deletion. |
| Healthy file after an earlier failure | Record the new result/time while retaining the old failure; do not mutate the artifact. |
| Lost response and duplicate/concurrent same-ID checks | One durable receipt/result and stable replay; no duplicate document or overwritten check. A deliberate new check is distinct. |
| Access revoked, actor changed, company/document selection changed | Refuse unauthorized work at the real boundary; stale/canceled UI cannot restore another selection's data. A live PO edit/cancellation alone must not block checking an already-issued historical copy. |
| UI loading, stop, retry, error, recorded versus fresh results | Actual injected-resource lifecycle plus signed-in desktop/phone/keyboard walkthrough. |
| State preservation | Only declared check receipts/observations may append. Business rows, immutable archive records and all object bytes stay unchanged; compare the snapshot's application tables, not Cloudflare internals. |

After that check slice, separately scope server-assisted continuation for the
original actor. Formal replacement implementation additionally depends on the
role choice above and its lineage/receipt contract. Production, supplier/model
acceptance and purchasing remain separate.

## Task verification, integration and rollback

This is documentation-only work on a branch based on `1937c12` / PR #29, which
itself follows PR #28. The existing code/tests were read to distinguish current
behavior from future requirements. No application tests or migrations are run
or claimed for this policy. Verify whitespace, all changed relative file/section
links, unchanged acceptance checkboxes and consistency with the existing strict
archive command before publishing.

Local documentation verification passed: `git diff --cached --check`, all 418
relative links including 16 section targets, and agreement of all 29 A/B/C
checklist states. Acceptance checkboxes are unchanged. The diff contains only
these five documentation files; no new runtime or external acceptance is claimed.

The [G6 merge restriction](C4_FULL_OFFLINE_GATE_RUN_20261025.md#next-g6-then-the-separately-authorized-paid-matrix)
still applies; its operator's status is unknown. Keep the policy PR separate
until a safe integration point, merge its predecessor PRs in order and refresh
shared-document changes/checks before integration. No new gate or paid allowance
is granted. Rollback reverts this documentation commit; no data repair follows.
