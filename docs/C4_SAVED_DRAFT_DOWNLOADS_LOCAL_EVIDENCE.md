# C4 signed-in saved-draft downloads — local evidence

Recorded: 2026-10-25, Windows, workstream C4. Outcome: PDF and Excel buttons in
the manager's current saved purchase-order view, using the existing authorized
snapshot and document generators. This completes one local UI integration;
C4/C5/M8 remain open and the hosted release remains deferred.

## Scope and integration baseline

Local `main` started clean at `41814f1`, two export commits ahead of its old
shared base and 21 commits behind refreshed `origin/main` at `9229f9f`.
The incoming commits are the merged C4 gate/launcher work, including the
[passing G5 offline gate](C4_FULL_OFFLINE_GATE_RUN_20261025.md). They add no
saved-draft download controls. An isolated worktree merged both histories at
`fe43be5`, without conflicts, preserving both local export commits and all
incoming work. This task changes no gate/launcher/audit implementation.

The [authorized export API](C4_SAVED_DRAFT_EXPORT_LOCAL_EVIDENCE.md),
[saved-document adapter](C4_SAVED_DRAFT_DOCUMENTS_LOCAL_EVIDENCE.md) and existing
PDF/Excel engines were reused. There is no new migration, dependency, API route,
document contract, permission model or feature flag.

## Delivered behavior

The [download component](../src/components/workspace/purchase-order-downloads.tsx)
appears in the [current saved-draft view](../src/components/workspace/purchase-order-drafts.tsx).
It names the current saved revision and provides Download PDF / Download Excel,
progress/busy feedback, cancellation, recoverable errors, retry and a stale-draft
reload action. New/edited unsaved drafts, historical revision details and canceled
drafts have no download controls. Existing manager/owner company authorization
remains on the server; employees cannot open this purchasing view.

The [download lifecycle](../src/lib/purchase-order-download.ts) performs an
authenticated, same-origin, no-store GET for the selected company, draft and
explicit revision. It validates the response and its selection before loading
document code. After generation, a second authorized GET checks membership,
current revision/cancellation and identical saved content before starting the
download. A changed draft is held for reload; it is never silently replaced by
a newer revision. These are read snapshots, not an indefinite guarantee that a
downloaded file will remain current after its final check.

Duplicate clicks share one pending job. Cancel, leaving the draft, entering its
editor, saving/reviewing/canceling, replacing its revision, switching company or
unmounting invalidate pending continuations. Abort signals stop pending fetches;
a canceled or disposed job cannot download or publish a later success state.
Blob URLs and temporary anchors are cleaned up on successful and failed handoff,
including element-creation/click failures. Filenames identify the PO, revision
and draft format. Supplier submission, purchasing and inventory are unaffected.

PDF code/font and Excel libraries load only on demand after the initial
authorization read. The [public font](../public/fonts/NotoSans-Regular.ttf) and
[OFL license](../public/fonts/OFL-NotoSans.txt) are byte-identical copies of the
existing licensed preview assets, now available to the real app's static server.
Unsupported PDF characters and Excel limits retain the existing explicit
refusals. Library-load errors explain when the page needs reloading.

## Verification in the combined worktree

