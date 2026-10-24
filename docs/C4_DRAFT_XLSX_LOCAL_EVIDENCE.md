# C4 fictional draft Excel — local evidence

Recorded: 2026-10-24, Windows, workstream C4. Outcome: genuine `.xlsx` download
beside the existing local PDF/CSV controls, using the same immutable fictional
draft. This completes one preparatory component. C4/C5/M8 remain open; signed-in
export integration and the owner-deferred online release are separate.

## Delivered behavior

The [Excel exporter](../previews/c4-order-draft/xlsx.ts) validates and copies the
complete draft projection before asynchronous library loading. Changed quantities,
group context, source fingerprint or removed warnings are refused. It uses the
existing exact stock/estimate formatters without recalculating replenishment,
converting exact quantities through floating point, inventing totals or treating
missing prices as zero.

The workbook contains **Draft** and **Lines** sheets. Draft shows the fictional
company, supplier, account, location and review warnings. Lines contains all
products/SKUs, whole packs, exact conversions and stock quantities, estimate
displays/currency/minor units, proposal/revision/status, source/review/edit reasons,
sales-source status and repeated draft context/warnings. Both sheets identify
the file as **“Fictional review draft — not an order.”** The item header is
filterable, five heading rows and the first two item columns are frozen, long
cells wrap, and every populated data cell is literal text with Excel text format.
That preserves long numbers/identifiers on opening; numeric spreadsheet analysis
requires a deliberate conversion of a copy. No formulas or clickable links are
created from user text. Editing the downloaded file does not update Pantrack.

The exporter preserves normal Unicode, quotes, XML characters, leading zeros and
formula-like text. Controls/directional overrides are displayed as literal
escapes, and literal OOXML sequences such as `_x000D_` are escaped for round-trip
reading. Invalid Unicode, fields exceeding the conservative 32,767 serialized
character cell bound and text containing `x005F_` (case-insensitive) are explicitly
refused with a text/CSV fallback. Values are never silently truncated.

The reserved-marker refusal came from independent inspection: openpyxl's shared
string reader removes `x005F_` text even when standard OOXML escaping is present.
The initial failed artifact is retained in the private `final/` directory. The
final source holds this case instead of issuing an ambiguous identifier. The
same inspection found an unsectioned print header; adding its `&L` section marker
made the final workbooks parse without warnings.

The [preview UI](../previews/c4-order-draft/main.ts) adds Download Excel,
loading/busy, success and recoverable errors. Example changes invalidate pending
downloads, and invalid sources disable all four exports. A library-load failure
offers reload/text/CSV/PDF; a download failure clears busy state and permits retry.
No database connection, schema, app API, role contract or purchasing gate changed.

The [asset-only server](../scripts/order-draft-preview.mjs) now serves the exact
esbuild output allowlist, including same-origin code-split chunks. ExcelJS is
loaded only when requested. Host validation, GET-only routing, loopback binding
and CSP `connect-src 'none'` remain enforced; arbitrary files and APIs are not
served. Five distinct assets were requested in the walkthrough: HTML, CSS, main
JavaScript, the shared helper chunk and the on-demand ExcelJS chunk.

