# A8 Clover sales-readiness source — local evidence (2026-09-29)

**Outcome:** `D1ReplenishmentSalesReadiness` reads the company-scoped Clover
connection, sync checkpoint, last success/error, and held sales-event count
from the D1 structures used by B7. It does not contact Clover or write D1.
Its caller must provide a server-derived actor; the reader rejects missing,
wrong-company, and invalid-role actors before any query. There is no new API.

The caller supplies whether the server's sandbox sync gate is enabled and an
explicit maximum acceptable lag. The result is `current` only for a matching
sandbox merchant with a recent successful sync, no error, no held Clover event,
and an enabled gate. Missing/disconnected/mismatched or invalid sync state is
`unknown`. Paused, stale, failed, or held sync is `degraded`. Held events are
counted across the company's Clover history so reconnecting cannot hide an
older unresolved event. The result includes reasons and timestamps for review.

At the time of this source-only slice, A6/A7 proposals still accepted
**fictional** sales-health fixtures. A later [A8 v2 review slice](M7_A8_CLOVER_REVIEW_CONTRACT_EVIDENCE.md)
passes this result through a read-only proposal and fake A-to-C handoff. No
API/UI or supplier submission uses it. No M7 acceptance is claimed.

## Verification in this worktree

- Focused `scripts/test.mjs a8-sales-readiness-d1`: passed on fresh SQLite with
  all 18 committed migrations. It covered company isolation, no writes,
  current, paused, stale, failed, held, never-synced, disconnected, changed
  merchant, unaccepted environment, and invalid checkpoint cases.
- TypeScript `tsc --noEmit`: passed.
- Full `scripts/test.mjs`: passed, 31 suites, after the final code change.
- `scripts/check-migrations.mjs`: passed, 18 ordered migrations.
- `scripts/run-framework.mjs build`: passed.
- Wrangler D1 migration apply with `--local`: passed all 18 migrations in this
  isolated worktree. No remote D1 changed.
- `scripts/local-smoke.mjs`: passed served local auth, tenant isolation, and
  sign-out checks using fictional data.

The sandbox evidence is [B7's accepted report](M5_B7_SANDBOX_EVIDENCE.md),
not this test: the test uses fictional local connection and sales rows. A7's
development D1 migrations `0016` and `0017` are still a separate remote gate.
Rollback at the time was removal of this read-only module and its test; there
was no schema or persisted-data change.
