# BUG-06: a count confirms only its own saved details

Date: 2026-10-11. Workstream A5/M3 physical-count idempotency.
Scope: [BUG-06 in the fix checklist](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-06--conflicting-concurrent-physical-counts-both-report-success).
Baseline `22a5919` includes completed local BUG-02/03/04/05 above main `161d08f`.
Branch: `workstream-a/bug06-count-receipts-20261011`; worktree:
`work/bug06-count-receipts-20261011`. Fixing commit:
`3dbe7c2021211f1e1173d3cf23169f55eec49ede`.

## Reproduction and result

Two real management-service calls with one reference requested 900 mL and
800 mL. Deferred gates paused both batches before `BEGIN IMMEDIATE`, after
both had read that no receipt existed. The 900 mL request committed first.
Before the fix, the losing 800 mL call fulfilled. The new regression failed
because it received no `operation_conflict`. It passes after the fix.

Count saving now loads and validates the actual persisted reconciliation and
its matching exact count event after every successful batch. The comparison
includes product, entered amount, entered unit, normalized occurrence, actor,
trimmed note and the original expected version from `balance_version_before`.
It does not use acknowledgment metadata as identity proof. Missing receipts
report concurrent change; an incomplete reconciliation/event pair reports
store corruption. It never guesses the original version.

The same comparison runs before today's conversion/chronology checks on replay.
An original custom-measurement receipt can be confirmed after its factor changes,
even when converting the old amount using the new factor would be invalid.
Identical replay returns current stock without resetting a later delivery,
configuration, count cutoff or history. An altered expected version is a conflict.
The package adapter's immutable raw fingerprint still confirms before checking
today's package configuration. No change to package request contracts.

Only the management service and a new regression suite changed. No new migration,
API schema, route authorization, UI behavior or external integration. The branch
inherits [BUG-04's planning fix](BUG04_PLANNING_MEASUREMENTS.md), so the overlapping
management-service changes are serialized and verified together.

## Checks in this worktree

- Six existing focused suites passed before editing. The new deterministic
  regression failed on the original code and passed after the change.
- `pnpm test inventory-count-receipts inventory-management-contract
  stock-pack-units stock-entry waste-recording m2-security
  inventory-planning-units`: seven suites passed. Tests use real SQLite with
  all journaled migrations and the real management/package services.
- For accurate, zero and misleading positive metadata, conflicting races cover
  amount, unit, time, actor, note, product and expected version. They retain one
  reconciliation/event, one version increment, the winner's 900 mL and identical
  saved history after the losing call. Equivalent normalized time/trimmed note
  confirms an identical concurrent count. Distinct IDs sharing a version conflict.
- Lost-response confirmation, replay after delivery/configuration, historical
  custom factors, package fingerprints and backdated entry protection pass.
  Snapshot assertions cover application writes and retained count/event history;
  this task adds no SQL immutability triggers.
- A loopback server invokes the actual inventory POST handler with fictional
  identity/company bindings: the winning request returns 200, the conflicting
  loser returns 409/`operation_conflict`, and anonymous, wrong-company and
  employee requests return 401/403 without changing any saved rows. An altered
  expected-version replay returns 409; identical replay returns 200.
- `pnpm typecheck`, `pnpm test` (82 suites), `pnpm db:check` (35 migrations),
  `pnpm build`, `pnpm local:setup`, `pnpm db:migrate:local` and `pnpm test:local`
  passed. The final pipeline also runs the earlier sales-outcome, readiness,
  measurement and runtime recovery regressions together. App smoke data is fictional.
- Initial extra test fixtures used an incorrect unit-column name and an invalid
  fractional count input; those fixtures were corrected to the actual schema and
  whole-count contract before the final checks. A proposed direct SQL history
  assertion was replaced with application-path history assertions because that
  direct database guard is not an existing reconciliation-table guarantee.
- Full diff review, `git diff --check` and changed relative documentation links
  passed. Main and the other completed worktrees remain clean.

## Repair, rollback and step 1 integration

No real count or hosted API was inspected or repaired. A prior false success
does not prove that the losing amount was saved. Use the persisted receipt as
the factual outcome, review the intended count with the manager, and if needed
record a fresh physical count under a new reference/time/version. Do not edit
historical reconciliations to match an unsaved request. Missing exact-event
history needs separately reviewed repair; keep the record blocked rather than
inventing its original version.

Reverting this receipt comparison would restore false acknowledgments. If a
release problem arises, pause count writes and forward-fix the comparison while
retaining saved history and [BUG-02's inventory fence](BUG02_SALES_OUTCOME_RECOVERY.md).

All six bug checkboxes are now closed for **local** acceptance in this final
stacked branch. BUG-01 was already on main. The integration order above main is
BUG-02, BUG-03, BUG-04, BUG-05, then BUG-06; this final branch contains them all.
Each fix remains separately reviewable in its source/evidence commits.
No branch was pushed, merged to main or deployed, and no remote database or live
integration was changed. The next unblocked step is review/integration of the
tested branch. Hosted release validation and any real historical repair require
their separate authorization/evidence; local passes do not close those gates.
