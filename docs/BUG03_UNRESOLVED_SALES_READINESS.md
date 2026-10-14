# BUG-03: unresolved sales block replenishment reviews

Date: 2026-10-11. Workstream B7/M5 health with the A8/M7 consumer. This is
BUG-03 only from the [fix checklist](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-03--duplicate-polling-hides-unapplied-sales-from-readiness).

Baseline: `aadf9bb`, the completed local BUG-02 branch, above `main` at
`161d08f`. Worktree: `work/bug03-sales-readiness-20261011`; branch:
`workstream-b/bug03-sales-readiness-20261011`. Integrate BUG-02 before this
dependent branch. Neither branch has been pushed or merged by this task.

Fixing commit: `f1565adca0d5d1552172257633ce57d78d5e1ad7`.

## Outcome and reproduction

A paid sale fails before inventory commits, leaving ten cups instead of nine.
A successful poll of the same sale then counts a duplicate, advances the scan
checkpoint and clears the scan error. Before the fix, both the readiness reader
and actual SQL guard accepted this as current stock: `status='current'`,
`allowed=1`, despite the failed receipt and no inventory application.

The [new regression](../tests/sales-unresolved-readiness.mjs) reproduced that
failure using the real D1 services, all journaled migrations, foreign-key-enabled
SQLite and mocked Clover. After the fix, the same scan leaves the sale visible
as unresolved: `status='degraded'`, `allowed=0`. Saving a new proposal fails.
An authorized explicit retry applies the original sale once, leaving nine cups;
only then can readiness become current. Later applied duplicates stay healthy
and change no stock.

Polling success proves the scan completed, not that every received sale updated
inventory. The polling algorithm and its timestamps remain unchanged. This task
introduces no automatic retry, recovery endpoint or scheduler.

## Shared unresolved-outcome policy

The [shared SQL predicate](../src/lib/clover-sales-outcomes.ts) is used by both
the [readiness reader](../src/lib/d1-replenishment-sales-readiness.ts) and the
[atomic source guard](../src/lib/d1-replenishment-clover-source.ts).

| Stored outcome | Readiness/source treatment |
| --- | --- |
| `received`, `processing`, `held`, `failed` Clover event | Unresolved; new saves/edits are blocked. Lease expiry alone does not resolve processing. |
| Clover receipt without its state row | Unresolved; incomplete stored evidence cannot establish current health. |
| Undismissed Clover identity-conflict receipt | Unresolved even when the canonical event is applied; only an audited conflict dismissal resolves it. |
| `applied` event without a pending conflict | Resolved, including stock-neutral refund/cancellation outcomes. |
| Reviewed `dismissed` or replaced `superseded` event with no committed application | Resolved; no automatic application is attempted. |
| `dismissed`/`superseded` event with a committed inventory application but no applied attempt outcome | Unresolved; do not mistake terminal state for a verified consumption baseline. |
| Terminal event whose original committed result was reconciled by BUG-02 | Resolved without rewriting its terminal history or changing stock. |

Every query is bound to the requested company and canonical provider. Clover
records from an older merchant or environment in that same company remain
relevant because they can affect shared inventory. Another company's records
and a different provider's records cannot block or enter this Clover readiness
result. No new order, event, conflict or failure-detail references are exposed
to employees; existing role/company access checks remain.

## Write-time protection and history

The existing origin and lifecycle services already run the source predicate
inside conditional database writes. They now use the expanded shared policy.
The regression inserts a genuine failed sale or identity conflict immediately
before the actual proposal INSERT or quantity-edit UPDATE. In the conflict case,
the canonical deduction is committed before the proposal calculation; the later
conflict changes neither stock/version nor scan timestamps. Both writes are
rejected by the sales predicate itself.

Rejected inserts create no proposal. Rejected edits append no false success.
On access, an existing review is invalidated once as `source_unavailable` and
requires a new review. Cancellation remains available. Its immutable origin
JSON and original history remain unchanged. Later improved health does not
automatically clear an already recorded invalidation; follow the existing
cancel-and-recalculate workflow.

## Producer/consumer handoff and compatibility

The existing v1/v2 snapshot shapes and versions remain unchanged. Clover v2
readiness adds only the reason `unresolved_events`; `heldEventCount` retains its
literal held-state meaning. A held event emits both `held_events` and the new
general reason. No extra count or identity fields are added.

The [snapshot validator](../src/lib/replenishment-proposal.ts),
[C4 fake consumer](../src/lib/c4-fake-supplier-consumer.ts), and
[A8 preview](../src/components/workspace/a8-review-preview.tsx) accept the reason
together. The preview explains it as "Some sales still need to update stock or
be reviewed." Existing immutable v1/v2 snapshots and handoffs without the new
reason still decode, including their original JSON. The fake consumer still
holds every handoff with supplier submission disabled.

