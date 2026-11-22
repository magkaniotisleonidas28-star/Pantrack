# R1e part 2 — Caution choice and Ignore — local evidence

Recorded: 2026-11-21. Branch: `workstream-c/r1e-caution-ignore`, based on
`main` at `4071c29`. This completes step R1e of the
[stock levels roadmap](STOCK_LEVELS_AND_ALERTS_ROADMAP.md#r1--reliable-stock-levels)
under [decision 0011](decisions/0011-reliable-stock-levels.md) (points 1 and
4). It is **local evidence only**: nothing was deployed and no hosted or live
service was used.

## What changed

- **"How careful should suggestions be?"** appears at the top of **Inventory →
  Usage & accuracy**. Owners and managers choose one of three settings for
  the whole café; employees see which one is in use.

  | Setting | Runs short about | Description |
  | --- | --- | --- |
  | **Lean** | 1 delivery in 7 | Less stock and waste |
  | **Balanced** | 1 delivery in 20 | The default |
  | **Cautious** | 1 delivery in 100 | More on the shelf |

- **Caution for this product:** each product's suggestion box has a choice of
  "Café setting (…)", Lean, Balanced or Cautious. A product's own setting
  overrides the café's. A recent run-out still raises the product's setting
  one step (Lean → Balanced, Balanced → Cautious).
- **Ignore:** next to **Use this level**. The suggestion is replaced by "You
  chose to ignore this suggestion. It shows again when the numbers change",
  with **Show it again**. An ignore is tied to the exact level that was seen.
  When the suggestion changes (new counts, a new schedule, a different
  caution), it shows again. If the numbers return to the ignored level, it
  stays ignored.
- **Every explanation** now ends with how the spare is sized, for example
  "Spare is sized to run short about 1 delivery in 20 (Balanced)".
- Changing caution or ignoring never changes stock or a saved level. Only
  **Use this level** saves a level, as in part 1.

## Server and data

- Migration [`0054_stock_level_cautions`](../drizzle/0054_stock_level_cautions.sql)
  adds two tables:
  - **`stock_level_cautions`**: company, product (`*` for the café), caution
    (only `lean`, `balanced` or `cautious`), who and when; one row per company
    and product.
  - **`stock_level_ignores`**: company, product, the ignored level (whole
    minor units only), who and when; one row per company and product.

  The tables are additive, with no triggers. Choosing "Café setting" for a
  product removes its own row. Changes are audited through the existing
  company route logging for `inventory`.
- [Reader and actions](../src/lib/d1-stock-levels.ts):
  - suggestions use the product's caution, or else the café's, or else
    Balanced;
  - the view lists product overrides and currently ignored products;
  - `setCaution`, `ignore` (refused when the level seen is no longer the
    suggestion) and `unignore`, for owners and managers only.
- [Route](../src/app/api/inventory/levels/route.ts): `POST` accepts `accept`,
  `set_caution`, `ignore` and `unignore`. Inputs are checked strictly. The
  `inventory` route checks allow owners and managers only, and the service
  checks again.
- [Screen](../src/components/workspace/stock-usage-panel.tsx), with
  [styles](../src/components/workspace/stock-usage-panel.css).

## Verification

The complete local pipeline passed in this worktree on 2026-11-21 with the
changes staged on base `4071c29`:
- `pnpm typecheck`;
- `pnpm test` (188 suites, including the extended
  [stock levels test](../tests/stock-levels.mjs));
- `pnpm db:check` (55 ordered migrations match the schema and apply to a
  fresh database);
- `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`;
- `pnpm a8:check:browser`.

The first complete run had two failures outside this change:
- `tests/po-cart-worker-processes.mjs` (a process-timing test);
- `test:local`'s `/auth/callback` page check (a 500 while the dev server
  was still compiling).

Both passed when re-run on their own: the worker test twice, the smoke check
once. The complete pipeline then passed on the same unchanged staged files.
They are recorded here as intermittent, not as caused by this change.

The new and changed files have no ESLint findings and are Prettier-clean.

The extended test checks:
- **Caution:**
  - Balanced until changed;
  - employees are refused, "café setting" for the café itself is refused,
    and a product without stock is refused;
  - café Cautious gives 2.33 × variation × √9 for beans;
  - a product's Lean (1.04) overrides it, and other products follow the
    café;
  - changing the product's caution again replaces it, and "café setting"
    removes it;
  - the changing user is recorded.
- **Ignore:**
  - a stale level, a product without a suggestion, and an employee are
    refused;
  - ignored beans are hidden;
  - a different caution shows the suggestion again, and returning to the
    ignored numbers hides it again;
  - Show it again (an employee is refused) clears it;
  - saved levels are untouched.
- **Tables:** unknown cautions are refused, as are negative, text, decimal
  and empty levels.
- **Route:**
  - employee `set_caution` and `unignore` 403;
  - an unknown caution 400 and another company 403;
  - manager `set_caution` 200;
  - `ignore` 200, after which the read shows it ignored;
  - a stale `ignore` 409.
- All part 1 checks still pass.

A local Playwright check passed against fictional data in a preview copy:
- at 1440 px, choosing Cautious changed the beans suggestion to "1 delivery
  in 100 (Cautious)" with **Use this level** offered;
- **Ignore** showed "Show it again";
- oat milk set to Lean was stepped up to Balanced by its recent run-outs;
- at 390 px there was no sideways scrolling;
- there were no page errors.

Screenshots were reviewed.

## Migration review

- **SQL:** two `CREATE TABLE` statements with checks and foreign keys to
  companies, and no triggers. They are generated by `drizzle-kit` from
  [the schema](../src/db/schema.ts), with the journal entry and
  `0054_snapshot.json`.
- **Fresh database:** `pnpm db:check`; the test applies all 55 migrations in
  memory.
- **Compatibility:** the tables are new. Without rows, every company is
  Balanced with nothing ignored, which is exactly part 1's behaviour.
- **Rollback:** turning exact inventory off returns 404 here. A forward repair
  would be a new migration, and empty tables have no effect.
- **Merge queue:** no other open pull request adds a migration (checked on
  2026-11-21).
