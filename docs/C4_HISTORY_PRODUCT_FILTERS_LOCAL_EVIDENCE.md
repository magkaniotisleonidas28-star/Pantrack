# C4 saved-product history filters — local evidence

Recorded: 2026-10-26, Windows, workstream C4. One outcome: product/item filtering
shared by the saved-PO history list and complete PDF/native Excel exports.
C4/C5/M8 remain open, purchasing stays gated and the hosted release stays paused.

## Baseline and ownership

The clean root and refreshed remote `main` were at `ac5e419`. The existing
[date filters](C4_HISTORY_DATE_FILTERS_LOCAL_EVIDENCE.md),
[history criteria](C4_PO_HISTORY_FILTERS_LOCAL_EVIDENCE.md) and
[complete exports](C4_FILTERED_HISTORY_EXPORTS_LOCAL_EVIDENCE.md) were reused.
Work used `work/c4-history-product-filter-20261026`; feature commit `b9d719f`.

The refreshed [supplier-confirmation PR 17](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/17)
uses different application files and remains untouched. Status/roadmap edits
are shared handoffs and must preserve both outcomes when that PR merges.
Unpublished work on another computer cannot be detected by this check.
No schema, migration, dependency, company setting or external gate changed.
The original root and hosted databases were untouched. Existing migrations were
applied only to this task's fresh fictional database; no supplier/provider/model,
checkout, deployment or production action ran.

## Behavior and contract

The [shared contract](../src/lib/purchase-order-history-contract.ts) adds an
optional `product` criterion to both read endpoints and both download checks:

```text
GET /api/purchase-orders?companyId=<company>&product=beans&offset=0
GET /api/purchase-order-history-exports?companyId=<company>&product=beans
```

It is a trimmed literal substring, at most 200 characters, matching any saved
line's product ID, supplier SKU or description in the current saved revision.
It includes stock and non-stock items and works for manual, proposal and
registry-backed drafts. Matching a line selects the whole order once. Every
line, quantity, estimate, warning and status remains in the exported order,
including lines that did not match the criterion. No partial-order subtotal or
purchase evidence is invented.

The [bound SQL predicate](../src/lib/purchase-order-history-sql.ts) uses `EXISTS`
over saved line JSON. There is no wildcard expansion or SQL interpolation of
input. `%`, `_`, quotes, formula-looking text and SQL-looking strings are literal.
Case folding follows the existing SQLite ASCII behavior; there is no fuzzy,
accent or full Unicode case normalization. Blank/whitespace criteria normalize
to no product filter and retain the unfiltered fingerprint. Duplicate/unknown
keys and terms over 200 characters return 400. Detail/revision/choices calls
cannot mix with product criteria. List pagination and all export caps remain.

Product criteria combine with PO/supplier search, supplier, status and inclusive
date/time-zone filters. Only current saved descriptions/SKUs/IDs are searched;
notes, supplier/header text and live catalog names do not count as product
matches. A later saved SKU edit changes matching; a catalog rename does not.
No stock classification, quantity, mapping, financial policy or PO is changed.

The [list reader](../src/lib/d1-purchase-order-history.ts) keeps company membership
and data in one read statement. Product-matching summaries are materialized
before the ordered page window; ordinary header filters remain eligible for
inlining. During iteration, the initial nested-filter page composition repeated
an order across pages under tied creation timestamps. The permanent regression
fixes the multi-match order's position and verifies ID unions and offsets
1/19/20/27/28/1,000,000. The final query passed both actual SQLite producers and
the served local Worker. No SQLite root-cause attribution is claimed.

The [snapshot validator](../src/lib/purchase-order-history-export-contract.ts)
independently requires a matching saved line in every returned order. Product
criteria participate in the immutable fingerprint. Both authorized download
reads reuse the generic criterion serializer, including the product. A new
matching order holds download with 409; an unrelated nonmatching order does not
invalidate the snapshot. Anonymous, wrong-company, forbidden-role, revocation,
default-off, no-match and private/no-store contracts remain in force.

