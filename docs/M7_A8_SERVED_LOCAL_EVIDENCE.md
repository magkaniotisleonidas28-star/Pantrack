# A8 served local proposal evidence

Date: 2026-09-30. Scope: one isolated development worktree and its local D1
database, using fictional records only. This is local HTTP evidence, not a
browser visual review or hosted Clover evidence.

## Outcome

The repeatable [served check](../scripts/a8-local-served-check.mjs) starts the
local app, signs in through the local fixture, creates a fictional company and
product, configures exact inventory, and adds fictional planning settings and
Clover sandbox health to that worktree's local D1. It sends requests only to
`127.0.0.1`; it does not contact Clover or a supplier.

The check passed the manager's v2 read-only review; anonymous `401` and
wrong-company `403`; durable create and same-create retry; one saved list row;
manager quantity edit; invalidation after the fictional Clover checkpoint
changed; one audit event across repeated reads; and cancellation. The saved
handoff continued to report `supplierSubmissionAllowed: false`.

The served check first found that local D1 committed a conditional proposal
insert and edit while reporting zero in `result.meta.changes`. The API returned
`source_changed` even though those changes were stored. The origin, edit, and
cancel paths now verify the committed create ID or revision/change ID in D1.
This preserves the source and revision predicates on each SQL mutation while
avoiding a false failure caused by an unreliable change count. The rerun passed.

## Checks run in this worktree

- `scripts/local-setup.mjs`: passed. Only this worktree's ignored `.dev.vars`
  was set to enable the exact preview and Clover sync gates.
- Local D1 migration application: all migrations through `0017` passed on a
  fresh worktree database. No remote D1 was changed.
- `scripts/a8-local-served-check.mjs`: passed after the fix.
- Typecheck: passed.
- `scripts/test.mjs`: 32 suites passed.
- `scripts/check-migrations.mjs`: 18 ordered migrations passed against fresh
  SQLite.
- Build: passed.
- `scripts/local-smoke.mjs`: passed.
- `git diff --check`: passed.

To rerun, apply local migrations in an isolated worktree, set
`PANTRACK_EXACT_INVENTORY_PREVIEW=enabled` and
`PANTRACK_CLOVER_SYNC_ENABLED=enabled` in its ignored `.dev.vars`, then use
Node 22 to run `scripts/a8-local-served-check.mjs`. It leaves fictional records
in that worktree's local D1. The test file must not be pointed at hosted D1.

## Remaining A8 acceptance work

- Review and record the allowed age of a successful Clover sync. The current
  10-minute limit is provisional.
- Apply development D1 migrations `0016` and `0017` only under a separate,
  explicit remote-migration authorization, then run hosted manager and
  concurrent-source-change checks with approved fictional sandbox data.
- Review the visual manager flow in a browser and capture hosted evidence.

M7/A8 remains open. These local results do not authorize supplier submission,
a remote migration, or a deployment.
