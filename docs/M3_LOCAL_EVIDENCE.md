# M3 local implementation evidence

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

## Remaining work recorded after the calculation packet

This list records what was still open at the end of that earlier packet. The
A4 implementation items below are completed by the later completion packet;
A5's external/prerequisite gates remain open.

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
5. Run the full local pipeline and A5 acceptance handoff. At this packet point,
   A4 and M3 remained unchecked pending the complete behavior and evidence.

Rollback for this slice: the calculation module has no runtime caller and makes
no database writes. Reverting its integration-free source/tests does not alter
inventory or history. A3 remains additive; any later deployed schema repair must
be a new migration.

## A4 task packet: persistent inventory-consumption port

The first A4 integration packet adds a D1-backed implementation of the published
`pantrack.inventory-consumption.v1` port. It selects immutable recipe and modifier
versions at the sale occurrence time, enforces the latest physical-count cutoff,
and applies every product change plus its application/event history through one
transactional D1 batch. A company-scoped application key permanently identifies
the result, so exact retries return the stored result and changed input returns
`idempotency_conflict`.

The implementation also maintains an existing legacy inventory JSON projection
from the exact balance during the compatibility window. It fails closed on
invalid persisted quantities, activation intervals, conversions, or application
results. Held and rejected requests write nothing.

Focused local coverage proves sale-time version selection, modifiers, negative
modifier holds, missing configuration and count holds, cutoff enforcement,
cross-company isolation, concurrent duplicate safety, restart replay, legacy
projection updates, injected transactional rollback, and corrupt-result denial.
This module is not yet called by an HTTP route, so existing manual, CSV, bridge,
and inventory behavior remains unchanged pending the remaining A4 management
service/UI work and the B4 cutover.

Checks run for this packet:

- PASS: focused A2, D1 consumption, A3 migration, and B2 ingestion suites.
- PASS: focused ESLint and `pnpm typecheck`.
- PASS: `pnpm test` (14 suites), `pnpm db:check`, and `pnpm build`.
- PASS: `pnpm db:migrate:local` (no pending migrations) and `pnpm test:local`.
- PASS: `git diff --check`.

Rollback for this packet removes the unused port and its tests; it has no route
caller and added no migration. Any application written after a future cutover is
immutable and would require a forward repair rather than history deletion.

## A4 completion packet: persistent management behavior and gated UI

Updated: 2026-09-20. A4 is implemented locally. A5 and M3 acceptance remain
open because M2's external acceptance and the A-to-B handoff review have not
been recorded.

The D1 inventory management service now owns exact unit classification,
versioned pack conversions, stock movements, physical counts, reconciliation
history, recipe drafts/activation/archive, and modifier
drafts/activation/archive. It uses company-scoped conditional writes and D1
transactional batches. Repeated operation identities replay only identical
input; changed input conflicts. A lost configuration or balance comparison
rolls back instead of leaving an active projection or dead pending version.

Same-dimension configuration changes preserve canonical balances. Initial
classification and any otherwise-permitted dimension change require a fresh
opening count. A dimension change is rejected after a count, movement, incoming
stock, or recipe reference. Custom conversion changes create new immutable unit
versions. Counts require an explicit non-future effective time later than every
existing movement/count, preserve the pre-count estimate and signed variance,
and reset accumulated estimated usage.

Migration `0011_slimy_vargas.sql` adds one-active-version constraints and
reviewed SQLite triggers that make activated recipe/modifier rows and their
ingredient/delta children immutable while still permitting forward-only
active-to-archived transitions. The upgrade fixture applies `0000` through
`0010`, seeds existing exact data, applies `0011`, and proves all prior rows are
byte-for-byte unchanged before exercising the new constraints. Fresh database,
snapshot, journal, foreign-key, and integrity checks pass.

The inventory route exposes the exact service only when
`PANTRACK_EXACT_INVENTORY_PREVIEW` is exactly `enabled`; absence or any other
value keeps the existing API and UI behavior. The preview gives owners and
managers classification, movement/count, immutable recipe, modifier, and
reconciliation controls, plus a compatibility planning tab that explains the
canonical stock position alongside the existing reviewed target/pack result.
Employees have read-only access. Every inventory
mutation is recorded in the security audit. While the preview is enabled,
legacy recipe writes and manual/CSV sales deductions are rejected with a clear
B4-cutover message. Register mappings remain editable, and no bridge, Clover,
manual, or CSV endpoint calls the new consumption port. This prevents old and
new inventory authority from drifting before B4 switches sales ingestion and
inventory consumption together.

Legacy free-text recipes remain unchanged and appear as requiring a reviewed
replacement. Activating a reviewed exact replacement atomically archives the
legacy active version and updates the compatibility projection. Archiving an
exact recipe without replacement removes that active projection while retaining
all normalized history.

### Local verification

- PASS: `pnpm typecheck`.
- PASS: focused ESLint for the exact route, UI, service, contract, gate, and
  quantity module.
- PASS: `pnpm test` (16 suites), including A2 fake and D1 consumption, A3/B3
  migration compatibility, A4 management/migration coverage, legacy sales,
  bridge, Clover, purchasing safety, and M2 security.
- PASS: `pnpm db:check` (12 ordered migrations agree with schema and apply to a
  fresh SQLite database).
- PASS: `pnpm build`.
- PASS: `pnpm db:migrate:local`; local-only migration `0011_slimy_vargas.sql`
  applied successfully with 14 commands.
- PASS: `pnpm test:local`; local home page, authentication fixture, company
  creation, catalog, tenant isolation, and sign-out passed. Only fictional local
  data was used.
- PASS: `git diff --check`.

The A4 contract suite separately proves exact/concurrent duplicate handling,
operation-input conflicts, stale-write rejection, same-dimension preservation,
dimension-change rejection, curated and custom units, count cutoffs/variance,
recipe/modifier immutability, one activation winner, legacy replacement,
archive-without-replacement, restart durability, compatibility projections,
foreign keys, and company isolation. The M2 route suite proves anonymous,
wrong-company, employee-write, CSRF, manager-write, employee-read, audit, dark
gate, and legacy-sales-pause behavior.

Rollback before B4 is to leave the preview variable unset and continue using
the legacy inventory path. Migration `0011` is additive. If it is ever applied
outside local/test environments, rollback remains forward-only: stop using the
exact path and repair schema or data with a new migration; never rewrite or
remove `0011`. No remote migration, deployment, live POS call, customer data,
supplier action, or production credential was used.
