# C4 purchase-order history filters — local evidence

Recorded: 2026-10-25, Windows, workstream C4. Outcome: company-scoped search,
status and supplier filters in the existing manager saved-PO list, including
correct pagination and asynchronous recovery states. This is one C4 outcome;
C4/C5/M8 remain open and the online release stays deferred.

## Baseline and overlap check

The four completed local export/integration commits were pushed to `main` at
`336c447` before this work. Its [Windows/Ubuntu repository checks](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/40249939780)
both passed, including their six-command pipelines. GitHub showed no open PRs;
refreshed remote refs had no unmerged changes to the PO service/API/manager-list
files. The other contributor's gate work was already merged. Work that has not
been pushed from another computer cannot be inspected through this check.

Implementation used `work/c4-po-history-filters-20261025`, based on `336c447`.
The [existing saved-draft storage](C4_PO_FOUNDATION_LOCAL_EVIDENCE.md),
[revision history](C4_PO_REVIEW_LOCAL_EVIDENCE.md) and
[signed-in document controls](C4_SAVED_DRAFT_DOWNLOADS_LOCAL_EVIDENCE.md) were
reused. No schema, migration, dependency, purchase operation or provider gate
changed. This task does not re-run or extend the historical G5 gate acceptance.

## Delivered behavior and contract

The [history contract](../src/lib/purchase-order-history-contract.ts) adds
optional `q`, `supplier` and `status` parameters to the existing GET list:

```text
GET /api/purchase-orders?companyId=<company>&q=<text>&supplier=<text>&status=reviewed&offset=0
```

`q` searches saved PO numbers or supplier names. `supplier` searches saved
supplier IDs or names. Both are trimmed literal substring searches, limited
to 200 characters, and combine with each other and an optional exact
`draft`/`reviewed`/`canceled` status. `%`, `_`, quotes and SQL-looking input
are ordinary text, not wildcard or SQL syntax. SQLite's native `lower` gives
ASCII case folding; non-ASCII text is matched literally, without accent folding
or full Unicode case normalization. Empty text fields mean no text filter.

List query keys must be unique and recognized. Offsets are canonical nonnegative
integers, at most 1,000,000. Oversized list URLs, invalid statuses, duplicate or
unknown fields and filters mixed with choices/detail/revision requests are
refused with 400. Existing valid unfiltered, choices and detail calls remain
compatible. The list response remains `{orders, hasMore}` with at most twenty
rows and no invented total count. Generic GET failures describe a failed read;
they no longer suggest an uncertain save. All GET outcomes are private/no-store.

The [focused D1 reader](../src/lib/d1-purchase-order-history.ts) uses one SQL
statement for current company owner/manager membership and the filtered page.
Its authorized empty-page sentinel distinguishes no matches or a large offset
from revoked/forbidden membership. Filters apply before LIMIT/OFFSET; current
saved revisions provide supplier names/status. Sorting remains
`created_at DESC, id DESC`, using twenty results plus one lookahead. All values
are bound parameters. The existing service delegates its list method to this
reader; old `list(companyId, offset)` callers retain their behavior.

Each page is a read snapshot. Separate offset requests are not one frozen
multi-page snapshot; concurrent changes can move matches between pages. Search
uses current saved PO revisions, not historical supplier names, live registry
profiles, legacy Pantrack orders, confirmation/receiving records or line products.
Product/date filters and filtered bulk documents remain separate outcomes.

The [manager list](../src/components/workspace/purchase-order-drafts.tsx) has
Search saved drafts, Status, Supplier, Apply filters and Clear filters. Apply
and Clear reset to the first page; opening a draft and returning preserve the
applied criteria. Criteria are view preferences, not unsaved business edits.
Loading clears previous results and disables paging. Errors have Retry results;
filtered no-match and genuinely empty history have distinct messages. Abort
signals and request generations prevent older searches, inactive views and
previous companies from overwriting the current list. Existing detail, history,
editing/review and PDF/Excel behavior remain available.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used. Root logs/check scripts are in
`.sites-runtime/c4-po-history-filters-20261025/`. The real signed-in browser
harness, report, screenshots and downloaded workbook remain in the isolated
worktree's `.sites-runtime/history-browser-verified/`.

| Check in this worktree | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | Passed with copied per-worktree dependencies; no package change. |
| `pnpm test:focused purchase-order-api purchase-order-drafts purchase-order-review` | All three existing contract suites passed after reader extraction. |
| `pnpm test:focused purchase-order-history purchase-order-api purchase-order-drafts purchase-order-review` | All four suites passed. |
| `pnpm typecheck` | Passed, including the final UI loading/cancellation changes. |
| `pnpm test` | 118 suite invocations: 106 executed successfully and twelve explicit Windows skips. |
| `pnpm db:check` | All 35 ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Application Worker/client build passed. |
| `pnpm db:migrate:local` | All 35 existing migrations applied to a fresh isolated local database. No new migration. |
| `pnpm test:local` | Ordinary real local HTTP smoke passed with the PO preview gate off. |
| Real app / headless Edge | Thirty-three saved POs exercised unfiltered and filtered pages, combinations, old matches outside page one, first-page resets, literal characters, no matches, empty history, delayed responses, tab/company changes, retry and current-role refusal. |
| UI/regression inspection | Keyboard order, 390-pixel mobile and desktop screenshots passed visual inspection with no horizontal overflow. Opening a reviewed result and downloading a genuine XLSX preserves revision 2; returning retains the filters. No page errors or outside requests. |

The [permanent test](../tests/purchase-order-history.mjs) uses actual producers
and SQLite, the actual route/authorization wrapper, injected identity/environment
only, and loopback HTTP. It covers company separation; owner/manager success;
anonymous, wrong-company and employee refusal; membership revoked immediately
before the actual query; empty-offset authorization; literal/bound combined
filters; deterministic ties and matching before pagination; current versus old
supplier names; canonical input; generic private storage/identity failures; and
unchanged legacy contracts. Repeated reads leave every table unchanged and a
throwing fetch spy observes zero provider calls.

The browser uses real local fixture-cookie authentication and D1. Owner/manager
searches pass, employee/anonymous/wrong-company requests fail, and no-match
results expose no other company's rows. The pure read/detail/export sequence
preserves every application table. Explicit fake role changes for refusal tests
are outside that comparison and retain another fictional owner. Temporary
configuration was restored byte-for-byte; owned browsers/servers were closed.

Full diff/security review, `git diff --check` and changed Markdown relative-link
checks passed. No secrets/customer data, unsafe external effects or milestone
checkbox advances were introduced. This is local fictional acceptance, not
hosted, real Supabase/provider, café/pilot or production acceptance.

## Handoff and rollback

The next unblocked C4 document outcome is an authorized snapshot for a complete
filtered history export across pagination, with explicit size/refusal limits.
Reuse this filter contract and current document infrastructure; page-by-page
client downloads are not an immutable bulk-export snapshot. Issued R2 artifacts,
confirmation/receiving, scheduler/alerts and external purchasing acceptance remain
separate. No credential or external decision blocked this slice.

Rollback is a code revert of the history reader/contract, service/API delegation,
list controls/styles, focused test and documentation. There is no schema or
business-data repair. Keep the PO preview default-off and the hosted release
paused. No deployment, remote migration, supplier/model call, purchase, real cart
gate or historical browser cleanup occurred. Supplier submission and automatic
purchasing stay disabled.