The accepted [ten-minute development freshness policy](decisions/0004-m7-development-sales-freshness.md)
is unchanged, including exact boundary checks for both timestamps. This fix
strengthens the interpretation of current health when known application work
is unresolved. Coordinate producer, validators and UI in the same compatible
release; an older validator cannot decode the newly added reason.

BUG-05 should use the [BUG-02 recovery contract](BUG02_SALES_OUTCOME_RECOVERY.md#bug-05-recovery-contract)
to fence expired workers and reconcile original outcomes. Until that wiring is
implemented, affected reviews safely remain blocked. Do not wire blind retries
into polling to clear the warning.

## Verification

All commands ran in this fixing worktree with Node 22.23.2 and pnpm 11.25.0.
The local D1 and variable files are isolated from the owner's existing databases;
provider credentials are empty outside fictional test fixtures.

Final verification passed. The table also records the required pre-fix failure.

| Command/check | Result |
| --- | --- |
| `pnpm.cmd install --frozen-lockfile --store-dir C:/Users/Leo/Project/Pantrack/.sites-runtime/pnpm-store` | Passed; lockfile unchanged. An initial offline attempt lacked package metadata, so the frozen install was completed normally. |
| Baseline: `pnpm.cmd test:focused clover-b6-local a8-sales-readiness-d1 a8-clover-review-contract a8-sale-to-proposal-d1 c4-a7-supplier-handoff m2-security` | Passed all six suites before implementation. |
| Pre-fix `pnpm.cmd test:focused sales-unresolved-readiness` | Failed as required: actual `{status:'current',allowed:1}`, expected `{status:'degraded',allowed:0}` after the failed sale and duplicate poll. |
| `pnpm.cmd test:focused sales-unresolved-readiness clover-b6-local a8-sales-readiness-d1 a8-clover-review-contract a8-sale-to-proposal-d1 c4-a7-supplier-handoff m2-security sales-inventory-outcome-recovery` | Passed all eight suites after implementation, including BUG-02's durable recovery regression. |
| `pnpm.cmd typecheck` | Passed. |
| `pnpm.cmd test` | Passed all 79 suites in the final run. |
| `pnpm.cmd db:check` | Passed: 35 ordered migrations match the schema and fresh SQLite database. |
| `pnpm.cmd build` | Passed; existing vinext route-classification notices remain. |
| `pnpm.cmd local:setup` | Passed; ignored local variables created with empty external-provider credentials. |
| `pnpm.cmd db:migrate:local` | Passed `0000` through inherited BUG-02 `0034` on a new isolated local D1 database. |
| `pnpm.cmd test:local` | Passed the local HTTP, fixture sign-in, anonymous/forged-header rejection, catalog, tenant isolation and sign-out checks; exit code `0`. |
| `node .sites-runtime/bug03-preview-browser.mjs` | Passed a one-off isolated Edge walkthrough of the real A8 preview component using the regression's current/degraded JSON fixtures at 1200px and 390px. The warning renders, no page errors or horizontal overflow; no provider API access. |
| Full diff review, `git diff --check`, changed relative-link checks | Passed; no schema edits, secrets, unrelated work or runtime gate changes. |

The committed regression uses explicit awaited write hooks for deterministic
races. Its scenario checks cover active states, pending conflicts,
same-key retry, genuine duplicates, canonical provider/company isolation,
employee privacy, forbidden conflict actions, terminal history, live INSERT/edit
predicates, one-time audited invalidation, cancellation and v1/v2 decoding.
The focused freshness suite preserves the accepted ten-minute boundaries.

The browser probe and screenshots are ignored local artifacts, outside CI. It
verifies component wording with mocked API responses. A styled full-app and
hosted walkthrough remain separate. The complete HTTP smoke test exercises the local
app. No required local BUG-03 check remains open; remote CI and hosted/provider
verification were not performed.

## Review, rollback and external limits

BUG-03 introduces no migration, schema edit, environment setting, remote
operation or runtime gate change. Inherited BUG-02 migration `0034` is exercised
only in fresh isolated local D1/SQLite fixtures. Stock, recipe and proposal
history preservation, exact quantities, authorization and existing supplier
holds remain protected by the focused and complete local checks.

No Clover/provider request, hosted database change, deployment, purchase, push
or merge was performed. Local mocked-provider evidence does not establish native
provider, hosted D1, remote CI, pilot or production acceptance. Historical wrong
stock balances still require a separately reviewed count/correction; the health
reader does not repair them.

For rollback, pause new durable Clover proposal saves/edits while retaining
immutable snapshots and audit records. Keep the unresolved-outcome predicate
and compatible reason decoder in place or repair forward. Returning to the
held-only guard would reopen the defect. No bulk data rollback is needed.

The next unblocked fix is BUG-04, preserving planning quantities when product
measurements change. BUG-05's runtime recovery also has the safe local BUG-02
handoff available; it remains a separate fixing task.
