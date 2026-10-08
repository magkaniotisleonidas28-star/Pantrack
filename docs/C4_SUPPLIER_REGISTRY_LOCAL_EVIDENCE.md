# C4 — Supplier profiles and product mappings

Local verification: 2026-10-04. Branch: `workstream-c/c4-supplier-engine`.
One reviewable C4 outcome, following the [PO foundation](C4_PO_FOUNDATION_LOCAL_EVIDENCE.md).
The [PO-first rollout](PURCHASE_ORDER_ROLLOUT.md) remains the product direction;
C4/M8 acceptance and supplier submission remain open.

## Delivered contract

Managers and owners can create, review, version and archive company-owned
supplier profiles, accounts, delivery locations and exact inventory mappings.
Profiles retain ordering email/telephone, payment terms, optional minimum/fee
estimates, ordering instructions, notes and an attributed email-acceptance report.
Unknown or manager-reported acceptance does not enable sending. Account/location
IDs remain stable; existing locations cannot be reassigned to another account.
Archived records and all historical versions remain readable.

The same inventory item can have different packs from different suppliers.
Mappings freeze SKU, description, order-unit label, pack contents, scoped unit
version, exact canonical conversion, nullable estimated USD price and inventory
configuration reference. Duplicate active SKUs within a supplier/account/location
group are rejected. Changed inventory configuration or retired custom units hold
new use for review. Nothing rewrites the inventory item's purchase pack.

Registry-backed manual drafts use `pantrack.purchase-order-draft.v2` and freeze
the full supplier profile and selected mapping projections. Whole packs and exact
integer totals are server-derived from those frozen conversions. Later profile,
address, price, pack or archive changes cannot rewrite an existing draft.
Existing manual/fictional-proposal v1 drafts remain compatible. No replenishment
need is recalculated and no fictional proposal is upgraded to a real mapping.

`pantrack.supplier-mapping.v1`, with `mode: review_only` and
`source: manual_registry`, is the explicit read-only handoff for A's next slice.
Production replenishment generation using the registry is **not implemented**
here. A must consume current versioned selections through a separately reviewed
production proposal contract before production proposal ordering is possible.

## Files, API and migration

- `src/lib/purchasing-supplier-contract.ts` defines strict commands, profile and
  mapping versions, and the mapping projection.
- `src/lib/d1-purchasing-suppliers.ts` provides company/manager authorization,
  exact conversions, paging, immutable history, archives and operation receipts.
- `/api/purchasing-suppliers` provides gated profile/mapping/history/units/stocks/
  projection reads and review mutations. Existing company middleware supplies
  session, role, CSRF and private no-store responses. Membership and source
  versions are checked again inside the atomic commit batch.
- PO contract/service/UI add explicit registry selections while retaining v1.
  Manager navigation adds **Purchasing suppliers**. Unsaved company-switch guards
  and same-request retries retain uncertain saves without making a second write.
- Migration `0026_purchasing_supplier_registry.sql`, its generated snapshot and
  journal add six company-scoped head/version/operation/event tables and SQL
  guards. The migration replaces the initial PO trigger additively to permit v2;
  `0025` and all used migrations remain unchanged.
- `scripts/purchase-order-preview.mjs` generates a dedicated ignored local
  Wrangler configuration and local-only variables, with placeholder D1,
  `remoteBindings: false` and `.sites-runtime/po-review-state` persistence.
  Shared authentication/provider secrets and `.dev.vars` are not copied.
- Focused tests are `purchasing-suppliers` and `purchasing-suppliers-api`.
  `scripts/purchasing-suppliers-local-check.mjs` exercises the actual loopback
  service using disposable fictional companies and stock setup.

## Verification

PASS in this worktree:

- `pnpm test:focused purchasing-suppliers purchasing-suppliers-api purchase-order-drafts purchase-order-api`:
  six/twelve-item supplier packs, unchanged inventory setup, null estimates,
  exact custom units, dimensions/overflow, duplicate/group isolation, server
  anonymous/wrong-company/employee checks, actor-bound replay, stale versions,
  membership revocation, concurrent edits/retries, lost acknowledgment, injected
  rollback, archives/history/paging and byte-for-byte v1 migration compatibility.
  Supplier/mapping changes and custom-unit retirement between projection and
  PO commit leave no partial PO, operation receipt or audit.
