# BUG-02: safe sales outcome recovery

Date: 2026-10-04. Workstream B5 / M4 outcome recovery, B7 / M5 consumer,
A2 inventory boundary. This is local evidence and the producer handoff for
[BUG-05](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-05--expired-processing-events-have-no-runtime-recovery-path).
Runtime recovery wiring, historical stock repair, hosted acceptance, and milestone
acceptance are separate tasks.

## Task and isolation record

Starting HEAD: `f9849750b539c51e163fea6fd1cfd865b5cb538d`, branch `main`.
Starting status: modified `docs/README.md`, untracked `docs/APPLICATION_DATA_FLOW.md`.
Both were preserved in the original checkout, along with its local database.
The fixing checkout is `/private/tmp/pantrack-bug02-20261004`, branch
`workstream-b/bug02-outcome-fence`, created from that HEAD with an initially clean
status. `main` was rechecked before migration generation and final verification;
it remained at the starting HEAD. No fetch, push, merge, deployment, live
integration, remote-data change, or purchasing action was performed.

Objective: reconcile authoritative inventory commits before advancing a sales
lineage, so a lost response cannot consume an original line twice. Completion
requires the real D1-service/mocked-Clover regression to reproduce stock 7 before
the fix and stock 8 afterward, deterministic expired-worker fences, immutable
history, focused and full isolated checks, and this tested recovery handoff.
No external credential or product decision was needed.

## Reproduction and behavior

The new [regression suite](../tests/sales-outcome-recovery.mjs) starts with ten
cups, a one-cup immutable recipe, an item mapping, an encrypted fictional Clover
connection, and journaled migrations with foreign keys enabled. It throws on
the second matching application lookup: the result read after inventory commits.
The first sync fails with `inventory_unavailable`, but one application and stock 9
are durable. The newer paid order retains the original line and adds a stable
additional line. Before the fix, the test failed with `'7' !== '8'`. After the fix,
each application contains one consumed line, there are two stock movements, and
stock is 8. Repeated scans do not consume again.

Two supersession paths needed repair. `sales_event_state_received` in migration
`0010` superseded failed predecessors at receipt time; its stale-receipt update
and `sales_event_state_transitioned` history/audit trigger were also traced.
`D1SalesEventStore.claim()` repeated predecessor supersession. The additive
`0024` migration replaces only the receipt trigger and adds guards that reject
supersession or claiming over unresolved failed/missing attempt replies. The
transition-history trigger remains intact. A failed event returned to `received`
by an explicit retry still carries its unresolved attempt and cannot bypass these
guards. Historical terminal events are not rewritten.

Before a new claim, `SalesIngestionService.process()` resolves up to 100 unresolved
attempts in that company's order lineage through the target revision. It uses the
original persisted application key and the inventory port, rather than remapping
old lines or performing stock writes in B. A durable application supplies its
original recipe/modifier versions and balances. Recovery checks its company, key,
attempt, contract, occurrence (including an earlier occurrence confirmation), and
selected source-line identity. Any remaining unresolved attempt blocks the claim.

`sales_event_inventory_outcomes` stores append-only recovery evidence. Previously
failed attempt replies remain unchanged. A recovered application changes a current
`failed`/retried `received` event to `applied` and becomes the complete consumption
baseline for later positive deltas. An already historical `superseded` event keeps
its state, while its confirmed durable consumption can supply the baseline.
The correction consumer reads the original application, so a reconciled deduction
still supports a reviewed correction request. Opening that review changes no stock.

## A2 recovery extension

The [shared port](../src/lib/inventory-consumption-contract.ts) retains the v1
semantic application request and adds the optional
`pantrack.inventory-consumption-recovery.v1` capability:

```ts
consume(originalRequest, { attemptId })
reconcile({ contract, companyId, idempotencyKey, attemptId })
// -> identity + { status: "applied", application: originalAppliedResult }
// or identity + { status: "not_applied" }
```

An attempt identity is separate from the stable semantic application key and
does not affect its fingerprint. B supplies the immutable processing-attempt ID.
A persists it privately in the application; neither it nor the private stock
claim token is returned in the public application result. A same-input replay
still returns the saved application, while changed input conflicts.

[The D1 producer](../src/lib/d1-inventory-consumption.ts) atomically inserts a
permanent company/application/attempt fence and reads that fence joined to the
application. A missing acknowledgment or fence receipt is an error, not absence.
`not_applied` therefore proves that this attempt cannot subsequently commit.
The inventory INSERT trigger aborts a revoked token and also any worker without
an attempt token once a fence exists for that application key. This protects
pre-extension workers as well as current ones. A retry may consume under the same
application key with a new attempt ID; existing successful applications remain
immutable and replayable.

Reconciliation never deducts stock, selects current mappings, or re-evaluates old
recipes/count cutoffs. A durable result read or validation failure leaves B's
outcome unresolved. A fence may already exist when acknowledgment is lost; another
reconciliation safely confirms it. A v1-only port without `reconcile` fails closed
with `recovery_unavailable`. The [fake producer](../src/lib/inventory-consumption-fake.ts)
implements the same capability and has [producer contract tests](../tests/inventory-consumption-contract.mjs).

## BUG-05 consumer handoff

