# C4 fictional draft PDF — local evidence

Recorded: 2026-10-24, Windows, workstream C4. Outcome: add PDF download to the
existing isolated fictional draft/CSV preview. This is one preparatory component;
C4/C5/M8 remain open. The owner deferred the online release. No hosted release,
maintenance, remote migration, supplier/model execution or purchasing occurred.

## Outcome and boundaries

The [PDF exporter](../previews/c4-order-draft/pdf.ts) takes the existing
[immutable draft projection](../src/lib/supplier-order-draft.ts), validates and
copies it before its first asynchronous operation, and generates a downloadable
PDF. It preserves company/supplier/account/location, product/SKU, proposal
revision and source status, whole packs, exact per-pack/total stock quantities,
canonical minor units, estimated line prices, warnings, review/edit reasons and
sales-source status. A changed projection, including modified totals or removed
warnings, is refused. Quantities and estimates use the existing exact string
formatters; no floating-point quantity or price calculation is introduced.

Every page says **“Fictional review draft — not an order.”**, labels prices as
estimates and includes page numbers. Missing prices remain **Unavailable**.
Ordinary items stay together; long fields wrap, and oversized items have a
continuation label. Control characters and directional overrides are shown as
literal escapes. Tested Latin, Greek and Cyrillic text survives extraction;
unsupported characters fail explicitly with text/CSV offered as alternatives.
Accessible tagged PDF and broader script coverage remain future work.

The [preview controls](../previews/c4-order-draft/main.ts) add Download PDF,
loading/busy, success and recoverable error states. Changing/reviewing/resetting
the example invalidates a pending download. Invalid sources disable all exports.
No approval, send, checkout, reservation or receiving action is added.

The [loopback server](../scripts/order-draft-preview.mjs) still serves exactly
three allowlisted in-memory assets on `127.0.0.1:5180`. The font is bundled into
JavaScript by esbuild, so CSP retains `connect-src 'none'`. There is no font CDN,
API, database connection or new filesystem-serving route. The
[unmodified font and license](../previews/c4-order-draft/assets/README.md) record
their upstream commit and SHA-256. The package/lockfile add pinned development
dependencies `pdf-lib@1.17.1`, `@pdf-lib/fontkit@1.1.1` and the independent test
reader `pdfjs-dist@5.4.296`; existing package versions are unchanged.

The implementation follows [PDF-LIB's custom-font API](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedfont)
and the test uses [PDF.js's document/page reader](https://mozilla.github.io/pdf.js/examples/).
These libraries and the font are used only by the local preview/tests; no
production app component imports the PDF module. No schema, migration, API,
authorization or durable purchase-order contract changed.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used. Logs, actual PDFs and screenshots
are retained privately under `.sites-runtime/c4-draft-pdf-20261024/`; final browser
artifacts are in its `final/` directory.

| Check run in this worktree | Result |
| --- | --- |
| Existing `pnpm test:focused supplier-order-draft` baseline | Passed before implementation. |
| `pnpm install --frozen-lockfile --offline` | Passed; lockfile and installed dependencies agree. |
| `pnpm typecheck` | Passed, including the final PDF layout. |
| `pnpm test:focused supplier-order-draft supplier-order-draft-pdf` | Passed after fixing the test fixture to preserve the handoff's matching estimate fields and 200-character SKU bound. Initial failed log retained. |
| `pnpm test:focused supplier-order-draft-pdf` after pagination changes | Passed; final full run also included the later continuation/snapshot tests. |
| `pnpm test` | 109 suite invocations: 99 executed successfully, ten explicit POSIX-specific Windows skips. The final PDF suite passed within this run. |
| `pnpm db:check` | All 35 ordered migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | Application build passed; existing route-classification/plugin timing notices remain. The final isolated preview was separately rebuilt and browser-verified. |
| Headless Edge/Playwright served walkthrough | Normal PDF via keyboard Enter, missing-price PDF, busy state, pending-download invalidation on source change, simulated Blob failure/retry, invalid-source refusal and Reset passed. No page errors. |
| Desktop and 390 × 844 visual review | Controls, keyboard focus, wrapping and PDF button inspected; no horizontal mobile overflow. Both final PDF pages rendered and visually inspected. Ordinary item details remain together. |
| Independent PDF.js reader in the permanent test | Exact values and Unicode, missing estimates, very large integers, non-USD minor-unit labels, long SKUs, escaped controls, oversized continuation, all 50 items across 18 pages, text within page bounds, no JavaScript/actions/attachments/links passed. |
| Independent PyMuPDF 1.26.5 inspection of actual browser downloads | Normal and missing-price PDFs each have two pages, embedded fonts, exact expected values and repeated draft labels/page counts. Retry produced another valid missing-price PDF. |
| Preview request audit | Only GET `/`, `/main.js`, `/styles.css`; no outside requests. `/api/orders`, `/.env`, separate font path and POST `/` return 404. |

The [permanent PDF test](../tests/supplier-order-draft-pdf.mjs) also consumes real
durable v1/v2 producer outputs against fictional SQLite fixtures, compares every
table and original source before/after repeated PDF exports, and installs a
throwing fetch spy. Database/source snapshots stayed identical, with zero network
calls. Mutation after export starts cannot change the captured PDF snapshot.
Foreign-company sources, inconsistent projections, unsupported glyphs and bad
font bytes are refused.

`git diff --check` passed and all 280 relative links/anchors across the five
changed/new Markdown files resolve. Full diff review found no unrelated source
changes, credentials, company-data exposure, unsafe external effects or milestone
checkbox advances.

`db:migrate:local` and `test:local` were not run for this preview-only slice:
there is no schema or application-route change, and the regular HTTP smoke leaves
fictional rows in the existing local D1. Fresh-schema consistency is covered by
`db:check`; actual export behavior is covered by the isolated served walkthrough.
This is local evidence only. No hosted, supplier sandbox, real-model, pilot,
production or full accessibility acceptance is claimed.

## Handoff and rollback

Run `pnpm dev:order-draft`, open <http://127.0.0.1:5180>, then choose Download PDF.
The server bundles once, so restart it after editing the preview. No credentials
are needed. Reverting this slice removes the PDF control/module, bundled font and
three development dependencies; no data repair or migration rollback is needed.

Next independent local C4 slice: native XLSX export of the same immutable
fictional draft. Integrating either format into the signed-in app is separate:
resolve company/role on the server, re-read the current authorized durable draft
and preserve its revision. The local builder is validation, not authentication
or a current-database freshness check. Final requested/observed/confirmed/received
exports, filtered history and private financial access remain C5 integration
work under the [PO/cart roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md).

The [prepared online release](C2_DEV_RELEASE_PREPARATION_20261024.md) stays on
hold. Its frozen candidate does not include this PDF slice; any later release
must revalidate the selected source. Purchasing and supplier submission remain
disabled. Existing cart/browser maintenance evidence and consumed allowances are
unaffected; no cart gate, cleanup or paid retry was run.
