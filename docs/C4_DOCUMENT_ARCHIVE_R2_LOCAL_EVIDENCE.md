# C4 private R2 document objects — local evidence

Recorded: 2026-10-26. One C4 outcome: implement the private, create-only R2 object
port behind the existing immutable archive lifecycle and D1 journal.
This is local implementation evidence. C4/C5/M8 remain open and hosted release
stays paused; app save/read controls are a later slice.

## Baseline and ownership

The clean root was synced from `5025e83` to current remote main `ee7c001` before
creating `work/c4-document-archive-r2-20261026` and its short-lived branch.
This preserves the other contributor's merged weekly suggestion/schedule/screens,
payment decisions and over-cap approval work. No open PR remained at the overlap
check. Unpublished work on another computer cannot be detected.

The [archive contract](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md),
[D1 journal](C4_DOCUMENT_ARCHIVE_D1_LOCAL_EVIDENCE.md), current snapshot readers and
native PDF/Excel renderers are reused. No application schema, migration, package,
route, UI or deployed bucket binding is added. The root and hosted databases are
untouched. Existing migrations are applied only to isolated fictional test stores.
No live bucket, supplier, model, payment, checkout or deployment was contacted.

## Implementation

| File | Responsibility |
| --- | --- |
| [R2 object port](../src/lib/r2-document-archive-objects.ts) | Opaque key validation, owned/checksummed bytes, atomic conditional creation, bounded stream reads and private error handling. |
| [Shared digest](../src/lib/document-byte-digest.ts) | The existing owned-buffer SHA-256 function, moved without changing behavior. |
| [Archive lifecycle](../src/lib/purchase-order-document-archive.ts) | Imports/re-exports that digest under its existing API; authorization, source checks, durable intent/observations and recovery behavior are unchanged. |
| [Port/stream tests](../tests/document-archive-r2.mjs) | Input identity/caps, checksums, mutation capture, size lies, overflow/truncation, failures, cancellation and released reader locks. |
| [Native lifecycle tests](../tests/document-archive-r2-runtime.mjs) | Actual local Worker R2 writes and D1+R2 archive lifecycle, native formats, current permissions, tamper/missing holds and process restart. |
| [Worker fixture](../tests/helpers/document-archive-r2-worker.ts) and [test core](../tests/helpers/document-archive-r2.mjs) | Ephemeral local bindings and nonce-protected test endpoints only; neither is an app endpoint. |

The object port accepts only the canonical company-hash/document-UUID/content-
SHA-256/format key produced by the archive. Keys, URLs and arbitrary paths never
become a public download mechanism. Company authorization remains in the server
archive lifecycle and its D1 journal; the opaque hash is not authorization.

Writes capture the caller's bytes before awaiting, refuse empty/oversized or
hash-mismatched input, and supply an R2 SHA-256 checksum. Every write uses
`onlyIf: {etagDoesNotMatch: '*'}`. An existing object yields `exists` and is never
overwritten, including concurrent callers. Content type follows PDF/XLSX, with
attachment and private/no-store HTTP metadata. No list, delete, public/signed URL,
multipart operation, overwrite or automatic retry is exposed.

Reads use one `get` so metadata and body come from the same object version. They
never call `head` then fetch a potentially different body, or load an unbounded
`arrayBuffer`. Oversized/invalid size metadata cancels the body before consumption.
In-bounds bodies use one allocation bounded by the reported size and the existing
10 MiB archive ceiling. A stream exceeding its advertised size is canceled with
no bytes returned; reader locks are released on success, refusal and failure.

Short/corrupt bodies return their actual observed bytes to the internal archive
lifecycle. That lifecycle records actual size/hash before refusing the document;
it never hands partial or corrupt bytes to the caller. Provider errors are
sanitized. Unknown write/read outcomes are durably recorded by the existing
journal, and prepared retries only verify the same object. They never rerender,
put again, overwrite, delete or silently repair it.

