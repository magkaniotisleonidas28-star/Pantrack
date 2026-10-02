# A8 review of proposal migrations 0016 and 0017, with guard repair 0022

Reviewed locally on 2026-09-30. Outcome: one database transition-guard defect
requires a follow-up; no destructive change or company-isolation defect was
found in the supported application paths. This review does not accept M7 or
authorize remote migration, deployment, supplier submission, or purchasing.

The focused forward repair passed local verification on 2026-10-02. The
nullable-reason finding is resolved for databases that apply `0022`; existing
historical records are preserved. A8/M7 acceptance remains open.

## Contract and scope

Workstream step: **A8 — Accept M7**, bounded to migration readiness.
Review the committed SQL, generated snapshots, journal, schema, proposal
writers, compatibility tests, and recovery notes for
[`0016`](../drizzle/0016_light_hedge_knight.sql) and
[`0017`](../drizzle/0017_confused_electro.sql). Preserve existing local work and
data. The reviewable outcome is a finding and local evidence report; repair is
a separate implementation task.

## Finding: nullable invalidation reason bypasses the transition guard

**P2 — database guard correctness.** In `0017`, the allowed invalidation branch
uses `NEW.invalidation_reason IN (...)`, inside `CASE WHEN NOT (...)` in
`replenishment_state_update_guard` (SQL lines 84–104). Because the column is
nullable, `IN` returns SQL `NULL` when the new reason is `NULL`. If the remaining
invalidation conditions match, the complete allowed-transition expression and
its negation are both `NULL`. `CASE WHEN` then skips the rejection.

A direct SQL probe reproduced this sequence on a fictional `review_required`
proposal with one pack and no previous invalidation:

```sql
UPDATE replenishment_proposal_states
SET revision = revision + 1,
    change_id = 'probe-null-invalidation', kind = 'invalidate',
    changed_by = 'system', reason = 'Fictional invalidation',
    invalidation_reason = NULL
WHERE company_id = 'review-a' AND proposal_id = 'proposal-a';

UPDATE replenishment_proposal_states
SET revision = revision + 1, packs = '2',
    change_id = 'probe-edit-after-null', kind = 'edit',
    changed_by = 'fictional-manager', reason = 'Fictional edit after invalidation'
WHERE company_id = 'review-a' AND proposal_id = 'proposal-a';
```

Both statements succeeded and appended audit events. The first event says
`invalidate`, but the state remains editable because its invalidation reason
is still `NULL`. This violates the database invariant that an invalidated
proposal cannot be edited.

The current [`D1 lifecycle writer`](../src/lib/d1-replenishment-lifecycle.ts)
always supplies a supported, non-null reason. No current HTTP request path
was found that produces this failure. It is a database protection gap for an
incorrect future writer or repair statement, not evidence of an authorization
bypass or the owner's earlier HTTP 409 error.

Recommended repair: use a **new migration** to replace the guard, explicitly
reject a null invalidation reason, or reject any allowed-transition expression
that is not true. Add a focused SQL regression proving that null/unknown reasons
abort without changing state or audit history, while valid invalidation still
blocks subsequent edits. Do not rewrite migrations already used locally.

## Checks and compatibility

- `0015` → `0016`: the snapshot adds only proposal origins. `0016` → `0017`:
  it adds only proposal state and events. Existing table definitions are
  unchanged, snapshot ancestry matches, and the ordered journal contains all
  18 migrations.
- `0016` is additive and has no backfill. Its company/product foreign key,
  company-scoped IDs, and immutable-origin triggers agree with the schema.
- `0017` preserves existing origins and initializes revision-one state and
  creation events. The compatibility suite covers duplicate preexisting
  origins: their quantities remain held until each is resolved. It does not
  silently discard or merge them.
- A direct SQL audit-ID collision rolled back the whole state update. A blocked
  duplicate nonzero proposal left no origin, state, or event. Foreign-key and
  integrity checks passed.
- Fresh isolated Wrangler `--local` application passed all 18 migrations. The
  local ledger recorded `0016` and `0017` once each, and all nine proposal
  triggers were present. This used temporary local state and did not migrate
  the owner's existing database.
- `pnpm db:check`: passed, 18 migrations matching schema and fresh SQLite.
- `pnpm test:focused replenishment-proposal-origins-d1 replenishment-lifecycle-d1
  a8-clover-review-contract c4-a7-supplier-handoff m2-security`: passed, five
  suites. These include anonymous, wrong-company, forbidden-role, replay,
  reservation, source-change, and review-only handoff checks.
