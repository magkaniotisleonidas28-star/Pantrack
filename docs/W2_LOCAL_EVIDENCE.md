# W2 — Café-item waste, local implementation and evidence

Date: 2026-09-30. Workstream A, W2 in the
[waste and margin roadmap](WASTE_AND_MARGIN_ROADMAP.md).
Branch: `workstream-a/w2-menu-waste`, based on W1 commit `93256f9`.
Status: implemented and verified locally; worker usability, owner acceptance,
hosted migration, deployment, and pilot acceptance remain separate.

## Task contract

Provide one dedicated Waste page and shared quick drawer. Staff select café
items, a whole count, and a reason. Purchased ready-made food subtracts individual
items; prepared drinks/food use immutable recipes and modifiers. An already
counted sold item is classified without further consumption. An extra
replacement consumes ingredients once. Missing or ambiguous sale evidence is
held with zero stock effect until a manager links a confirmed sale.

Keep existing company data and W1 ingredient saves compatible. No provider,
supplier, real café data, remote database, payment, deployment, or push is in
this task. Toast remains on hold and supplier submission remains disabled.

## Behavior and files

- `menu-waste-recorder.tsx` is one mounted controller for page and drawer:
  search, favorites, recent items, 1/2/5 counts, five reasons, optional note,
  modifiers, sold/replacement distinction, and explicit held receipts.
  Opening the page from the drawer preserves the draft. Uncertain requests
  retain their original identity in tab storage, including after sign-in or
  a later validation rejection. No offline queue/background submission exists.
- `workspace.tsx` adds Waste → Record waste / Item setup / Needs review.
  `employee-workspace.tsx` exposes recording without setup/review, purchasing,
  prices, or other workers' history. The old ingredient recorder stays available
  through a secondary action and retains its separate pending-save format.
- Product setup explicitly marks an offering as bought ready-made. Search
  displays an unconfigured catalog item with a setup explanation. Managers can
  navigate to that item's exact inventory form, with `each` selected, set the
  quantity per box and enter an actual opening count. Catalog creation alone
  does not invent stock or assume a purchase pack contains one item.
- `d1-menu-waste.ts` implements company-scoped options/setup/entries, confirmed
  sale choices, bounded sold-unit allocation, held entries and manager linking.
  Records retain item name, reason, quantity, request, actor, selected versions,
  and ingredient effects. They cannot be edited/deleted through this feature.
- `d1-inventory-consumption.ts` adds a trusted internal waste adapter, preserving
  the public v1 sales contract. Entry and all ingredient effects share one D1
  transaction. Waste uses the authenticated worker and structured reason;
  it creates no fabricated sales event. A losing stock comparison remains
  uncertain until the same request is confirmed, with no hidden automatic retry.
- Five routes under `/api/waste/{items,entries,sales,setup,review}` enforce
  existing role/company checks, write-origin protection, no-cache responses,
  preview gating, and operation-reference security audits. Staff responses
  omit prices, balances, payment/provider payloads, and other workers' details.
- `d1-sales-corrections.ts` blocks corrections for consumption already claimed
  as waste. Both correction and allocation repeat their exclusion guard inside
  the transaction so a race cannot restore classified wasted ingredients.

### A-to-B handoff

The published inventory consumption v1 and provider event contracts are
unchanged. Waste has its own `waste:` application namespace. Sold waste links
only an applied, immutable consumption line with known whole quantity; mixed
modifier quantities are held. Each line has one shared capacity across recipe
and purchased-item classification. A sale correction request excludes later
classification, and classified waste excludes later correction requests.

For classified waste, selected versions describe the original consumption line;
the waste receipt quantity is the claimed subset. Future costing must scale to
that subset and must not charge another ingredient deduction.

Do not remove those guards when extending sales correction, refund, or revision
behavior. Refunds alone still restore no ingredients. Additional paid revisions
use their existing delta consumption; W2 changes no provider policy. Native
Clover/Toast proof for this new waste classification is not claimed.

## Migration, compatibility and rollback

