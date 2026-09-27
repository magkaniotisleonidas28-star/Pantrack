# A8 local sale-to-proposal integration slice — 2026-09-26

**Outcome:** one local A8 integration test joins the existing exact inventory
consumption port to the A6/A7 review and lifecycle services on the same SQLite
database. It uses the fictional B7 latte's documented opening balances and
ingredient amounts. It does not use Clover, the hosted B7 company, a real sales
health source, a supplier, or a purchase action.

The test creates a review-only milk proposal before a delayed fictional latte
sale is applied. The sale deducts 200 mL milk, 18 g espresso, and one cup once;
replay changes nothing. Reading the older proposal records one inventory-source
invalidation. It cannot be edited or replaced while its unresolved quantity is
held. After an audited cancellation, two competing create requests produce one
new proposal and one quantity-reserved result. The new snapshot sees the lower
milk balance and recommends two fictional packs instead of one. Both handoffs
forbid supplier submission. A wrong-company actor is rejected. Foreign-key and
SQLite integrity checks pass.

This is a local module integration check. The test's sales-readiness, supplier,
and price inputs remain explicit fictional fixtures. The competing requests run
against one local SQLite connection; this does not establish distributed
concurrency or hosted behavior. The existing A7 tests cover source-change races
and the database reservation triggers separately.

## Verification

- Focused `scripts/test.mjs a8-sale-to-proposal-d1`: passed after the final
  assertions.
- TypeScript `--noEmit`: passed.
- Full `scripts/test.mjs`: passed, 30 suites, before the final assertion-only
  tightening; the focused suite passed again afterward.
- `scripts/check-migrations.mjs`: passed, 18 ordered migrations on a fresh
  SQLite database.
- `scripts/run-framework.mjs build`: passed.
- Wrangler `d1 migrations apply DB --local`: passed all 18 migrations in this
  isolated worktree. No remote D1 changed.
- `scripts/local-smoke.mjs`: failed twice because the Vite dev server did not
  return the home page within its 120-second deadline. It logged startup but
  did not become reachable. The failure is recorded rather than counted as a
  pass; the A8 test itself does not use the dev server.

## Remaining A8 gate

[B7/M5](M5_B7_SANDBOX_EVIDENCE.md) is still open for cancellation/refund,
later paid revision, token refresh, missed-event recovery, disconnect, and
native retry evidence. A8 still needs accepted M5 inputs, a real company-scoped
sales-readiness source, the M7 proposal API/UI path, hosted end-to-end evidence,
and the rest of its concurrency/acceptance review. A8 and M7 remain unchecked.
Development D1 has not applied A7 migrations `0016` and `0017`; this slice
does not authorize or perform that remote change.
