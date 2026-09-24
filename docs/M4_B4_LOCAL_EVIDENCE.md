# M4 B4 local evidence — exact sales and inventory cutover

Date: 2026-09-22
Evidence level: local D1, deterministic fakes, compiled UI, and route tests only

## Task packet

Workstream/checklist step: B4 — integrate A's consumption contract.

Objective: while `PANTRACK_EXACT_INVENTORY_PREVIEW=enabled`, route manual sales,
recipe CSV, mapped register CSV, and the authenticated register bridge through
the durable B3 event service and A4 exact-inventory port; add company-scoped
exception review and two-step corrections. Preserve all legacy behavior while
the switch is off.

Constraints: no live POS, remote migration, deployment, customer data, supplier
action, or production switch change. M2 and M3 acceptance remain open, so this
does not accept M4 or enable B5.

## Implemented behavior

- Manual, recipe-CSV, mapped-CSV, and bridge references have distinct durable
  source namespaces. Their normalized lines are stable under input reordering.
- Manual and CSV requests require an explicit manager-confirmed occurrence
  time. The existing bridge body remains valid; optional
  `schemaVersion: "pantrack.bridge.v1"` and `occurredAt` fields permit immediate
  processing. An older body is stored with inferred receipt time and held until
  an owner or manager confirms the real occurrence time.
- Every exact sale goes through `SalesIngestionService` and
  `D1InventoryConsumptionPort`. One invalid mapping, version, unit, count, or
  quantity holds the whole event. The permanent application key prevents a
  retry, concurrent duplicate, refresh, or post-application crash recovery from
  deducting stock twice.
- Cutover checks both old `sales_imports` references and new durable events. A
  pre-cutover reference cannot enter exact inventory, and a temporary rollback
  to the legacy path cannot reapply an exact event.
- `/api/sales/events` provides bounded company-scoped status, duplicate-conflict,
  replay/retry/dismiss, occurrence-confirmation, and correction actions. Owners
  and managers may mutate; employees receive redacted status without normalized
  lines, retained fragments, ingredient changes, correction quantities, user
  identities, credentials, payments, or customer data.
- The “Sales & exceptions” tab supports manual/recipe-CSV entry, technical
  retry, mapping replay, dismissal with a reason, older-bridge time confirmation,
  duplicate-conflict dismissal, correction request, amount review/edit, and
  atomic confirmation. The mapped-CSV setup screen also requires confirmed time
  under the gate.
- Refunds and cancellations retain B1/B2's no-automatic-restoration policy.
  Corrections retain the original event and deduction, suggest the opposite of
  every ingredient deduction, allow reviewed signed edits, and write a separate
  permanent inventory adjustment plus audit. Stale stock rejects the entire
  correction; an applied correction cannot run twice or be requested again for
  the same sale.

## A to B contract handoff review

Person B reviewed the B4 runtime against the published
`pantrack.inventory-consumption.v1` contract on 2026-09-22. B4 passes the
company, stable application key, confirmed occurrence time, mapped recipe and
modifier identities, and canonical quantities through the shared port. Recipe
version selection, opening-count cutoff enforcement, exact unit validation,
atomic ingredient changes, and replay results remain owned by the inventory
port rather than being reimplemented in sales code.

The review found and fixed two concurrency defects around manager actions. Two
simultaneous confirmations of an older bridge event now create one occurrence
confirmation and one audit entry. Two simultaneous confirmations of the same
stock correction now both return the one permanent result while inventory and
linked adjustments change once. Focused regression coverage proves both cases.

The served walkthrough also exposed a local D1 compatibility defect: batched
writes were committed, but the runtime did not return the per-statement
`meta.changes` values used to acknowledge a processing lease and its terminal
result. The store now verifies the persisted lease directly and uses
transactional `SELECT changes()` checks for attempt completion. Correction
requests verify their saved review record instead of relying on optional batch
metadata. This prevents a successful deduction or correction request from
being reported as failed while retaining exact-one claim/completion behavior.

Conclusion: the B-side integration consumes A's published interface without an
inventory-specific workaround. This supplies Person B's compatibility review
for A5, but does not accept A5 or M3; Person A's milestone evidence and the M2
gate remain required.

## Migration and compatibility

Generated migration `0012_tough_rage.sql` adds occurrence confirmations,
correction items, immutable results, and links from each correction to its exact
inventory events. It does not rewrite migrations `0010` or `0011`.

`tests/b4-data-foundations.mjs` applies migrations through `0011`, seeds legacy
sales, inventory, and durable event rows, applies `0012`, and proves every prior
row remains byte-for-byte unchanged. The new tables start empty, foreign keys
pass, and a fresh database agrees with the generated schema, snapshot, and
journal.

Rollback is forward-only after any nonlocal migration: leave the preview switch
off, retain the immutable event/correction tables, and repair through a new
migration. Before any remote use, rebase the schema-bearing change through the
migration merge queue and obtain migration review.

## Verification

- PASS — `pnpm typecheck`.
- PASS — focused ESLint over every changed TypeScript/TSX source file.
- PASS — `pnpm test` (18 suites).
- PASS — `pnpm db:check` (13 ordered migrations match schema/snapshot/journal
  and apply fresh).
- PASS — `pnpm build`; the build includes `/api/sales/events` and the compiled
  sales review UI.
- PASS — `pnpm db:migrate:local`; `0012_tough_rage.sql` applied locally with six
  commands on the original run and reported no pending migrations on the
  2026-09-22 review run.