Consume this branch's committed types, real port, store, and tests together after
the serialized schema merge. Rebase BUG-03/BUG-05 before editing shared B files.
`clover-sync.ts`, webhook/API/UI callers, and runtime gates are unchanged here.
The source search still shows definitions/internal forwarding only for recovery;
there is no endpoint or polling caller newly wiring it into runtime.

The safe internal entrypoint is:

```ts
await service.recoverExpiredLeases(authorizedCompanyId, {
  limit: 50, // valid range 1–100; default 100
  source: { provider, environment, merchantId }, // server-derived, optional
});
```

It considers only expired processing attempts and never steals an unexpired lease.
The original event supplies company/application identity to A. Recovery atomically
records its inventory outcome, terminal attempt/state, and one `lease_expired`
audit per winning attempt. Concurrent recovery returns the winning event ID once.
After-commit interruption becomes `applied`; safely fenced absence becomes
`failed`/`interrupted`. The latter permits an explicit same-key retry or safe
supersession by a newer complete revision. It does not silently skip unsold items
or replay under a different key. Old workers may subsequently fail their stale
terminal writes, but cannot add inventory movements.

BUG-05 must authorize the company and intended owner/manager or trusted machine
before this internal call, derive any provider scope on the server, bound the call,
handle partial progress/errors truthfully, and prove its selected runtime caller
with anonymous/wrong-company/forbidden-role tests. Do not call it from read-only
health GETs, perform an unbounded webhook sweep, or provision a scheduler.
On any reconciliation/identity/evidence-write error, leave unresolved state locked
and surface actionable failure. Earlier candidates in a bounded call may already
be safely completed; repeat the bounded call to confirm remaining work.

## Migration, compatibility, and rollback

[0024_safe_bromley.sql](../drizzle/0024_safe_bromley.sql), its generated
[snapshot](../drizzle/meta/0024_snapshot.json), and
[journal](../drizzle/meta/_journal.json) add two tables and their guards.
The snapshot retains all existing table definitions unchanged and correctly links
to `0023`. Existing SQL migrations were not edited. Fences/outcomes reject updates,
deletes, and replacement rewrites. Outcome insertion requires the original
attempt's durable fence and matching authoritative application/absence.

The populated-upgrade regression includes a pre-extension application, a failed
reply, and a predecessor already superseded by the old trigger. Applying `0024`
preserves inventory/projection, applications/movements, sales facts/states/history,
attempts/replies, mappings, and versions byte for byte. Only a subsequent authorized
process reconciles that outcome and consumes the new line. No historical stock
deduction is automatically repaired. Previously overstated usage requires a
separate, reviewed, audited physical reconciliation or correction.

Do not roll back by dropping fences/guards or restoring the old receipt trigger:
that reopens the defect. If a regression appears, keep native sync off, pause the
affected ingestion/recovery path, preserve all applications/fences/outcomes, and
forward-repair through a new migration or scoped port/service fix. An older binary
with this schema may have its unsafe claim rejected; that is a safe compatibility
failure, not authorization to weaken the guards. Serialize migration integration
and rebase on current mainline before merge. Resolve any migration-queue collision
under the roadmap's ownership rules, then rerun fresh/populated checks; never
rewrite a used migration.

## Local verification

The existing five requested focused suites passed before the new regression.
The new regression then failed at stock 7, and passes after the fix. All checks
use this worktree; dependencies were copied locally, and no owner database or
credential file was reused. Final verification explicitly selected the installed
Node 22.23.2 runtime and pnpm 11.25.0. The earlier Node 26.9.0 checks also passed.

- PASS — requested focused suites plus `sales-outcome-recovery` and
  `inventory-consumption-contract` (seven suites).
- PASS — `pnpm typecheck`, `pnpm test` (42 suites), and `pnpm build`.
- PASS — `pnpm db:check`: 25 ordered migrations, fresh SQLite schema/snapshot/journal.
- PASS — `pnpm local:setup` and `pnpm db:migrate:local`: fresh isolated Wrangler D1,
  `0000`–`0024` applied. The first sandbox attempt could not bind localhost;
  the approved local-only rerun succeeded. The pinned-runtime repeat found no
  pending migrations.
- PASS — `pnpm test:local`: temporary local HTTP server, anonymous/forged-header
  rejection, fixture sign-in, company creation, catalog, company isolation and
  sign-out. Its fictional company stays only in this worktree's local D1.

Regression coverage includes postcommit lost reads, successive positive revisions
with multiple lost replies, same-key retry with changed mappings/archived versions,
no-commit failure, crash-after-commit, correction/refund/cancellation policies,
mapping holds and advanced count cutoffs, company/provider recovery scope,
concurrent/duplicate recovery, missing acknowledgment, mismatched recovery identities,
missing recovery capability, evidence-write failure, and populated migration.
Before-commit deferred gates cover revision arrival both before and after recovery,
and old-worker resumption both before and after the new commit, with and without
attempt-token support. A separate postcommit deferred gate covers late terminal
completion. No timing sleeps establish any race.

This is real D1-service SQL exercised through isolated SQLite, fresh local Wrangler
D1 migration, and a local HTTP smoke test with mocked providers. Hosted D1
concurrency, Clover native behavior, CI, sandbox, pilot, and production acceptance
were not run or claimed. Supplier submission, automatic purchasing, and native
sync configuration retain their existing gates. Only BUG-02 is eligible for local
closure; BUG-05's runtime integration remains open.
