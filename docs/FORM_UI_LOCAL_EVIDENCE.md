# Stock, recipe and Waste form refinement

Date: 2026-10-04. Workstream: A4 interface follow-up, connected to W2 café-item
waste. Outcome: a consistent, understandable entry flow for Add stock, recipe
creation/review, recipe browsing, and the Waste page. This is a focused interface
slice; it does not complete or reopen a milestone.

## Changes

- `src/components/workspace/task-form.tsx` and `task-form.css` provide shared
  section headings, explanatory text, native radio choices, responsive field
  groups, review rows, and action footers. Sections use rules instead of nested
  cards and retain the existing Pantrack colors and controls.
- `stock-entry.tsx` separates item selection, measurements and packaging, the
  stock quantity, and optional entry details. Existing/new item selection is
  explicit; optional supplier details and advanced custom measures are
  disclosures. Delivery, physical count, incoming stock, and ingredient use have
  contextual instructions and outcome-specific save labels.
- `recipe-builder.tsx` groups the name, base ingredients, customer choices, and
  optional extras. Review is a separate stage with Back to editing, preserving
  the controlled recipe values. Review moves focus to its heading.
- `recipe-list.tsx` adds a labeled search/count toolbar, flatter ingredient
  details, explicit edit/archive actions, and distinct empty/search states.
- `menu-waste-recorder.tsx` adds visible page navigation, a flatter item picker
  without duplicate recent/favorite rows, grouped entry fields, native reason
  choices, and visible stock-handling choices with deduction explanations.
  Existing sale matching and manager-review behavior is retained.
- `exact-inventory-panel.tsx` makes Add stock/Create recipe the primary actions
  within their views. The prior Inventory navigation refinement remains intact.

No API contracts, persistence models, migrations, authorization rules, quantity
calculations, or provider behavior changed in this slice. Existing pending-save,
retry, dirty-entry, and history mechanisms remain. Pre-existing purchasing work
and the earlier [Inventory refinement](INVENTORY_UI_LOCAL_EVIDENCE.md) were
preserved.

## Local verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed after the final source change |
| `pnpm test` | All 46 suites passed during implementation |
| `pnpm test:focused stock-entry stock-pack-units recipe-choices menu-waste waste-recording` | All five suites passed after the final source change |
| `pnpm db:check` | Passed; 25 ordered migrations match schema and apply to fresh SQLite |
| `pnpm build` | Passed after the final source change |
| `git diff --check` | Passed |

Safari desktop and 390px responsive previews were inspected using isolated
fictional W1/W2 review data. The walkthrough established:

- A new milk setup converts one US gallon jug to 128 fl oz and three jugs to
  384 fl oz in the unsaved preview.
- Recipe ingredient selection sets the matching unit. An unsaved 18g espresso
  recipe reaches the separate review stage; Back to editing preserves the name,
  ingredient, amount, and unit. The final review exposes its heading, quantities,
  Save recipe, and Back to editing in Safari's accessibility tree.
- Waste shows quantity/reason, stock handling, recipe extras when applicable,
  and optional context. Choosing already-counted waste without a matching sale
  displays no extra deduction and Save for review.
- Narrow-screen stock packaging fields stack, recipe ingredient/quantity/unit
  fields remain readable, and Waste descriptions and actions fit the viewport.
- The recipe list was inspected at narrow width. Its expanded history and
  archive interaction were not exercised in this browser pass.

All walkthrough entries were unsaved and discarded in the test tabs. Browser
checks prove presentation and traversal, while automated suites prove the
existing domain contracts; this is not a full assistive-technology audit or a
new hosted acceptance result. No production data or live integrations were used,
and nothing was deployed. No database migration or HTTP smoke rerun was needed
for these UI-only changes.

## Handoff and rollback

Review locally at `http://127.0.0.1:5176/` in the existing isolated W2 fixture.
The next unblocked step is an owner usability walkthrough with typical café
entries, following [the W2 evidence](W2_LOCAL_EVIDENCE.md). Hosted verification is
a separate release task. No milestone checkboxes changed.

Rollback only this slice's changes in the four form/list files and the primary
action treatment in `exact-inventory-panel.tsx`, then remove `task-form.tsx` and
`task-form.css` after removing their imports. Preserve the earlier Inventory
layout and unrelated uncommitted purchasing changes; do not reset the shared
working tree.