- `pnpm typecheck`, `pnpm test` (33 suites), and `pnpm build`: passed.

No migration, schema, application behavior, or purchasing contract was changed
during the initial 2026-09-30 review. Only this report and its status link were
added then.

## Forward repair and local evidence — 2026-10-02

Workstream step: **A8**, bounded to repairing the database transition guard.
The reviewable outcome is that a missing or invalid invalidation reason cannot
change proposal state or append an audit event, while valid lifecycle operations
continue to work. No external decision or credential is needed for this local
slice. Existing uncommitted work was preserved, and this was the only pending
schema-bearing change in the checkout's migration queue.

- `pnpm exec drizzle-kit generate --custom
  --name=repair_replenishment_state_guard` initially generated a local-only
  `0018` repair. During packaging, remote `main` had advanced through used
  migrations `0018`–`0021`. The unpublished repair was regenerated by Drizzle
  as [`0022`](../drizzle/0022_repair_replenishment_state_guard.sql), with its
  [snapshot](../drizzle/meta/0022_snapshot.json) and
  [journal entry](../drizzle/meta/_journal.json).
- The migration drops `replenishment_state_update_guard` without `IF EXISTS`,
  then recreates it after a statement breakpoint. The only guard change is
  replacing `NOT (allowed transitions)` with `(allowed transitions) IS NOT TRUE`.
  Both SQL `FALSE` and `NULL` now raise the existing transition error. All
  transition branches, revision/quantity checks, reservation checks, and error
  messages are preserved.
- All upstream SQL and snapshots through `0021` are byte-for-byte unchanged.
  The regenerated snapshot has a unique ID, its parent is `0021`, and every
  other snapshot definition is identical. No table, application, API, type,
  or data change is included. The accepted [ten-minute freshness policy](decisions/0004-m7-development-sales-freshness.md)
  remains unchanged.
- The new [SQL regression suite](../tests/replenishment-state-guard-migration.mjs)
  first failed on the NULL bypass before the repaired trigger was installed.
  It now proves upgrade preservation for every application table, with seeded
  origins, edits, invalidations, cancellations, legacy/exact inventory, settings,
  and a second fictional company. It rejects NULL, empty, whitespace-only, and
  unsupported reasons on independent `draft` and `review_required` proposals
  without any writes. All four supported reasons produce one revision and one
  matching system audit event, retaining packs and requiring review.
- The suite rejects edits and repeated invalidation after invalidation, allows
  cancellation with the reason preserved, permits ordinary edits/cancellation
  with a NULL reason on clean proposals, and proves complete rollback on an
  audit change-ID collision. Foreign-key enforcement and integrity checks pass.
- The [existing lifecycle suite](../tests/replenishment-lifecycle-d1.mjs) still
  asserts `0017` backfill preservation before applying later journal entries.
  Its authorization, replay, reservation, cancellation, source-change, and race
  checks now exercise the repaired guard.

Initial local verification before integrating newer remote `main` (the repair
was then numbered `0018`, and the source had 34 suites / 19 migrations):