- `pnpm typecheck`; `pnpm test` — 46 suites; `pnpm db:check` — 25 ordered
  migrations, fresh schema/foreign-key/integrity checks; `pnpm build`.
- `pnpm db:migrate:local`: `0026` applied to placeholder local D1 only. The
  isolated preview also applied `0026`, with no pending migrations on restart.
- `VINEXT_NO_DEV_LOCK=1 pnpm test:local`: actual HTTP smoke, including default-off
  supplier/PO routes. The override skips only the existing local development
  server lock; that server and its data were left untouched.
- `node scripts/purchasing-suppliers-local-check.mjs`: served anonymous,
  wrong-company and cross-origin rejection; six/twelve-item drafts totaling
  twelve/twenty-four items, replay, later address change, retained snapshot/history
  and unchanged inventory response.
- Safari desktop: keyboard traversal across supplier inputs, a saved fictional
  supplier with account/location/address and unavailable email, an eight-item
  mapping with unavailable price, a three-case draft showing **24 each**, frozen
  versions, cancellation with reason, original details retained and supplier/
  mapping history. Reset cleared the unsaved reason and retained saved records.
- Safari responsive mode at 390×844: supplier fields, action buttons, mobile
  workspace navigation, exact draft lines and wrapping frozen-version detail
  remained readable within the viewport.
- `pnpm exec openspec validate --all --strict`: three changes passed. Full
  diff/source review and `git diff --check` passed; all 164 changed-document
  relative Markdown links/anchors and changed/untracked source whitespace passed.

The browser found a registry command-builder block in the wrong UI handler.
Moving it into form submission resolved the error; the positive save/cancel
flow above was repeated afterward. A blank shared preview variable initially
overrode the gate and returned 404. A dedicated ignored configuration resolved
that setup issue without modifying shared local variables. These failed attempts
are not counted as positive evidence. Full accessibility acceptance and browser
network-uncertainty simulation remain additional QA; uncertainty recovery is
covered by service tests and inspected UI request locking.

Automated table comparisons show no inventory movements, proposal-history
changes, approvals, reservations, supplier submissions or legacy order changes.
Saved records are review drafts only. No supplier contact, real email/order,
café account/data access, remote migration, deployment or push occurred.

## Handoff and next outcome

Next unblocked C4 outcome: audited PO draft edits and manager review/approval
with invalidation and immutable approved snapshots. PDF/XLSX/history, durable
email dispatch, manual supplier confirmation and A-owned atomic incoming/
receiving remain separate slices. Supplier channel acceptance, café permission,
accepted M7, production A mapping/proposal integration and all release/provider
gates remain open. This is fictional/local evidence only.

Migration merge handoff: retain the prior uncommitted foundation and integrate
`0025` before this serial `0026` change. Only one schema-bearing change may use
the migration merge queue at a time; no remote apply is authorized. Rollback
disables `PANTRACK_PO_DRAFT_PREVIEW` and reverts preview code/UI while retaining
history. Use an additive forward repair; do not drop history or rewrite migrations.

For local review, run `pnpm dev:purchase-orders` and open
`http://127.0.0.1:5179`. Use the fictional fixture sign-in and practice company.
Classify a stock item in Inventory, save its supplier/profile mapping in
**Purchasing suppliers**, then explicitly select its supplier/account/location
and mapping in **Purchase-order drafts**. No sending control is available.

## Main integration — 2026-10-07

Drizzle regenerated the unpublished registry migration as `0026` after PO `0025`
and simulation `0024`. Main migrations through `0023` are unchanged. The gated
PO/registry consumers are integrated together to preserve v1/v2 compatibility.
Original evidence above is historical; current integration checks are recorded
in [C4 main integration](C4_MAIN_INTEGRATION_20261007.md).
