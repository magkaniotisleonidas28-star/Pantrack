# A4 modifier draft and activation evidence

Date: 2026-09-21
Outcome: modifier lifecycle service complete locally in a SQLite-backed D1
harness. A4 and M3 remain incomplete. No API/UI cutover or external acceptance
is claimed.

## Task contract

Implement one A4 slice: let a company owner or manager create and edit an
unpublished extra or substitution, activate a version, and archive it without
changing what an earlier sale meant. Use the existing A3 tables and A1 quantity
rules. Preserve existing uncommitted A2/A4 work. No migration, B-side contract,
live provider, deployment, or current screen change is part of this slice.

Completion requires signed exact ingredient changes, immutable published
contents, atomic lifecycle/audit writes, server-side membership checks,
historical selection through the consumption port, and failure/race tests.

## Behavior and files

- [Modifier service](../src/lib/modifier-version-service.ts) offers `inspect`,
  `saveDraft`, `activate`, and `archive`. Callers supply the latest inspection
  token for each write. Changes to relevant modifier, base recipe, unit,
  configuration, or applied-sale data make an old token fail instead of silently
  overwriting newer state.
- A modifier belongs to one company's base recipe. Only owner/manager members of
  that company may inspect or change it. Membership is checked again inside the
  write transaction. No caller-provided role is trusted.
- Positive deltas add ingredients, such as 0.5 g of coffee for an extra shot.
  Negative deltas remove them, such as taking out 2 g of milk in an oat swap.
  Values use exact unit conversion. Zero, unclassified, retired, wrong-product,
  duplicate-ingredient, or incompatible amounts are rejected.
- Draft values may be edited. Published values and names cannot be edited.
  Activation closes the old active interval and starts the new one using the
  server clock. Archiving closes the active interval. Both leave past versions
  intact for sale-time selection. A reviewed active base recipe is required
  before activation.
- Activation cannot backdate over an already applied sale. A sale arriving
  during activation invalidates its snapshot and forces a reload. If a signed
  substitution would make total ingredient use negative, the consumption port
  holds the whole sale for review without changing stock.
- Each successful mutation writes a `security_audit` record in the same batch.
  A failed write rolls back both the modifier change and its audit record.

## Local proof and limits

[Modifier tests](../tests/modifier-version-service.mjs) cover anonymous,
forbidden-role and other-company denial; draft edits; an extra and a
substitution; immutable history; old/new sale-time selection through the actual
internal `D1InventoryConsumptionPort`; archive holds; invalid amounts; negative
combined consumption holds; stale editors; competing activations; changed
membership and units; injected database failures; and a sale racing activation.
The test database passes its foreign-key check.

- PASS: `node scripts/test.mjs modifier-version-service` after the final extra
  test (1 suite).
- PASS: `node scripts/test.mjs` before that final test-only addition (17 suites,
  including the modifier suite, schema/fresh migration checks and older contract
  tests).
- PASS: `pnpm typecheck`, focused ESLint on the new service, `pnpm db:check`
  (11 migrations), and `pnpm build`.
- NOT RERUN: local D1 migration or HTTP smoke test. There is no new schema or
  route; the previously recorded duplicate `nodejs_compat` local Worker startup
  issue remains unresolved.

These tests use SQLite transactions behind a D1-shaped adapter. They do not
prove actual Cloudflare D1 execution, route authorization, current-screen
behavior, hosted CI, a live POS, or production behavior. The service has no
runtime route caller. Its history guard intentionally compares the company's
unit/configuration catalogue and relevant sale records, which may cause
conservative conflicts and needs actual-D1 size/performance review before
integration. Independent security review is still needed for this A4 service;
the earlier A2 approval does not cover it.

## Handoff

No migration or shared A2 contract changed. Rollback is removal of this unused
service and its focused test; no runtime data requires repair. Existing A2/A4
work remains untouched. The next unblocked A4 slice is the safe configuration
and physical-count writer, including cutoff and variance history. Legacy-data
reconciliation, manager UI, route cutover, M2 acceptance, A3 review and A5
handoff remain open. No milestone checkbox was changed.
