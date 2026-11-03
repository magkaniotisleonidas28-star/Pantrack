# C4 prepared-file evidence review — local evidence

Recorded: 2026-11-01. Workstream/checklist: C4. One bounded outcome: current
company owners/managers can inspect retained preparation metadata for unissued
document saves without touching objects or changing any application/archive row.
This follows [original-request continuation](C4_DOCUMENT_SAVE_CONTINUATION_LOCAL_EVIDENCE.md)
and the [recovery policy](C4_DOCUMENT_RECOVERY_POLICY_20261101.md).

## What the review proves

The existing save-history detail now distinguishes:

- **No preparation recorded:** no durable manifest exists for this save. The view
  makes no assertion about object presence and does not start generation.
- **Preparation recorded, copy not issued:** original expected format, byte size,
  template, source fingerprint and record count come from the retained manifest.
  The last storage evidence is labeled matched, missing, damaged, unavailable or
  write unconfirmed, with its original observation time. No observation remains
  explicitly unknown. The original request time is never called a preparation time.
- **Issued:** the unissued preparation panel is hidden. Existing issued-copy
  review, checks and downloads retain their separate behavior.

Opening or refreshing this panel reads the journal only. A stored match does not
establish current object presence, source freshness, publication or approval.
Physical deletion, corruption or restoration cannot silently update the view's
recorded outcome; only a later retained observation can do so. Source edits and
cancellation never replace the original manifest's size, digest, template or
source proof. Refresh evidence does not continue a save or invoke a file check.

The expected digest/source fingerprint/template are available inside **File
identifiers**, leaving ordinary file/source/result information visible. No
object key, URL, lease token, raw observation payload or additional actor identity
is returned. Read access uses the existing company owner/manager policy; it does
not confer the original-actor continuation permission. Another company owner can
inspect evidence while remaining unable to continue another person's save.

## Implementation and affected contracts

- [Preparation DTOs](../src/lib/document-archive-preparation-contract.ts) define
  strict states and a bounded whitelist of expected metadata and stored outcomes.
- [Review projection](../src/lib/d1-document-archive-review.ts) derives the field
  from the same authorized snapshot already used for detail and event history.
  It adds no query, source capture, R2 call, renderer, journal writer or route.
- [Review DTO validation](../src/lib/document-archive-review-contract.ts) accepts
  older responses without the optional field and rejects mismatched issue state,
  format, source kind, original request time, template, record count or check time.
  Missing legacy fields never mean that no preparation exists.
- [The evidence component](../src/components/workspace/document-preparation-evidence.tsx)
  is stateless. [Existing review controls](../src/components/workspace/document-archive-review.tsx)
  own refresh, company/source binding, loading, abort/disposal and private-data
  clearing. Existing continuation and issued-file actions stay separate.

There is no migration, schema, dependency, binding or hosted configuration change.
Every business row, intent, lease, observation and object is preserved by review.
The feature remains behind the existing archive-preview flag. Root and hosted
databases, gate resources, suppliers, paid models and purchasing are untouched.
C4/C5/M8 remain open; hosted/pilot/production acceptance is not claimed.

## Verification

Absolute evidence root:
`C:/Users/Leo/Project/Pantrack/.sites-runtime/c4-prepared-file-evidence-20261101`.

The original review-client baseline passed before editing. Focused API/client,
type and screen-rule checks passed during implementation. The signed-in browser
walkthrough and all six final frozen-source commands passed in this worktree:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 165 selected suites; 153 executed, 12 existing Windows POSIX skips |
| `pnpm db:check` | Passed: all 45 ordered migrations match the schema |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed: all 45 existing migrations applied locally |
| `pnpm test:local` | Passed: local HTTP smoke |

Source and Git inventory remained unchanged through these checks, frozen at tree
`eee0fff83b5756e73db304f9d51ee24ebcda58d8`. Only this handoff/status documentation
was finalized afterward. `checks.json`, `final-audit.json`, `frozen-source.json`
and command logs retain the inputs/results. Changed documentation has 435 valid
relative links, including 15 heading targets; all 29 A/B/C states agree and
acceptance checkboxes remain unchanged. Clean-machine Windows/Linux CI must also
pass for the final pushed PR head before integration; consult the draft's current
checks rather than treating this local evidence as CI or hosted acceptance.

[Native cases](../tests/helpers/document-archive-preparation-evidence.mjs) run
through the [actual archive API harness](../tests/document-archive-api.mjs), native
D1/R2, production journal and actual review client. They cover both sources and
formats; unprepared, active-prepared and issued states; uncertain writes and actual
object observations; missing/corrupt/restored objects without automatic scans;
original metadata after edits/cancellation; actor/role/company/default-off refusal;
review with the R2 binding absent; unchanged leases/all application rows and zero
R2 calls; and strict client refusal/clearing of malformed or inconsistent metadata.
Fixture reads/tampering/observations occur outside the asserted read-only windows.

The [signed-in browser walkthrough](../scripts/document-preparation-evidence-ui-check.mjs)
uses the isolated fictional PO preview and blocks other network origins. It seeds
preparation records through the production journal over that preview's SQLite.
Expected metadata comes from real locally issued PDF/Excel copies; observations
are retained fixtures and the new prepared IDs deliberately have no object.
That browser fixture proves stored-evidence presentation, not current file health;
the separate native API cases exercise physical object changes.

The walkthrough covers matched/missing/write-unconfirmed/no-observation/no-record
states, active and other-actor visibility, issued-panel hiding, identifier expansion,
metadata-only refresh, real role loss and private-data clearing, exact preservation
of every application/archive row, no save/check/download/continuation requests,
desktop/390px overflow and keyboard use. It passed with no page errors and no
application/archive row changes. Screenshots were inspected at both widths.
Browser evidence is retained under the worktree's absolute
`C:/Users/Leo/Project/Pantrack/work/c4-prepared-file-evidence-20261101/.sites-runtime/preparation-evidence-browser/run-f3ccc112-4ea4-44fd-9340-df46ae240960`;
the result is copied to the evidence root above as `browser-result.json`.
The owned local preview was stopped after the walkthrough.

## Integration, rollback and next slice

This draft follows PR #34 and includes main `5ffc088`, preserving the other
contributor's [G8 work](C4_FULL_OFFLINE_GATE_RUN_20261031.md). No gate implementation
file is changed. Keep the stack unmerged during the protected preparation-to-paid
window; operator status is separate from these local checks. This task authorizes
no operational gate, provider run, deployment, maintenance or production-data action.

Rollback reverts this view/projection/DTO change together. No data repair follows:
review wrote nothing, and all original manifests, observations and objects remain.
Mixed older strict clients may refuse the extra response field safely, so keep the
matching UI/API bundle together. No journal or save-command contract is rewritten.

The subsequent [fresh prepared-file check](C4_PREPARED_FILE_CHECK_LOCAL_EVIDENCE.md)
now implements explicit verification with stable check identity, retained audit
inputs and no publication, generation or object writes. It remains distinct from
this stored-evidence view and original-actor continuation. Formal linked replacements
still need the pending owner-only versus owner/manager role choice and lineage contract.
