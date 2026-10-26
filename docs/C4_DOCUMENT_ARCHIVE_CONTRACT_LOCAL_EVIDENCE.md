# C4 private immutable document archive contract — local evidence

Recorded: 2026-10-26, Windows, workstream C4. One outcome: define and exercise
the private immutable PDF/native Excel archive lifecycle using local dependencies.
The contract slice is implemented; application persistence and download wiring
remain separate. C4/C5/M8 stay open and the hosted release stays paused.

## Scope and ownership

The clean baseline was `efd07de`. Work used the separate
`work/c4-document-archive-contract-20261026` worktree and branch. Archive feature
commit: `ff2c5cb`. Existing saved-draft/history readers, snapshot validators and
native document serializers were reused, without changing their behavior.

[Receiving PR 18](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/18)
owned the schema queue at task start and then merged upstream as `bb8f339`.
Integration commit `5eeba73` preserved its inventory implementation, migration
`0039` and shared documentation with no conflicts. The task did not merge the PR
itself. The subsequent
[receiving-counts PR 19](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/19)
was checked for overlap; archive application files are separate. Unpublished
work on another computer cannot be detected.

This archive slice adds no application schema, migration, dependency, bucket
binding, route or UI. Local conformance tables exist only in disposable fictional
SQLite fixtures. Incoming migrations were applied only to the isolated task
database. The original root and hosted databases were untouched. No supplier,
model, purchasing, live integration, deployment or production action ran.

## Implementation and contract

| File | Responsibility |
| --- | --- |
| [Archive contract](../src/lib/purchase-order-document-archive-contract.ts) | Strict requests, immutable manifest/artifact, versioned templates, opaque object identity, bounded private-object and durable-journal ports. |
| [Source adapter](../src/lib/purchase-order-document-archive-sources.ts) | Existing authorized D1 snapshot readers, frozen source proof and existing trusted PDF/Excel rendering. |
| [Archive lifecycle](../src/lib/purchase-order-document-archive.ts) | Save/replay, durable preparation, create-only object write, exact-byte verification, publish/recovery and authorized historical reads. |
| [Local dependencies](../tests/helpers/document-archive.mjs) | File-backed SQLite journal, actual membership/source transactions, immutable-row triggers and bounded create-only filesystem storage. Test adapters only. |
| [Lifecycle tests](../tests/purchase-order-document-archive.mjs) | Real source producers/renderers, native file readers, process restart, races, private errors and refusal/audit behavior. |

`save` accepts a company, stable operation ID, `pdf` or `xlsx`, and either one
saved draft ID/revision or complete history filters/fingerprint. It rejects
caller-supplied roles, actor identity, bytes, snapshots, template, keys and URLs.
Identity comes from the injected server session; current owner/manager membership
is checked by the journal inside each authorization-sensitive transition.
No HTTP API has been exposed by this slice.

The journal reserves company/operation/actor/request identity before generation.
The same company/operation is permanent: a different actor, format or source
conflicts. The same completed command verifies and returns the existing copy,
even after the original draft changes or is canceled. It never regenerates that
copy from current data. Active leases reject concurrent saves; expired tokens
cannot prepare or publish and may append diagnostic observations only.

A prepared immutable manifest records the server UUID, company, original actor,
format, template version, existing draft label, SHA-256, exact byte size, source
fingerprint, all selected PO IDs/revisions/statuses, request time and retention
policy. Completed artifacts add an immutable issue time. The four initial
template identities distinguish single draft/history and PDF/Excel. Existing
draft labels remain explicit: saving a copy does not record a purchase,
confirmation or delivery.

Object identity is derived from a hashed company prefix, document UUID, content
hash and format. No user text enters the path and no provider URL is returned.
The hash is a partition key, not an authorization mechanism. Object creation
must be atomic and conditional on absence. Reads check actual bytes and provider
size against the prepared hash/size before publication or handoff. Output is
capped at 10 MiB, in addition to all existing source/rendering limits.

Before the first object write, the manifest is durable and the journal rechecks
current role plus the complete current source atomically. Publication repeats
that check, including the filtered history membership. A new matching PO holds
an in-progress history copy even when old selected revisions did not change.
After publication, source changes do not alter the artifact; current company
membership and session identity still gate every read.

