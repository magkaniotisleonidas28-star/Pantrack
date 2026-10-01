# W2 — Recipe, milk choice and stock usability

Date: 2026-10-01. Workstream: A/W2. Scope: local development only.

## Task and outcome

The owner requested a compact recipe list, a separate recipe builder with all
choices configured before saving, simpler stock setup, and a local site using
normal Pantrack sign-in. This implements that one usability outcome on
`workstream-a/w2-recipe-builder`, preserving the earlier W1/W2 work.

Supplier submission stays disabled. This task did not deploy a Worker, migrate
remote D1, contact a POS/supplier, or create a supplier order. Toast/B8 remains
on hold. Worker acceptance and pilot approval are separate.

## How to try it

Run `pnpm dev:usability`, then open <http://127.0.0.1:5177>. Sign in with your
existing Pantrack account. This profile uses ordinary Supabase authentication;
its company, inventory and recipe data live in a separate persistent local D1
database. It does not copy hosted workspace data.

- **Inventory → Stock → Add stock:** choose an existing item or create a new
  ingredient/ready-made item. Enter its counting unit, purchase pack, quantity
  per pack and opening count together. Supplier details are optional.
- For existing stock, choose **Receive a delivery** to add to the estimate or
  **Physical count** to replace it with the measured quantity. Units/pack edits
  keep the balance and require a reviewed pack quantity.
- **Inventory → Recipes & sales → Create recipe:** enter the fixed ingredients,
  then add milk choices and optional extras. Review the complete recipe and save
  once. Recipe list rows are collapsed, searchable, and paginated at ten rows.
- For a latte, keep milk out of the fixed ingredients and add a required milk
  choice. For example, Whole milk and Oat milk each add 200 mL of their own
  stocked ingredient. There is no automatic default milk.
- **Sales:** use separate lines for different milk choices. **Waste:** choose
  the milk used for an unsold drink or additional replacement. Already counted
  sales use their original preparation and cause no second deduction.
- Bought croissants still need **Waste → Item setup → Bought ready-made** and
  an `each` opening count to appear as ready-made menu waste.

Unsaved recipe and stock forms remain mounted when switching workspace views.
They warn before company changes or page closure. An uncertain save freezes its
request and offers a retry of that same operation. These form drafts are held
in memory: keep the tab open until an uncertain save is confirmed. Persistent
cross-browser draft recovery is not claimed.

## Implementation and handoffs

New focused UI modules are `recipe-builder.tsx`, `recipe-list.tsx` and
`stock-entry.tsx`. The existing workspace shell, exact inventory panel, manual
sales form and menu Waste form connect them to company-scoped APIs.

`publishRecipeExact` publishes the recipe, choice metadata and all modifier
versions in one D1 batch. It preserves existing recipe and modifier identities,
archives previous active versions and retains immutable history. An older
migrated recipe has a review button that uses its existing lineage instead of
creating a replacement identity. Unknown old quantities require re-entry.

`createStockExact` creates the catalog item, unit, inventory configuration,
opening count, movement history and compatibility projection atomically.
An item without purchasing information has `priceKnown:false`, empty supplier
and SKU, and a visibly unknown price. The server refuses to prepare a purchase
until these fields are supplied. Existing products retain their prior price
semantics. This is an unknown-price marker, not a cost-analysis feature.

Both new actions require owner/manager access, company membership and the
existing CSRF protections. Durable operation receipts prevent a repeated
request from publishing twice or resetting later stock. Recipe publication
checks the current recipe/modifier versions inside the committing batch, so a
concurrent edit cannot leave partial history.

**A → B handoff:** the existing inventory-consumption v1 request shape is
unchanged. Choice options use ordinary modifier identities. Consumption selects
the recipe and modifier versions at the sale occurrence time. A missing,
conflicting or partial milk choice returns `required_choice_missing`, holds the
sale and deducts zero stock. Manual sales map modifiers within the selected
company/recipe and keep differently configured lines separate. CSV rows without
choices are held. Native POS choice mapping/import remains a separate B task;
no provider behavior is proved here. Old recipes without choice metadata keep
their prior behavior. Legacy imports reject recipes marked `requiresChoices`
when exact inventory is off, preventing incomplete milk deductions.

## Migration and local profile

Additive migration `0020_w2_recipe_choices.sql` adds only:

- Company/recipe/version-scoped `recipe_version_choices`, with immutable rows.
- Company/operation-scoped `inventory_setup_operations`, with immutable save
  receipts and a trigger that aborts failed write guards.

