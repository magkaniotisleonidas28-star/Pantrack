# C4 permanent document copies in the app — local evidence

Recorded: 2026-10-27. One C4 outcome: connect the existing private immutable
archive, D1 journal and R2 adapter to authorized app save/list/download controls.
C4/C5/M8 remain open. This is local implementation evidence; hosted release is
still paused and no bucket or hosted binding has been provisioned.

## Scope and baseline

The task began on clean, synced main `98aa016` in
`work/c4-document-archive-app-20261026`, using its own short-lived branch. Remote
main and open PRs were checked before work and again before full verification;
there was no published overlap. Other contributors' weekly schedules, supplier
suggestions, receiving, money decisions and over-cap approval changes are
preserved. Unpublished work elsewhere cannot be detected.

The [contract](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md),
[D1 journal](C4_DOCUMENT_ARCHIVE_D1_LOCAL_EVIDENCE.md) and
[R2 adapter](C4_DOCUMENT_ARCHIVE_R2_LOCAL_EVIDENCE.md) are reused. No application
schema, migration, package or hosted Wrangler configuration changes. Existing
migrations run only against isolated fictional test stores. The root and hosted
databases remain untouched. No real supplier, checkout, model, payment, identity
provider or R2 service is contacted; purchasing remains disabled.

## Implementation and contracts

| File | Responsibility |
| --- | --- |
| [API route](../src/app/api/purchase-order-documents/route.ts) | Current company/role/session and CSRF guards, strict commands/queries, trusted server generation, private binary handoff and safe errors. |
| [Archive catalog](../src/lib/d1-document-archive-catalog.ts) | One D1 batch reads current membership and only issued metadata, with 20-copy pages and deterministic date/ID ordering. |
| [App contract](../src/lib/purchase-order-archive-app-contract.ts) | Strict catalog/read selection, safe integer offsets, captured immutable metadata and UUID-based filenames. |
| [Browser lifecycle](../src/lib/purchase-order-archive-client.ts) | Durable tab-scoped request recovery, cancellation/disposal, bounded checked responses and final current-viewer check before Blob download. |
| [Saved copies section](../src/components/workspace/purchase-order-archives.tsx) | Save PDF/Excel, retry the same save, stop waiting, list/page/refresh copies, download and visible holds. |
| [Draft/history workspace](../src/components/workspace/purchase-order-drafts.tsx) | Connects the section to saved revisions and applied history filters; cancels pending work on input, edit, navigation or company change. |
| [Local preview](../scripts/purchase-order-preview.mjs) | Creates ignored local-only R2/assets bindings and enables the archive preview on loopback port 5179. |
| [HTTP regression](../scripts/local-smoke.mjs) | Verifies permanent copies remain off in the ordinary app configuration. |
| [API tests](../tests/document-archive-api.mjs), [client tests](../tests/document-archive-client.mjs) and [browser walkthrough](../scripts/document-archive-ui-check.mjs) | Exercise native resources, guarded routes, exact retries, real response streams and actual signed-in app downloads. |

The existing current-revision download buttons remain available. The separate
**Saved copies** section saves permanent files and retrieves their original bytes
after later edits or cancellation. Canceled drafts cannot create a new copy, but
their previously issued copies remain readable by a current company owner or
manager. History saves capture every matching record through the existing
complete filtered-history reader and its fingerprint, rather than the current
visible page. Existing history and 10 MiB file limits remain in force.

`POST /api/purchase-order-documents` accepts the existing archive command, with
`X-Pantrack-Archive-Viewer` as a current-session precondition. That header grants
no authority: authentication, membership and the journal's SQL guards determine
access. The service rechecks that the authenticated viewer still matches it.
Client-supplied bytes, actor/role, template, object key and URL are refused.

`GET` supports issued-copy lists (`view=list`, company, kind, optional draft ID
and offset), immutable metadata (`view=metadata`, company and document ID), and
the verified binary file (company and document ID). Duplicate/unknown selection
parameters are refused. Lists exclude held/unissued intents. Current metadata
reads require access too; no public/signed URL or R2 key is returned.

