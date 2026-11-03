# C4 fresh prepared-file checks — local evidence

Recorded: 2026-11-02. Checklist: C4. One bounded outcome: a current company owner
or manager can explicitly check an unfinished save's exact prepared file, retain
the read inputs and retrieve the same completed result after an interrupted reply.
This follows [stored preparation evidence](C4_PREPARED_FILE_EVIDENCE_LOCAL_EVIDENCE.md)
and [original-request continuation](C4_DOCUMENT_SAVE_CONTINUATION_LOCAL_EVIDENCE.md).

## Behavior and authority

**Check prepared file now** reads the original manifest's private object and
compares its bounded bytes, reported size and SHA-256. Results are verified,
missing, damaged or unavailable. It never captures a new source, renders, puts,
deletes, replaces, publishes or downloads a file. It changes no business record,
intent, lease, original manifest, save actor or earlier observation. No binding,
dependency, supplier/model integration or hosted activation is added.

Current company owners/managers may check another person's prepared file under
the existing review permission. They still cannot continue that person's save.
Draft edits/cancellation and history changes do not rewrite the original expected
bytes or source proof. A match is not source approval, permission to publish or a
claim of permanent file health. No manifest means no check action. New checks on
issued copies are refused; existing completed receipts remain replayable under
current access if the original save is subsequently issued.

Each explicit action has a stable, actor/company/document-bound operation ID.
The server admits it before R2 work, retaining the immutable expected manifest.
It appends read inputs before evaluating access loss, session change or issuance
during the read. Refused work cannot authorize a completed receipt. Repeated
same-ID calls return one immutable completed result/time without another read;
concurrent unresolved calls may read more than once and retain every input.
A deliberate new check gets a distinct ID. Lost D1 acknowledgments are resolved
against the actual retained events, never a guessed success.

Refresh review/evidence still reads recorded metadata only. Check inputs update
the unissued preparation panel and safe history. Admission/completion bookkeeping
is hidden from ordinary history. After issuance, prepared-check diagnostics do
not become issued-file health signals. Existing save and issued-file contracts
retain their behavior.

## Files and contracts

- [Strict command/event/receipt DTOs](../src/lib/prepared-file-check-contract.ts)
  use `pantrack.prepared-file-check.v1`; callers supply IDs only.
- [The D1 store](../src/lib/d1-prepared-file-checks.ts) binds admitted identities,
  checks current roles in SQL, retains diagnostics and settles stable results.
- [The service](../src/lib/prepared-file-check.ts) has only a file-read port and
  check-event store; it has no generation, publication or object-writing port.
- [The guarded route](../src/app/api/purchase-order-documents/check-prepared/route.ts)
  requires the existing archive-preview gate, current company authority, origin/
  content-type protection and the current viewer header. Responses are private,
  non-cacheable and never include file bytes, keys, leases or provider errors.
- [The shared bounded reader](../src/lib/document-file-observation.ts) contains
  the same read/copy/hash operation moved from the existing archive lifecycle.
  [Save/retrieval](../src/lib/purchase-order-document-archive.ts) reuses it.
- [The client](../src/lib/prepared-file-check-client.ts) persists before sending,
  retries the exact request, rechecks the source-scoped review before showing a
  receipt, cancels/disposes stale resources and requests private-data clearing
  after access refusal. [The control](../src/components/workspace/prepared-file-check.tsx)
  is wired into [review](../src/components/workspace/document-archive-review.tsx).

## Migration and integration queue

[Migration 0045](../drizzle/0045_prepared_file_checks.sql) replaces only the
observation-insert guard, preserving every existing save-token and issued-read
rule. The old guard rejects every tokenless unissued observation, so safely
checking another actor's prepared file requires this explicit new event protocol.
The initial assumption that no migration was needed was corrected after inspecting
that trigger; original actors are never impersonated to evade it.

New `prepared_check` events are tokenless and have three stages:

| Stage | Required authority/proof |
| --- | --- |
| Requested | Current owner/manager, exact unissued manifest, fresh company-wide observation ID |
| Observed | Same admitted company/document/actor/manifest identity and bounded observation shape; retained even after access loss or issuance during the read |
| Completed | Matching retained observation, still-current owner/manager and exact unissued manifest; one terminal result for that operation |

All events remain append-only. Existing publication still requires matching
`object` evidence under the original save lease token; a tokenless
`prepared_check` cannot satisfy either condition. No old migration is rewritten.
[The journal](../drizzle/meta/_journal.json) appends 0045, and its generated
[snapshot](../drizzle/meta/0045_snapshot.json) has the same semantic tables,
indexes, foreign keys and checks as 0044. No table or column changes.

