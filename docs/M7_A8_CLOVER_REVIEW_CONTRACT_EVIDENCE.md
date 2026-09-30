# A8 Clover-backed review contract — local evidence (2026-09-29)

**Outcome:** a read-only A8 path now uses the company-scoped Clover sales-health
reader in an explainable proposal calculation. Its snapshot and A-to-C handoff
use `pantrack.replenishment-review.v2` and
`pantrack.replenishment-handoff.v2`; existing fictional v1 proposals keep their
original contract. The v2 handoff still has `mode: review_only` and
`supplierSubmissionAllowed: false`. Supplier mapping and price remain
fictional fixtures.

`D1ReplenishmentReview.buildWithClover` reads sales health before calculation
and again after reading inventory and settings. A changed checkpoint, health
status, held count, reason, or last-success time returns `source_changed`
instead of a snapshot. It deliberately ignores the reader's new `checkedAt`
time on the second read. Paused or held sales add proposal review reasons.
The caller must supply a server-derived actor, the server's sync-gate state,
and an explicit freshness limit; no API or UI calls this path yet.

The focused test applies all 18 committed migrations to local SQLite. It checks
the D1 reader → v2 snapshot → v2 handoff → Person C fake consumer path, a
checkpoint and held-sale changes during calculation, paused and held sales, wrong-company and
missing actors, contract/source tampering, zero review writes, and zero supplier
calls. The existing v1 handoff tests still pass. This test uses fictional local
D1 rows; [B7's sandbox record](M5_B7_SANDBOX_EVIDENCE.md) is separate evidence.

## Verification

- Focused `scripts/test.mjs a8-clover-review-contract`: passed.
- TypeScript `tsc --noEmit`: passed.
- Full `scripts/test.mjs`: passed, 32 suites.
- `scripts/check-migrations.mjs`: passed, 18 migrations on fresh SQLite.
- `scripts/run-framework.mjs build`: passed.
- Wrangler D1 apply with `--local`: passed all 18 migrations in this isolated
  worktree; no remote D1 changed.
- `scripts/local-smoke.mjs`: passed local served authentication, company
  isolation, and sign-out checks.

No migration, remote deployment, Clover request, purchase, or supplier call
was made. The durable A7 origin/lifecycle still stores v1 fictional sales
fixtures. Later health changes after a v2 snapshot is returned are **not**
durably tracked by this slice. A8 still needs durable source invalidation,
proposal API/UI, hosted end-to-end and concurrency evidence, and its separate
development D1 migration gate for A7 `0016`/`0017`. Rollback is reverting this
code and documentation commit; no database repair is needed. The A-to-C
handoff change is that C's fake consumer recognizes v2 and continues to hold
it without submission.
