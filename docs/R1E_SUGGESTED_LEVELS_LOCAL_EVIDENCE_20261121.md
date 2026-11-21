# R1e part 1 — Suggested levels — local evidence

Recorded: 2026-11-21. Branch: `workstream-c/r1e-suggested-levels`, based on
`main` at `54e7541`. This is the first part of step R1e of the
[stock levels roadmap](STOCK_LEVELS_AND_ALERTS_ROADMAP.md#r1--reliable-stock-levels)
under [decision 0011](decisions/0011-reliable-stock-levels.md) (points 1, 2,
4, 5, 6 and 7). It is **local evidence only**: nothing was deployed and no
hosted or live service was used. No schema change.

R1e is split in two, so each part stays reviewable:
- **Part 1 (this):** suggestions at the default Balanced caution, with an
  explanation, and **Use this level** to accept one.
- **Part 2 (next):** a café-wide and per-product caution choice (Cautious,
  Balanced, Lean) and **Ignore**. Part 2 needs a migration.

## What it shows

Under each product in **Inventory → Usage & accuracy**, a **Suggested level**
box shows the suggested level, the current level (or "no level set yet", or
"your level already matches") and a plain explanation. For example:

> Keep about 1550 fl oz (about 24¼ cartons) (no level set yet). You use about
> 145 fl oz a day. Northline Dairy delivers 2 days after you order, and you
> order every 7 days, so stock needs to last 9 days. About 237 fl oz (about
> 3¾ cartons) of that is spare, for days busier than usual. Your counts show
> about 22% more is used than recorded; that is included. It ran out 2 times
> in the last 4 weeks, so extra spare is included.

Owners and managers see **Use this level**; employees see the suggestion only.
When there is no suggestion, the box says what is missing:
- the history from R1b;
- any measured use;
- a supplier link under Purchasing suppliers;
- the supplier's delivery schedule from R1d.

## How it is calculated

[Calculation](../src/lib/stock-levels.ts), a pure function:

*level = everyday use × days to cover + caution factor × daily variation ×
√(days to cover)*

- **Everyday use:** use measured from counts (R1b). A suggestion needs
  "Enough history".
- **Days to cover:** the supplier's delivery days plus days between orders
  (R1d). When a product has several suppliers with schedules, the longest is
  used, which errs on the safe side. The explanation says so.
- **Daily variation:** the sample standard deviation of recorded use over the
  whole UTC days of the last 28 days (since the first recorded use, excluding
  today). It is scaled up by the measured-to-recorded gap, so unrecorded use
  also widens the spare.
- **Caution factor:** Balanced 1.65 (about 1 short cycle in 20). A run-out
  report in the last 4 weeks that was not dismissed (R1c) raises it one step,
  to Cautious 2.33, for that product.
- **Rounding:** up to a whole unit (each, gram or millilitre).

[Reader](../src/lib/d1-stock-levels.ts) gathers, read only:
- R1b usage;
- daily recorded use;
- active product-to-supplier links, with the current supplier version's
  schedule (re-checked against the supplier rules; a schedule outside them is
  not used);
- run-out reports from the last 4 weeks;
- each product's current restocking settings.

## Accepting

**Use this level** (owners and managers) saves a new version of the product's
restocking settings through the existing settings store, with the reason
"Accepted Pantrack suggestion":
- **target** is the suggested level;
- **daily use** is the measured use;
- every other setting is kept;
- a product with no settings yet gets: no capacity or shelf-life limit, a
  count every 7 days, and packs of 0 minimum, multiples of 1 and no maximum.

These are the restocking settings the newer Purchasing plan review already
reads.

- **Seen numbers only:** the request carries the level the person saw and the
  settings version. If either has changed, it is refused and the person sees
  the new suggestion.
- **Safe to repeat:** a repeated request returns the saved version.
- **Route:** `GET /api/inventory/levels` (any member; it includes the R1b
  usage) and `POST` `accept` (owners and managers through the `inventory`
  route checks, and again in the service). It returns 404 when exact
  inventory is off.

Unchanged: stock, counts, the older Purchasing plan suggestions, the order
page, and supplier submission (still behind its own gate).

## Verification

The complete local pipeline passed in this worktree on 2026-11-21 with the
changes staged on base `54e7541`:
- `pnpm typecheck`;
- `pnpm test` (188 suites, including the new
  [stock levels test](../tests/stock-levels.mjs) and the R1b usage test);
- `pnpm db:check` (no migration);
- `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`;
- `pnpm a8:check:browser`.

The new and changed files have no ESLint findings and are Prettier-clean.

The stock levels test checks:
- **The calculation:**
  - steady use has no spare (10 a day × 9 days = 90);
  - uneven use gives 1.65 × variation × gap × √9, rounded up;
  - a run-out raises Balanced to Cautious and Lean to Balanced;
  - the longest of several supplier schedules is used;
  - mass rounds up to whole grams;
  - each "no suggestion" status.
- **The reader, on all migrations, with three weeks of history ending
  today:**
  - steady milk (3 a day measured, 2 recorded, Dairy 7 + 2 days) gives 27,
    with 33% unrecorded;
  - uneven beans use the longer of two suppliers' schedules, with the
    expected spare;
  - cups have no counts yet;
  - a supplier version with a schedule outside the rules gives "needs
    schedule", and the next valid version is used;
  - a recent run-out raises milk's caution, and a dismissed one does not.
- **Accepting:**
  - an employee is refused;
  - a level or settings version that changed since it was seen is "stale";
  - a product without a suggestion is refused;
  - the saved version holds target 27, daily use 3 and the defaults, with
    the reason and the manager;
  - a repeat returns the same version without a second row, and a reused
    reference for a different level is refused;
  - existing settings keep capacity, shelf life, count interval and pack
    rules.
- **Route:**
  - anonymous 401 and wrong company 403;
  - employee read 200 with `private, no-store`, but employee accept 403;
  - bad input 400 and a stale level 409;
  - manager accept 200;
  - preview off 404.

A local Playwright check passed against fictional data seeded into a preview
copy. Oat milk and espresso beans have four weeks of history and are linked to
suppliers with schedules (7 + 2 days, and 7 days with same-day delivery):
- at 1440 px, the explanations read as above, and **Use this level** saved
  the beans level, after which the box said "your level already matches";
- at 390 px, there is no sideways scrolling;
- there were no page errors.

It was re-run after a final headline colour fix. Screenshots were reviewed.

## Handoff

- **Workstream A:** accepted suggestions write `replenishment_settings_versions`
  through `D1ReplenishmentSettingsStore.save`. Until now only scripts wrote
  them, and this is the first in-app writer. The exact Purchasing plan still
  also shows the older recommendation, which uses the older settings.
  Retiring that is workstream A's call.
- `RECORDED_USE` in [the usage reader](../src/lib/d1-stock-usage.ts) is now
  exported and shared.

## Not covered

- Hosted data and real café history.
- Days are UTC days, not the café's time zone. Variation is not sensitive to
  this.
- Caution choice and Ignore (part 2).
