# A8 durable Clover proposal safety — local evidence (2026-09-29)

**Outcome:** the A7 origin/lifecycle can now store a review-only v2 proposal
when the company's Clover sandbox sales health is current. A database predicate
checks the same merchant, sync checkpoint, successful sync time, enabled policy,
freshness, and absence of held Clover sales in the `INSERT` itself. A change
between calculation and insert rejects the origin with `source_changed`.

On each lifecycle read, a changed source adds one durable, audited invalidation
event, moves a draft to review required, and warns the A-to-C handoff that the
source is unavailable. Edits carry the same predicate in their single database
`UPDATE`, so a change after the read cannot silently save an edit. Repeated reads
do not create duplicate audit events. A missing sales policy fails closed for a
v2 origin; existing fictional v1 origins retain their prior behavior. The v2
sales-health snapshot now includes the merchant ID so a merchant switch with an
unchanged checkpoint cannot appear current. Person C's fake consumer validates
the expanded v2 shape and continues to hold it without a supplier call.

This is **invalidation on access**, not a background watcher. A paused, stale,
unknown, or held Clover source can still produce a transient read-only review
snapshot; it cannot be stored by `createWithClover`. Existing saved proposals
can be canceled after invalidation. Supplier mapping and price remain fictional,
and all handoffs still say `supplierSubmissionAllowed: false`.

## Verification

- Focused `scripts/test.mjs a8-clover-review-contract`: passed. It uses fresh
  local SQLite with all 18 migrations and checks authorization, company
  isolation, create replay, a checkpoint change during insert, a checkpoint
  change during edit, merchant switch, paused sync, held sale, one audit event,
  stale-edit rejection, and zero supplier calls.
- TypeScript `tsc --noEmit`: passed.
- Full `scripts/test.mjs`: passed, 32 suites.
- `scripts/check-migrations.mjs`: passed, 18 ordered migrations.
- `scripts/run-framework.mjs build`: passed.
- Wrangler D1 migrations applied all 18 to this worktree's **local** database.
- `scripts/local-smoke.mjs`: passed local auth and company-isolation checks.

No new migration, remote D1 change, deployment, Clover request, or purchase was
made. This test is local fictional evidence, separate from [B7's accepted
sandbox evidence](M5_B7_SANDBOX_EVIDENCE.md). Development D1 still needs a
separate authorized application of A7 migrations `0016` and `0017` before a
hosted durable proposal flow can run. A8 also needs an authenticated API/UI,
served and hosted end-to-end proposal tests, and hosted concurrency evidence.
Revert this code commit to roll back the local change; no database repair is
needed. The C4 handoff owner must carry the required v2 merchant ID in future
consumer changes.
