# Recipe option-set screens — local evidence

Recorded: 2026-11-15. Branch: `workstream-c/recipe-option-screens`, based on
`main` at `93a1e21`. Step 2b of
[decision 0009](decisions/0009-recipe-option-sets.md): the screens for the
[stored option sets](RECIPE_OPTION_SETS_LOCAL_EVIDENCE_20261114.md). **Local
evidence only.** No schema, API or sales-engine change.

## Changed behavior

All in Inventory → Recipes with the exact inventory preview enabled:

- **Item wording and views:** the view switch is now Items, Option sets and
  Add item. The item list, builder and messages say "item" rather than
  "recipe"; the side-menu section is still called Recipes.
- **Option sets view**
  ([`recipe-option-sets.tsx`](../src/components/workspace/recipe-option-sets.tsx)):
  - lists each set with how customers choose, its choices and amounts, the
    items using it, and how many of them still need updating;
  - an owner or manager can add or edit a set: name, "Pick exactly one" or
    "Optional, any number", and up to 40 choices, each adding one or more
    ingredients or changing nothing. Saved choice names stay fixed, and
    removing a saved choice warns that sales still including it will be held;
  - saving uses a retry-safe operation ID ("Retry same save" after an
    uncertain result), then reports how many attached items were updated, or
    names any item that could not be;
  - "Update N items now" republishes items still on an older revision.
  - It says plainly that linking choices to Clover options is coming soon and
    that, until then, Clover sales including them are held for review.
- **Per item** (in each active item's details): the attached option sets, any
  amounts changed for that item, a "Needs update" tag with an "Update now"
  button when an item has not picked up a set change, and "Change option sets"
  to tick up to 10 sets and optionally change the amount of any one-ingredient
  choice for that item only. Empty boxes keep the set's amount.
- **Item builder**
  ([`recipe-builder.tsx`](../src/components/workspace/recipe-builder.tsx)):
  sections are now "Always uses", "Pick-one choices for this item" and
  "Modifiers for this item only". An item-only modifier may now have no
  ingredient changes (for example "Extra hot"), shown as "No stock change".
  "Add pick-one choice" starts with blank names and is limited by the 64-option
  total, including option-set choices (it previously stopped at 15 options).
  Copying a modifier no longer offers option-set choices.
- **Shared ingredient row** extracted to
  [`recipe-amount-fields.tsx`](../src/components/workspace/recipe-amount-fields.tsx)
  and used by both the builder and the option-set editor.
- The inventory panel now passes the `optionSets` already returned by
  `GET /api/inventory` to these screens.

## Verification

The complete local pipeline passed in this worktree on 2026-11-15 with the
changes staged: `pnpm typecheck`, `pnpm test` (177 suites), `pnpm db:check`
(47 migrations), `pnpm build`, `pnpm db:migrate:local` (nothing to apply) and
`pnpm test:local`. ESLint is clean for the new and changed components except
two findings in `inventory-panel.tsx` that are already on `main`; Prettier is
clean for the new files and the builder.

**Local browser check** (headless Chromium against `pnpm dev`, fixture
sign-in, exact preview enabled), no page errors:

1. Created an "Optional, any number" set with Vanilla (15 mL) and a no-change
   "Extra hot"; the stored set matched.
2. Attached it to an item: the item gained the generated Vanilla (15) and
   Extra hot (no change) options.
3. Changed Vanilla to 20 for that item only: the generated option became 20
   and the attachment recorded the override.
4. Added Caramel (10 mL) to the set: "Option set saved. 1 item updated.",
   and the item had Vanilla 20, Caramel 10 and Extra hot.
5. Edited the item in the builder: the item wording showed, the option-set
   choices were kept, and a new no-change item-only modifier was saved with
   no ingredient changes while the set's options stayed active.
6. At 390 px wide, the Option sets view and the attach form had no sideways
   scrolling.

## Not covered

- "More of the picked milk" for light or no ice (step 3) and linking choices
  to Clover options (step 4).
- Removing an option set; added afterwards
  ([record](RECIPE_OPTION_SET_REMOVAL_LOCAL_EVIDENCE_20261115.md)).
- Hosted D1 or a real Clover account; this was local only.

## Rollback

Revert the commit. Stored sets and attachments stay valid and remain usable
through the API.
