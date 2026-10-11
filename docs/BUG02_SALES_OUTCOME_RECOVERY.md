# BUG-02: durable sales inventory outcome recovery

Date: 2026-10-11. Workstream B5/M4 recovery and B7/M5, with the A2
inventory boundary. Baseline: `main` at `161d08f`. Worktree:
`work/bug02-sales-outcome-20261011`; branch:
`workstream-b/bug02-sales-outcome-20261011`.

Fixing commit: `65ec1b1ecfdb48fd7e2004d222c3deb8b22a3fe2`.

## Task and evidence boundary

Prevent a lost inventory response, interrupted worker or later order revision
from deducting an already consumed item again. Preserve company/provider lineage,
exact quantities, historical mappings/recipe versions and immutable attempt
results. This task fixes BUG-02 only from the
[fix checklist](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-02--newer-sales-revision-deducts-committed-inventory-again).
BUG-03 through BUG-06 and milestone acceptance remain separate.

Verification uses fictional local SQLite/D1 data and mocked Clover. No remote
database, provider connection, deployment, purchase or hosted sync is authorized
by this evidence. The owner's existing local databases are outside this worktree.

## Reproduction and resulting behavior

The original five focused suites passed at the baseline. The newly added
[real-store/port regression](../tests/sales-inventory-outcome-recovery.mjs)
failed before the fix: ten cups became nine after the first committed sale, then
seven when a later revision added one cup. The correct result was eight.

The fix reads the authoritative application under the original company and
application key before replaying a sale or superseding a committed predecessor.
It retains the original selected recipe/modifier versions, including when
current mappings or the stock cutoff have changed. A known committed result
adds an audited recovery attempt, retaining the original failed/interrupted
attempt result; reconciliation itself changes no stock.

Receipt-time and claim-time supersession now preserve a predecessor with a
durable application until its result is reconciled. A newer claim fails closed
while such a result remains unresolved. Later revisions use the recovered
complete-order baseline and consume only positive additions. Refunds and
cancellations do not restore stock; negative revisions still require review.

If an older record was already terminal `superseded`, reconciliation appends
evidence without rewriting that terminal state or its transition history. The
verified application still supplies the consumption baseline for later revisions.
This does not undo historical duplicate deductions.

## Contract and migration handoff

The [inventory contract](../src/lib/inventory-consumption-contract.ts) keeps
the v1 request/result wire shapes and semantic idempotency fingerprint. Trusted
sales callers now pass a separate `{eventKey, attemptId}` execution context.
The [D1 port](../src/lib/d1-inventory-consumption.ts) checks that lease in the
same transaction that claims the application and changes stock. Its private
attempt marker never enters public inventory results.

The optional `lookupApplied(companyId, applicationKey)` capability returns the
validated original application with `replayed: true`, without resolving current
mappings or applying inventory. The durable runtime supplies this capability;
older consumption-only fakes retain their existing behavior and do not prove
durable recovery/fencing.

The [sales store](../src/lib/d1-sales-event-store.ts) adds company/lineage-scoped
`unresolvedConsumption` and replay-safe `reconcileApplied` operations. Recovery
attempts and `inventory_reconciled` audits are appended atomically. Original
sales events, applied inventory JSON and failed attempt results are retained.

Migration [0034](../drizzle/0034_sales_inventory_outcome_fence.sql) follows
`0033`; the generated journal and snapshot are included. It changes no tables,
columns or populated rows. It replaces the receipt supersession trigger and adds
two guards: new sales applications require the current processing attempt, and
committed predecessors cannot be superseded as unapplied work. Used migrations
`0009`, `0010` and `0011` remain unchanged.

The [C4 upgrade test](../tests/c4-main-upgrade.mjs) now verifies the exact
journaled replacement of that single receipt trigger. All other original schema
objects, sessions, recovery state, stock, recipes and history remain protected
by its existing preservation assertions.

Full verification also exposed a Windows test race in
[the purchasing worker process suite](../tests/po-cart-worker-processes.mjs):
parent-side journal polling intermittently blocked the child's atomic rename
with `EPERM`, then appeared as a timeout. Its
[test-only process observer](../tests/helpers/po-cart-worker-process-observer.mjs)
now reports completed saves through IPC, carrying only the call count. The parent
retains its original disk/history/effect assertions after the process stops,
uses bounded waits and reports early exits. The real worker CLI, filesystem
writes and runtime protocol are unchanged.

## BUG-05 recovery contract

Use [SalesIngestionService.recoverExpiredLeases](../src/lib/sales-ingestion.ts)
behind a separately implemented, bounded, authorized and audited runtime entry
point. BUG-02 does not add the endpoint or polling/scheduler wiring.

