# C4 main integration — 2026-10-07

Outcome: integrate the existing supplier simulation, immutable draft preview,
persistent PO drafts and supplier registry onto main `5bad73e`. This is merge
preparation for C4, not C4/M8 acceptance, hosted deployment or purchasing approval.

## Preservation and integration

The original `workstream-c/c4-supplier-engine` checkout remains intact. A private,
Git-ignored source backup and hash manifest cover 475 tracked/untracked source
files; every file still matched after integration. Local variables, database
state and existing preview data were not copied or modified. The integration
worktree is `/private/tmp/pantrack-c4-integration-20261007`, on
`workstream-c/c4-main-integration`.

The branch starts from current remote main and replays purchasing changes only.
Shipped Inventory, Waste, recipe/stock forms and workspace styles match main;
the shared workspace adds gated purchasing navigation and dirty-state reporting.
Main's auth recovery fence, replenishment guard repair, accepted freshness policy
and UI release records are preserved. Existing rollout documentation is included
without closing any milestone gate.

The schema queue is serialized on this integration branch: the simulation is
committed first; the PO schema and standalone preview follow; the registry and
compatible v1/v2 API/UI consumers complete the stack. No intermediate branch is
proposed for independent deployment.

| Unpublished source migration | Regenerated migration |
| --- | --- |
| `0022_supplier_simulation` | `0024_supplier_simulation` |
| `0023_purchase_order_drafts` | `0025_purchase_order_drafts` |
| `0024_purchasing_supplier_registry` | `0026_purchasing_supplier_registry` |

Drizzle generated each snapshot, SQL table/index definition and journal entry
against its preceding integrated schema. Custom triggers are byte-identical to
their source slices. All main SQL migrations, snapshots and journal entries
through `0023` are unchanged. Tests locate purchasing migrations by tag instead
of assuming their old indexes. No pending purchasing migration was applied remotely.

## Current-worktree verification

PASS in the integration worktree, using Node 22.23.2 and pnpm 11.25.0:

- `pnpm typecheck`.
- `pnpm test`: **49 suites**, including main's auth recovery and replenishment
  guard regressions, purchasing tenant/role guards, source races, replay,
  concurrency, uncertain saves, immutable history and v1/v2 compatibility.
- `pnpm db:check`: **27 ordered migrations**, matching generated schema, fresh
  SQLite application, integrity and foreign keys.
- `pnpm build`: production Worker/application build completed.
- `pnpm db:migrate:local`: all 27 migrations applied to an isolated placeholder
  D1 database in this worktree.
- `VINEXT_NO_DEV_LOCK=1 pnpm test:local`: loopback home/auth/company/catalog,
  company isolation, CSRF, sign-out and default-off PO/registry routes passed.
  The override avoids interference with another checkout's local dev lock.
- `node scripts/purchasing-suppliers-local-check.mjs`, against the isolated
  `dev:purchase-orders` preview: anonymous, wrong-company and cross-origin
  rejection; six/twelve-unit packs; retry replay; immutable drafts after address
  changes; supplier history; unchanged inventory.
- `tests/c4-main-upgrade.mjs`: applying all three pending migrations to populated
  fictional main data preserved **65 preexisting tables and their schema
  objects**, including sessions, recovery state, recipes, inventory, legacy
  orders and proposal history. It checks integrity/foreign keys after each step
  and verifies that upgrades infer no supplier or order records.
- Safari fictional local walkthrough: supplier/account/location selection,
  three six-unit cases saved as **18 each**, missing-price/email display,
  cancellation retaining the snapshot and create/cancel audit; saved supplier
  profile and mapping review; Inventory, Recipes and Waste navigation/rendering.
- `git diff --check`; source/schema preservation comparisons and relative-link
  review. Generated migration metadata is reviewed through generation, schema
  checks and the upgrade test rather than manually merged.

Initial local D1, loopback smoke and served-check attempts were blocked by sandbox
`EPERM`; the same checks passed with loopback permission. These failures were
environment restrictions, not passing application evidence. No existing local
database or provider credential was needed for verification.

Earlier slice documents retain historical suite counts and browser evidence;
this record is the current integrated local result. Hosted provider auth,
hosted D1 concurrency, full accessibility and production acceptance are separate.

## Contracts, rollback and next step

Existing proposal v1/v2 and PO draft v1/v2 contracts are preserved. The company
scoped PO/registry routes require owner/manager membership and remain unavailable
unless `PANTRACK_PO_DRAFT_PREVIEW` is exactly `enabled`. Supplier submission,
automatic purchasing and Clover sync stay disabled. There is no new supplier
transport, approval, reservation, inventory receipt, email or payment path.

Before merge, require successful Ubuntu and Windows branch CI and a current
main comparison. If main gains another migration, regenerate only the unpublished
C4 stack against that new baseline before merging. The published main migrations
must remain unchanged.

Rollback keeps the purchasing gate off and reverts purchasing code/navigation
while retaining additive tables and audit history. Do not drop history or roll
back fenced authentication; repair schema forward with a new migration. Deploying
this branch later requires a separately authorized migration/release window.

Next unblocked C4 feature: audited PO draft editing and manager review/approval.
PDF/XLSX, email, supplier confirmation, A-owned receiving and production proposal
integration remain separate outcomes. No supplier access or contact is required
to merge this disabled local foundation.
