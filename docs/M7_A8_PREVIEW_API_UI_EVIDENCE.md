# A8 read-only proposal preview — local evidence (2026-09-29)

**Outcome:** managers and owners can request an explainable Clover-backed v2
proposal snapshot from an authenticated, read-only API and view its arithmetic
in the exact-inventory preview. The API checks company access and product
ownership on the server. Anonymous, wrong-company, and employee requests are
denied. The route is dark when the existing exact-inventory preview gate is off.

The preview reads exact inventory, versioned planning settings, and company
Clover sales health. It shows target, on hand, confirmed incoming, shortfall,
pack size, limits, whole-pack recommendation, sync checkpoint, held count, and
review reasons. The route supplies an explicitly fictional, unmapped supplier
fixture and no price; the screen labels those values unverified. It uses the
server's Clover sync gate and a provisional 10-minute freshness limit for this
local preview. A missing source returns an unavailable reason. No proposal is
saved, edited, approved, or sent from this screen.

## Verification

- Focused `scripts/test.mjs m2-security`: passed. The route test covers
  anonymous, wrong-company, employee, preview-off, and manager requests with
  missing planning settings.
- TypeScript `tsc --noEmit`: passed.
- Full `scripts/test.mjs`: passed, 32 suites.
- `scripts/check-migrations.mjs`: passed, 18 ordered migrations.
- `scripts/run-framework.mjs build`: passed and included the new API route.
- Wrangler applied all 18 migrations to this worktree's **local** D1.
- `scripts/local-smoke.mjs`: passed the general served auth and isolation check.
  It did not exercise the new preview screen end to end.

This is local fictional evidence. No remote D1 change, deployment, Clover
request, or supplier call was made. [B7's sandbox record](M5_B7_SANDBOX_EVIDENCE.md)
is separate. The [durable A8 safety path](M7_A8_DURABLE_CLOVER_SAFETY_EVIDENCE.md)
is not yet exposed for saving/editing in this API. A8 still needs a reviewed
freshness policy, a served proposal walkthrough, hosted end-to-end and
concurrency evidence, and the separately authorized development D1 application
of A7 migrations `0016` and `0017`. The preview can be rolled back by reverting
this code commit; it adds no schema or persisted data.