The implementation follows the official [Workers R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [conditional-write consistency](https://developers.cloudflare.com/r2/reference/consistency/)
contracts. Tests verify the selected condition in the actual local Worker/runtime;
this is not a hosted R2 acceptance claim.

## Verification

Focused contract, D1 journal, R2 port and actual runtime tests are run in this
worktree. The native test uses persisted local workerd D1 and R2 bindings, with
actual PDF/Excel serializers; the store is no longer an in-memory object map.
It proves:

- Twelve simultaneous Worker writes create once; eleven return `exists`.
- Checksums and native object metadata match the stored bytes; a limited Worker
  read returns no body instead of truncating a file.
- Both single-draft/history sources and PDF/native Excel survive exact retrieval.
- Anonymous, wrong-company and employee requests cause no R2 I/O. Owner reads
  retain original actor identity; revoked roles or changed sessions refuse handoff.
- The complete manifest is durable before the first R2 put, and archive operations
  preserve every non-archive application table in one native D1 read snapshot.
- Completed replay performs no additional render or put; source edits/cancellation
  do not change an issued copy.
- A successful R2 put with a lost response leaves a prepared hold. After disposing
  the runtime, a separate Node process reopens the same D1/R2 stores and publishes
  the exact copy with zero render or put calls.
- A put failure before creation remains held on retry. Corrupt, truncated or
  missing files are refused after durable observations, without automatic repair.
- Permission/source changes after a real object write leave a private held object
  and no issued artifact. Unissued records cannot be downloaded.
- Bounded stream cases include zero/max limits, malformed sizes/chunks, overflow,
  read/cancel errors, incorrect object identity and released locks.

During setup, the application-table preservation check was scoped to Drizzle's
owned tables, excluding Cloudflare internal tables. A Headers serialization limit
in the Node-to-workerd test bridge was avoided by using R2's structured conditional
option; the actual Worker race test independently verifies its atomic behavior.

The intended source files were staged before the full pipeline, and source/index
inventory stayed fixed through all six checks. Pinned Node 22.23.2 and pnpm
11.25.0 were used in this isolated worktree.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | Passed with the unchanged lockfile. |
| `pnpm local:setup` | Passed; private task-local variable files only. |
| `pnpm test:focused document-archive-r2 document-archive-r2-runtime document-archive-d1 purchase-order-document-archive` | All four suites passed on the final source. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 155 selected suites: 143 executed successfully and twelve explicit Windows/POSIX skips. |
| `pnpm db:check` | All 45 ordered migrations match the schema and apply fresh. |
| `pnpm build` | Passed. |
| `pnpm db:migrate:local` | All 45 existing migrations applied to the isolated worktree database. |
| `pnpm test:local` | Home page, anonymous/forged-header refusal, fictional sign-in/company/catalog, tenant isolation and sign-out passed. |
| `git diff --check`, staged whitespace check and documentation link check | Passed; all 387 relative links in the four changed documents resolve. |

The twelve skips are existing POSIX browser/maintenance fixture suites, not the
new R2 tests. No second full-suite run or source change was needed after these
checks. The final handoff separately reports any exact-commit GitHub CI result.
Logs and fictional stores remain under the root
`.sites-runtime/c4-document-archive-r2-20261026/` and the task worktree's ignored
`.sites-runtime/` directories. No new UI exists to walk through. App build/HTTP
smoke are regression checks; they do not prove a hosted archive is configured.

## Limits, rollback and next handoff

The adapter guarantees creation-only access through this port, and the journal
detects external alteration. It does not configure provider-level object locks or
prevent a separately privileged administrator from modifying a bucket. The test
driver deliberately simulates that corruption; reads are then held for review.
Retention remains `retain-until-explicit-policy`, without a deletion or TTL API.

Hosted bucket privacy, public-domain settings, lifecycle/retention administration,
credentials, deployment and real-provider durability/performance remain unverified.
Private/no-store metadata does not itself make a public bucket private. Verify
public access is disabled when a bucket is separately provisioned and bound.

Next bounded C4 document outcome: connect authorized app save/read controls to
this R2 port and the existing journal using local bindings first. Preserve current
company/role checks, private/no-store responses, source/revision identity,
permanent operation IDs, audit and user-visible holds. Keep signed/public object
URLs and implementation details out of that user flow.

Rollback disables/reverts the object adapter's callers while retaining stored
objects, immutable D1 metadata and observations. No schema repair is required for
this slice. Preserve the other contributor's weekly/financial changes and do not
delete issued objects or rewrite used migrations. No acceptance checkbox advances.