Generation size/signature and object presence/size/hash observations are appended
before refusal decisions. Raw provider errors and document content are excluded.
An audit failure refuses the operation. A lost write response retains the
prepared identity and records uncertainty. Retrying a prepared operation only
reads that exact object: it does not render or put again. Exact bytes can complete
publication if current access/source still permit it. Missing, corrupt or unknown
objects remain held, without deletion, overwrite or blind repair. A held private
object may remain after access/source changes; it is never an issued artifact.

Retention is `retain-until-explicit-policy`: this contract has no deletion or TTL
operation. No legal retention duration or production storage policy is inferred.

## Verification

The focused test and first full six-command pipeline passed on the archive
feature before receiving integration: 136 suite invocations, 124 executed
successfully and twelve explicit Windows skips, plus all 39 migration checks.
The combined receiving/archive pipeline then passed in the same worktree:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed on combined source. |
| `pnpm test` | 138 suite invocations; 126 executed successfully and twelve expected Windows skips. The archive lifecycle suite executed successfully. |
| `pnpm db:check` | All 40 ordered migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | Application Worker/client production build passed. |
| `pnpm db:migrate:local` | Incoming `0039` applied successfully to the task's existing isolated fictional database. No archive migration. |
| `pnpm test:local` | Home/authentication/company/catalog/tenant/sign-out HTTP smoke passed. |
| Documentation | `git diff --check` and all 358 relative file links across the four changed documents passed. |

Self-review covered the complete archive/source/test/documentation diff against
the merged receiving baseline: company/server authorization, immutable identity,
durable refusal inputs, retry effects, secrets, scope and completion claims.

The permanent lifecycle suite proves:

- Both source kinds and both native formats, source/template identity, byte
  hash/size and business-table preservation across archive operations.
- Anonymous, wrong-company, employee, owner/manager, changed-session and revoked
  membership behavior, including actual role changes at prepare/publish/read.
- Source edits at prepare and publish, plus new matching history membership.
- Permanent replay/conflict, simultaneous busy refusal, expired-token fencing
  and no overwrite of an already existing filesystem object.
- Historical byte equality after PO edits/cancellation, caller/render-buffer
  mutation isolation, malformed/empty/oversized generation and size mismatch.
- Corrupt/missing files, unknown reads/writes, durable refusal inputs,
  append-only observations, immutable artifact metadata and audit failure holds.
- A successful object write with a lost response followed by database close,
  a new Node process and exact recovery with zero render or put calls.

PDF.js and an OOXML reader inspect generated files in the suite. Separate
PyMuPDF/openpyxl processes also passed on the actual saved copies: a two-page
draft PDF, and a history workbook with two POs/three lines including cancellation.
They checked SHA-256/size against durable artifacts, exact values/fingerprint,
draft labels, PDF bounds and Excel literal cells. The first PDF page was visually
inspected. Evidence and fictional artifacts remain under the ignored
`.sites-runtime/document-archive-tests/` in the worktree; orchestration logs are
in the root `.sites-runtime/c4-document-archive-contract-20261026/` directory.

There is no new app UI or endpoint to walk through. The app Worker build and
ordinary HTTP smoke are regression checks, not proof of an R2/D1 archive adapter.
Local filesystem/SQLite conformance is not Cloudflare, sandbox, pilot or production
acceptance. No external acceptance or purchasing gate is advanced.

## Handoff, limits and rollback

The next bounded document outcome is a production-shaped D1 metadata journal
adapter, after refreshing the shared migration queue. Its additive migration,
atomic company/role/source guards, immutable metadata, audit retention, replay
and token fencing must pass actual Wrangler splitting/apply and lifecycle tests.
Do not replace atomic guards with a separate pre-read followed by an unguarded
batch. The receiving work owns its migrations; select no archive migration number
until the queue is clear.

After that, implement private create-only R2 storage and bounded hash-checked
retrieval, then connect an authorized app save/read lifecycle as separate slices.
Enforce private/no-store downloads without public/signed object URLs. Evaluate
storage recovery, object retention/administration and real limits on those actual
adapters before treating the app archive as complete. Future templates preserve
old artifact identity and never rerender an issued copy.

No blocker remains for this local contract. Storage credentials, production
configuration, legal retention duration and hosted acceptance are outside it.
Rollback can revert `ff2c5cb` and this evidence/status update. No archive data/schema
repair is required because the archive is unwired; preserve the separately merged
receiving work and its migration. C4/C5/M8 remain unchecked.
