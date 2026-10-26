# C4 D1 document archive journal — local migration and lifecycle evidence

Recorded: 2026-10-26. One C4 outcome: replace the archive's conformance journal
with a D1 metadata adapter and its additive application migration.
The migration and lifecycle tests now use the application schema directly.
C4/C5/M8 remain open. No hosted acceptance or release is claimed.

## Scope and migration ownership

Preparation started from `59d3d90` and was pushed as `5cd9f17` in
[PR 20](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/20).
Completion rebased that existing implementation onto current `main` at `6020d0b`.
Work is isolated in
`work/c4-document-archive-d1-20261026` on its matching short-lived workstream branch.
It builds on the [archive contract](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md)
and reuses the existing saved-draft/history producers and native PDF/Excel engines.

[Receiving PR 19](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/19)
merged upstream as `4960603`, and
[order-closure PR 21](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/21)
then merged as `6020d0b`. Both were integrated by rebasing without application
conflicts. No other open schema PR remained when archive generation began.
The other contributor's branch/PR was not modified or merged by this task.
Unpublished work on another computer cannot be detected.

Following the [migration queue rules](AI_DEVELOPMENT.md#6-concurrent-ai-work),
Drizzle generated `0042_document_archive_journal` from the freshly rebased schema,
after receiving's `0040`/`0041`. No migration number was reserved, no snapshot was
hand-merged, and no previously used migration was rewritten. The former draft
SQL fixture was removed. All archive tests now require the application migration.

Migrations are applied only to isolated fictional SQLite/D1 databases.
The root and hosted databases are untouched. No route, UI,
R2 binding, deployment, supplier, model or purchasing action was added or invoked.

## Implementation

| File | Behavior |
| --- | --- |
| [D1 journal](../src/lib/d1-document-archive-journal.ts) | Durable company-scoped reservation/replay, fenced leases, preparation, observations, publication, holds and authorized historical reads. |
| [Source guard](../src/lib/d1-document-archive-source-guard.ts) | Existing producer validation plus complete source/membership checks inside the actual mutating SQL. |
| [Application schema](../src/db/schema.ts) | Three archive tables, company/composite foreign keys, operation/token uniqueness and JSON/state/time checks. |
| [Migration 0042](../drizzle/0042_document_archive_journal.sql) | Additive schema plus eleven triggers for immutable metadata, retained leases and append-only observations. |
| [Snapshot](../drizzle/meta/0042_snapshot.json) and [journal](../drizzle/meta/_journal.json) | Generated schema ancestry after `0041`; all prior table definitions remain identical. |
| [D1 lifecycle](../tests/document-archive-d1.mjs) | File-backed SQLite and actual filesystem lifecycle, commit-time races, durable refusal inputs, lost acknowledgments and process restart. |
| [Local D1 runtime](../tests/document-archive-d1-runtime.mjs) | Actual workerd D1 binding, native database clock, atomic mutations, tenant/role guards, immutable metadata and runtime restart. Object storage is an injected local map. |
| [Compatibility](../tests/document-archive-d1-schema.mjs) | Wrangler splitting, fresh/populated schema apply, unchanged legacy rows, foreign keys and existing export compatibility. |
| [Test dependencies](../tests/helpers/document-archive-d1.mjs) | Isolated fictional fixtures and explicit hooks for actual resource races. |
| [CHECK validator](../scripts/sqlite-check-constraints.mjs), [migration checker](../scripts/check-migrations.mjs) and [tests](../tests/ci-check-constraints.mjs) | Verify applied named CHECK expressions against Drizzle while preserving quoted values and nested SQL; missing/changed checks also fail the complete migration checker. |

The journal implements the existing server-only port; it is not connected to an
HTTP endpoint or the application. The caller must supply the authenticated server
actor from the existing archive lifecycle. SQL checks current company owner/manager
membership at reservation, preparation and publication, and again at historical
read/recheck. Caller roles, arbitrary document bytes, templates, keys and URLs do
not become archive inputs.

Reservations permanently bind company/operation/actor/request identity. Active
attempts return busy; changed requests conflict. Each claim rotates a unique
lease token and retains the old lease. Prepared manifests preserve exact
company/source/template/hash/size/time/retention identity. Issued artifacts are
immutable, and later PO edits/cancellation never cause them to be regenerated.

Preparation and publication validate the current source using the existing
readers, persist the expected/observed source proof, then recheck role, lease and
complete selected revision/status membership in the mutating statement itself.
This relies on the existing immutable revision/event/header rules in migrations
`0025`/`0027`; regression tests refuse direct mutation of that evidence. The history
guard reuses the existing SQL predicates for search, supplier, status, product,
dates and zone. New matching records hold publication; unrelated records do not.
No large snapshot aggregate or one-parameter-per-record query is introduced.

Production lease checks and issue timestamps use native database time inside the
write statement. A trusted injected SQL clock exists only for local conformance
tests. It is never populated from user input or an environment setting. A failing
test first reproduced expiry after a pre-read; the corrected code refuses at
prepare/publish even when no newer claimant has replaced the token.

Every mutation carries a unique write ID. A write and its result read share a D1
batch transaction. Lost acknowledgments are reconciled against the durable write
ID, never `meta.changes`; unknown outcomes fail closed. Source observations,
object evidence and hold reasons are retained before their corresponding
refusals. Raw provider errors and file content are excluded. A successful file
alone cannot publish without its matching durable observation from the same lease.

The implementation follows Cloudflare's documented
[batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): bound values
stay below the parameter limit, and SQL does not aggregate full history snapshots
into a single large database string. Actual hosted limits/performance remain
unverified.

## Verification record

The existing archive lifecycle baseline passed in this worktree. Focused journal,
schema compatibility and actual local workerd D1 tests passed. They prove:

- Both original owner/manager access and anonymous/wrong-company/employee refusals.
- Current role/source checks after pre-reads and before actual SQL commits.
- Full filtered/unfiltered history, all criteria, added matching/nonmatching POs.
- Database-clock expiry, busy refusal, expired-token fencing and permanent replay.
- Immutable metadata/leases/audit, source evidence and legacy-row preservation.
- Historical byte equality, tamper refusal, audit failure and missing-object holds.
- Reconciliation after lost D1 responses at reservation, prepare and publish.
- A lost object-write response followed by a different process recovering from
  the same file-backed database/files with zero render or put calls.
- Native local D1 persistence after stopping and recreating the workerd runtime.

The first complete run stopped at the migration checker's deliberate guard against
schema-declared CHECK constraints, which earlier schemas did not declare.
Validation was added before continuing: it reads applied DDL, tokenizes quotes,
comments and nested parentheses, and compares complete declared check sets without
collapsing string contents. Regression tests reject missing, changed and extra
constraints; complete checker tests mutate only disposable copies of migrations.
The archive migration itself was not rewritten after being applied.

The preparation run passed all six checks before migration integration: 141 suite
invocations, 129 executed successfully and twelve Windows skips, with 40 then-
current migrations. The final frozen-source completion run on the combined
receiving/closure/archive source passed all six checks:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 147 suite invocations: 135 executed successfully and twelve expected Windows skips. |
| `pnpm db:check` | All 43 ordered migrations match Drizzle and apply to fresh SQLite, including declared CHECK validation. |
| `pnpm build` | Application Worker/client build passed. |
| `pnpm db:migrate:local` | Pending receiving/counting, closure and archive migrations applied only to the task's isolated database; all 43 are now applied there. |
| `pnpm test:local` | Home/auth/company/catalog/tenant/sign-out HTTP smoke passed. |
| Focused archive migration run | All four archive contract/journal/runtime/schema suites passed using application migration `0042`, including actual local workerd D1. |
| Receiving integration baseline | Journal/runtime/order-closure tests passed after rebasing onto receiving and closure. |

The final source/test/schema/documentation review covered authorization, immutable
identity, atomic source/clock guards, private failures, unknown writes, retained
audit and scope. `git diff --check` and all relative file links in the five changed
Markdown files pass. The snapshot comparison proves that the three archive tables
are the only additions and every prior table definition is unchanged. An earlier
verification-order error left a removed fixture in Git's inventory; intended
source changes were then staged/committed before the successful frozen run. The
durable workflow rule in [AGENTS.md](../AGENTS.md) prevents that recurrence.
Private logs remain in the root
`.sites-runtime/c4-document-archive-d1-20261026/` (preparation) and
`.sites-runtime/c4-document-archive-d1-final-20261026/` (completion), plus the worktree's
`.sites-runtime/` directories. No hosted, provider sandbox, pilot or production
acceptance is claimed. The local app build/smoke are regression checks, not an
app archive walkthrough.

## Limits, rollback and next handoff

The D1 journal and application migration are this bounded outcome. The journal
remains unwired to the app, and there are no storage credentials or external
acceptance dependencies for these local checks. The next bounded document item
is private create-only R2 storage with bounded/hash-checked retrieval against this
existing journal; authorized app save/read controls follow separately.
Keep draft labels and current access checks, retain issued identities and audit,
and add no deletion, TTL, blind repair or rerendering of issued copies.

No production migration or hosted release is authorized by this evidence.
Rollback disables/reverts journal callers while retaining the additive archive
tables and observations, then forward-repairs any defect. Other workstreams'
receiving/closure migrations must remain intact. Never delete or rewrite issued
records or a used migration to roll back. C4/C5/M8 remain unchecked.
