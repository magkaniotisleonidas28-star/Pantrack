# Workspace header, navigation and wording — local evidence

Recorded: 2026-11-14. Branch: `workstream-c/ui-shell-navigation`, based on
`main` at `4d25751`. This is the first of four owner-requested UI changes,
explored first in an uncommitted local prototype and approved by the owner.
It is **local evidence only**: nothing was deployed and no hosted or live
service was used.

## Owner decisions

On 2026-11-14 the owner reviewed a local prototype and asked for:

- one workspace header, with company switching, rename, members and new
  company in a company menu;
- the original hover-expanding side menu kept, with each section's
  sub-sections shown **only** in the side menu, not as tabs on the page;
- "A fresh start, fully stocked." renamed "Create a new order", and its
  subtitle removed;
- one word, "supplier", instead of "vendor", and plain-language messages;
- unfinished sections marked "Coming soon".

The later requests (simpler Setup & register, guided product setup, Sales as
its own section, and recipe option sets) are separate pull requests.

## Changed behavior

- **Header:** for owners and managers, the company bar and the "Members &
  ownership" panel are replaced by a company menu in the workspace header
  ([company portal](../src/components/workspace/company-portal.tsx)). It lists
  companies (scrollable), and offers Rename (owner only), Members & ownership
  (now a dialog) and New company. Switching with unsaved work still asks first.
  Employees keep the existing company bar, because their workspace has no
  header.
- **Practice notice:** shorter, with a dismiss button remembered in this
  browser (`localStorage`, guarded; it is shown again if storage is
  unavailable).
- **Phone header:** one row; "Record waste" becomes an icon button with its
  accessible name kept.
- **Navigation:** Inventory, Waste and Suppliers pages no longer render their
  own section tabs. The side menu (and the phone menu sheet) already listed
  them. Inventory and supplier page headings now name the current section
  under a small section label. The Waste "Needs review" count, previously on a
  page tab, now appears in the side menu.
- **Wording:** supplier labels and dialogs say "supplier"; supplier
  sub-sections are "Your suppliers", "Automation rules", "Suggested orders" and
  "Schedule". Several technical notices were rewritten in plain language. The
  server's purchasing-block constant is unchanged; only the supplier page shows
  friendlier text.
- **Coming soon:** the three unfinished supplier sub-sections carry a "Soon"
  label in the menu and a notice on the page. Payment methods stays available,
  because hosted Stripe setup exists; its "not configured" state now reads
  "Coming soon".
- **Removed styles:** the unused page-tab styles.
- **Browser check:** the [A8 scenario](../scripts/a8-browser/scenario.mjs) now
  opens Inventory → Purchasing plan from the side menu.

No API, schema, authorization or data behavior changed.

## Verification

The complete local pipeline passed in this worktree on 2026-11-14 with the
changes staged on base `4d25751`: `pnpm typecheck`, `pnpm test` (175 suites),
`pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` and
`pnpm a8:check:browser` (the updated side-menu scenario). ESLint reports no new
findings in the changed files compared with `main`, and the files that were
Prettier-clean on `main` remain so; repository-wide `lint` and `format:check`
already fail on `main` and are not claimed.

A local browser walk-through on desktop (1440×900) and phone (390×844) widths
confirmed: no company bar, one company menu, no page section tabs, section
headings for Inventory → Purchasing plan and Suppliers → Automation rules,
Payment methods reachable, the members dialog opening from the company menu,
the phone menu sheet listing sub-sections with "Soon" labels, no horizontal
overflow and no page errors.

## Not covered

- Hosted appearance and real accounts; this was a local fictional workspace.
- Employee view changes (none were made).

## Rollback

Revert the commit. No data or schema changes need reversal.
