# C4 saved-document review — local evidence

Recorded: 2026-11-01. One C4 outcome: owners and managers can review held saves
and recorded missing/corrupt-file checks without changing the journal or files.
C4/C5/M8 remain open. Hosted activation and release remain deferred.

## Scope and integration boundary

The isolated branch `workstream-c/c4-document-archive-review-20261031` starts from
documentation PR #28 (`f320bea`), above main's G6 rebinding `5f9df85`. This avoids
repeating its status corrections or competing edits to the shared progress notes.
An initial remote check found only that documentation PR, with no published
implementation overlap. Unpublished work cannot be detected.

The [G6 instructions](C4_FULL_OFFLINE_GATE_RUN_20261025.md#next-g6-then-the-separately-authorized-paid-matrix)
prohibit merges from preparation until the paid matrix finishes. Operator status
remains unknown; this work stays on its separate branch and does not merge into
main, invoke G6, create an allowance or run a real model. PR #28 must integrate
first at a safe point. Then retarget this feature's PR to main, refresh any
shared-file changes and rerun affected checks before integration.

## Changes and contracts

| File | Responsibility |
| --- | --- |
| [Review contract](../src/lib/document-archive-review-contract.ts) | Strict source-scoped queries, bounded response schemas and fixed status/reason text. |
| [D1 review projection](../src/lib/d1-document-archive-review.ts) | Current company/role reads in one D1 batch; attention filtering before 20-record paging; safe observation history in append order. |
| [Existing API](../src/app/api/purchase-order-documents/route.ts) | Adds guarded GET views `review` and `review-detail`; preserves the existing preview flag, private/no-store headers and fixed errors. |
| [Review client](../src/lib/document-archive-review-client.ts) | Owns cancellable GET requests, pins viewer/company/source, discards stale responses and clears data on refused/invalid reads. |
| [Review screen](../src/components/workspace/document-archive-review.tsx) and [saved copies controls](../src/components/workspace/purchase-order-archives.tsx) | Review saves, safe reasons, newest-first checks, paging, refresh/stop, empty/error/retry states and selection/navigation cleanup. |
| [Native API coverage](../tests/document-archive-api.mjs), [review cases](../tests/helpers/document-archive-review.mjs), [client coverage](../tests/document-archive-review-client.mjs) and [browser walkthrough](../scripts/document-archive-review-ui-check.mjs) | Actual resource lifecycle, access boundaries, retained recovery evidence, no review writes/file IO and signed-in UI behavior. |

`GET /api/purchase-order-documents?view=review` accepts the existing catalog
selection: company, draft/history kind, draft ID when applicable and offset.
`view=review-detail` also requires a document UUID and pages the recorded checks.
Both return at most 20 records plus `hasMore`; neither accepts bytes, a storage
key/URL, a supplied actor, repair or deletion. Details must match the selected
company and source. Current owners/managers can review another original actor's
save; employees, anonymous callers and other companies cannot read it.

Unissued operations distinguish active waiting, expired/unconfirmed saves and
holds. Issued copies appear in the attention list only when their last retained
file check is missing, mismatched or unavailable. Successful later checks remove
that current warning while retaining earlier observations. Append order resolves
same-timestamp events, independent of UUID ordering. Raw requests, lease tokens,
source snapshots, provider details and arbitrary reason text are never returned.

The screen explicitly describes **recorded results**, not a fresh file scan.
Refresh reads the journal only. It does not touch R2, retry a save, generate a
file, repair/delete anything or change an observation. The existing exact-request
recovery and immutable downloads remain separate and unchanged. No schema,
migration, dependency or hosted runtime binding is added.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0, with the unchanged lockfile, were used in
this worktree. Intended source additions were staged before the six-command run;
source and inventory stayed unchanged until all six checks completed. Only the
documentation's final result wording was filled in afterward. Logs are retained
at the absolute root evidence directory
`C:/Users/Leo/Project/Pantrack/.sites-runtime/c4-document-archive-review-20261031/`.

| Check | Result |
| --- | --- |
| Locked offline install and `pnpm local:setup` | Passed with private task-local settings. |
| Focused API, archive-client and review-client suites | Three passed. |
| Signed-in Edge walkthrough | Passed on final UI/walkthrough source; 24 attention records, draft/history scopes and empty history. |
| `pnpm typecheck` | Passed, including the frozen final pipeline. |
| `pnpm test` | Passed: 158 selected suites, 146 executed successfully and twelve existing Windows/POSIX skips. |
| `pnpm db:check` | Passed: all 45 ordered migrations, schema and fresh database agree. |
| `pnpm build` | Passed. |
| `pnpm db:migrate:local` | Passed: all 45 existing migrations in this worktree's isolated local database. |
| `pnpm test:local` | Passed: home, sign-in, company/tenant isolation and default-off archive behavior. |
| Whitespace and changed-document links | `git diff --cached --check` passed; all 403 relative links, including 15 section targets, resolve; 29 A/B/C states match and no acceptance checkboxes change. |

The native API suite applies all 45 existing migrations to ephemeral local D1
and uses native R2. Actual saves, a lost write response, missing/corrupt objects,
failed reads and exact-request recovery feed the review projection. It proves
pending/expired/held/missing/damaged/unavailable states, bounded source-scoped
paging, unknown-reason redaction, role revocation inside the D1 boundary, changed
identity at response handoff, and retained observations after recovery. Every
review read preserves all application and archive tables and causes zero R2
reads/writes. Review also works without an R2 binding because it reads metadata.

The browser's held saves come from actual source-change refusals; missing/corrupt
states are explicitly seeded retained-observation fixtures. Detection itself is
proved separately with real native objects in the API suite. The browser checks
20+4 paging, older checks, safe errors/retry, stop-waiting, a real role change,
history's empty state, keyboard focus and 390px/desktop layout. All application
and archive tables remain identical after review; every review request is GET
and no page errors occur. Screenshots were visually inspected. Final evidence:
`C:/Users/Leo/Project/Pantrack/work/c4-document-archive-review-20261031/.sites-runtime/archive-review-browser/run-677d385c-21d3-4e5c-bc22-bb6bb75ab209/`.
The owned browser and preview were closed afterward; port 5179 was released.

The first native comparison incorrectly included a Cloudflare-reserved metadata
table and was refused. The corrected test uses the application's snapshot
inventory; the passing run does not claim access to platform internals. A short
durable D1 comparison rule was added to [agent instructions](../AGENTS.md).
An initial browser launch preceded preview readiness; only completed walkthroughs
are counted. These harness failures are not reported as passing checks.

## Limits, rollback and next handoff

This is local fictional evidence. Root/hosted databases, live R2, supplier/model
services, purchases and deployment remain untouched. Existing migrations apply
only in ephemeral tests and the isolated worktree's local stores. Hosted bucket
privacy, performance, durability and complete workflow acceptance remain open.

Rollback removes the new GET callers/review controls or disables the existing
archive preview gate; retain all original documents and observations. No data
repair or migration rewrite is needed. After the G6 merge restriction clears,
the next bounded document outcome is a recovery/reissue policy defining who may
act and how original evidence is retained. No administrative recovery, reissue
or deletion is implemented or authorized by this read-only slice.

The subsequent [recovery policy](C4_DOCUMENT_RECOVERY_POLICY_20261101.md) now
defines the next explicit issued-file check and the constraints for later
continuation/replacement work. The replacement-role choice remains pending;
the policy adds no runtime action or permission.
