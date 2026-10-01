# W2 purchase packages and recipe measurements

Date: 2026-10-01. Workstream A / W2, one local usability outcome.
Branch: `workstream-a/w2-pack-units`, following the
[recipe/stock builder](W2_RECIPE_STOCK_USABILITY.md).

## What changed

Ingredients have a recipe measurement and a separately configured purchase
package. In **Inventory → Stock → Add stock**, choose an item or create one,
then enter **Recipe measurement**, **Purchased as**, and **Each package contains**.
For an existing item, choose **Change measurements or purchase pack**.

| Ingredient | Purchase package example | Recipe measurement |
| --- | --- | --- |
| Milk | Jug containing 1 US gallon | US fluid ounces |
| Syrup | Bottle containing 750 mL | mL |
| Espresso beans | Bag containing 1 kg | g |
| Biscoff spread | Jar containing the labelled gram weight | g |

Receiving can use whole packages or a measured quantity. Opening and physical
counts can use whole containers plus a measured remainder, or a measured total.
Expected incoming uses the same two entry methods; zero clears incoming.
Delivery marked as already incoming reduces incoming once. Extra ingredient
use remains a measured entry.

The preview explains the result before saving: three one-gallon jugs are
384 US fl oz; two 1,000 g containers plus 100 g are 2,100 g. A physical count
replaces the estimate; receiving adds stock. New recipe ingredient selection
defaults to the configured recipe measurement; compatible units remain available.
Editing existing curated-unit recipe entries preserves their entered units;
custom historical entries retain their canonical quantities rather than being
reinterpreted through a later custom conversion.

The stock list shows the preferred measurement and an **approximate package
equivalent**. That equivalent is a rounded amount, not a count of unopened
containers. This outcome supports one package size per item, not nested cases
or several supplier package sizes. No mass-to-volume density is guessed.
Existing item configurations are retained until a manager explicitly changes them.

## Server contracts and schema

- `packageStockExact` is company-scoped, owner/manager-only, CSRF-protected and
  behind the existing exact-inventory gate. Employees retain read access.
- `stock-pack-quantities.ts` uses integer/rational conversion arithmetic, with
  existing canonical precision and overflow rules. Display rounding never
  feeds inventory calculations. One US gallon equals 128 US fl oz.
- Package entry and configuration receipts preserve the raw input, operation
  identity and package configuration. Receipts and stock changes commit in
  one guarded batch. Retries confirm that original entry, including after
  later package edits, without using today's conversion.
- Balance version and configuration checks reject stale entries. Conflicting
  operation reuse, cross-dimension units, negative remainders and fractional
  package counts are rejected. Canonical events continue using the unchanged
  inventory-consumption contract. Physical counts project back into the
  configured legacy measurement, including milk in fluid ounces.
- Additive migration [0021](../drizzle/0021_w2_purchase_measurements.sql) adds
  nullable original purchase amount/unit fields and guards saved conversion
  history against edits/deletion. The generated schema snapshot and journal
  match the SQL. Old rows remain null in the new fields; the UI uses their
  existing canonical package amount without guessing an original entry.
- Migration `0021` was applied locally to the default, normal-login usability,
  W1 review and W2 review profiles. No remote database or Worker was changed.

Inventory/API shared files are the A ownership handoff; B's sale/waste
consumption contract remains unchanged. Supplier submission and automatic
purchasing remain disabled. Costing and nested supplier packaging are separate
P1/C3 follow-ups.

## Verification completed

All commands ran successfully in this branch:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed all 39 suites |
| `pnpm db:check` | Passed 22 ordered migrations, schema match and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed; no pending local migration on final run |
| `VINEXT_NO_DEV_LOCK=1 pnpm test:local` | Passed local HTTP/auth/company-isolation smoke |

The dev-lock override accommodates the existing local preview servers.
The focused package suite proves milk/syrup/bean recipe consumption, opening
counts, physical counts and legacy projections, incoming/delivery handling,
old-package retries, stale configuration rejection, simultaneous saves, lost
acknowledgment recovery, transaction rollback and company isolation. Route tests
cover anonymous, wrong-company, forbidden-role and foreign-origin rejection.

Two old POS fixtures now name their configuration columns explicitly so an
additive column cannot break positional inserts. The historical W1 migration
fixture seeds its old schema directly rather than running today's service
against an intentionally old database.

Safari's owner-signed-in local workspace at `http://127.0.0.1:5177` was checked
on desktop, 390 × 844 phone and 820 × 844 tablet, in light and dark themes.
The unsaved milk form showed 128 fl oz per gallon jug and 384 fl oz for three
jugs. Existing Biscoff stock showed 5,000 g / approximately five boxes;
unsaved receiving and count previews showed 2,000 g and 2,100 g respectively.
The examples were canceled, no layout product was persisted, and the original
light theme and ordinary desktop view were restored. The stock table uses its
existing horizontal scrolling on narrower screens. This is visual evidence,
not a complete accessibility or real-worker usability acceptance.

The prior W2 review database still has 22 bagels, 18 croissants, 95 cups,
892 g beans, 4,000 mL milk, 3,000 mL oat milk, six waste entries and two sale
allocations. No browser stock save, sale, waste or supplier order occurred in
this outcome. These are local checks, with no provider/pilot/production proof.

## Rollback and next step

Keep migration `0021` and its ledger intact if reverting the UI/API code; old
code ignores the nullable columns and new entries already have canonical
stock events plus compatible legacy projections. Do not erase receipts or
rewrite saved package sizes. Correct a package size with a new configuration;
correct stock through an audited physical count. Any schema forward repair
must use a later migration through the merge queue.

Next: owner/worker usability review of package setup, receiving, physical
counts and recipe quantities on the normal-login local site. W2 acceptance
and full accessibility review remain open. P1's dated cost foundation can be
planned separately; deployment and hosted migrations require their own scope.
