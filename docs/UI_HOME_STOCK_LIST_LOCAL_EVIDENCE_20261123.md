# Home page and stock list — local evidence

Recorded: 2026-11-23. Branch: `workstream-c/ui-home-stock`, based on `main` at
`6b941a4` (after [step 1](UI_MERCURY_LOOK_LOCAL_EVIDENCE_20261123.md)). This is
step 2 of the four official changes from the owner-approved design preview
("looks good can you make it official"). It is **local evidence only**.

## What changed

- **Home page** ([panel](../src/components/workspace/home-panel.tsx)), now the
  first page in the owner and manager workspace:
  - a greeting and today's date;
  - five figures: out of stock, running low, counts due, paused sales and
    run-out reports. Each opens its page;
  - a **To do** list, each item with a time estimate and a button. It covers
    run-out reports, products that are out, counts due, paused sales,
    products needing setup, and an unfinished order;
  - a **Clover** card (owners only) and **Recent orders**.

  Home comes first in the side menu and the phone tab bar.
- **Stock list** ([Inventory → Stock](../src/components/workspace/exact-inventory-panel.tsx)):
  - a **Status** column with one badge style:
    - **In stock** (green);
    - **Running low** and **Count due** (amber);
    - **Out** (red);
    - **Needs setup** (grey);
  - filter chips with counts: All, Needs attention, Out, Running low, Count
    due, Needs setup;
  - amounts right-aligned, and "Last count" in plain words such as "3 days
    ago";
  - shorter row buttons (**Update** / **Set up**). Their accessible names
    remain "Update stock for …" and "Set up stock for …";
  - on phones, each product is a simple row (name, status, amount, "Counted
    3 days ago"), and **Add stock** is pinned above the tab bar.
- **Order history:** each order's status uses the same badge.
- **Status rule** ([stock status](../src/lib/stock-status.ts)), shared by the
  stock list and the home page:
  - **Needs setup:** no stock record;
  - **Out:** nothing on hand;
  - **Running low:** under 30% of the product's saved level;
  - **Count due:** not counted in the last 7 days;
  - otherwise **In stock**.

  The saved level is read from the existing suggested-levels endpoint. The
  "Running low" rule is an interim rule, and its home figure says so ("under
  30% of their level"). The R2 low-stock alerts decision will replace it with
  a rule based on usage and delivery schedules.

The home page only reads existing endpoints:
- `/api/inventory`;
- `/api/inventory/levels`;
- `/api/inventory/run-out`;
- `/api/sales/events` (owners and managers);
- `/api/clover` (owners).

A failed read shows "—". There is no API, schema, permission or stored-data
change.

## Verification

The complete local pipeline passed in this worktree on 2026-11-23, with the
changes staged on base `6b941a4`:
- `pnpm typecheck`;
- `pnpm test` (189 suites, including the new
  [stock status test](../tests/stock-status.mjs));
- `pnpm db:check`;
- `pnpm build`;
- `pnpm db:migrate:local`;
- `pnpm test:local`;
- `pnpm a8:check:browser`.

The new test covers each status, the 30% and 7-day boundaries, negative
estimates, a missing level and "never counted". It also pins that the stock
list and the home page use the same rule, and that the row buttons keep their
"Update stock" and "Set up stock" names.

ESLint shows no new findings compared with `main` in the changed files, and
none in the new files. Prettier passes on the new files.

Browser checks used the demo café with the exact inventory preview on, in
desktop (1440×900) and phone (390×844) windows. The home page showed 1 out, 2
counts due, 1 paused sale and 11 to set up, matching the stock list's chips.
The stock list's badges, chips and phone rows rendered, with no page errors.

## Not covered

- Steps 3 (shorter wording) and 4 (Suppliers page), which follow as separate
  pull requests.
- The final "Running low" rule (R2).
- Hosted appearance and real phones.