- PASS — `git diff --check`.
- PASS — `pnpm test:local` after merging C1's local runtime repair from `main`
  on 2026-09-22. The served smoke test covered the home page,
  anonymous/forged-header rejection, local fixture sign-in, company creation,
  catalog, tenant isolation, and sign-out.
- PASS — dedicated Safari walkthrough against the local served app with the
  preview switch enabled. A manual sale reduced exact stock once; an exact
  duplicate displayed “inventory was unchanged”; and a separately reviewed
  correction restored precisely the suggested amount and could not be applied
  twice. Recipe CSV and mapped-register CSV uploads each displayed an applied
  event in their distinct namespace and deducted their one fictional recipe
  quantity. The owner UI displayed applied, held, and processing states plus
  correction controls. A temporary local-only employee role displayed the
  read-only catalog, recipe, and recent safe status list without sales-entry or
  correction controls; owner access was restored and the temporary membership
  was removed immediately afterward.
- PASS — the authenticated bridge path, including old-message occurrence-time
  holds and confirmed replay, remains covered by the local B4 route/contract
  suite. No bridge token was created during the browser walkthrough and no live
  POS was contacted.
- FAIL — the optional repository-wide `pnpm lint` exhausted Node's 4 GB heap
  while traversing the ignored, generated 1.5 GB `.sites-runtime` directory.
  Focused lint over all changed source files passed; the normal required local
  pipeline does not include the full lint command.

Focused B4 tests prove namespace separation, legacy and rollback deduplication,
exact/concurrent duplicates, whole-event holds, old-bridge time confirmation,
mapping repair/replay, redacted employee status, correction suggestions,
reviewed edits, atomic application, replay prevention, stale-stock conflict,
company/role authorization, and migration compatibility. B2/A2 tests separately
retain crash-after-application recovery, cancellations/refunds, modifiers,
count cutoff, unit/version holds, and all-or-nothing consumption coverage.

## Acceptance and handoff

Proved locally: the B4 domain, D1, route, authorization, migration, build, and
gate behavior described above. No mocked provider result is represented as
sandbox evidence.

Still blocked: M2 acceptance; Person A's A5/M3 acceptance record; hosted
CI/review; and all external POS evidence. The shared local runtime and B4's
human-facing UI flows now pass locally, but C1's remaining provider and
deployment acceptance work is still open. B5 remains the next workstream-B
acceptance item after those prerequisites; Clover stays in B6.

Before B5, obtain migration and cross-workstream review, record hosted CI, and
complete the outstanding M2/M3 acceptance evidence. Do not merge this
schema-bearing branch or mark B4/M4 accepted before that evidence exists.

## Employee sales-status privacy follow-up — 2026-09-23

The original employee list omitted normalized sale lines and correction amounts
but still returned external references and free-text review reasons. The
follow-up narrows each employee status row to state and occurrence time, returns
no conflicts or corrections, and denies employee reads of individual event
history. The employee workspace displays only those two fields. The legacy
sales read used for recipes also omits imports and register mappings for
employees; owners and managers retain their review data. The feature gate
remains off by default, and no stored sale or inventory row is changed.

The focused M2 security suite passed with fictional sensitive-looking
references and reasons, employee/manager role comparisons, and the individual
history denial. `pnpm typecheck`, the full 18-suite `pnpm test`, `pnpm db:check`,
`pnpm build`, and focused ESLint passed. This is local evidence only, not B5 or
M4 acceptance.

## B4 local closeout and owner artifact acceptance — 2026-09-24

The B4 contributor completed a separate closeout on 2026-09-23 in
`workstream-b/b4-closeout-20260923` (commit `3aa521f`). Its evidence is recorded
here on `main` after the owner accepted the completed local review artifacts on
2026-09-24. The earlier pending-M2, pending-M3, and do-not-merge statements
above describe the historical branch state; B4 code is already on `main`, and
C1/M2 and A5/M3 are now owner-accepted for development.
The [B1 design](decisions/0003-m4-sales-ingestion.md) is accepted, and B4's
implementation checklist item is complete locally. B5/M4 is still open.

The closeout used an isolated fictional D1 database and enabled the preview
only for its local served check. A fictional employee's held-sale screen showed
state and occurrence time, without its distinctive external reference or review
reason. It showed read-only inventory and no sales-entry or correction controls.
Focused security tests cover the employee response field allowlist, empty
conflict/correction lists, denied event detail/history, and owner/manager access.
The preview is off by default in tracked configuration; the local server was
stopped after the check. The branch closeout applied all migrations through
`0012_tough_rage.sql` to its fresh isolated local D1 and passed its full local
pipeline; its source tests and migration were unchanged when this record moved
to `main`.

The complete pipeline passed again on current `main` on 2026-09-24:

- PASS: `pnpm typecheck` and `pnpm test` (19 suites).
- PASS: `pnpm db:check` (13 migrations agree with schema, snapshot, and journal
  and apply to a fresh SQLite database) and `pnpm build`.
- PASS: `pnpm db:migrate:local` (no pending local migrations) and
  `pnpm test:local` (fictional local authentication, company, tenant isolation,
  and sign-out). The smoke test left a fictional company in local D1.

The two loopback-dependent commands needed a permitted unsandboxed local run
after sandbox binding returned `EPERM`. This closeout did not apply migration
`0012` remotely or verify hosted Worker behavior. Leave the exact preview off
remotely until both are checked. If a nonlocal migration needs repair, retain
history and add a forward migration. No live POS, supplier, customer-data,
deployment, or production acceptance is claimed. B5 must separately collect
and accept the complete M4 evidence before B6/Clover work.
