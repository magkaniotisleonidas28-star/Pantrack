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

This is one read-only source component. The existing A6/A7 proposal snapshot
and Person C handoff still accept **fictional** sales-health fixtures; this
result is not passed into a proposal, shown in an API/UI, or a basis for
supplier submission. Integrating the new source requires an explicit A-to-C
contract update and source-change validation. No M7 acceptance is claimed.

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
Rollback is removal of this unused read-only module and its test; there is no
schema or persisted-data change. The next A8 slice is to carry a real sales
health result through a versioned review-only proposal contract, with
source-change and A-to-C consumer tests, before hosted proposal testing.
