# Recipe option limits and no-change options — local evidence

Recorded: 2026-11-14. Branch: `workstream-c/recipe-many-options`, based on
`main` at `6068b55`. Step 1 of [decision 0009](decisions/0009-recipe-option-sets.md).
**Local evidence only.**

## Changed behavior

- **More options per item:** a recipe may publish up to 64 modifiers (was 16)
  and a choice group up to 40 options (was 20), with up to 200 ingredient
  changes in one recipe (was 100). The limit lives in one shared constant,
  `MAX_RECIPE_MODIFIERS`, used by the
  [publisher](../src/lib/d1-recipe-publisher.ts), the
  [inventory API](../src/app/api/inventory/route.ts) and the
  [recipe builder](../src/components/workspace/recipe-builder.tsx).
- **Constant-size concurrency check:** a republish previously bound four values
  per active modifier, which would exceed D1's 100 bound parameters per
  statement beyond about 20 modifiers. It now checks the active modifier count
  and that every active (modifier, version) pair appears in one JSON array
  bound as a single value (`json_each`/`json_extract`), so the bound values no
  longer grow with the number of modifiers. Stale, missing or extra expected
  modifiers still refuse the write with `concurrent_update`.
- **No-change options:** a modifier may have no ingredient changes, both in the
  API and the publisher. Consumption already handles such a modifier: its
  version is found and nothing is deducted, so the sale is not held.

No schema change. The builder UI does not yet offer no-change options; that
comes with stored option sets.

## Verification

The complete local pipeline passed in this worktree on 2026-11-14 with the
changes staged on base `6068b55`: `pnpm typecheck`, `pnpm test` (176 suites,
including the new one), `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`
and `pnpm test:local`. The existing `recipe-choices`, `stock-pack-units` and
`m2-security` suites also passed on their own. ESLint and Prettier are clean for
the changed library and test files; the changed route and builder stay
Prettier-clean.

[`tests/recipe-many-options.mjs`](../tests/recipe-many-options.mjs) uses a local
D1 stand-in that rejects more than 100 bound values per statement. It publishes
40 options (8 required milks, 31 syrups, one no-change option), republishes with
all 40 expected versions, refuses one stale version, one missing, one swapped
for an unknown, all plus one unknown, and an empty expectation, rejects 65
options, applies a sale with a milk, two syrups and the no-change option, holds
a sale without a milk, and refuses another company. Five deliberate mutations
(no set comparison, no count comparison, ignoring the version, no maximum, no
empty-option bypass) each made it fail. The JSON functions were also confirmed
in the local Wrangler D1 engine.

## Rollback

Revert the commit. No data or schema changes need reversal; recipes published
with more than 16 modifiers would then be refused on their next edit.
