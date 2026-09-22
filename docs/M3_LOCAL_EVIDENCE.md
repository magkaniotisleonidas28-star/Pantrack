# M3 local implementation evidence

Latest A2 handoff status: [approved local handoff](A2_B_CONSUMER_REVIEW.md),
2026-09-21. Independent review found no blocking issues and the project owner
approved A2. Reviewed changes still need a commit; A4/M3 remain incomplete.
Earlier sections below retain their historical status.

Latest A4 slices: [recipe draft/activation service](M3_RECIPE_LOCAL_EVIDENCE.md)
and [modifier draft/activation service](M3_MODIFIER_LOCAL_EVIDENCE.md) are
locally tested, including immutable history, manager permissions and concurrent
sales/activation. The later [configuration/count writers](M3_COUNT_CONFIGURATION_LOCAL_EVIDENCE.md)
are also locally tested. Full runtime cutover remains unfinished.
The later [gated exact-stock preview](M3_EXACT_PREVIEW_LOCAL_EVIDENCE.md)
adds a manager route and screen for new products only. Migrated product cutover
and B4 sales integration remain open.

Updated: 2026-09-19. Workstream A. M3 is not accepted.

## A4 task packet: exact quantity and target calculations

Objective: implement the pure quantity behavior from
[A1's accepted decision](decisions/0002-m3-quantity-and-recipe-model.md), with
acceptance examples suitable for the later inventory service.

Context: A2's consumption contract and A3's additive data structures exist in
the working tree. Their focused tests pass. The
[current status](CURRENT_STATUS.md) still records pending M2 acceptance, and
Person B's A2 review has not been recorded. The roadmap's wave 0 allows pure
quantity logic and fixtures while those prerequisites are open.

Constraints: work directly on main per the owner's instruction; preserve the
existing A1-A3 changes; stay in A-owned calculation/test files; leave API/UI
integration and shared-contract changes for their reviewed handoffs. No new
migration, external provider call, or deployment is part of this slice.

Completion criteria: exact parsing/conversion and target examples pass focused
tests, the full test suite and type checks; document calculation semantics and
remaining integration work.

## Implemented behavior

- [inventory-quantities.ts](../src/lib/inventory-quantities.ts) accepts decimal
  strings, uses bigint arithmetic, and emits canonical integer strings. Mass and
  volume have six decimal places; counts accept integer text only. Unsupported
  syntax, negative zero, excessive precision, and signed 64-bit overflow fail.
- Curated unit IDs resolve to frozen exact rational definitions. US customary
  volume units derive from A1's exact gallon, and mass ounces from its pound.
  Conversion rounds once, half away from zero. Fractional each results fail.
- Custom definitions retain company, product, ID, and version. Conversion
  verifies company/product scope and an optional expected dimension. A new
  definition does not mutate the old one. Persistent version sequencing and
  safe configuration changes are still service responsibilities.
- Target examples subtract on-hand and incoming quantities exactly, round
  shortfall up to whole purchase packs, and round capacity/shelf limits down.
  A shelf limit is an already-reviewed maximum total usable stock quantity;
  forecasting it and the remaining M7 proposal policies are outside this module.
- An opening count is required before suggesting packs. A stale count retains
  the arithmetic with a `stale_count` review reason. Consumers must honor review
  reasons before accepting a recommendation. This pure function grants no
  permission to order and does not replace the current UI's calculator.
- The A2 fake's lower bound now includes `-9223372036854775808`, matching A1's
  signed 64-bit range. Its regression test checks atomic rejection of a further
  deduction. The A2 request/result contract is unchanged.

## Local verification

[inventory-quantities.mjs](../tests/inventory-quantities.mjs) checks A1's pound,
gallon, and case examples; malformed values; signed rounding; bounds; scoped
custom units; cross-dimensional rejection; incoming stock; zero target; whole
packs; capacity/shelf caps; missing/stale counts; and arithmetic above
JavaScript's safe integer range.

Checks run in this worktree (using the bundled Node/pnpm runtime):

- PASS: `node scripts/test.mjs inventory-consumption-contract m3-data-foundations`
  before implementation.
- PASS: `node scripts/test.mjs inventory-quantities` after implementation.
- PASS: `node scripts/test.mjs` (10 suites, including migration drift/fresh
  application, legacy compatibility, and the signed-minimum regression).
- PASS: `pnpm typecheck` and focused ESLint for both changed TypeScript modules.
- PASS: `pnpm build`.
- PASS: diff/whitespace review and relative documentation link checks.
- NOT RUN: local D1 migration and HTTP smoke test for this calculation-only
  slice; it adds no schema, endpoint, UI, or runtime integration.

The existing A2/A3 suites cover consumption behavior through a fake and migration
compatibility through SQLite. They do not prove a persistent M3 service exists.
No real provider acceptance or deployed behavior is claimed.

## Remaining A4 work and gates

1. Record M2 acceptance and Person B's review of the A2 contract. Obtain migration
   review of A3 before integration; passing compatibility tests is local evidence.
2. Implement the persistent company-scoped inventory service: atomic writes,
   safe configuration changes, immutable recipe/modifier activation, historical
   version selection, count cutoff/variance history, and durable idempotency.
3. Route inventory and manual sales writes through that service with explicit
   occurrence times, preserving the legacy projection during cutover. Reconcile
   legacy records changed after A3's one-time backfill before authority switches.
4. Add manager UI for classification, versioned recipes/modifiers, count timing
   and reconciliation, plus anonymous/wrong-company/forbidden-role and concurrency
   tests. Connect exact target explanations and reviewed limits.
5. Run the full local pipeline and A5 acceptance handoff. Leave A4/M3 unchecked
   until the complete behavior and required evidence exist.

Rollback for this slice: the calculation module has no runtime caller and makes
no database writes. Reverting its integration-free source/tests does not alter
inventory or history. A3 remains additive; any later deployed schema repair must
be a new migration.

## A4 follow-up: atomic inventory persistence (2026-09-21)

Outcome: the internal saving layer is complete locally against a SQLite-backed
D1 batch harness. A4 and M3 remain incomplete. This section supplements the
earlier calculation evidence; it does not replace its historical results.

### Task contract and implementation

Objective: persist an already-resolved sale's ingredient deductions, application
receipt and audit events together, with company isolation, duplicate protection
and rejection of stale balance snapshots. Use existing A3 tables; add no schema,
route, UI, external calls or changes to B's shared consumption contract.

- [D1 inventory store](../src/lib/d1-inventory-consumption-store.ts) binds every
  read/write to a server-selected company. A mismatched application is rejected.
- A single batch saves the application, exact balances, estimated usage and
  ingredient events. A failed ingredient update forces the entire batch to
  roll back. A stale plan must be reloaded and recalculated as a whole.
- Updates compare the original configuration, dimension, quantity, usage,
  version and count cutoff. Concurrent duplicates return the original saved
  result; a reused key with different canonical input reports a conflict.
- All arithmetic uses integer text and bigint, including range checks. The
  existing recipe-selection result is retained with the application for audit.
- [Store tests](../tests/inventory-consumption-store.mjs) exercise two companies,
  two ingredients, duplicate and conflicting concurrent calls, competing sales,
  rollback after a later ingredient changes, count cutoff changes, malformed
  arithmetic, injected database failure, large quantities, overflow, empty
  deductions, and replay through a new store instance.

### Boundaries and downstream handoff

This is an internal repository, not an implementation of `InventoryConsumptionPort`
and not a browser/API input boundary. It trusts the future server-side planner to
resolve valid recipe/modifier versions and supply a canonical request fingerprint.
The planner must check saved applications before recalculating a retry, enforce
configuration classification and recipe eligibility, and handle concurrent
recipe/configuration activation safely. Authentication and role checks belong
before the store; there is no new endpoint in this slice. Existing authorization
tests passed, but do not establish authorization for a future integration.

No runtime route imports this store. Legacy balances are unchanged by this code.
Before cutover, complete the A2 consumer and A3 migration reviews, implement the
planner and safe configuration/count services, reconcile legacy writes since
backfill, and test the actual D1 batch path. Then integrate authorized routes and
manager screens. M2 acceptance remains required for M3 acceptance.

### Verification in this worktree

- PASS: `node scripts/test.mjs inventory-consumption-contract m3-data-foundations`
  as the pre-change baseline, using the bundled Node runtime.
- PASS: `node scripts/test.mjs inventory-consumption-store`; rerun after adding
  the final large-number, conflict and zero-deduction cases.
- PASS: `node scripts/test.mjs` (14 suites); the later test-only additions passed
  the focused rerun above.
- PASS: `pnpm typecheck` and
  `eslint src/lib/d1-inventory-consumption-store.ts`.
- PASS: `pnpm db:check` (11 migrations), `pnpm build`.
- PASS: `pnpm db:migrate:local`; existing migrations 0008–0010 applied to the
  local placeholder database. No new migration was created or remote DB touched.
- FAIL: `pnpm test:local`: the Worker stops before serving requests with
  `Compatibility flag specified multiple times: nodejs_compat`. The existing
  `vite.config.ts` local override and `wrangler.jsonc` both specify this flag.
  These files were not changed. Hand off startup configuration diagnosis to C1.
- PASS: diff whitespace review and all relative links in this evidence file.

The sandbox initially blocked compiler/Worker process startup with `EPERM`;
approved local reruns produced the results above. The new persistence behavior
was tested using SQLite transactions behind a D1-shaped adapter, not a live D1
service. Local migration success does not prove the new store's actual D1 path.
No hosted CI, external provider, pilot, deployment or production evidence is claimed.

Rollback: remove the unused store and its test; no runtime data is affected.
Do not reverse or edit existing migrations applied during local verification.
Next A4 slice: implement the server-side consumption planner over persisted
recipe/modifier versions and this store, with sale-time selection and retry tests.

## A4 follow-up: persisted consumption planner (2026-09-21)

Outcome: the internal consumption port now selects persisted recipes/modifiers,
calculates deductions and commits through the preceding saving layer. Complete
locally in the SQLite D1 harness; A4/M3 acceptance and API cutover remain open.

### Task contract and implementation

Objective: implement the existing A2 request/result interface over A3 data,
selecting versions at sale time and preserving whole-sale atomicity and durable
replay. Preserve all preceding uncommitted work. Stay in A-owned source/tests
and this evidence file; no migrations, routes, UI or live service changes.

- [Consumption port](../src/lib/d1-inventory-consumption.ts) binds company and
  actor in its server-side constructor, validates requests, and reads saved
  applications before loading current inventory. An identical retry returns
  the original result even if recipes or physical counts have since changed.
- [Shared engine](../src/lib/inventory-consumption-engine.ts) contains the rules
  previously in the fake. The [fake module](../src/lib/inventory-consumption-fake.ts)
  retains its published names through aliases; B's interface and tests remain
  compatible. Runtime code does not import the fake. Extraction also adds
  structural request checks and rejects invalid stored version statuses.
- [Snapshot query](../src/lib/inventory-consumption-snapshot.ts) reads the
  requested recipe lineages, their ingredients/modifiers and referenced stock
  configurations/units/balances in one company-scoped SQL statement. Ordered
  JSON is compared again inside the application insert transaction. Any change
  invalidates the entire calculation, including a plan with zero deductions.
- The store's optional snapshot guard preserves its existing callers. The new
  port always supplies the guard. It retries a stale whole-sale plan up to three
  attempts, then raises a retryable storage error without claiming the sale key.
- Legacy recipes and drafts cannot serve as sale recipes. Unclassified units,
  missing versions/counts, incompatible quantities and negative modifier totals
  produce review holds; no partial deductions or claimed keys are saved.

### Local proof and remaining boundaries

[Service tests](../tests/inventory-consumption-service.mjs) prove delayed and
boundary-time recipe selection, modifier totals, durable replay through another
port instance, equivalent timestamp replay, conflict rejection, two-company
isolation, simultaneous deliveries and distinct sales, held-then-repaired input,
and snapshot invalidation during recipe/unit/count edits. They also cover zero
deductions, negative substitutions, invalid dates/structure, corrupt version
status and bounded retry exhaustion. Existing A2 and B tests still pass.

The harness uses SQLite transactions with a D1-shaped adapter, not a Worker D1
binding. No new HTTP endpoint exists, so anonymous and role denial at a future
route are not proved here. The caller must authorize the company and actor;
constructing this internal port is not authentication. Existing API security
suites passed as regression evidence only.

The snapshot intentionally includes all versions for requested recipe lineages.
Unrelated edits within those lineages can cause conservative retries; actual D1
execution limits and larger-history performance need verification before route
integration. Corrupt version intervals/status fail closed as errors. Safe recipe
activation, count/configuration writers and legacy reconciliation are still
required, as are M2 acceptance and the A2/A3 handoff reviews.

### Verification and handoff

- PASS: `node scripts/test.mjs inventory-consumption-store inventory-consumption-contract`
  before implementation (after approved rerun for sandbox compiler `EPERM`).
- PASS: `node scripts/test.mjs inventory-consumption-service` during development
  and again after the final invalid-status guard/test.
- PASS: `node scripts/test.mjs` (15 suites), including fresh migrations and schema
  validation. This full run preceded only the final invalid-status guard, which
  passed the focused service rerun above.
- PASS: `pnpm typecheck`, focused ESLint on all five touched inventory modules,
  and `pnpm build` before that final guard.
- PASS: final diff whitespace check and relative links in this evidence file.
- NOT RERUN: local migration application (no schema changes) and HTTP smoke test.
  The preceding slice's startup failure from duplicate `nodejs_compat` remains
  unresolved and belongs to C1; no successful startup is claimed for this slice.

No remote database, deployment, provider, production or pilot action occurred.
Rollback: remove the unused port/snapshot guard and restore the preceding fake;
the extraction and planner introduced no runtime writes or schema changes.
The shared A2 contract is unchanged; B should review the preserved fake exports
and new port before future B4 integration. The later
[recipe lifecycle](M3_RECIPE_LOCAL_EVIDENCE.md) and
[modifier lifecycle](M3_MODIFIER_LOCAL_EVIDENCE.md) slices now provide internal
draft/activation services. Count reconciliation, authorized routes and manager
screens remain later A4 work.
