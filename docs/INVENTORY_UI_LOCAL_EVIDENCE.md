# Inventory layout refinement — local evidence

Date: 2026-10-04. Workstream A, A4 manager UI follow-up. Outcome: complete
locally for this layout slice; no new milestone acceptance or deployment.

## Scope and result

Inventory now follows heading → section navigation → tools → working data.
Stock, Recipes & sales, Purchasing plan and Activity are directly available
above the content, using the existing workspace section state. Summary tiles
become inline counts on Stock. Both legacy and exact stock lists support search
by product, supplier and SKU, with an explicit no-match state.

Repeated recipe, review and purchasing containers become lists separated by
rules. Purchasing rows put the recommendation beside its existing arithmetic
on desktop, then stack in source order on narrow screens. Form groups and
review disclosures retain their functionality with quieter styling. Palette,
data, calculations, actions, draft state and server authorization are retained.

The implementation lives in [inventory-layout.tsx](../src/components/workspace/inventory-layout.tsx),
[inventory-layout.css](../src/components/workspace/inventory-layout.css),
[inventory-panel.tsx](../src/components/workspace/inventory-panel.tsx) and
[exact-inventory-panel.tsx](../src/components/workspace/exact-inventory-panel.tsx).
The shared [workspace shell](../src/components/workspace/workspace.tsx) has one
additional callback prop connecting the visible section navigation. Its existing
uncommitted purchase-order and supplier changes were preserved.

## Verification

- PASS — `pnpm test:focused inventory-sales inventory-management-contract`,
  before implementation and after the final source edits.
- PASS — `pnpm typecheck`, including the final source edits.
- PASS — `pnpm test`: all 46 suites in this checkout. These include pre-existing
  uncommitted purchasing work and prove local behavior, not live integrations.
- PASS — `pnpm db:check`: 25 ordered migrations match the current schema and
  apply to fresh temporary SQLite. This task introduces no migration.
- PASS — `pnpm build`, including the final UI corrections.
- PASS — `git diff --check` and changed relative-link existence checks.
- PASS — Safari walkthrough of legacy stock in the existing loopback preview:
  visible navigation, SKU filtering, and purchasing-plan empty state.
- PASS — Safari exact inventory walkthrough in the existing fictional W1
  loopback workspace: populated stock, purchasing rows, recipe empty state,
  and responsive review at 390px and 1440px. Desktop light/dark appearances
  were inspected; narrow review used light mode. Focus outlines were visible.
- The design hook reported no deterministic issues on the new layout files.
  The standalone Impeccable context/detector engine was unavailable; existing
  source and browser views supplied context instead.

An attempted second dev server refused to start because an existing server
owned this checkout. Existing previews were used without stopping either
server. No stock, recipes or orders were saved during the visual walkthrough.
`pnpm db:migrate:local` and `pnpm test:local` were not run for this UI slice;
there are no database or API changes. No live provider or hosted evidence is
claimed. Populated recipe expansion, all form submissions and a complete manual
accessibility audit remain separate review coverage.

## Handoff and rollback

No API, schema or consumption-contract changes. Inventory tables retain local
horizontal scrolling on phones so every quantity and action stays available.
All new styling is scoped to Inventory. The shared-shell handoff is the
`onSectionChange` prop; future integrations must preserve it.

Rollback only this task's inventory changes and the single shell callback,
preserving the purchasing edits already present in the checkout. No data repair
is needed. Suggested commit: `Simplify inventory layout and section navigation`.
Next unblocked workstream A checklist item remains A8's recorded hosted
acceptance work; this visual refinement does not close those gates.