This is the sole schema-bearing change in the current document PR stack. Recheck
the migration merge queue before integration; never reserve or hand-renumber an
entry if another schema change lands. It follows PR #35 and includes main
`5ffc088`. Preserve the other contributor's [G8 freeze](C4_FULL_OFFLINE_GATE_RUN_20261031.md#next-g8-then-the-separately-authorized-paid-matrix):
no main merge, gate preparation, paid run, remote migration or deployment ran here.
All migration application in this task is confined to this worktree's fictional
local databases. Hosted application/backup/maintenance approval remains separate.

## Verification

Absolute evidence root:
`C:/Users/Leo/Project/Pantrack/.sites-runtime/c4-prepared-file-check-20261102`.

The pre-change issued-check/review-client baseline passed. Focused native API,
client, migration, type/schema and screen-rule checks pass. All six final commands
passed in this worktree while source and Git inventory remained frozen:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 167 selected suites; 155 executed, 12 existing Windows POSIX skips |
| `pnpm db:check` | Passed: all 46 migrations and the current schema |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed: all 46 migrations, including 0045, applied locally |
| `pnpm test:local` | Passed: local HTTP smoke |

Frozen tree: `5cd29afc678af807961698a8572b17beb79ad308`. Only handoff/status
documentation was finalized afterward; the source inventory remains identical.
`checks.json`, `frozen-source.json`, `final-audit.json` and command logs retain
the evidence. All 460 changed-document relative links, including 16 heading
targets, resolve; all 29 A/B/C states agree and acceptance checkboxes are unchanged.

- [Migration cases](../tests/prepared-file-check-migration.mjs) reproduce the old
  refusal; verify Wrangler produces two statements with one complete trigger;
  preserve every populated row; reject actor/role/lease/reference/shape violations;
  retain inputs after revocation; refuse check-based publication; and exercise
  non-destructive old-guard restoration and forward repair in disposable SQLite.
- [Native API cases](../tests/helpers/prepared-file-check-api.mjs), integrated in
  [the existing API harness](../tests/document-archive-api.mjs), use actual migrated
  D1/R2 and the guarded route. Both formats/source kinds, missing/corrupt/oversized/
  unavailable files, no-manifest/issued/default-off refusal, roles/company/CSRF,
  active save preservation, concurrent replay/collisions, actual lost native D1
  acknowledgments, source edits/cancellation and a real concurrent publication
  pass. Existing application/intent/lease rows and object bytes stay unchanged
  within the check windows; explicit fixture faults occur outside those windows.
- [Client cases](../tests/prepared-file-check-client.mjs) exercise the actual
  controller with injected request/storage/abort resources, exact recovery,
  scope/DTO refusal, final review authorization and stale-response disposal.
- [The signed-in walkthrough](../scripts/prepared-file-check-ui-check.mjs) passed
  against the isolated local Worker and actual R2 bytes. Local-only fixture
  put/delete/corruption/restoration is explicit and separate from app actions.
  Eleven POST attempts include real lost-response and stop/retry recovery,
  distinct new identities, verified/missing/damaged results, source/actor/issued
  visibility, role-loss clearing, keyboard Tab/Enter and desktop/390px inspection.
  Business/intent/lease rows and prior observations are identical; only declared
  check events append. No page errors or horizontal overflow. Screenshots were
  inspected. Browser result and images are under
  `C:/Users/Leo/Project/Pantrack/work/c4-prepared-file-check-20261102/.sites-runtime/prepared-check-browser/run-ad4ef335-2ec3-4cde-a190-5266755ef7e4`;
  the result is copied to the evidence root as `browser-result.json`.

Iteration logs are retained. Initial migration fixtures needed valid source
binding and a spare owner for revocation; the initial browser harness checked a
pending response too early and was corrected to wait for the actual refusal.
These fixture/harness failures are separate from the final passing checks.
The owned preview was stopped after the walkthrough.

## Rollback, limits and next decision

Apply 0045 before serving the matching API/UI. Older bundles can run with the
new guard; they cannot originate the new event protocol. Code rollback disables
or reverts the new route/control while retaining all check evidence and the used
migration. Do not delete events, rewrite 0045, reset the database or repurpose
pending IDs. If the old guard must be restored after integration, use a separately
reviewed forward migration after resolving active checks; the local repair test
does not authorize a hosted repair operation.

Clean-machine CI must pass on the final pushed head before integration. These
are local/development checks, not hosted bucket/privacy, provider, pilot or
production acceptance. C4/C5/M8 remain open and purchasing stays disabled.
Formal linked replacements still need the pending owner-only versus owner/manager
role decision and a separate lineage/receipt contract. Fresh checking and
original-actor continuation are implemented and should not be repeated as new work.
