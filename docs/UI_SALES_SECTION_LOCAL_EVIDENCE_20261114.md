# Sales as its own section — local evidence

Recorded: 2026-11-14. Branch: `workstream-c/ui-sales-section`, stacked on the
[Setup & register and guided product setup change](UI_SETUP_GUIDED_STOCK_LOCAL_EVIDENCE_20261114.md).
This is the third of four owner-approved UI changes. The owner asked on
2026-11-14 for sales to stop living inside recipes: "Maybe Sales should be its
own tab and implement other future features within it". It is **local
evidence only**.

## Changed behavior

- **Side menu:** a new top-level "Sales" section (owner and manager workspace)
  with "Record sales", "Sales history" and "Insights" (marked "Soon").
- **Inventory:** "Recipes & sales" becomes "Recipes". Both stock screens drop
  their sales area and point to the Sales page instead.
- **Record sales** ([Sales panel](../src/components/workspace/sales-panel.tsx)):
  - with the exact inventory preview, the existing
    [sales & exceptions flow](../src/components/workspace/sales-exceptions.tsx)
    moves here unchanged, with the same active recipe and modifier versions;
  - otherwise, the original batch import (named batch, quantities per recipe,
    optional `recipe_id,quantity` file) moves here with plainer wording. It
    calls the same `/api/sales` import with the same fields.
- **Sales history:** exact mode lists recorded sale events from the existing
  `/api/sales/events` read (plain status labels, source, time); otherwise the
  saved batch names and times.
- **Insights:** four "Coming soon" descriptions (best sellers, busy times,
  ordering from sales, automatic register sync). No data is computed.
- **Wording:** Setup & register now points to "Inventory → Recipes" and warns
  not to record the same sales again on the Sales page.

No API, schema, authorization or stored data change; the moved components call
the same endpoints as before.

## Verification

The complete local pipeline passed in this worktree on 2026-11-14 with the
changes staged on base `f7d2e1d`: `pnpm typecheck`, `pnpm test` (175 suites),
`pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` and
`pnpm a8:check:browser`. ESLint reports no findings in the new files and no new
findings in changed files compared with `main`; the new and formatted files are
Prettier-clean.

Local browser checks at 1440×900 in both modes:

- **Exact inventory preview** (local flag enabled): Sales menu shows the three
  sub-sections; Record sales renders the existing sales & exceptions flow;
  Sales history lists existing fictional events ("Stock updated", source and
  time); Insights shows four cards; Inventory → Recipes has no Sales switch and
  shows the pointer.
- **Without the preview:** the batch form renders; a fictional batch saved
  ("Sales saved. Stock estimates are updated.") and appeared in Sales history;
  Recipes has no sales block.
- No page errors. Fictional rows were written only to this worktree's local
  database copy.

## Not covered

- Rewording inside the moved sales & exceptions flow (unchanged).
- Real insights; hosted appearance.

## Rollback

Revert the commit. No data or schema changes need reversal.