The [manager form](../src/components/workspace/purchase-order-drafts.tsx) adds
Product or item with a short accessible label, described help and a clear
whole-order explanation. Apply/Clear reset paging; detail/back retains criteria.
Unapplied input disables export, and typing cancels pending work immediately.
Existing date/page/navigation/company cancellation, error/retry/refresh and
empty-result states remain. The [formatters](../src/lib/purchase-order-history-documents.ts)
show the product criterion and whole-order scope in PDF and in both Orders and
Lines sheets. Existing exact-value projection, licensed font and literal-cell
engines are reused.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used. Command logs/reports are in root
`.sites-runtime/c4-history-product-filter-20261026/`. All checks ran in this worktree.

| Check | Result |
| --- | --- |
| Frozen offline install and fictional local setup | Passed with copied per-worktree dependencies; no root secrets or package changes. |
| Five existing focused history/date/export suites | Passed after the shared contract extension. |
| [Product regression suite](../tests/purchase-order-history-products.mjs) | Passed with real producers/SQLite, manual/non-stock/proposal/registry sources, both actual route wrappers, loopback HTTP, native files and the checked download lifecycle. |
| `pnpm typecheck` | Passed, including a final run after the accessible label/help refinement. |
| `pnpm test` | 132 invocations: 120 executed successfully, twelve explicit Windows skips. |
| `pnpm db:check` | All 38 existing ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Final application Worker/client build passed. |
| `pnpm db:migrate:local` | All 38 existing migrations applied to this task's fresh isolated database; final run found none outstanding. |
| `pnpm test:local` | Ordinary local HTTP smoke passed with preview off. |
| Signed-in local Edge | Nine downloads passed. From page two, main PDF/Excel contained all 32 matching POs and all 59 lines; beta and canceled subsets, literal SKU text and refreshed results also passed. |
| Actual data/lifecycle | No page overlap under tied timestamps/multiple line matches; current-SKU, saved description/product ID, catalog isolation, combined criteria, detail/back, no matches, Clear/retry, cancellation on input/apply/page/Clear/navigation/company, new matching/nonmatching records and revoked access passed. |
| Preservation | Every application table stayed unchanged across the read/export/cancellation sequence. Intentional seed/new-match/role writes were checked separately. Preview configuration restored byte-for-byte. |
| Independent files | PDF.js/OOXML tests passed on 28 POs/55 lines. Separate PyMuPDF/openpyxl processes checked those artifacts and actual browser files: 32 POs, 59 exact PO/line pairs, 61 PDF pages, revisions/statuses, fingerprint, date/product provenance, scope, bounds and literal cells. Unmatched lines remained present. |
| UI inspection | Desktop/390px controls and full screenshots, keyboard order, accessible label/help and no horizontal overflow passed; no page errors or outside requests. |
| Built Worker assets | Actual local production bundle served the product controls, exact licensed font/license and anonymous product-export 401/private-no-store refusal. |

The browser uses real saved-PO producers with an injected fixture clock and
native SQLite/D1 adapter, then reads/exports through the actual signed-in app.
Reports, screenshots and downloaded files remain in this worktree's
`.sites-runtime/product-history-browser-first/`; built-Worker evidence is in
`.sites-runtime/production-product-history-assets/`. Private fixtures are fictional
and uncommitted. Rendered PDF and controls were visually inspected.

## Limits, rollback and next handoff

No blocker remains for this local slice. Product searches scan saved line JSON
within the authorized company and materialize matching summaries for paging;
large-company performance beyond these fixtures is not established. Existing
100-order/1,000-line/2 MB source and projected-snapshot export limits, font/page
and Excel cell/Unicode refusals still apply. These are current draft records,
not a complete revision archive, issued document, confirmation or delivery record.
No hosted, supplier sandbox, café pilot, production or fresh G5 acceptance is claimed.

Rollback can revert `b9d719f` or disable the existing preview. No data/schema repair
is needed; retain the separately merged incoming-stock and spending-limit work.

Next bounded C4 document item: define and test the immutable private issued-
document storage contract (company/revision ownership, hash/template identity
and retention) using local dependencies. Recheck existing work and the supplier-
confirmation migration queue before schema-bearing integration. This outcome
does not close C4/C5/M8 or authorize a hosted release or supplier execution.
