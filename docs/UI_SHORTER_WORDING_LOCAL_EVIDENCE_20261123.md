# Shorter wording — local evidence

Recorded: 2026-11-23. Branch: `workstream-c/ui-shorter-wording`, based on
`main` at `96a3736` (after steps
[1](UI_MERCURY_LOOK_LOCAL_EVIDENCE_20261123.md) and
[2](UI_HOME_STOCK_LIST_LOCAL_EVIDENCE_20261123.md)). This is step 3 of the four
official changes from the owner-approved design preview. It is **local
evidence only**.

The owner asked for less text three times during the preview:
- "the website as a whole is still a bit too verbose when it comes to all the
  big blocks of text in alot of tabs";
- "the screens for setting up recipes and setting up stock are still too
  verbose";
- "all the text under the titles … are unneeded".

They approved the result and asked to make it official.

## What changed

94 wording changes in 22 workspace screens. No behaviour, data or permission
changes.
- **Lines under page titles removed:**
  - Inventory;
  - Recipes;
  - Usage & accuracy;
  - Sales;
  - Waste;
  - Product catalog;
  - Order history;
  - Payment methods;
  - Setup & register;
  - Suppliers & automation;
  - Purchase-order drafts. These keep only a selected draft's status.
- **Practice notice:** "Practice mode. Nothing is sent to suppliers."
- **Setting up stock**
  ([stock entry](../src/components/workspace/stock-entry.tsx)): the intro
  sentence is gone, and section hints are a few words, for example "How you buy
  it." or "Count what's on the shelf." Each update action has one short line.
- **Recipes and option sets:**
  - [item builder](../src/components/workspace/recipe-builder.tsx): the intro
    and save note are removed, and hints are one line;
  - [option sets](../src/components/workspace/recipe-option-sets.tsx): "Like
    milk. Pick one." / "Like syrups. Pick any.", and the Clover-linking
    paragraph is removed;
  - shorter modifier and list text.
- **Usage & accuracy:** each suggestion shows "Keep about …". The full
  explanation is behind a closed **Why this level?** link.
- **Purchasing plan:** the planning arithmetic is behind **How it's worked
  out**. "Compatibility position" now reads "on hand + incoming".
- **Setup & register, Clover status, Payment methods, Suppliers & automation,
  Waste and order-draft filters:** each says the same thing in one short line.
  Technical scheduler and connector notes are behind **Technical details**.
- A small style for these **Details** links (green, with an arrow) is added to
  [the look](../src/components/workspace/workspace-look.css).

## Tests

[`tests/pos-register-status.mjs`](../tests/pos-register-status.mjs) checked
the old register-status sentences. It now checks the new ones:
- "Toast: setup required";
- "Not available yet. Use CSV imports for now.";
- "Couldn't check the connection";
- the bridge states "not set up", "set up, nothing received yet" and "set up
  and receiving".

No other test or script used the replaced text. Each replaced sentence was
searched for in `tests/` and `scripts/`.

## Verification

The complete local pipeline passed in this worktree on 2026-11-23, with the
changes staged on base `96a3736`:
- `pnpm typecheck`;
- `pnpm test` (189 suites);
- `pnpm db:check`;
- `pnpm build`;
- `pnpm db:migrate:local`;
- `pnpm test:local`;
- `pnpm a8:check:browser`.

The shortened export note no longer showed the line limit, which left one
import unused (`HISTORY_EXPORT_MAX_LINES`, one new lint warning). The import
was removed. `pnpm typecheck`, `pnpm test` (189 suites) and `pnpm build` then
passed again on the final source.

ESLint then showed the same findings in the changed files as on `main`
(7 pre-existing errors, 2 warnings), with none new. Prettier was re-run on
every changed file that was already formatted on `main`. `git diff --check`
passed.

## Not covered

- Step 4 (one Suppliers page), which follows separately.
- The employee workspace and sign-in screens, which were not part of the
  owner's review.
