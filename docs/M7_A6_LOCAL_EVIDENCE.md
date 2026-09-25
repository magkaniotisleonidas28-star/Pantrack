# A6 independent M7 core — local evidence

Recorded 2026-09-25 on `workstream-a/a6-calculator-20260925`. This is local
development evidence for checklist item A6, not M7 acceptance.

| A6 outcome | Local evidence |
| --- | --- |
| Versioned replenishment settings | `0014` creates an empty company/product-scoped history. `replenishment-settings-d1.mjs` proves authorized manager writes, immutable earlier versions, replay-safe change IDs, conflict handling, tenant isolation, and preservation of legacy inventory rows. |
| Exact review calculation | `replenishment-proposal.mjs` covers confirmed incoming, whole packs, capacity, shelf-life and maximum caps, minimum/order-multiple conflicts, stale/missing counts, expiry status, sales-health fixtures, and exact price arithmetic. |
| Frozen source snapshot | `replenishment-review-d1.mjs` reads active exact stock and saved settings, records their versions, uses only same-company fictional sales/supplier/price fixtures, detects changed sources during the read, and makes no writes. The snapshot records SKU, mapping version, pack quantity, estimate, and explanation. |
| Supplier grouping | `replenishment-review-group.mjs` groups one company's frozen lines by supplier/account/location, rejects duplicate products, keeps currencies separate, sums exact minor units, and counts unpriced lines. |

## Verification in this worktree

- TypeScript `tsc --noEmit`: passed.
- `scripts/test.mjs`: 25 suites passed.
- `scripts/check-migrations.mjs`: 15 ordered migrations matched schema and applied to fresh SQLite.
- `scripts/run-framework.mjs build`: passed.
- Local Wrangler D1 migration apply: passed; no migrations pending in this worktree.
- `scripts/local-smoke.mjs`: passed local HTTP authentication, company isolation, and sign-out checks.
- `git diff --check`: passed before commit.

`0014` is additive and has no backfill. Its SQL, journal, snapshot, fresh-database
application, legacy-row compatibility, and immutable-history triggers were
reviewed locally. The [A6 core notes](M7_A6_CORE_NOTES.md) describe rollback by
restoring a pre-migration local database snapshot and forward repair after any
settings history has been written. Remote migration and restore were not tested.

## Boundary and next work

All A6 output remains review-only. Supplier mappings, prices, and sales health
are fictional fixtures; lot-level expiry is flagged as unchecked. There is no
proposal API, persistent proposal, reservation, supplier call, schedule, or
purchase action in A6. A7 owns durable lifecycle, invalidation, audit, and the
A-to-C contract. A8/M7 acceptance awaits reliable M5 inputs and its own
concurrency and end-to-end evidence.