Pinned Node 22.23.2 and pnpm 11.25.0 were used in
`work/c4-saved-draft-downloads-20261025`. Root logs/check scripts are retained
under `.sites-runtime/c4-saved-draft-downloads-20261025/`. The final app walkthrough
and six downloaded files are in the worktree's ignored
`.sites-runtime/manager-downloads-browser-verified/`; production-bundle asset
checks are under `.sites-runtime/production-download-assets/`.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | Passed with copied per-worktree dependencies and no package changes. |
| `pnpm test:focused purchase-order-downloads purchase-order-export-api purchase-order-exports` | All three suites passed. |
| `pnpm typecheck` | Passed, including the final lifecycle cleanup/error changes. |
| `pnpm test` | 117 suite invocations: 105 executed successfully and 12 explicit Windows skips. Includes the incoming gate tests and final new download test. |
| `pnpm db:check` | All 35 ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Combined Worker/client application build passed. |
| `pnpm db:migrate:local` | All 35 existing migrations applied to the fresh isolated worktree database. |
| `pnpm test:local` | Ordinary real local app smoke passed with the PO preview gate off. |
| Actual signed-in manager app, headless Edge | Owner PDF/Excel, manager Excel, transient error/retry, busy/cancel, leaving/editing/company switching, real membership revocation/employee denial, stale/reload/new revision, review and cancellation passed. Anonymous, forged-header and wrong-company HTTP reads are refused. |
| Actual downloaded files | Two PDFs and four XLSX files passed separate PyMuPDF/openpyxl inspection: saved revisions 1/2/3, exact quantities, unavailable versus zero estimates, embedded font, literal spreadsheet text and no formulas/links. |
| Layout/accessibility checks | Keyboard traversal includes both downloads; desktop and 390-pixel mobile screenshots were inspected, with no horizontal overflow. Busy states and status/alert messages are exposed. This is not a full accessibility audit. |
| Built Worker served locally through Wrangler | Exact font bytes, license and manager client chunk served from `dist`; anonymous export receives 401 with private/no-store headers. This used separate isolated local persistence, not a deployment. |

The [permanent lifecycle test](../tests/purchase-order-downloads.mjs) uses actual
saved-draft producers and SQLite, actual serializers, and the actual Blob/link/
URL handoff with injected dependencies. It covers anonymous/wrong-company/
employee refusal, owner/manager success, both authorization reads, real membership,
edit and cancellation writes between reads, strict selection checks, duplicate
jobs, cancel/restart, disposal, network/library errors, retry and URL cleanup.
Source and every application table remain unchanged by exports.

The browser walkthrough uses actual fixture-cookie authentication and application
routes. Explicit fictional role/edit/review/cancel mutations test refusal paths;
they are separated from the before/after table comparisons proving read-only
exports. A second fictional owner preserves the real last-owner database guard.
All outside browser requests were blocked; no page errors occurred. Only the
isolated worktree's fake configuration was temporarily enabled and it was
restored byte-for-byte. Owned local servers/browsers were closed afterward.

Earlier walkthrough attempts stopped on fixture assumptions: the last-owner
guard correctly refused a sole-owner downgrade; retained companies made a reused
display name ambiguous; a cancellation selector expected the wrong existing
label. Fixtures/selectors were corrected after inspection. The final complete
walkthrough passed; earlier artifacts remain retained. No application change
was needed for those fixture stops.

Full diff/security review, `git diff --check` and changed Markdown relative-link
checks passed. No secret, customer data, unsafe external effect or milestone
checkbox advance was introduced. No real Supabase/provider/hosted acceptance,
native Excel/LibreOffice walkthrough or fresh C4 gate invocation is claimed.
The historical G5 pass retains its frozen source and scope; these new UI changes
do not inherit a new full-gate result.

## Handoff, next task and rollback

The current saved-draft PDF/Excel workflow is complete locally. Keep
`PANTRACK_PO_DRAFT_PREVIEW` default-off outside the explicit local preview and
keep the owner-deferred hosted update on hold. No external decision or credential
was needed for this UI outcome. Any future hosted release needs a new selected
source/backup/migration/acceptance review; its old frozen packet predates these
commits.

The next unblocked C4 document/history outcome is company-scoped saved-PO history
search/status/supplier filtering. The current list is offset-paginated only;
inspect and extend that existing service instead of rebuilding history storage.
Filtered history/bulk exports, immutable issued R2 artifacts, supplier confirmation,
receiving, scheduler/alerts and hosted/external purchasing gates remain separate.

Rollback is a code revert of the controls, lifecycle module, editor hooks, static
font copies, focused test and documentation. The merged collaborator's gate work
can remain intact. No schema or business-data repair is required. No deployment,
remote migration, supplier/model call, real cart gate, historical browser cleanup
or purchase occurred. Supplier submission and automatic purchasing stay disabled.
