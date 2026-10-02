# A8 served local proposal evidence

Date: 2026-09-30. The original HTTP check used one isolated development
worktree and its local D1 database with fictional records only. Follow-ups below
record the existing checkout's tooling verification and the owner's local
browser report separately. None of these establishes hosted Clover evidence.

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

## Follow-up: multiple local database files

On 2026-09-30, the existing `main` checkout had two local SQLite database files.
One had all 18 migrations through `0017`; the other had no migration ledger.
The original check incorrectly required exactly one file, so it failed even
though `pnpm db:migrate:local` correctly reported no pending migrations for
the configured binding.

The check now uses [a local database selector](../scripts/local-d1-database.mjs)
after its API calls create a unique fictional company/product configuration.
It probes candidate databases read-only and selects the one containing that
configuration, rather than guessing from the filename or migration ledger.
Missing or ambiguous matches stop the check before direct database writes.
Both existing database files remain in place; no reset or deletion is required.

Verification in this checkout:

- `pnpm test:focused local-d1-database`: passed. The
  [regression test](../tests/local-d1-database.mjs) covers several candidate
  files, unchanged candidate data, and missing/ambiguous fixture matches.
- `node scripts/a8-local-served-check.mjs`: passed with both existing SQLite
  files present, including authorization, create/retry/list/edit, audited
  invalidation, and cancellation. Only fictional local records were added.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, 33 suites.

This changes local verification tooling only. No migration, application
contract, remote database, deployment, provider call, or milestone acceptance
changed. Reverting the tooling changes requires no schema or data repair.

## Owner-reported local browser walkthrough

On 2026-09-30, the owner used the local fixture sign-in and the prepared
fictional company to review the manager flow. The owner reported that the saved
review remained `review_required` with source check `inventory_changed` and
that everything else in the walkthrough worked. This is the expected status
after a stock change: the proposal needs a new review, with the changed source
recorded separately. Cancellation must subsequently change the status to
`canceled`.

This is an owner-reported local browser result, not an independently captured
visual review or an itemized record of every desktop/mobile check. Ordinary
account creation had returned an origin-related `403` during setup; the owner
continued using fixture sign-in. This walkthrough does not verify Supabase
signup or resolve that separate origin issue.

The owner also encountered the expected durable-create `409` after the
fictional checkpoint and last-success timestamps became 16 and 15 minutes old.
The server's limit was provisional at that point. The agent refreshed only this
local fixture's timestamps after checking its fictional merchant, placeholder
credential, sandbox environment, and local owner membership. Exact balances,
sales count, and inventory event count were verified unchanged. No provider
request was made, and this synthetic refresh is not sync evidence.

## Accepted development freshness policy

On 2026-09-30, the owner explicitly accepted keeping the ten-minute freshness
limit for development. [Decision 0004](decisions/0004-m7-development-sales-freshness.md)
records the inclusive boundary for both the sync checkpoint and successful-sync
timestamp, the other current-health requirements, and stale-review recovery.
The runtime threshold is unchanged; the UI now explains the accepted rule.

Verification for this policy record and UI wording in the current checkout:

- `pnpm test:focused a8-sales-readiness-d1 a8-clover-review-contract m2-security`:
  passed, three suites. Each timestamp is accepted at ten minutes and rejected
  one millisecond later; the conditional SQL guard also rejects expiry after a
  current snapshot was read. Authorization and stale-source behavior passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, 33 suites, including migration/schema guard checks.
- `pnpm build`: passed.
- `git diff --check` and relative file-link checks: passed.

## Remaining A8 acceptance work

- The later [W1/W2 hosted release](C2_W2_HOSTED_RELEASE.md) applied development
  D1 through `0021`, including `0016`/`0017`. The local guard repair is now
  `0022`; apply it only under separate explicit remote-migration authorization,
  then run hosted manager and concurrent-source-change checks with approved
  fictional sandbox data.
- Capture hosted browser evidence for the manager flow; the local owner report
  above does not replace hosted end-to-end or concurrency checks.

M7/A8 remains open. These local results do not authorize supplier submission,
a remote migration, or a deployment.