Every supported response, including permission/validation/default-off errors,
uses private/no-store and nosniff headers. The server uses the existing trusted
PDF/Excel serializers and reads the bundled licensed font through the internal
assets binding at one fixed path. It forwards no original request credentials.
The [Workers assets-binding contract](https://developers.cloudflare.com/workers/static-assets/binding/)
supports this internal access. The app origin is retained for the local Vite
bridge, which refused the initial synthetic hostname with HTTP 403.

The browser captures an operation ID and exact command in `sessionStorage`
**before** dispatch, scoped to current viewer, company and source. An interrupted
response, stop-waiting, navigation or reload can only retry that same request.
An explicit new save creates a new operation after a known outcome. Source-change
refusal permits a reload; corrupt/unavailable recovery data blocks a fresh save
instead of silently discarding the pending identity. File bytes and credentials
are never stored in this recovery record. Closing a tab discards this browser
recovery record; issued copies remain discoverable from the server catalog.

Stopping the browser wait does not undo a write that may already have happened.
The UI says so and offers verification of that save. Downloads allocate only the
manifest's bounded size, consume a real stream, verify actual length/SHA-256,
release reader locks, then recheck immutable metadata and the current viewer
before using the existing Blob/link/URL cleanup lifecycle.

The served app strips ordinary `Content-Length` on chunked transfers. A separate
`X-Pantrack-Document-Size` header binds the declared size to the immutable record;
actual byte count and hash are still checked independently. This avoids treating
chunked transfer as file corruption without allowing a partial file.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used in this worktree. Intended source
additions were staged before the full pipeline; source/index inventory stayed
fixed throughout that run. All six commands passed. After that run completed,
final review preserved actionable history preparation errors and disabled retries
when recovery storage is unusable. The affected tests, typecheck, build, built
Worker and ordinary HTTP smoke were repeated successfully on that final source;
the schema/migrations were unchanged. This avoids claiming the earlier full-suite
run included the later error-message branch. Exact-commit GitHub checks are
reported separately in the final handoff.

| Command/check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline`, `pnpm local:setup` | Passed with the unchanged lockfile and private task-local variable files. |
| `pnpm test:focused document-archive-api document-archive-client purchase-order-downloads purchase-order-history-downloads` | Four suites passed before the final history-error refinement. |
| `pnpm typecheck` | Passed in the full pipeline and on final source. |
| `pnpm test` | 157 selected suites: 145 executed successfully and twelve existing Windows/POSIX skips. |
| `pnpm db:check` | All 45 ordered migrations match the schema and apply fresh. |
| `pnpm build` | Passed in the full pipeline and again on final source. |
| `pnpm db:migrate:local` | All 45 existing migrations applied in the isolated worktree database. |
| `pnpm test:local` | Passed in the full pipeline and on final source, including the new archive-default-off check. |
| `pnpm test:focused document-archive-api document-archive-client purchase-order-history-downloads` | All three suites passed after the refinement; size, access, changed/empty history and failed recovery-storage cases preserve their safe outcomes. |
| `node scripts/document-archive-ui-check.mjs` with local Edge | Final signed-in walkthrough passed; five native files retained. |
| Final built-Worker probe | All four source/format combinations passed, with real session decryption, native D1/R2, exact read/replay, private headers and anonymous refusal. The identity provider is a confined fake and every outbound request is intercepted. Hosted configuration remains off. |
| Separate PyMuPDF/openpyxl readers | All five browser files and four final built-Worker files passed. |
| Whitespace and changed-document links | `git diff --check` and staged checks pass; all 397 relative links across the changed documentation and agent instructions resolve. |

The four focused API/client/current-download/history-download suites pass. The
new API test uses native local workerd D1/R2 with all 45 existing migrations,
real source producers and actual serializers. It proves anonymous, wrong-company,
employee, forged-viewer and CSRF refusals; strict payloads; private headers; both
formats and source kinds; issued-only deterministic pages without duplicates on
unchanged metadata;
current-role changes at handoff; original actor retention; unknown-write recovery;
and exact old reads after later edits/cancellation. Every non-archive application
table is unchanged by archive operations. A client restarted after a committed
save loses its HTTP response reuses the same command and causes one object put.

The final signed-in Edge walkthrough, with network confined to loopback, passes:

- Real Worker PDF/Excel saves, lists and verified downloads for a draft and
  product-filtered history; no client-generated file is uploaded.
- Lost response after the actual commit, reload, same-operation retry and no
  duplicate copy; stop-waiting after commit and the same verified outcome.
- Membership revocation during the final download handoff, with no browser file;
  employee and anonymous reads refused. A second fictional owner preserves the
  real last-owner constraint during the revocation fixture.
- Every business table preserved by archive operations, and the exact original
  document ID and byte hash retrieved after a later edit and cancellation.
- Desktop/390px layout, accessible buttons and keyboard focus, without page errors
  or horizontal overflow. The owned browser and preview are closed afterward.

Five actual browser files pass separate PyMuPDF/openpyxl inspection: exact saved
hashes, readable Unicode PDF, embedded NotoSans, US Letter pages, canceled history,
native workbooks and literal `=BAGS` text without formulas, hyperlinks or external
workbook links. Four additional files generated by the final built Worker pass
the independent readers too. The earlier browser pass is retained separately; the final pass
also includes stop-waiting and applied product filters.

The walkthrough was refined to select the original copy after a second explicit
PDF save, and to avoid changing local setup files during browser verification.
An environment-file restart invalidated one development walkthrough; its results
are not counted as a product failure or a pass. No authorization/storage rule was
relaxed. Agent instructions also add a preflight for positional PowerShell `rg`
wildcards after repeated read-command mistakes.

Logs and independent reports are in the root
`.sites-runtime/c4-document-archive-app-20261026/`. The final browser files,
screenshots and result are in the worktree's
`.sites-runtime/archive-browser/run-3785af77-d2c9-4a7a-bde8-da986f2f88d3/`.
Native API stores are disposable; preview D1/R2 stores remain isolated in this
worktree. Local/simulated identity-provider evidence is not hosted acceptance.

## Limits, rollback and next handoff

Only the fictional PO preview enables `PANTRACK_DOCUMENT_ARCHIVE_PREVIEW` and
binds `DOCUMENT_ARCHIVE`. Ordinary development/hosted configurations remain off.
No hosted bucket privacy, deployment, retention administration, performance or
provider durability is accepted. Private HTTP metadata is not a substitute for
disabling public bucket access. Existing creation-only/retain-until-policy
limitations and administrator-tamper holds remain unchanged.

Rollback disables the preview gate/removes its callers while retaining issued
objects, immutable D1 metadata, operation identity and observations. There is no
schema rollback or migration rewrite for this slice. Never delete or overwrite
an issued object to make a retry appear successful.

The next unblocked document outcome is a read-only manager/owner review of held
saves and missing/corrupt copies using the retained journal evidence. Administrative
repair/reissue/deletion and hosted activation require their own explicit scope.
C4/C5/M8 stay unchecked, purchasing disabled and hosted release paused.
