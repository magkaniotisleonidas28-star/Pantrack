# C4 manager order-draft preview and export — local evidence

Recorded: 2026-10-01. Workstream: C4; branch:
`workstream-c/c4-supplier-engine`. Outcome: fictional draft/export demonstration
implemented locally. C4, M7 and M8 acceptance remain open. Supplier submission
and automatic purchasing remain disabled.

## Delivered behavior

The [pure draft builder](../src/lib/supplier-order-draft.ts) consumes immutable
v1/v2 A → C handoffs plus an expected company ID. It reuses the existing C4
source validator: one company/supplier/account/location, 1–50 unique products
and proposals, positive whole packs, current sales, no source invalidation and
eligible source status. Canceled/unknown sources and unsafe review reasons are
rejected. Missing price estimates remain reviewable and explicitly unavailable.

The builder freezes a copied handoff, preserving proposal IDs/revisions, SKUs,
pack counts, conversions, source evidence, estimates and warnings. Stock quantity
is only `packs × stockUnitsPerPack.minor` using `BigInt`; replenishment needs and
prices are never recalculated. Count displays in each, mass in grams, and volume
in mL, using the inventory contract's exact six-decimal canonical scale. Estimates
are copied from the handoff. USD uses two decimal places; other currencies show
explicit minor units rather than guessing a currency exponent. No final quote,
fees or confirmed delivery is invented.

Plain-text and UTF-8 CSV exports identify company/supplier/account/location,
proposal revision, SKU, whole packs, exact conversion and stock quantity, estimates,
source status and warnings. Both carry **“Fictional review draft — not an order.”**
CSV quotes every cell, doubles embedded quotes, uses CRLF records and prefixes
formula-like cells with an apostrophe, including formulas after whitespace/control
prefixes. This deliberate CSV escaping can add an apostrophe to a spreadsheet
cell; the source handoff stays unchanged. Import identifiers and exact integer
columns as text in spreadsheets that automatically round large numeric cells.

The [isolated preview](../previews/c4-order-draft/index.html) offers normal,
missing-price and invalidated-source fixtures, Review example, Copy draft,
Download CSV, Reset and a plain-text manual-copy disclosure. Changing examples
clears the old export. Invalid sources disable both exports; Reset restores the
normal fictional draft. Clipboard denial exposes/selects text for manual copying.
There is no checkout, send, approval or order-placed control.

The [local server](../scripts/order-draft-preview.mjs) uses existing esbuild and
Node HTTP dependencies. It binds only `127.0.0.1:5180`, validates Host and serves
three explicit in-memory assets. CSP blocks network connections and form
submission. It reads no environment files, opens no DB and imports no supplier
engine or transport. Production application routes, gates and schema are unchanged.

## Run and review

```sh
pnpm dev:order-draft
```

Open <http://127.0.0.1:5180>. Review each example. Copy the normal draft, download
both normal and missing-price CSVs, inspect exact columns, check the invalid-source
alert and disabled exports, then Reset. Stop with Ctrl+C; restart after source
edits because assets are bundled once at startup. No credentials are required.
Clipboard support depends on browser access; use the text disclosure if denied.
Stopping the server ends the demonstration. Removing this isolated preview and
its package command rolls it back without touching durable data or migrations.

## Verification

| Check run in this worktree | Result |
| --- | --- |
| `pnpm test:focused purchasing-safety c4-a7-supplier-handoff supplier-simulation-contract` | Existing hard block and C4 handoff/quote baseline passed. |
| `pnpm test:focused supplier-order-draft` | Passed: full v1/v2 handoff preservation, exact large integers and conversions, deterministic input permutation/replay, immutable copies, company/group isolation, duplicate products/proposals, empty/oversized batches, zero/fractional/noncanonical packs, canceled/unknown/invalidated sources, missing estimates, Unicode, quotes/newlines and formula escaping. |
| `pnpm typecheck` | Passed after correcting preview DOM typing against the combined browser/Worker declarations. |
| `pnpm test` | All 42 suites passed. |
| `pnpm db:check` | All 23 existing migrations match schema and apply to fresh SQLite. |
| `VINEXT_NO_DEV_LOCK=1 pnpm build` | Worker build passed; existing route-classification notice remains. |
| `pnpm db:migrate:local` | Passed; no migrations pending. No new migration. |
| `VINEXT_NO_DEV_LOCK=1 pnpm test:local` | Local home/auth, forged/anonymous rejection, fictional company/catalog, company isolation and sign-out passed. |
| `openspec validate --all --strict --no-interactive` | Existing supplier-simulation change passed; this draft does not change its completed engine tasks. |
| Safari served walkthrough | Normal and missing-price reviews, copy success, two actual CSV downloads, source-change export clearing, invalid-source alert/disabled exports and Reset passed. |
| Download inspection with Python `csv.DictReader` | Both actual files contain three lines, revision 2, three packs, exact bean conversion `2267961850` → `6803885550`, preserved Unicode/quotes, estimated prices and explicit missing-price warnings. |
| Safari responsive design at 390 × 844 | Controls wrap into two columns, references/cards stack, text and identifiers wrap; text disclosure remains readable. Desktop layout inspected too. |
| Keyboard checks | Example selection via arrow/Return and text-selection/Shift+Tab focus to the disclosure exercised. Full keyboard-only control traversal remains unverified: native automation did not retain page focus and a coordinate-focus attempt returned `noWindowsAvailable`. This is a QA limitation, not accessibility acceptance. |

The [new test](../tests/supplier-order-draft.mjs) consumes actual durable v1/v2
producer outputs, snapshots **all** fictional SQLite tables and original handoff
JSON, repeatedly exports and compares them unchanged. A throwing fetch spy proves
zero provider calls. The served preview's asset-only server has no write path;
`/api/orders` returns 404. No orders, approvals, reservations, inventory movements
or proposal history are created by preview/export. The ordinary HTTP smoke test
separately leaves a fictional company in local D1, as documented by that command.

`git diff --check` passed. All 133 relative links in the four changed/new evidence
and roadmap documents resolve. The full diff and new files were reviewed for
scope, credentials, company isolation, exact arithmetic, unsafe external effects
and unsupported acceptance claims. No issues remain in that code review; the
keyboard walkthrough limitation above remains explicit.

## Baldor constraint and manual handoff

[Baldor's published Terms of Use](https://www.baldorfood.com/terms-of-use), checked
2026-10-01, “Prohibited Uses” clauses (c)/(e), prohibit automated retrieval and access through an
interface other than Baldor supplies. This demonstration contains no Baldor data
or portal connector. A real automated channel needs a separately approved access
arrangement; an existing café account or lack of supplier response does not supply
that evidence. The [C3 access packet](C3_BALDOR_PREPARATION.md) remains preparation.

For later authorized manual ordering, the manager must review a **current**
proposal and verify the actual supplier account, location, SKU, pack conversion,
availability, price, fees, minimums, cutoffs, delivery and payment in the supplier's
ordinary interface before separately authorized ordering there. This export is
neither a supplier confirmation nor proof of incoming inventory. Human-reported
confirmations, durable manual-order tracking and receiving remain separate slices.

Next unblocked C4 outcome: integrate this draft into Pantrack's authorized manager
workflow after review. That integration must resolve membership/company on the
server and re-read current durable sources before building an export. An expected
company parameter is validation context, not authentication. This pure snapshot
builder cannot establish current database freshness on its own.

No remote migration, deployment, push, café account access, supplier contact,
real order, payment or live integration occurred. Sandbox, pilot, production and
full accessibility acceptance are not claimed.
