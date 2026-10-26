# C4 D1 document archive journal — prepared local implementation

Recorded: 2026-10-26. One C4 outcome: replace the archive's conformance journal
with a D1 metadata adapter. **Implementation and local tests are prepared;
final application migration/integration is pending the shared schema queue.**
C4/C5/M8 remain open. No hosted acceptance or release is claimed.

## Scope and queue dependency

The clean baseline is `59d3d90`. Work is isolated in
`work/c4-document-archive-d1-20261026` on its matching short-lived workstream branch.
It builds on the [archive contract](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md)
and reuses the existing saved-draft/history producers and native PDF/Excel engines.

[Receiving PR 19](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/19)
still owns the migration queue. Its application files are separate, while its
schema, generated metadata and shared status documents require coordinated merges.
The queue-handoff question remains pending. No other contributor's branch was
modified or merged, and unpublished work cannot be detected.

The repository's [agent instructions](../AGENTS.md) say:
“Only one schema-bearing change may use the migration merge queue at a time.”
The [concurrent-work playbook](AI_DEVELOPMENT.md#6-concurrent-ai-work) also requires
generating the final migration only after rebasing on current `main`, without
reserving numbers or hand-merging snapshots. Accordingly, `src/db/schema.ts`,
`drizzle/`, migration numbers and shared progress documents remain untouched.

The draft schema is a [test fixture](../tests/fixtures/document-archive-journal.sql),
not an application migration. It is applied only to newly created fictional
SQLite/D1 fixtures. The root and hosted databases are untouched. No route, UI,
R2 binding, deployment, supplier, model or purchasing action was added or invoked.

## Implementation

| File | Behavior |
| --- | --- |
| [D1 journal](../src/lib/d1-document-archive-journal.ts) | Durable company-scoped reservation/replay, fenced leases, preparation, observations, publication, holds and authorized historical reads. |
| [Source guard](../src/lib/d1-document-archive-source-guard.ts) | Existing producer validation plus complete source/membership checks inside the actual mutating SQL. |
| [Schema fixture](../tests/fixtures/document-archive-journal.sql) | Three draft tables and eleven triggers for immutable metadata, retained leases and append-only observations. |
| [D1 lifecycle](../tests/document-archive-d1.mjs) | File-backed SQLite and actual filesystem lifecycle, commit-time races, durable refusal inputs, lost acknowledgments and process restart. |
| [Local D1 runtime](../tests/document-archive-d1-runtime.mjs) | Actual workerd D1 binding, native database clock, atomic mutations, tenant/role guards, immutable metadata and runtime restart. Object storage is an injected local map. |
| [Compatibility](../tests/document-archive-d1-schema.mjs) | Wrangler splitting, fresh/populated schema apply, unchanged legacy rows, foreign keys and existing export compatibility. |
| [Test dependencies](../tests/helpers/document-archive-d1.mjs) | Isolated fictional fixtures and explicit hooks for actual resource races. |

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

All six local checks passed in this worktree:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 141 suite invocations: 129 executed successfully, twelve expected Windows skips. |
| `pnpm db:check` | All 40 existing application migrations match Drizzle and apply fresh. The archive fixture is deliberately outside that application journal. |
| `pnpm build` | Application Worker/client build passed. |
| `pnpm db:migrate:local` | All 40 existing migrations applied to the task's fresh isolated database. No archive migration was generated or applied there. |
| `pnpm test:local` | Home/auth/company/catalog/tenant/sign-out HTTP smoke passed. |
| Final focused archive run | All four archive contract/journal/runtime/schema suites passed after the full pipeline, including the additional audit/missing-object/observation-reference refusals. |

The final source/test/schema/documentation review covered authorization, immutable
identity, atomic source/clock guards, private failures, unknown writes, retained
audit, scope and pending completion claims. Documentation whitespace and all
eleven relative file links passed. Private logs and fixtures remain in ignored
`.sites-runtime/c4-document-archive-d1-20261026/` at the root and the worktree's
`.sites-runtime/` directories. No hosted, provider sandbox, pilot or production
acceptance is claimed. The local app build/smoke are regression checks, not an
app archive walkthrough.

## Remaining integration, rollback and handoff

The adapter code is prepared; **the planned D1 adapter step is not fully complete
until its final migration is generated, verified and integrated.** After PR 19
merges or the owner explicitly hands over the migration queue:

1. Refresh/rebase on current `main` and preserve receiving's changes.
2. Add the three archive tables to Drizzle's shared schema; generate the final
   additive migration, snapshot and journal without choosing a number in advance.
3. Carry over the fixture's constraints/triggers, replace fixture-only schema
   setup with that migration, and review every generated schema artifact.
4. Repeat migration compatibility, Wrangler splitting/local apply and the full
   pipeline on the combined source before main integration.

Do not deploy or apply this to root/hosted data as part of that local handoff.
Private create-only R2 storage and authorized app save/read controls remain later
separate outcomes. Preserve all issued identities and audits; do not add deletion,
TTL, blind repair or rerendering to the storage adapter.

Rollback before migration integration is removal/revert of this prepared adapter
and fixture; no application database repair is needed. Future migration rollback
should disable callers while retaining the additive archive/audit tables, then
forward-repair any defect. Never delete or rewrite issued records to roll back.
