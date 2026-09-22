# A4 recipe draft and activation evidence

Date: 2026-09-21
Outcome: recipe lifecycle service complete locally in a SQLite-backed D1 harness.
A4 and M3 remain incomplete. No API/UI cutover or external acceptance is claimed.

## Task contract

Implement one A4 slice: create/edit unpublished recipe drafts, activate a draft
and archive a recipe while preserving sale-time history. Use existing A3 tables
and quantity rules; preserve all prior uncommitted A2/A4 work. No schema, B-side
contract, live provider, deployment or existing screen changes are in this task.

Completion requires exact ingredient conversion, immutable published contents,
atomic lifecycle/audit writes, server-side membership enforcement, stale-edit
and activation-race tests, and historical consumption through the A4 port.

## Behavior and files

- [Recipe service](../src/lib/recipe-version-service.ts) provides `inspect`,
  `saveDraft`, `activate` and `archive`. Callers pass the most recent inspection
  token to mutations. A stale recipe, unit/configuration change or newly applied
  sale causes a conflict; callers must reload rather than overwrite silently.
- Only draft names and ingredients may be edited. Creating another draft leaves
  previous versions intact. Version numbers are allocated within the guarded
  transaction. Legacy/published versions cannot be edited or reactivated.
- Ingredients use current classified product unit versions and exact conversion
  from entered decimal text. Saving and activation both validate quantities and
  dimensions. Activation checks persisted canonical quantities against their
  entered values; it does not silently recalculate an old draft under new units.
- Activation uses the server clock, closes the previous active interval and
  opens the new one atomically. Archival without a replacement leaves later
  sales held. Overlapping history, backwards clocks and activation at/before an
  already-applied sale are rejected. A same-time sale/activation race is fenced
  by the application snapshot, so saved sales cannot be reinterpreted.
- A verified session's user ID must be supplied by the server. The service reads
  the current company membership and requires owner/manager access; that role
  is checked again inside the write batch. It does not trust a caller-supplied
  role. Anonymous, employee and other-company access tests all reject.
- Existing `security_audit` rows record actor, operation, recipe/version target
  and server time. The audit guard and changes share one transaction; a failed
  ingredient insert or activation rolls back the audit and all recipe changes.

## Verification

[Recipe tests](../tests/recipe-version-service.mjs) cover draft editing, exact
quantities, immutable active/archived ingredients, sale-time boundary selection,
archival holds, stale editors, competing activations, membership revocation during
save, unit changes, invalid quantities, another company's records, database fault
rollback and a completed sale racing activation. Historical selection is exercised
through the actual internal `D1InventoryConsumptionPort`, not a stub planner.

- PASS: pre-change `node scripts/test.mjs inventory-consumption-service`.
- PASS: `node scripts/test.mjs recipe-version-service`, including the final
  activation rollback and simultaneous-sale test additions.
- PASS: `node scripts/test.mjs` (16 suites). This run preceded only the final
  test-harness/test additions, which passed the focused rerun above.
- PASS: `pnpm typecheck`, `eslint src/lib/recipe-version-service.ts`, `pnpm build`.
- PASS: migration validation/fresh-apply tests within the full suite (11 existing
  migrations), final diff whitespace review and changed documentation links.
- NOT RERUN: local migration application (no schema change), and HTTP smoke test
  (the previously recorded duplicate `nodejs_compat` startup issue is unchanged).

The first focused test attempt hit sandbox compiler `EPERM`; the approved rerun
exercised the tests. An early permission-revocation fixture tried to demote the
last owner, which existing M2 constraints correctly blocked. The fixture was
corrected to revoke a manager instead; the transaction-level check then passed.

## Limits, rollback and next step

This service has no runtime route caller. The existing recipe screen still uses
the legacy overwrite path. Immutability is enforced by this service, not new SQL
triggers; all future writes must go through it after reviewed cutover. These
tests use SQLite behind a D1-shaped adapter; actual Worker D1 execution, route
authorization/session plumbing and UI behavior remain to be verified.

The conservative snapshot includes the company's entire unit/configuration
catalogue plus this recipe's history and applied sales. This is safe but can
conflict on unrelated unit changes and needs scaling/actual-D1-limit review
before rollout. Independent security review of this new service is also required
before integration; A2's earlier approval does not cover this new A4 service.

No migration or shared contract changed. Rollback is removal of the unused
service and its tests; no runtime data needs repair. Do not revert preceding
A2/A4 work or rewrite existing migrations.

Next unblocked A4 slice: versioned modifier drafts/activation for extras and
substitutions, including signed ingredient changes and immutable history.
Configuration/count writers, legacy reconciliation, manager UI and M2/A3/A5
acceptance gates remain separate work. No milestone checkbox was changed.
