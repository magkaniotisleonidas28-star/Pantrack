# Setup & register and guided product setup — local evidence

Recorded: 2026-11-14. Branch: `workstream-c/ui-setup-guided-stock`, stacked on
the [workspace header and navigation change](UI_SHELL_NAVIGATION_LOCAL_EVIDENCE_20261114.md).
This is the second of four owner-approved UI changes from the 2026-11-14
prototype review. It is **local evidence only**.

## Changed behavior

- **Setup & register** ([page](../src/components/workspace/setup-register.tsx),
  [register card](../src/components/workspace/register-provider.tsx)): the
  setup checklist opens by default and the subtitle reads "Get your café ready
  step by step". The Clover app connection, the automatic sales endpoint and
  its access tokens move into a closed "Technical connections" section shown
  last on the page. Import is titled "Import sales from your register".
  Behavior, permissions and requests are unchanged.
- **Guided product setup, older stock screen**
  ([panel](../src/components/workspace/inventory-panel.tsx)): when products are
  not set up, a call-out offers "Set up products". It walks each unconfigured
  product: first how it is measured and stored (three questions; the rest under
  "More settings (optional)", which opens automatically if a hidden field is
  invalid), then an opening count, then the next product. Progress, "Skip this
  product" and "Stop setup" are shown. It reuses the existing save requests and
  reloads stock before opening each step, so record versions stay current.
- **Guided product setup, exact stock screen**
  ([panel](../src/components/workspace/exact-inventory-panel.tsx)): the same
  call-out opens the existing "Add stock" form for each product without stock
  in turn, with progress, skip and stop. A save moves to the next product;
  leaving for the stock list ends the walkthrough.
- **Stock in purchase packs:** the older screen shows stock in the product's
  purchase unit first ("2.5 cases", or "≈ 1 case" when rounded) with the exact
  stock-unit amount below. The exact screen shows its existing package
  equivalent ("≈ 6 × box") first, with the exact amount below.

No API, schema, authorization or stored data shape changed.

## Verification

The complete local pipeline passed in this worktree on 2026-11-14 with the
changes staged on base `d6d21dc`: `pnpm typecheck`, `pnpm test` (175 suites),
`pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` and
`pnpm a8:check:browser`. ESLint reports no new findings in the changed files
compared with `main`, and `register-provider.tsx` stays Prettier-clean.

Local browser checks at 1440×900:

- **Exact stock screen** (`PANTRACK_EXACT_INVENTORY_PREVIEW=enabled` in the
  ignored local variables): call-out "11 products need setting up"; progress
  1 → 2 of 11 after skip; stop returns to the list; a full guided save of one
  product moved to product 2 and the list then showed "≈ 6 × box" over
  "6 each" and "10 products need setting up".
- **Older stock screen** (flag empty): settings → count → next product
  ("Product 2 of 10"), "More settings" closed while guided, stop; the saved
  product showed "2.5 cases" over "5 bag".
- **Setup & register:** checklist open, "Technical connections" closed and
  ordered last.
- No page errors in any run. The fictional rows were saved only in this
  worktree's local database copy.

## Not covered

- Hosted appearance; employee views (unchanged).

## Rollback

Revert the commit. No data or schema changes need reversal.