New additive `0019_w2_menu_waste.sql` adds four tables: offering settings,
immutable waste entries, sale allocations, and immutable review links. The
snapshot and journal match; no earlier migration was rewritten. Composite
foreign keys isolate companies; unique operation references support replay.
Seven new triggers protect immutable entries/links and allocation identity,
capacity, monotonic claims and bounds. Existing catalog/order data is retained;
no offerings, counts or waste entries are invented by migration.

The migration was applied **locally only**, to ordinary `.wrangler/state`, the
preserved W1 review database, and a new isolated W2 review database. The
migration checker also applied all 20 migrations to fresh SQLite databases.
W1 compatibility explicitly tests migration 0018 rather than assuming the
last journal entry is W1.

Apply 0018 and 0019 before any separately authorized Worker rollout: ordinary
sales movements now include the nullable W1 reason column, and correction
requests query the W2 allocation table. Turning off the preview hides recording
but preserves correction safety for linked history.

Rollback: disable the preview first, retain the additive schema and all history,
and forward-repair a defective write path with a new migration. Do not restore
an older Worker that lacks the classified-waste correction guard after such
records exist. Never delete allocation/entry rows or reverse recipe effects
silently; a reviewed physical count is the current recovery path. Database
backup/restore and any hosted action require a separate authorized task.

## Verification

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 36 suites |
| `pnpm test:focused menu-waste waste-recording m2-security` | Passed |
| `pnpm db:check` | Passed, 20 ordered migrations and fresh database |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, 0019 |
| `VINEXT_NO_DEV_LOCK=1 pnpm test:local` | Passed real local HTTP smoke |
| `node scripts/w2-review-fixture.mjs verify` | Passed allocation bounds, foreign keys, no purchasing order |
| `git diff --check` and changed-document relative links | Passed |

Focused tests cover setup/replay/CAS, exact bought-item counts, latte ingredients,
extra shots, insufficient stock with no partial effects, stale versions,
calendar validation, count cutoffs, complete request/actor identity, concurrent
saves, forced stock comparison failure and retry, lost acknowledgments,
transaction rollback, sold allocation/overclaim, delayed-sale linking,
correction/classification races, historical receipts after recipe archival,
company isolation, immutable rows, privacy and malformed responses.
Security tests cover all new route methods: anonymous, wrong-company,
forbidden employee setup/review, cross-site writes, gate-off behavior, expiry,
session-derived actor, narrow responses, no-store and audited successful retries.
Existing B4/Clover regression suites passed with mocked providers.

### Safari walkthrough — isolated fictional data

Served at `http://127.0.0.1:5176/`, company **W2 fictional café — menu waste**.
The fixture seeds 20 croissants, milk/beans/cups, one active latte/shot recipe,
one unconfigured bagel and one local manual sale. No Clover token or remote
provider was used. The existing user's croissant and W1 balances were preserved.

| Observed case | Result |
| --- | --- |
| Two croissants, End of day / unsold | Croissants 20 → 18; one entry |
| One latte, Spilled, one Extra shot | Milk 4800 → 4600 mL; beans 982 → 946 g; cups 99 → 98 |
| Link that already counted local sale | Classified receipt; same balances, one capacity claimed |
| Search new bagel before setup | Visible setup explanation; waste disabled |
| Mark bought ready-made → stock setup | Correct bagel selected, `each`, explicit 12 per box / opening 24 entered |
| Two bagels, Spoiled | 24 → 22 individual items |
| Missing sold latte | Held receipt, zero stock use |
| Arriving local manual sale → manager link | Review resolved; linking added no stock effect |
| Drawer draft → Open Waste page | Item, count 2 and reason preserved |
| Purchasing draft after waste navigation | Croissant purchase quantity stayed 1; no order saved |
| Employee view | Record controls visible; item setup/review and purchasing absent |
| Light/dark; 390×844 phone and 820×844 tablet | Layout, labels, form buttons and sticky save action inspected |
| Safari Option-Tab, Space | Focus reached count shortcuts and selected 2 from keyboard |

The original held entry remains immutable with status `held`; a separate review
link supplies its effective classified receipt and removes it from Needs review.
Final fictional stock: 18 croissants, 22 bagels, 4400 mL milk, 928 g beans,
97 cups. Two confirmed sale units are allocated once each. No supplier order
was created. The fictional role was restored to owner after employee review.

