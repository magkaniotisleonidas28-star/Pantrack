# C4 — Durable PO draft foundation

Decision: 2026-10-03. Local verification: 2026-10-04.
Branch: `workstream-c/c4-supplier-engine`. This is one reviewable C4 outcome,
not completed M8 or implementation of the entire purchasing rollout.

## Contract and delivered behavior

The [PO-first rollout](PURCHASE_ORDER_ROLLOUT.md) is adopted in the
[milestone roadmap](PANTRACK_MILESTONES.md) and [status](CURRENT_STATUS.md).
M8 is reviewed email POs, PDF/XLSX and delivery reconciliation; M13 optional
supplier APIs follows users; M14 automation follows reviewed release evidence.
Existing M0–M7 evidence and pending POS gates are preserved.

The default-off manager preview creates persistent manual stock/non-stock drafts
or consumes saved v1/v2 proposal references. It provides saved draft listing,
detail, proposed cap, explicit missing estimates, frozen supplier/address/line
snapshots and cancellation with reason and retained creation/cancellation audit.
Exact stock conversion is server-derived for manual lines; proposal pack counts,
SKUs, revisions, conversions, estimates and full handoffs remain unchanged.
Proposals are read without triggering A's invalidation/history writers. Source
versions and Clover freshness are checked again inside the commit batch.

Anonymous users, wrong-company members and employees cannot read or mutate POs.
Managers/owners are resolved from server identity and membership, including a
commit-time guard. Each create/cancel operation has an actor/payload fingerprint
and immutable result receipt. Concurrent retries and lost acknowledgments recover
the same result. Source/state/membership changes abort the entire batch.

No send, purchase approval, budget reservation, source quantity hold, inventory
movement, proposal mutation or receiving control exists in this foundation.
Unknown-price values stay null/unavailable. A proposed cap is not an approved
cap and no supplier ordering permission is inferred. Current proposal mappings
are explicitly fictional and remain prohibited for production ordering.

## Files, interfaces and migration

- `src/lib/purchase-order-contract.ts` defines the strict draft input/view types.
- `src/lib/d1-purchase-order-drafts.ts` implements manager-authorized persistence,
  read-only proposal projection, exact lines, list/detail and cancellation.
- `/api/purchase-orders` exposes GET list/detail/choices and POST create/cancel;
  `PANTRACK_PO_DRAFT_PREVIEW=enabled` is required, off otherwise. Existing
  authorization middleware supplies session/company/CSRF and no-store behavior.
- Workspace adds a Purchase-order drafts item only after the gated API succeeds.
  Uncertain saves retain the same request for retry and lock further changes.
- Migration `0025_purchase_order_drafts.sql`, generated snapshot and journal add
  four company-scoped tables: header/snapshot, line identities, operation receipts
  and events. SQL guards retain immutable evidence and restrict draft transitions
  to cancellation. No used migration is modified and no legacy row is backfilled.
- New focused suites: `purchase-order-drafts` and `purchase-order-api`.

## Verification

PASS in this worktree:

- Baseline: `pnpm test:focused supplier-order-draft supplier-simulation-d1`.
- `pnpm test:focused purchase-order-drafts purchase-order-api` (also covered by
  the complete test run): exact manual/v1/v2 lines, source/group validation,
  company/role rejection, membership/source races, duplicate/concurrent saves,
  lost acknowledgment, injected rollback, immutable history and unchanged
  preexisting tables, including stock and proposal history.
- `pnpm typecheck`.
- `pnpm test`: 44 suites passed, including the preserved fictional draft/export
  and simulation suites and additive compatibility checks.
- `pnpm db:check`: all 24 migrations match generated schema and apply to a fresh
  SQLite database; foreign-key and integrity checks pass. SQL, snapshot and
  journal reviewed; used migrations remain untouched.
- `pnpm build`: Worker/client build passes with the new gated API route.
- `pnpm db:migrate:local`: migration `0025` applied to local placeholder D1 only.
- `pnpm dev:purchase-orders`: all 24 migrations applied to a fresh separate
  `.sites-runtime/po-review-state` database; fixture sign-in, no live auth account.
- Served loopback HTTP checks at port 5179: actual anonymous/company/CSRF checks,
  exact stock/non-stock save, replay, listing/detail, cancellation and unchanged
  inventory response. A fictional three-bag beans line preserved
  `2267961850` canonical minor units per bag and `6803885550` total.
- Safari desktop browser: fictional supplier/address/cap entry, keyboard traversal
  across input/text-area fields, UI non-stock save, explicit unavailable estimate,
  saved detail/history, cancellation using Option-Tab then Return, and retained
  original details. Reset cleared unsaved fields while retaining saved history.
- Safari responsive mode at 390×844: form, controls, long PO reference, exact stock
  detail, missing-price non-stock detail and audit history fit the narrow layout.

Initial native Safari automation encountered focus/capture errors and an
overlapping company dialog. Reloading the disposable unsaved entries resolved
the interruption; the positive UI save/cancel/keyboard and narrow checks above
were subsequently completed. Full accessibility acceptance and browser simulation
of network uncertainty remain separate QA, not claims from this walkthrough.

- `VINEXT_NO_DEV_LOCK=1 pnpm test:local`: served HTTP smoke passed, including
  the new default-off PO assertion. The initial `pnpm test:local` attempt was
  blocked by an existing Vinext development-server lock. The documented Vinext
  override skips only that development lock; the existing server and lock were
  left untouched. The smoke still used its own local port and fixture identity.
- `openspec validate --all --strict`: planning/spec consistency checked.
- `git diff --check`, full diff/source review and relative Markdown file/anchor
  checks: all 158 relative links/anchors passed, including new documents.
  Local-only effects, unchanged used migrations,
  default-off routes and retained prior work were reviewed.

## Remaining outcomes and external gates

C4 and M8 remain unchecked. Next: versioned supplier registry and production
A-to-C mappings, then audited edits/approval, PDF/XLSX/history, durable email
dispatch, manual supplier confirmation and A-owned atomic incoming/receiving.
The [rollout](PURCHASE_ORDER_ROLLOUT.md) preserves the complete approved behavior
and implementation sequence. None of those subsequent features is represented
as implemented by this foundation.

No supplier contact, live email/order, café account/data access, remote migration,
deployment or push occurred. Provider/domain/R2 setup, supplier email agreement,
café permission, accepted M7 and production mapping/inventory contracts remain
gates for later outcomes. Mock/local evidence is distinct from provider/pilot
acceptance.

Rollback: turn off the preview and revert its code/UI; retain history tables and
use an additive forward repair if needed. Do not drop purchasing history or
rewrite used migrations. Shared schema/journal/workspace/roadmap changes remain
uncommitted for the migration merge queue; preserve prior work during integration.

## Local review

Run `pnpm dev:purchase-orders`, open `http://127.0.0.1:5179`, use the fictional
fixture sign-in and create/select a practice company. Choose **Purchase-order
drafts**. Stock lines require exact item setup in Inventory first. Supplier
details are captured per draft until the registry slice. Saved proposal sources
must be current and have matching supplier/account/location references; they
remain fictional. History pages contain 20 drafts; the preview bounds choices to
500 stock items/proposals. Issued PDFs, XLSX and email are not available yet.

## Main integration — 2026-10-07

The unpublished PO schema was regenerated as `0025` after simulation `0024`.
Custom PO guards are unchanged. The schema and standalone preview are queued
first; gated PO API/UI consumers are integrated with the dependent registry
slice. Original evidence above predates integration; see the integration record
for current-worktree verification. No remote migration is authorized here.
