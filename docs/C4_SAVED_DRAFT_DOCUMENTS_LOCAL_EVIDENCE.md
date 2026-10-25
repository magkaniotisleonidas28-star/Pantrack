# C4 saved-draft PDF/Excel adapter — local evidence

Recorded: 2026-10-25, Windows, workstream C4. Outcome: PDF and native XLSX
generation from the existing authorized saved-draft export response. This is
one document-adapter outcome. Signed-in download controls remain the next task;
C4/C5/M8 remain open and the online release remains deferred.

## Existing work reused

Before implementation, local `main` was clean at `9f8eaaf`. A fetch confirmed
the concurrent C4 gate branch at `1177bbd` changes gate/launcher/audit work,
not saved-draft documents. The completed [fictional PDF](C4_DRAFT_PDF_LOCAL_EVIDENCE.md),
[fictional XLSX](C4_DRAFT_XLSX_LOCAL_EVIDENCE.md) and
[saved-draft authorization/revision API](C4_SAVED_DRAFT_EXPORT_LOCAL_EVIDENCE.md)
were inspected. Their functionality was reused, rather than implemented again.

The old preview generators require replenishment handoffs, so they cannot
represent a manual/non-stock saved PO honestly. The missing adapter now reads
the existing `pantrack.purchase-order-export.v1` response and projects saved
PO fields directly. It never fabricates proposal handoffs for manual items.

## Delivered behavior and contracts

The [document adapter](../src/lib/purchase-order-documents.ts) exports
`serializePurchaseOrderPdf(snapshot, fontBytes)` and
`serializePurchaseOrderXlsx(snapshot)`. Both capture and structurally validate
their input before asynchronous imports. Captured input/font bytes cannot be
replaced by caller edits while generation is pending. These functions do not
authenticate, fetch an API response, check current membership/revision or sign
a document. Consumers must obtain the response from the existing authorized
endpoint for the selected company, draft and revision.

The existing [export contract](../src/lib/purchase-order-export-contract.ts)
now shares its document validation with `capturePurchaseOrderExport`. Its
response fields, version, permissions, atomic D1 read and default-off gate
are unchanged. Missing warnings/limitations, inconsistent arithmetic,
duplicate lines, canceled status, invalid review references and ambiguous
registry references are refused. Structural validity is not proof of server
origin, current database freshness or purchase approval.

PDF/XLSX retain saved manual stock/non-stock lines, proposal v1/v2 references,
registry supplier/mapping versions, unit labels, descriptions, exact decimal
string quantities, estimates, notes, cap, company/supplier/account/location,
warnings and current review metadata. Missing prices remain **Unavailable**,
zero remains zero, and non-stock inventory quantities say **Not applicable**.
Unit estimates absent from older snapshots say **Not saved**; they are not
derived from totals. Supplier-specific saved pack sizes override no live data:
the six-unit saved mapping remains six when inventory's default is thirty.

Both formats say **Draft — no order placed.** PDFs repeat the PO reference,
revision/status and draft label on every US Letter page, embed the existing
licensed Noto Sans font and paginate without cutting off values. Unsupported
font characters and exports above 500 pages are refused. XLSX has Draft/Lines
sheets, frozen/filterable headings and literal text values, preserving long
numbers/identifiers and avoiding formulas or clickable links. Existing Unicode,
control/OOXML escaping and oversized/ambiguous cell refusals are retained.
Source warnings and all three freshness/estimate/no-order limitations appear
in both formats. No stock, supplier, price or sales readiness is recomputed.

The existing layout/escaping code now lives in the shared
[PDF engine](../src/lib/draft-document-pdf.ts) and
[XLSX engine](../src/lib/draft-document-xlsx.ts).
The [fictional PDF adapter](../previews/c4-order-draft/pdf.ts) and
[fictional XLSX adapter](../previews/c4-order-draft/xlsx.ts) use those same
engines and retain their fictional labels, source validation and behavior.
There are no duplicate rendering engines or new package dependencies.

## Local verification

Checks ran in `work/c4-saved-draft-documents-20261025`, based on `9f8eaaf`, with
pinned Node 22.23.2 and pnpm 11.25.0. Root private logs/scripts remain under
`.sites-runtime/c4-saved-draft-documents-20261025/`. Browser scripts/downloads
remain in this worktree's ignored `.sites-runtime/saved-documents-browser/`.