## Reproduce and limits

For a new isolated fixture:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .sites-runtime/w2-review-state
node scripts/w2-review-fixture.mjs seed
PANTRACK_W2_REVIEW=enabled node node_modules/vite/bin/vite.js --port 5176
```

Use `/signin-with-chatgpt?return_to=/` for the fictional local sign-in.
`seed` refuses to overwrite an existing review database; use `verify` to inspect
it. `sale` adds only a fictional manual sale for delayed-arrival review. The
serve-only review flag is ignored during builds and does not enable deployment.

Sold choices/review lists are bounded to 50 recent records; absent, mixed,
unsupported or corrected consumption must be reviewed, not guessed. Pantrack
cannot infer that two independently entered unsold/replacement/sale records
represent the same physical preparation: staff must choose the correct mode.
Bought-item sales require a confirmed recipe line consuming one counted item;
no supplier/POS mapping is invented.

Worker timing, physical-device accessibility, full keyboard/screen-reader use,
browser-level lost-response/session-recovery walkthroughs and owner acceptance
remain open. Automated retry proof and the bounded keyboard check above do not
substitute for those reviews. W3 history/corrections/cost summaries and P1 costing
remain future outcomes. Next unblocked step: a brief worker usability review of
this local flow, then the separately planned P1 cost foundation.

## W2 usability refinement — 2026-10-01

Workstream A, W2 outcome: center the Waste containers and simplify modifier
setup during local review. Record waste, Item setup and Needs review share a
centered 860px maximum-width container; text remains left-aligned and the quick
drawer retains its layout. The three repeated exact-inventory summary cards
are removed, while product-level classification/count warnings remain.

The standalone Modifiers navigation entry is removed. Recipe details now show
their active/draft rules and collapsed history. Owner/manager controls generate
IDs, edit drafts or prepare replacement versions, and support multiple Add or
Remove ingredient changes. Copy from another recipe pre-fills an active rule
into an independent draft; it does not copy POS mappings or activate it. The
original identity and historical sales/waste are retained. Unsaved modifier
edits participate in the company-switch/reload warning. An uncertain response
freezes the request for an identical retry in the mounted editor; keep that
recipe open until confirmed. Modifier retries are not an offline queue and are
not restored after closing the editor/tab.

There is no schema migration, new route, or changed request/response shape.
The existing inventory draft API now accepts compatible standard ingredient
units even when that standard unit has not previously been selected for stock.
The unit definition and draft are saved in one D1 batch. Stock classification,
balances and historical conversions remain unchanged. Copies use the stored
canonical quantity, so an old 7g scoop cannot silently become a current 18g
scoop. Unconfigured/incompatible ingredients, invalid unit definitions, and
custom units that reuse standard unit IDs are rejected for new drafts. A → B
consumption types and Clover mappings are unchanged; newly copied rules need
their own reviewed provider mapping before that provider can use them.

Verification run successfully in this branch:

- `pnpm test:focused inventory-management-contract m2-security menu-waste`
  passed all three suites.
- `pnpm typecheck`, `pnpm test` (36 suites), `pnpm db:check` (20 migrations and
  fresh database), `pnpm build`, `pnpm db:migrate:local` (none pending), and
  `VINEXT_NO_DEV_LOCK=1 pnpm test:local` passed.
- Automated cases prove signed multi-ingredient copying, source/copy
  independence, stable draft identity after lost acknowledgments, preservation
  of historical custom-unit quantities, unit/draft transaction rollback,
  unchanged stock during setup, and anonymous/wrong-company/employee/CSRF
  rejection. Existing sale and Waste consumption contracts passed.
- Safari at `http://127.0.0.1:5176/` verified copying the original 18g extra-shot
  rule as 20g, editing its replacement draft from 21g to 22g, activation, a
  two-row dairy-to-oat substitution, archival, and retained history. The
  original 18g rule was unchanged.
- Safari desktop/light/dark, phone 390×844 and tablet 820×844 checks showed
  centered Waste content, removed sidebar/statistics clutter, stacked phone
  modifier controls, and content movement with the expanded/collapsed sidebar.
  Responsive mode was exited, light mode restored, and no editor draft left
  open. Full accessibility and real-worker timing remain unverified.

