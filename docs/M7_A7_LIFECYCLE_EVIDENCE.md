# A7 durable proposal lifecycle — local evidence

Migration `0017` adds company-scoped proposal state and append-only audit events.
It backfills one state and creation event for every `0016` origin without changing
the origin, inventory, settings, recipe, or purchasing rows. Preexisting origins
for the same product remain separate records. All their unresolved quantities
continue to block a new nonzero proposal until each old origin is canceled or
otherwise resolved. An empty old database receives empty tables.

The state row holds the active proposed pack quantity. A database trigger checks
for another unresolved nonzero quantity for the same company and product when
an origin is inserted or a zero quantity is raised. The origin insert, state
creation, and first audit event are one SQLite statement, so a losing request
leaves no orphan origin. Canceled, rejected, and closed states release the hold;
unknown, sending, accepted, and partially received states retain it. A canceled
origin itself is never deleted or rewritten.

The review-only D1 service permits manager/owner edits with a reason and
expected revision, and manager/owner cancellation. Employees may read a
same-company proposal but cannot edit or cancel. An edit checks the frozen
policy limits and current inventory/settings versions, including a second
version check within its database update. A source mismatch records one system
invalidation event and requires a new origin after cancellation. Database
triggers append every state change to immutable history and reject direct
invalid transitions. The current fictional sales, supplier, and price sources
never enable supplier submission.

Local tests use fictional companies and products. They cover additive migration
with old rows, duplicate old origins, company isolation, role checks, replay,
edit and cancellation history, reservation release, source-change races,
invalid state updates, foreign keys, and SQLite integrity. The A-owned fake
consumer holds every review-only handoff, including a hypothetical approved
status. Person C's C4 fake consumer does not yet exist in this repository, so
the actual cross-workstream consumer test is an explicit remaining handoff.

Local checks on the original A7 lifecycle branch passed: TypeScript `--noEmit`,
all 28 test suites, the 17-migration schema/journal/snapshot check, the
application build, Wrangler's `DB --local` apply of its then-numbered `0016`,
and the served HTTP smoke test.
Wrangler reported 14 migration commands executed on the local D1 instance.
The smoke test did not exercise an A7 API route; no such route is wired yet.

During B7 integration, the lifecycle SQL and its backfill/triggers moved
unchanged to `0017`, after the B7 `0015` and A7 origin `0016`; the snapshot
and journal entry were regenerated. Local A7 databases with the former
numbers need a fresh database or reviewed forward repair before applying the
merged sequence. Development D1 has not applied `0016` or `0017`.
The merged local pipeline passed TypeScript, 28 test suites, the 18-migration
fresh-database check, build, local D1 application of `0017` after `0016`, and
the served HTTP smoke test. Wrangler reported 14 local migration commands for
`0017`.

For local recovery before any post-`0017` origin or state change, restore a
pre-`0017` local database snapshot. After such a change, retain history
and repair with a new forward migration; do not delete the migration or replay
it blindly. Check Wrangler's migration ledger and schema before retrying a
partial trigger apply. Remote D1 migration and restore have not been run or
authorized. M7 acceptance still waits for A8 and reliable M5 inputs.