1. Recovery atomically closes the expired attempt and clears its lease. This is
   the durable fence: an old worker that resumes cannot insert a new inventory
   application or overwrite a replacement sales result.
2. Only after fencing, read the application under its original company/key.
   A valid application is reconciled as applied without any stock write.
3. A missing application after fencing leaves the event failed/interrupted.
   An authorized retry may consume it under a new attempt, or a newer complete
   revision may supersede it and consume the remaining order once.
4. If result lookup fails or validates incorrectly, keep the outcome unresolved.
   Recovery may throw after the old lease has already been fenced. The caller
   must report/review that failure; a later authorized same-key retry or later
   revision can reconcile the saved result. Do not claim that failure proves
   either application or non-application.
5. Never replay a saved application against arbitrary current mappings, change
   its application key or automatically adjust historical inventory.

## Verification

The focused regression covers lost post-commit response, repeated scans,
successive positive revisions, same-key retry after mapping/cutoff changes,
crash after commit, no-commit failure, concurrent recovery, old workers paused
before and after commit, a replacement attempt for the same key, both
supersession paths, raw unfenced writes, company/lineage isolation, invalid
durable results, negative corrections, refunds/cancellations and populated
upgrades with older application/terminal-state records. Race barriers use
deferred promises instead of sleeps.

Wrangler's statement splitter retains the new migration's four statements,
including each complete trigger. The populated upgrade compares every existing
table row, and fresh migration checks agree with the schema/snapshot/journal.

Final verification passed in this fixing worktree with Node 22.23.2 and pnpm
11.25.0. The table also records the expected pre-fix regression failure. Windows
commands used `pnpm.cmd`; the local database and variable files were created
inside this worktree only.

| Command/check | Result |
| --- | --- |
| Baseline focused suites: `pnpm.cmd test:focused sales-ingestion-contract sales-event-store-contract inventory-consumption-d1 clover-b6-local b4-sales-inventory` | Passed five suites before implementation. |
| New regression before implementation: `pnpm.cmd test:focused sales-inventory-outcome-recovery` | Failed as required: actual stock `7`, expected `8`. |
| `pnpm.cmd test:focused sales-ingestion-contract sales-event-store-contract inventory-consumption-d1 clover-b6-local b4-sales-inventory sales-inventory-outcome-recovery` | Passed all six suites after implementation. |
| `pnpm.cmd test:focused c4-main-upgrade sales-inventory-outcome-recovery` | Passed populated upgrade, trigger replacement and durable recovery checks. |
| `pnpm.cmd test:focused po-cart-worker-processes` | Passed real worker process checks after the test-only Windows race repair. |
| `pnpm.cmd typecheck` | Passed. |
| `pnpm.cmd test` | Passed all 78 suites in the final run. |
| `pnpm.cmd db:check` | Passed: 35 ordered migrations match the schema and fresh SQLite database. |
| `pnpm.cmd build` | Passed. Existing vinext route-classification notices remain. |
| `pnpm.cmd local:setup` | Passed; created ignored local fixture configuration with empty provider credentials. |
| `pnpm.cmd db:migrate:local` | Passed all migrations `0000` through `0034` on the isolated local D1 database. |
| `pnpm.cmd test:local` | Passed local HTTP, fixture sign-in, anonymous/forged-header rejection, catalog, company isolation and sign-out checks; final exit code `0`. |
| `git diff --check` and full diff review | Passed; no used migration edits, credentials, runtime enablement or external effects. |
| Snapshot and relative-link checks | Passed: `0034` has the correct `0033` ancestry and unchanged table metadata; every evidence/checklist relative file link resolves. |

Earlier full runs identified the upgrade assertion's expected old trigger and
the Windows journal-polling race described above. Both were corrected and the
final complete run passed. No required local check remains open for BUG-02.
These results establish local behavior only; hosted D1 migration, remote CI,
native Clover, pilot and production verification were not performed.

## Compatibility, repair and rollback

Older applications without the private attempt marker remain readable and are
preserved exactly. New sales writes require coordinated code and migration
rollout. An older runtime that omits the marker fails closed for new writes after
`0034`; keep ingestion paused during a future authorized rollout and verify the
deployment and remote migration order separately.

Already incorrect historical balances require a separately reviewed physical
count or correction using the retained audit trail. This migration performs no
bulk stock repair. A valid ledger record establishes its own original deduction,
not the correctness of every later historical application.

Rollback pauses sales application and recovery while retaining migration guards,
application keys, stock movements and history. Do not drop the guards or restore
an unfenced runtime to resume ingestion. Repair forward with a reviewed new
migration or compatible runtime, revalidate the original outcomes, then resume
only through the authorized release process.

The next unblocked fixing task is BUG-03, sales readiness for unresolved events.
BUG-05 may consume this recovery contract after BUG-02 is integrated and tested.