The generated snapshot and journal agree with the SQL. Existing migrations were
not rewritten; there is no stock or recipe backfill. It was applied to local
databases only, including the isolated usability database. Development D1
remains unchanged by this task.

The preview script copies only the existing Supabase URL and publishable key
into an ignored private configuration, generates and preserves its own local
encryption key, disables fixture authentication and remote bindings, and binds
strictly to `127.0.0.1:5177`. No POS, supplier or payment credential is copied.
Its state is under `.sites-runtime/usability-state`; configuration is under
`.sites-runtime/usability-preview`. Neither is committed. Existing servers on
5173, 5175 and 5176 and their data were preserved.

## Evidence

Focused automated suites exercise actual migration SQL in local SQLite with a
D1 adapter; external providers in security tests are mocked.

- `recipe-choices`: atomic publication, base/choice overlap rejection, required
  milk and extra shots, historical versions, separate mixed-milk sales,
  Waste/replacement deductions and sold classification, legacy lineage review,
  company isolation, duplicate/lost-acknowledgment recovery, competing edits,
  stale snapshots, immutable metadata and injected mid-batch rollback.
- `stock-entry`: catalog/unit/pack/opening count atomicity, unknown purchasing
  data, receiving versus physical counts, retry after later movements,
  company isolation, concurrent duplicate saves, lost acknowledgment and
  injected rollback leaving no partial item or count.
- `m2-security`: anonymous, wrong-company and forbidden-role requests for the
  new actions, authorized manager paths, existing CSRF/audit protection,
  unknown-price purchasing rejection and gated loopback authentication origin.

Safari evidence on this normal-login local profile is separate from those
tests. The owner signed in with the existing account and created local stock
and a Biscoff latte recipe. The agent observed the saved 5000 g stock count and
collapsed active recipe with Whole/Oat choices and an optional extra shot.
Those entries were preserved. A separate fictional review company received
four guarded local opening counts; no sales, Waste saves or orders were
created for layout inspection.

Visual checks covered desktop light/dark layouts, dark recipe fields at
390 × 844 and 820 × 844 responsive viewports, light Add stock at 390 × 844,
larger dropdown controls, and the Waste milk selector. Fresh unsaved layout
examples were canceled. Safari was restored to its normal light-mode workspace.
These are browser viewport checks, not physical-device or full keyboard/screen
reader acceptance.

The earlier W2 fixture verification retained its six Waste entries, two sold
allocations/links and exact stock balances. Local authentication-provider
sign-in worked; signup/recovery callback behavior was not retested here.

Final checks in this worktree:

| Command | Result |
| --- | --- |
| `pnpm test:focused recipe-choices stock-entry m2-security` | Three suites passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | All 38 suites passed. |
| `pnpm db:check` | 21 ordered migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | Passed. |
| `pnpm db:migrate:local` | Passed; no migrations pending. |
| `VINEXT_NO_DEV_LOCK=1 pnpm test:local` | Passed the local HTTP fixture smoke. |
| `node scripts/w2-review-fixture.mjs verify` | Earlier W2 records and balances retained. |
| `git diff --check` and changed relative documentation links | Passed. |

The initial full test runs found two empty-company assertions that needed to
include the new, empty legacy-recipe review metadata; both were updated and the
entire suite rerun successfully. An earlier plain `pnpm test:local` attempt
hit vinext's existing development-server lock. The final command bypassed only
that CLI lock so the smoke could start its own temporary loopback server while
preserving the owner's existing preview. Authentication and company checks
remained enabled. Its fixture-auth pass is separate from the observed ordinary
Supabase sign-in on 5177. No CI or hosted acceptance is claimed for these changes.

## Rollback, limits and next step

Keep migration `0020` and its immutable history if disabling this preview.
Stop its server and preserve the ignored state directory. Do not delete receipts
or rewrite a used migration; use a new additive migration for forward repair.
Before reverting to older application code, stop imports/consumption of recipes
with required choices: older code lacks the new choice validation and legacy
import guard. Keeping the current server safeguards while hiding the new UI is
the safer temporary rollback.

Remaining W2 gates are real-worker usability, full accessibility/recovery
walkthroughs and explicit owner acceptance. No roadmap acceptance checkbox is
advanced by automated checks alone. The next unblocked step is the owner's
hands-on local review; P1 cost foundations are a separate subsequent outcome.
