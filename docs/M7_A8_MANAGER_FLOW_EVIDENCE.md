# A8 manager proposal flow — local evidence (2026-09-29)

**Outcome:** a manager or owner can list saved v2 Clover-backed reviews and use
the gated proposal API to create, edit, or cancel one. The UI shows the saved
quantity, status, source warning, handoff warnings, and audit history. Every
write is company scoped and uses a stable client change ID for retry. The
server derives the actor, Clover sync policy, and explicitly fictional supplier
fixture; the browser cannot supply a sales source, supplier account, or price.

Create uses `D1ReplenishmentProposalOrigins.createWithClover`; edit and cancel
use `D1ReplenishmentLifecycle`. The earlier [durable safety evidence](M7_A8_DURABLE_CLOVER_SAFETY_EVIDENCE.md)
tests current-source creation, a changed checkpoint during insert/edit,
on-access invalidation, merchant switch, paused sync, held sale, and the
review-only C4 handoff. This API adds no supplier submission path. It is dark
when exact-inventory preview is off.

## Verification

- Focused `scripts/test.mjs m2-security`: passed. It verifies anonymous,
  wrong-company, employee, cross-site, preview-off, and manager access for
  saved-proposal routes. A manager's attempt with missing settings returns a
  conflict and writes no origin. With fictional current Clover rows and exact
  settings, it exercises preview, create/retry, list, edit, and cancel through
  the authenticated route; one origin and audited revisions remain.
- TypeScript `tsc --noEmit`: passed.
- Full `scripts/test.mjs`: passed, 32 suites.
- `scripts/check-migrations.mjs`: passed, 18 ordered migrations.
- `scripts/run-framework.mjs build`: passed with both A8 routes.
- Wrangler applied all 18 migrations to this worktree's **local** D1.
- `scripts/local-smoke.mjs`: passed general served auth and isolation. It did
  not exercise a positive saved-proposal browser flow.

This is local fictional evidence. A served browser create/edit/cancel walkthrough
and hosted end-to-end/concurrency checks remain unverified. The source policy
is a provisional 10-minute development rule and needs review for A8 acceptance.
Development D1 still requires separately authorized A7 migrations `0016` and
`0017`; no remote D1 change, Clover request, supplier call, or purchase was
performed. No new migration was added. Reverting this code commit removes the
manager API/UI without requiring database repair.
