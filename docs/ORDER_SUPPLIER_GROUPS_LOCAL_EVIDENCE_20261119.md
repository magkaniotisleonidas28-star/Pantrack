# New order page: products grouped by supplier — local evidence

Recorded: 2026-11-19. Branch: `workstream-c/order-supplier-groups`, based on
`main` at `e94e988`. The owner said the order page would become too long and
disorganized as products are added, and asked for products to be separated
into collapsible lists sorted by supplier. They reviewed a local preview and
asked to make it official ("lets just make these changes official for now").
This is **local evidence only**: nothing was deployed and no hosted or live
service was used.

## Changed behavior

- **Supplier lists:** the order page's single table is replaced by one list
  per supplier ([order product list](../src/components/workspace/order-product-list.tsx),
  [styles](../src/components/workspace/order-product-list.css)). Suppliers are
  sorted A–Z, and products within a supplier by category, then name
  ([grouping](../src/components/workspace/order-product-groups.ts)).
- **Supplier headings** open and close their list (`aria-expanded`). Each
  heading shows:
  - the number of products;
  - how many are in the order and their estimated subtotal;
  - progress toward the supplier's minimum, when Pantrack knows it ("$52.00
    to the $100.00 minimum" or "Minimum met").
- **Collapse all / Expand all** appears when there is more than one supplier.
- **Starting state:** lists start open when there are 20 or fewer orderable
  products, and closed when there are more. Each company's open/closed
  choices are remembered in this browser (`localStorage`, guarded; it falls
  back to the starting state if storage is unavailable).
- **Search** opens every supplier with a match while text is entered.
- **Category filters** come from the products' own categories instead of the
  fixed Dairy / Coffee & pantry / Packaging list. A new **In my order (n)**
  filter shows only products with a quantity.
- **Dark theme:** the supplier-list links, minimum messages and chosen rows
  have their own readable colours.
- **Compact rows:** about 60 px tall instead of 98 px. On phones, the price
  moves under the product name and the line subtotal is hidden, as before.
- **Removed:** the unused table and stepper icon imports in
  [workspace](../src/components/workspace/workspace.tsx).

Unchanged: quantities, the order basket, review, saving, the request sent when
an order is prepared, and every API, schema and authorization rule. Supplier
minimums still come only from the three sample suppliers, as in the existing
review dialog. Those minimums are whole dollars, so they are converted to cents
to compare with prices.

## Verification

The complete local pipeline passed in this worktree on 2026-11-19 with the
final changes staged on base `e94e988`: `pnpm typecheck`, `pnpm test` (184
suites, including the new [order product groups test](../tests/order-product-groups.mjs)),
`pnpm db:check` (no migration added), `pnpm build`, `pnpm db:migrate:local`,
`pnpm test:local` and `pnpm a8:check:browser`.

The new test checks:
- the supplier A–Z and category-then-name sorting, without changing the input;
- chosen counts and subtotals in cents;
- the dollars-to-cents minimum conversion, including no minimum for unknown
  suppliers;
- the categories taken from products;
- the order-page wiring.

ESLint on [workspace](../src/components/workspace/workspace.tsx) reports the
same 5 errors and 1 warning as `main`. The new files have no findings and are
Prettier-clean. `git diff --check` is clean.

A local Playwright script (Chromium, run from outside the repository, fictional
local data) passed 11 checks:
- Collapse all hides the lists, and the choice is remembered after a reload;
- search opens groups and shows only the match;
- with 60 products across 6 suppliers (extra products added in the browser
  only), lists start closed;
- In my order shows only chosen products;
- the minimum shows "$52.00 to the $100.00 minimum" at $48, and "Minimum met"
  at $120;
- each heading reports its open state;
- there are no page errors and no sideways scrolling at 390 px wide.

Screenshots at desktop and phone widths, in light and dark themes, were reviewed.

## Not covered

- Hosted appearance and real company catalogs.
- Minimums for real suppliers, which Pantrack does not store yet.
