# C4 uncertain-cart reconciliation — local evidence

Date: 2026-10-10. One C4 outcome: explicit manager resolution of attempted or
uncertain fictional carts. C4/M8 remain unchecked. This is local deterministic
browser evidence; no model, Browserbase, hosted supplier, checkout, payment or
order was used.

## Behavior and contracts

Managers inspect the practice cart, choose **Close practice browser**, and then
make a separate decision with a required review note:

- **Accept verified cart** requires the complete exact authorized cart, unchanged
  unrelated baseline items, no duplicate/unexpected items, and the complete-cart
  spending cap. Current authorization and all frozen source guards are rechecked
  inside the decision transaction. It marks the same held job ready while retaining
  its spending reservation, incoming quantities and account ownership.
- **Close abandoned preparation** requires an exact match to the immutable verified
  baseline. It cancels the permission/job and releases spending, incoming commitments
  and account ownership atomically. It retains `startedAt` and all attempts/results;
  on-hand stock, purchase state and delivery state do not change.

Inspection stays read-only. Partial or unreadable carts, missing baselines and
mismatches remain held. No addition/removal operation or automatic retry was added.
Canceled jobs with unresolved exposure can be inspected for abandonment, but cannot
be accepted as ready. Source invalidation can prevent acceptance without preventing
fresh baseline verification and abandonment. A new preparation needs fresh
permission and a new job; attempted jobs cannot resume.

The existing loopback/default-off manager API adds `acceptVerifiedCart` and
`abandonVerifiedCart`, with operation UUID, job/authorization/session revisions,
session identity and a 1–500 character note. Decisions use the latest successfully
closed inspection, matching account fence, no active/intervening session or worker,
and closing evidence less than five minutes old. The inspection credential and
identity must still be active, unexpired and current. Physical browser closure
still precedes completion publication. Lost completion/decision acknowledgments
replay their original receipts; UUID reuse with different input conflicts.

Manager status contains bounded verdicts, freshness and decision summaries. It
contains no raw cart observations, credentials, cookies, session URLs or profiles.
Pending decision intents survive reload in actor/company/order-scoped session
storage. Both new actions are available only in the existing local browser profile.

## Migration and implementation

Additive migration [0033](../drizzle/0033_po_cart_reconciliation.sql), its snapshot
and journal introduce two immutable tables: closed-inspection reconciliation
evidence and explicit manager decisions/receipts. Evidence references the original
private closing observation and the authenticated inspection credential/version.
SQL independently checks positive baseline/final verdicts against entry fields.
An AFTER INSERT decision trigger applies the state changes in the same transaction.
Narrow replacements of authorization, readiness, release and ownership guards
permit only the audited reconciliation paths. Existing fake behavior is preserved.

All migrations before 0033 are unchanged by this slice. The new migration's CASE
formatting was tightened during local development after its first local apply:
whitespace after END separates Wrangler statements. This changes formatting only,
not trigger behavior. Final SQL was separately Wrangler-split and applied to fresh
D1 and fresh/populated SQLite upgrades. The regression now requires each trigger
to occupy its own splitter statement. The migration queue contains 34 migrations
and the schema 105 tables.

Core changes are in the focused [reconciliation service](../src/lib/d1-po-cart-reconciliation.ts)
and [contract/verifier](../src/lib/po-cart-reconciliation-contract.ts). Browser
sessions publish independent closed-inspection verdicts; the manager route, strict
saved-intent parser and existing manager panel expose the two decisions. Worker
credentials gain internal credential/version metadata without exposing it in HTTP.
No worker grants, browser traffic policy or checkout capability were broadened.

## Verification

The complete local pipeline passed: `pnpm typecheck`, `pnpm test` (77 suites),
`pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, and `pnpm test:local`.
Focused reconciliation, API, migration and manager-client checks also passed.

The served-D1 reconciliation command passed six cases across both layouts:

1. Rows: three real browser additions, interrupted last result commit, fresh exact
   inspection, explicit acceptance, lost decision response and reload/replay.
2. Compact: the same exact-cart acceptance with the unresolved result retained.
3. Rows: lost begin acknowledgment creates an attempted but unchanged cart;
   verified abandonment releases exposure without another addition.
4. Compact: an already canceled attempted preparation is inspected and safely
   abandoned; commitments release once.
5. Rows: an interrupted first addition leaves a partial cart; neither decision is
   available and its spending remains held.
6. Compact: invalidated preparation can be freshly inspected and abandoned when
   its baseline is unchanged.

Rows acceptance was also rerun with a lost inspection-completion response; the
closed-browser evidence and explicit decision both replayed safely.

The acceptance script verifies unchanged actual cart contents and inventory,
retained attempt counts, immutable UUID retry payloads, reservations and bounded
manager projections. Desktop/mobile screenshots were inspected with no overflow;
the Impeccable detector returned no findings. Screenshots and logs remain ignored
under `.sites-runtime/po-cart-workers/reconciliation-*`.

Focused tests cover exact stock commitment release with unchanged physical stock,
missing baselines, wrong prices/packs/quantities, unrelated-item changes, duplicates,
unexpected items and spending-cap failures. They exercise five-minute expiry,
competing decisions, active/new sessions, fence loss, native browser closure,
credential/identity revocation, cancellation/source changes and transaction-time
membership loss. Anonymous, employee and wrong-company API requests are rejected;
strict schemas, CSRF, default-off gates and private minimal replay receipts pass.
Direct SQL readiness/release/ownership bypass attempts and forged decisions fail.
Fresh/populated upgrades preserve all previous 103 tables, including fake ready
jobs, credentials, receipts and existing browser baselines/finals/sessions/observations.

Existing regressions passed: separate browser-worker process recovery and fencing;
all eight manager UI cases; all ten supervised sign-in/inspection cases; all seven
served-D1 browser cases; the original 16 preview scenarios; and the worker, jobs,
authorization and original-preview HTTP checks. The one-command launcher opened a
visible inspection browser and preserved its ready cart/journal across restart
without another addition. The original-preview HTTP check initially returned 404
when run against the browser-worker profile; it passed after switching to its
required ordinary preview profile. In that ordinary profile, both internal worker
endpoints and both reconciliation actions returned 404 with the browser gate off.

All nine existing OpenSpec changes validated strictly. Final diff/whitespace,
conflict, privacy and relative-link checks passed across 153 changed/new text files
and 222 relative documentation links; this includes the preserved earlier C4 work.
The local preview/supervisor/worker processes were stopped. Three task-owned orphan
practice Chromium processes from crash regressions were closed, retaining their
private profiles and journals. No remote migration, deployment or supplier action
was performed.

## Rollback and next handoff

Stop the local workers and use the ordinary default-off profile. Retain jobs,
permissions, reconciliation records, private evidence/profiles and unresolved
exposure; do not reset held carts or reverse the schema. A forward repair must keep
both original attempt history and any accepted/released decision. Already released
preparations must never be silently recreated.

The next bounded C4 handoff is Stagehand AI discovery and independent verification
against the fictional storefront, under the existing cumulative model-evaluation
budget. Browserbase/worker budgets and hosted session/privacy feasibility remain
separate prerequisites for paid hosted work. Real supplier permission/access,
financial controls, checkout, documents, confirmation and receiving remain open.