| Check in this worktree | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | Passed with copied per-worktree dependencies; no new packages. |
| Existing export/API/PDF/XLSX focused baseline | Four suites passed before preview-engine extraction. |
| `pnpm test:focused purchase-order-documents purchase-order-exports purchase-order-export-api supplier-order-draft-pdf supplier-order-draft-xlsx` | All five suites passed. |
| `pnpm typecheck` | Passed, including final runtime source. |
| `pnpm test` | 113 suite invocations: 103 executed successfully and ten explicit POSIX-specific Windows skips. |
| `pnpm db:check` | All 35 ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Application build passed. Existing Vinext route-classification notices remain. |
| `pnpm db:migrate:local` | All 35 existing migrations applied successfully to the fresh isolated local database. |
| `pnpm test:local` | Real local application smoke passed: fixture sign-in, anonymous/forged-header refusal, company/catalog, tenant isolation and sign-out. Only fictional local rows were created. |
| Headless Edge downloads | All ten actual browser PDF/XLSX downloads passed; no page errors or outside requests. |
| Separate PyMuPDF/openpyxl inspection | Both reader processes exited zero; all five PDFs and all five workbooks passed. |

The [permanent document test](../tests/purchase-order-documents.mjs) uses actual
saved-draft producers and SQLite, then independent PDF.js and ZIP/XML readers.
Manual/non-stock, proposal v1/v2, registry, reviewed, large-number and 50-line
outputs pass. Values above Number precision, missing/zero estimates, exact
saved revision/grouping, private profile-field exclusion, immutable input/font
capture, invalid inputs and explicit unsupported/oversized refusals are covered.
Every SQLite table and original input stays identical across generation; a
throwing fetch spy observes zero provider calls.

Headless Edge generated ten actual downloads from a private loopback harness:
PDF and Excel for manual, reviewed, registry, large and 50-item saved responses.
No page errors or outside requests occurred. Document libraries load on demand.
Independent PyMuPDF and openpyxl inspection confirms every downloaded file's
saved values, revision, embedded PDF fonts, exact Excel text, draft labels and
absence of formulas/links. Rendered manual pages and a middle large-document
page were visually inspected. The 50-item example is eighteen PDF pages.

The initial combined Python reader printed successful assertions but crashed
during process shutdown (one confirmed Windows access-violation exit). Separate
PDF-only and XLSX-only checks, with explicit PDF resource disposal, both exited
cleanly with all five files passing. The combined-reader cause remains unresolved;
its retained report is supplementary and is not counted as a clean process pass.
No application source change was needed for this verifier workaround.

An initial typecheck caught a nested readonly type syntax error, corrected before
the passing checks. The private browser harness's first import path was also
corrected before its passing build/download run. Earlier attempts are retained.
`AGENTS.md` now requires absolute paths for evidence outside the active worktree
after repeated incorrect relative evidence-path reads. Full diff/security review,
`git diff --check` and all 291 relative Markdown links/anchors passed; no secrets,
customer data or milestone checkbox advances were introduced.

The harness uses fictional snapshots produced by the saved D1 reader, not the
signed-in app's future controls. Excel Desktop/LibreOffice and hosted PDF/Worker
generation were not exercised. Browser generation, independent readers and
local app build evidence do not establish those separate acceptance criteria.

## Handoff and rollback

Next unblocked C4 outcome: wire PDF/Excel controls to the selected saved draft
in the signed-in manager screen. Fetch the authorized endpoint with its explicit
revision, handle 401/403/409 and held sources, cancel obsolete selections,
provide busy/error/retry states, and serve the licensed font locally. Keep
API selection/authorization checks in that flow; the serializers alone provide
neither authentication nor a current-state check. Actual signed-in browser
walkthrough and Worker/client asset integration remain that outcome's checks.

No schema, migration, API route, runtime gate, dependency or other contributor's
gate script changed. Shared status/roadmap notes require normal merge coordination.
A frozen release/gate candidate needs fresh preparation after any source merge.
Revert the adapter, shared-engine extraction, export-validator refactor, test and
documentation to roll back; no business-data or schema repair is required.

No deployment, remote migration, supplier/model call, real cart gate, historical
browser cleanup or purchase was performed. Only isolated fictional local test
data was used. Supplier submission and automatic purchasing remain disabled.
