# Workspace surface refinement

Date: 2026-10-04. Workstream: A4 interface follow-up. Reviewable outcome:
consistent presentation hierarchy across Pantrack's workspace, replacing repeated
decorative cards with readable rows and open sections. This is a presentation
follow-up, not acceptance of an integration milestone.

## Changes

- `product-catalog.tsx` replaces the catalog tile grid with searchable product
  rows. Supplier, SKU, packaging, estimated price, sample/unverified status,
  edit, and supplier links remain. Café-item waste setup is one page action
  instead of an identical action on every product. Empty and no-match states
  are distinct.
- `workspace-surfaces.css` supplies shared rules for catalog/vendor/history
  rows, setup and automation sections, payments, ordering, table frames, and
  repeated stock/recipe review sections. Purchasing fieldsets keep their
  legends and disabled semantics while losing nested frames. Mobile layouts
  stack in DOM order; focus, reduced-motion, selection, and theme tokens remain.
- `setup-register.tsx` replaces eight equally weighted cards with a native
  collapsible ordered checklist. All eight instructions, statuses, navigation
  actions, and saved configuration counts remain. Register and mapping editors
  use open sections with constrained form widths.
- `vendor-automation.tsx` adds visible supplier-section navigation. Add vendor
  appears in the vendor section. Policy, scheduling, connection, and job handlers
  are unchanged.
- `workspace.tsx` uses the new catalog component and supplies the supplier
  navigation callback. Redundant decorative heading labels are removed from
  catalog, ordering, history, setup, suppliers, and payments.
- `globals.css` imports the shared surfaces and removes conflicting dark-theme
  backgrounds that repainted flattened sections. Dialog boundaries, alerts,
  selected states, and safety callouts remain. The focused sign-in panel remains,
  with its decorative shadow removed.

The scan included workspace components and app styling, including manager,
employee, purchasing, and authentication views. No API, authorization, schema,
calculation, persistence, or purchasing-gate behavior changed. Preserve the
earlier [Inventory](INVENTORY_UI_LOCAL_EVIDENCE.md) and
[form refinement](FORM_UI_LOCAL_EVIDENCE.md), plus unrelated uncommitted
purchasing work.

## Local evidence

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed after the final change |
| `pnpm test` | All 46 suites passed after component changes |
| `pnpm db:check` | Passed; 25 ordered migrations |
| `pnpm build` | Passed after the final CSS correction |
| Impeccable layout detector on changed surfaces/components | Returned no findings |
| `git diff --check` | Passed |

Safari inspection used the isolated local W2 review fixture on port 5176.
Desktop and 390px previews established catalog search (two milk matches out of
seven), no-match/clear-search behavior, stacked catalog content, setup summary
counts, supplier section navigation, and responsive payments geometry. The
first visual pass found a conflicting dark-theme background rule; the single
correction pass removed it and constrained setup forms. Final confirmation
showed the unframed setup/catalog at 390px and catalog, New order, and payments
at desktop size. Safari was returned to regular page size.

The native setup disclosure's expansion could not be exercised through the
available Safari automation; its ordered contents were source-reviewed. Gated
purchasing states, saved-payment states, employee views, authentication, and
filled order-history states received source review rather than a new browser
walkthrough. Earlier form and inventory browser evidence is linked above.
This is not an exhaustive state or assistive-technology audit.

No entries, settings, tokens, payments, orders, or supplier requests were saved
during this walkthrough. Nothing was deployed. Database migration and local
HTTP smoke reruns were unnecessary for this presentation-only slice. Existing
schema changes in the shared working tree belong to separate purchasing work.

## Handoff

Review at `http://127.0.0.1:5176/`. Next unblocked step: an owner usability
walkthrough of typical café tasks and the gated purchasing preview. Hosted
verification remains a separate release task; no milestone checkboxes changed.

Rollback only this slice: remove the shared surface import and its associated
dark-theme edits, restore the catalog/checklist/supplier-navigation presentation,
and remove the two new surface/catalog files after their imports are removed.
Do not reset the shared working tree or discard earlier form, inventory, or
purchasing changes. The main remaining risk is presentation in gated or populated
states not visited in this browser pass.

## Follow-up: balance the workspace width

The owner reported left-heavy tabs with unused space on the right. The focused
A4 follow-up adds `data-workspace-page` to the existing `main` in `workspace.tsx`
and appends a layout block in `workspace-surfaces.css`:

- A centered canvas uses 1440px for browsing/ordering, 1280px for inventory,
  1200px for setup/suppliers/history, and 1120px for payments. All shrink to the
  available width. Headings, actions, and content now share the same canvas.
- Narrow stock/recipe forms and manual-sales fields are centered. Recipe lists
  fill their canvas; recipe review uses the form's full width.
- Automation controls and allowed products, schedule and connector guidance,
  and mapping and CSV-import editors use two open columns when their actual
  content container has at least 1000px. They stack below that threshold,
  including when sidebar expansion reduces available space. DOM/focus order
  remains unchanged. No cards or new factual copy were introduced.
- Container containment applies only to setup/suppliers, preserving the
  viewport-based fixed order-total dock on New order.

Local checks for this follow-up: `pnpm typecheck`, the five focused stock-entry,
stock-pack-units, recipe-choices, menu-waste, and waste-recording suites, final
`pnpm build`, `git diff --check`, and Impeccable layout detection passed. The
detector returned no findings. These are current local checks, not hosted evidence.
No migrations, database updates, or backend-contract changes required migration
or HTTP smoke reruns.

Safari's isolated W2 walkthrough confirmed centered Add stock and side-by-side
automation controls/products on desktop, plus stacked automation fields and
mapping/import sections at 390px. Desktop mapping/import columns retained their
labels, instructions, and disabled actions. No values were changed or saved.
The wider record lists and gated/populated states retain the source-review
coverage limits above. The UI follows the existing themes and controls; this
pass is not a new accessibility certification.

Rollback this follow-up by removing only the appended balance/container-query
CSS block and `data-workspace-page`; preserve the earlier refinement and
unrelated pending work. Next unblocked step: owner review of typical entries
at the normal workstation width. No milestone checkboxes or release gates changed.