The optional `node scripts/w2-review-fixture.mjs modifiers` extends only the
isolated W2 café with a fictional oat-milk count and a second recipe for copy
review; it refuses to alter existing stock rows. The walkthrough changed no
existing stock: bagel 22, beans 892g, croissant 18, cups 95, milk 4000mL; the new
oat-milk fixture remained 3000mL. No new sale, Waste entry or purchasing order
was created during this refinement. The user's separate W1 catalog at port
5175 was preserved.

Rollback is a code revert with no schema removal. Retain any saved draft/unit
metadata and version history; do not delete active rules or provider mappings.
No remote migration, deployment, supplier contact or provider request occurred.
Next unblocked checklist outcome remains W1/W2 worker usability and owner
review; POS-assisted modifier import and P1 costing are separate tasks.

## W2 Inventory navigation — 2026-10-01

Workstream A, W2 outcome: simplify the local Inventory menu to the four-section
layout selected by the owner. Legacy and exact modes share Stock, Recipes &
sales, Purchasing plan, and Activity. Stock contains a collapsed Older data to
review disclosure; Purchasing plan contains a collapsed Clover review.
Both disclosures retain their owner/manager restriction and existing server
authorization. Activity shows the existing physical-count history, clearly
labeled; broader waste reporting is still a W3 outcome.

Exact Recipes & sales has two labeled buttons within the page. Recipe content
stays mounted when hidden. Sales content loads on its first visit and then
stays mounted within Inventory. This preserves unfinished modifier forms and
the pending-request state used by existing retry handling. It does not add
recovery after closing Inventory, reloads, or offline work. The Inventory
heading and purchasing description use plain language, and Waste setup now
points to Inventory → Recipes & sales → Recipes.

Only workspace components, navigation types, CSS and documentation changed.
No public API, database migration, authorization policy, feature gate,
calculation, supplier submission or provider behavior changed. The narrowed
InventorySection type is internal UI state; there are no stored section IDs
or URL parameters to migrate. Shared shell changes are ready for the merge
owner; no A → B or A → C contract handoff is required.

Verification in `workstream-a/w2-inventory-menu`:

- `pnpm typecheck`, `pnpm test` (36 suites), `pnpm db:check` (20 migrations and
  fresh SQLite), `pnpm build`, `pnpm db:migrate:local` (none pending), and
  `VINEXT_NO_DEV_LOCK=1 pnpm test:local` passed. Existing tests cover company
  and role isolation, uncertain-save retries, sale/Waste consumption and
  supplier gates. No new API behavior was introduced.
- Safari at `http://127.0.0.1:5176/` showed four Inventory entries, both
  specialist disclosures, existing count history, recipe/modifier controls,
  Sales controls, and the separate Waste page.
- An unsaved modifier quantity of 19g survived Recipes → Sales → Recipes and
  Activity → Recipes. It was canceled without saving; the active rule remains
  18g. An unsaved Sales reference survived the same view switching and was
  cleared. Pending-request behavior is covered by existing automated tests;
  no browser network failure was injected in this walkthrough.
- Desktop/light, phone 390×844/dark, tablet 820×844/light and both sidebar
  widths were inspected. Mobile navigation listed four entries; the selector
  fit without clipping, and tablet content moved with the expanded sidebar.
  Responsive mode was exited and light mode restored. Full accessibility and
  real-worker usability remain open.
- `node scripts/w2-review-fixture.mjs verify` confirmed clean foreign keys,
  zero purchasing orders, the existing six waste entries/two allocation claims,
  and unchanged balances: bagel 22, beans 892g, croissant 18, cups 95, milk
  4000mL, oat milk 3000mL. The separate W1 review database was not changed.
- `git diff --check` passed; changed documentation links were verified.

Rollback is a code revert; there is no data cleanup or schema reversal.
No remote migration, deployment, provider request or supplier contact occurred.
Next unblocked outcome remains W1/W2 worker usability and owner acceptance;
P1 costing is separate. These checks establish local behavior only.