| Command or check | Result |
| --- | --- |
| `pnpm test:focused replenishment-state-guard-migration replenishment-lifecycle-d1` | Passed, two suites |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 34 suites, including the existing pending work |
| `pnpm db:check` | Passed, 19 ordered migrations matching schema and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` in an isolated temporary current-source mirror | Passed, all 19 migrations on fresh local D1 |
| Wrangler `d1 migrations apply DB --local --config wrangler.upgrade.json --persist-to .wrangler/upgrade-state`, then the same command with `wrangler.local.jsonc` | Passed through `0017`, then applied only `0018` after seeding existing proposal history |
| `pnpm test:local` in the same isolated source mirror | Passed, local HTTP fixture sign-in, authorization, company isolation, CSRF, and sign-out |
| Ledger, installed trigger, and preservation inspection | Both local databases have `0018` exactly once and exactly one update guard matching the repair SQL; upgrade application rows and every other schema object are unchanged |
| Foreign-key/integrity checks, baseline hashes, `git diff --check`, and changed documentation links | Passed |

The temporary source mirror excluded existing runtime state and variable files;
local setup created fresh fixture variables with empty integration credentials.
Wrangler's local validation needed localhost sockets outside the filesystem
sandbox. Migration ledger entries and D1 runtime transaction counters advanced
as expected; they were excluded from the application-row comparison. Hashes
confirmed that the owner's existing local D1 state and unrelated pending files
were unchanged. These are local results, with no remote, provider, pilot, or
production evidence.

## Packaging integration verification — 2026-10-02

Before pushing, `git fetch origin` found 14 newer commits through `b1aef5d`.
They include the W1/W2 migrations already applied to hosted development. Three
focused A8 commits were rebased onto that source, preserving the other
workstreams' Toast, Baldor, waste, recipe, package, and hosted-release records.
The repair SQL is identical to the initial local-only version; Drizzle
regenerated its number, snapshot, and journal from the current migration queue.
No used migration or generated upstream metadata was hand-merged or rewritten.

The regression still seeds proposal history at `0017`, applies intervening
journal entries, and isolates the repair's row-preservation check. The
lifecycle suite applies all later entries after its backfill assertions.

| Integrated check | Result |
| --- | --- |
| `pnpm test:focused local-d1-database a8-sales-readiness-d1 a8-clover-review-contract m2-security replenishment-lifecycle-d1 replenishment-state-guard-migration` | Passed, six suites |
| `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build` | Passed, 41 suites and 23 migrations |
| `pnpm db:migrate:local` in a fresh isolated current-source mirror | Passed, all 23 migrations |
| Isolated Wrangler apply through `0021`, seed existing edited/invalidated/canceled proposal history, then apply `0022` | Passed; all application rows and every other schema object preserved |
| Ledger, trigger definition, foreign-key and integrity inspections | Both databases have all 23 ledger names exactly once and one guard matching `0022`; checks passed |
| `pnpm test:local` in the isolated mirror | Passed, local HTTP authentication/company-isolation smoke |
| `node scripts/a8-local-served-check.mjs` with only isolated fixture gates enabled | Passed, review, authorization, create/retry/list/edit, audited invalidation/repeat read, and cancellation; no provider or supplier calls |
| Upstream SQL/snapshot comparison, existing local D1 hashes, full diff/whitespace review, relative documentation links | Passed |

These checks used temporary local state, with new fixture variable files and
empty integration credentials. The owner's existing D1 state was preserved.
Pushing the commits does not apply `0022` to development D1 or establish hosted
A8 acceptance. The recorded W1/W2 release remains separate external evidence.

## Recovery and remaining evidence

The [origin recovery note](M7_A7_ORIGIN_NOTES.md) and
[lifecycle recovery note](M7_A7_LIFECYCLE_EVIDENCE.md) use a pre-migration local
snapshot only before new proposal/history writes. Once writes exist, preserve
them and use a new forward repair. Do not drop immutable history or blindly
rerun a partially applied migration; inspect the ledger, tables, and triggers.
Previously numbered local A7 databases also require a fresh database or reviewed
repair before adopting the merged sequence.

For any failed `0022` application, inspect `d1_migrations` and the installed
`sqlite_master` trigger definitions before retrying. Verify exactly one
`replenishment_state_update_guard` exists and uses `IS NOT TRUE`. If protection
is missing or the ledger and schema disagree, stop proposal writes while the
schema is reviewed. Preserve all origins, state, and audit history and use
another forward migration to restore protection if needed. Do not rewrite used
migrations, delete historical events, or blindly reapply the drop/create pair.
No destructive rollback or history correction is part of this repair.

The repository records an earlier remote trigger-parser failure and its
[development recovery procedure](M2_SETUP.md#development-d1-trigger-migration-recovery).
This review did not reproduce remote application or restore behavior, inspect
the current remote ledger, or exercise hosted concurrency/browser acceptance.
The initial review used the older status record at `0015`. The subsequently
fetched [W1/W2 hosted release](C2_W2_HOSTED_RELEASE.md) records development D1
through `0021`, including A7 `0016`/`0017`. The `0022` guard repair is local only.
No provider, supplier, or external database was contacted.

The local guard repair is complete. The next unblocked A8 item is preparation
of the development migration packet, including a read-only ledger/trigger
inspection plan and hosted verification steps. Remote application, deployment,
and hosted browser, end-to-end, and concurrency evidence require their separate
authorization; M7 and real M8 stay gated.