The implementation follows the rollout's [Excel defaults](PURCHASE_ORDER_ROLLOUT.md#durable-history-documents-and-permissions)
and [ExcelJS's document-workbook/browser API](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#browser).
Pinned development dependencies add `exceljs@4.4.0`, plus `fflate@0.8.2` and
`saxes@5.0.1` for independent ZIP/XML tests. No existing locked package version
changed. The production app imports none of this preview-only exporter.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used. Task logs/scripts and earlier
attempts remain under `.sites-runtime/c4-draft-xlsx-20261024/`; final browser
downloads, screenshots and the independent-reader report are in `verified/`.

| Check run in this worktree | Result |
| --- | --- |
| Existing `pnpm test:focused supplier-order-draft` baseline | Passed before implementation. |
| `pnpm test:focused supplier-order-draft supplier-order-draft-xlsx` | Both suites passed. |
| `pnpm typecheck` | Passed, including final source. |
| `pnpm test` | 110 suite invocations: 100 executed successfully, ten explicit POSIX-specific Windows skips. The final XLSX marker refusal and header repair are in its generated test module. |
| `pnpm db:check` | All 35 ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Application build passed; existing plugin timing/route classification notices remain. The final preview was separately rebuilt and browser-verified. |
| `pnpm install --frozen-lockfile --offline` | Passed. |
| Permanent independent ZIP/XML inspection | Native XLSX parts, both sheets, exact values/text formats, frozen/filterable headings, literal formulas/URLs, Unicode/controls/XML escaping, maximum 50 unique lines, 32,767-character value, explicit oversized/ambiguous/invalid refusals passed. No formulas, links, external relationships, macros or embedded objects. |
| Headless Edge/Playwright served walkthrough | Actual normal/missing-price Excel downloads, keyboard traversal/Enter, busy/duplicate-click guards, source-change cancellation, Blob failure/retry, invalid-source refusal and Reset passed. A deliberately blocked library chunk shows a useful error; reload recovers and downloads. No page errors. |
| Existing exports and layout | Actual PDF/CSV downloads still pass. Desktop and 390 × 844 screenshots visually inspected; no mobile horizontal overflow. |
| Independent openpyxl 3.1.5 inspection | Four actual final browser downloads plus adversarial and large-value files pass: exact string values, cell text formats, sheet/filter/freeze structure, no formulas/links and no parsing warnings. This includes 39-digit stock totals, 16-digit estimate minor units, Unicode, literal escape patterns, formula-like SKUs and escaped controls. |
| Network/routing audit | Preview requests are same-origin static GETs only; no provider calls. `/api/orders`, `/.env`, separate font/source paths, unknown JS, traversal and POST `/` return 404. |

The [permanent contract test](../tests/supplier-order-draft-xlsx.mjs) uses an
[independent fflate/Saxes reader](../tests/helpers/xlsx-reader.mjs), not ExcelJS's
own parser. Real durable v1/v2 producer outputs run against fictional SQLite:
every table and original source stays identical after repeated exports, and a
throwing fetch spy records zero calls. Input permutation preserves row order;
changing caller data after export starts cannot change the captured workbook.

`git diff --check` passed, and all 282 relative links/anchors in the four
changed/new Markdown files resolve. Full diff review found no unrelated changes,
credentials, customer data, unsafe external effects or milestone checkbox advances.

Excel Desktop/LibreOffice was not used, so a manual walkthrough in those apps is
not claimed. The XLSX structure and values were read independently with
openpyxl; spreadsheet print-layout and full accessibility acceptance remain
unverified. Local D1 migration application and the ordinary app HTTP smoke were
not run: this slice changes neither schema nor app routes, and that smoke leaves
fictional rows in the existing database. Local asset UI and fresh-schema checks
were run as recorded above. No hosted/supplier/model/pilot acceptance is claimed.

## Handoff and rollback

Run `pnpm dev:order-draft`, open <http://127.0.0.1:5180> and choose Download Excel.
Restart the preview after editing because it bundles once. No credentials are
required. Reverting this slice removes the Excel control/module, code-split
serving change, tests and three development dependencies; no data repair or
migration rollback is required.

Next bounded C4 outcome: define/test a server-authorized, revision-bound export
snapshot for saved PO drafts, including manual/non-stock lines and financial
access rules, before wiring these formats into the signed-in manager screen.
The fictional handoff builder does not establish authentication or current
database freshness. Final confirmation/receiving/filtered-history exports remain
under the [PO/cart roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md).

The [prepared online release](C2_DEV_RELEASE_PREPARATION_20261024.md) stays on
hold; its frozen candidate includes neither this slice nor the earlier PDF.
Any future release must revalidate selected source. No remote migration,
deployment, supplier/model execution, purchase, real cart gate or historical
browser cleanup was run. Supplier submission and automatic purchasing stay off.
