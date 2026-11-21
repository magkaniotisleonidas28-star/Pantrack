# R1b — Usage and accuracy (read only) — local evidence

Recorded: 2026-11-20. Branch: `workstream-c/r1b-usage-accuracy`, based on
`main` at `978ac4e`. This is step R1b of the
[stock levels roadmap](STOCK_LEVELS_AND_ALERTS_ROADMAP.md#r1--reliable-stock-levels)
under [decision 0011](decisions/0011-reliable-stock-levels.md). It is **local
evidence only**: nothing was deployed, and no hosted or live service was used.
No schema change.

## What it shows

A new **Inventory → Usage & accuracy** section, offered only with exact
inventory. For each product with stock set up, it shows four things:

- **Everyday use:** real use per day, measured from counts over the last 8
  weeks, shown in everyday units and containers ("130 fl oz (about 2 cartons)
  a day"). When counts are too few, recorded use from the last 28 days is shown
  instead and labelled "not yet checked by counts".
- **Not recorded:** how much more (or less) was really used than Pantrack
  recorded over the same periods, for example "About 9% more used than
  recorded", with both daily amounts.
- **Last count:** how far the latest count was from Pantrack's estimate
  ("Found 74 fl oz less than expected (−11%)"), plus up to five recent counts.
- **History:** "Enough history", or what is still missing: counts covering at
  least 7 days, and at least 14 days of recorded use (decision 0011, point 5).

A count that finds more than the deliveries explain is left out and flagged
("Check for a delivery that wasn't recorded"), never treated as negative use.

## How it is calculated

- [Calculation](../src/lib/stock-usage.ts), a pure function with no database
  access:
  - between two counts, real use = earlier count + deliveries − later count;
  - recorded use = sales use + waste + manual use, net of sales corrections;
  - only count periods that end in the last 56 days, in the product's current
    unit, are used;
  - whole minor units throughout, rounded half away from zero.
- [Reader](../src/lib/d1-stock-usage.ts), which runs four read-only queries
  per company:
  - stock balances;
  - counts from the last 176 days, with deliveries and recorded use summed
    between each count and the one before;
  - the first recorded use;
  - recorded use in the last 28 days.

  Movements are placed by when they happened. A movement at the same instant
  as a count goes to the side its stock version shows. So a late-arriving
  sale counts in the period when it happened.
- [Route](../src/app/api/inventory/usage/route.ts): `GET
  /api/inventory/usage?companyId=…`, using the existing company route checks
  for the `inventory` family. It needs read permission (owners, managers and
  employees), returns 404 when exact inventory is off, and 503 when a read
  fails. Responses are `private, no-store`.
- [Screen](../src/components/workspace/stock-usage-panel.tsx), with
  [styles](../src/components/workspace/stock-usage-panel.css). It reloads when
  stock versions or counts change. The menu entry is in
  [workspace navigation](../src/components/workspace/workspace-navigation.ts),
  and the older stock mode does not list it.

Unchanged: stock, counts, restocking suggestions, the order page, and every
write path. Nothing is saved by this step.

## Verification

The complete local pipeline passed in this worktree on 2026-11-20 with the
changes staged on base `978ac4e`:
- `pnpm typecheck`;
- `pnpm test` (185 suites, including the new
  [stock usage test](../tests/stock-usage.mjs));
- `pnpm db:check` (53 migrations, none added);
- `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`;
- `pnpm a8:check:browser`.

The new files and the changed navigation and stock screen files have no
ESLint findings, and are Prettier-clean.

The stock usage test covers:
- **Calculation:** real and recorded use, the unrecorded percentage, rounding,
  thin data (one count, counts 5 days apart, 10 days of history, nothing at
  all), a count higher than deliveries explain, and periods outside the
  window, in the future or across a unit change.
- **Reader, on all migrations in an in-memory database:**
  - a 20-day milk history with deliveries, daily use, waste, sales, a sales
    correction and two counts;
  - a late sale from before a count, and a sale at a count's exact time but
    recorded after it, each counted in the right period. Seen from day 71,
    only the later period is in the window, which isolates that check;
  - reading changes nothing;
  - company b's data never appears;
  - a total beyond the exact range is refused.
- **Route:**
  - anonymous 401;
  - wrong company 403;
  - a role without read permission 403;
  - employee, manager and owner 200, with `private, no-store`;
  - preview off 404;
  - a failed read 503.

Two deliberate breaks were confirmed to fail the test, then restored:
- removing the same-time rule;
- switching off the exact-total guard.

A local Playwright check (fictional data seeded into a local preview copy:
four weeks of oat milk, espresso beans and croissants with weekly deliveries
and counts) passed at 1440 px and 390 px wide: three products shown, no page
errors and no sideways scrolling. Screenshots were reviewed.

## Handoff

- Workstream A: this reads `inventory_reconciliations` and
  `inventory_events_exact` with these action meanings:
  - deliveries: `receive`, `order_receipt`;
  - recorded use: `use`, `waste`, `sale_consumption`, `sale_correction`.

  A new action that changes on-hand stock must be added to one of these lists
  in [the reader](../src/lib/d1-stock-usage.ts).
- R1e will turn "Everyday use" and the count accuracy into suggested levels.

## Not covered

- Hosted data and real café history.
- Totals are added up exactly in SQLite. A total beyond JavaScript's exact
  range (about 9 tonnes, or 9 million litres, of one product between two
  counts) is refused with a 503 rather than shown rounded.
