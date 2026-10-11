# C4 supervised practice browser — local evidence

Date: 2026-10-10. Scope: one C4 outcome, supervised fictional supplier sign-in and
read-only cart inspection. C4 and M8 remain unchecked. No hosted, supplier, model,
payment or order access was used.

## Behavior and contracts

`pnpm dev:cart-manager` now services durable human-browser requests before automated
cart work, using separate Node processes and the same private account profile.
The manager can choose **Open practice sign-in**, manually click **Sign in to
practice account** in the separate window, then choose **Close practice browser**
and, when eligible, **Resume preparation**. No real password or supplier account is
needed. **Inspect practice cart** opens ready or held work for reading only.

The manager job API adds UUID/revision-protected `requestBrowser`, `closeBrowser`
and `resume`. Receipts remain minimal; exact pending intents survive a reload in
actor/company/order-scoped session storage. Status exposes bounded session state,
deadline, verification summaries and server-derived eligibility. It never exposes
cookies, fixture tokens, browser profiles, control URLs or raw cart observations.

The default-off, loopback-only `/api/internal/po-cart-browser-session` endpoint uses
scoped `local_browser` credentials, strict schemas, a streaming 32 KiB limit,
private/no-store responses and transaction-time guards. Discovery, claim, opened,
heartbeat, completion/failure and expiry cannot authorize an addition. Fake
credentials cannot use it. Inspection can read invalidated work without restoring
permission, readiness or preparation.

A human session has requested/opening/open/closing/closed/failed/expired states,
exclusive company/supplier/account ownership, a fenced claim, 60-second leases,
20-second heartbeats and an immutable 30-minute deadline. Active human ownership
blocks automated discovery and mutations. Lost access, cancellation and revocation
close automation; expired or unresolved sessions never qualify as successful
closure. Revocation immediately holds a ready cart in the database. An expired
unresolved session also withholds readiness in the manager projection while a
supervisor is unavailable.

Sign-in recovery requires the latest successfully closed sign-in session, zero
attempts, an unstarted/current permission, unchanged source and retained account
ownership. A fresh closing cart must have no duplicates or requested SKU and must
preserve any existing immutable baseline. Resume requeues the same job atomically
with a new fence; it does not create permission or release spending/incoming
commitments. The new worker `verifyBaseline` operation compares a resumed worker's
fresh cart to the immutable server baseline before initializing its private copy.
Every addition still requires a new ephemeral `beginAttempt` acknowledgment.
Attempted or uncertain carts are inspection-only.

Human modes enforce their own proxy and Playwright request rules: sign-in permits
fixture reads and the practice login POST; inspection permits reads only. Additions,
checkout, external origins and unsafe redirects are blocked at both boundaries.
Ready carts are checked on inspection open and close. Mismatch, unreadable carts,
native window closure and expiry hold readiness. Immutable final evidence remains;
new append-only observations explain the later check. An independent watchdog and
request-time access checks stop browser access when a lease/deadline expires, even
while an HTTP retry is stalled.

Closure captures the cart, closes the actual browser, and only then publishes
completion. Private fsynced journals persist HTTP UUIDs and browser lifecycle
markers. Known closure/results replay without another browser call. An
opening/open marker after a crash never relaunches or adopts the prior browser.
Process locks and Chromium's live singleton owner prevent reuse of an active or
orphaned profile. Profiles, journals and fixture material remain ignored and private.

## Migration and compatibility

The migration queue ended at `0031`; additive `0032_po_cart_browser_sessions` adds
three tables, snapshot/journal entries, session/evidence/receipt guards, account
exclusion, revocation handling and the narrowly guarded held-to-queued transition.
No older migration was edited. Wrangler's statement splitter and local migration
apply succeeded. Fresh and populated upgrades preserve all 100 previous tables,
fake readiness/receipts/credentials, and existing browser baseline/final evidence.
Foreign-key and integrity checks pass. The resulting schema has 103 tables.

The first isolated preview apply occurred during development before the final two
revocation triggers were added to this new migration. Those triggers were applied
additively to that private preview database without deleting records or changing
the ledger. Fresh/split upgrade checks and the normal local migration path verified
the final file independently. No remote migration was run.

## Verification

The complete local pipeline passed: `pnpm typecheck`, `pnpm test` (74 suites),
`pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, and `pnpm test:local`.
Focused session/API/migration/client/network suites cover anonymous, forbidden-role
and wrong-company access; fake credentials; transaction-time revocation/source and
permission changes; explicit zero-attempt resume; immutable evidence; duplicate,
requested, changed and unexpected cart items; deadline/lease limits; recovery
journals; private responses; and profile contention.

Run the served fictional acceptance with:

```sh
pnpm dev:cart-browser-worker
# In another terminal, with that profile running:
pnpm cart:browser-session:check
```

Ten served-D1 cases passed (run in bounded case groups): both layouts sign in,
close, resume and produce exact final carts; a retained baseline is reverified by
a different worker; changed ready carts, native closure, uncertain additions,
expiry, cancellation and revocation stop safely; an actual separate process opens
and closes inspection; a killed process recovers without relaunching/adopting its
orphan, and a new request is blocked by the live browser profile. Dropped request,
close, resume, claim, opened, heartbeat and completion responses replay safely.
Stock and retained commitments remain correct. Desktop/mobile screenshots are in
ignored private evidence, with no horizontal overflow. One overlapping fixture
administration run hit local CLI contention; its unrun case passed when rerun.

Existing regressions passed: eight served manager UI cases, seven served-D1 browser
worker cases, 36 local browser worker cases and all 16 original preview scenarios.
The one-command launcher passed actual visible inspection and shutdown/restart
without new additions. Fake-worker, manager-job, authorization and original-preview
HTTP regressions passed. Both internal endpoints returned 404 again under the
ordinary profile, and task-owned test browsers were stopped. Existing manager/API
tests are included in the complete suite. OpenSpec validation
passed all nine changes. Diff, 215 relative documentation links and privacy checks
across 143 changed/new text files passed. These are
local deterministic results, not AI evaluation or supplier compatibility evidence.

## Rollback and next handoff

Stop `dev:cart-manager` and its workers and use the ordinary default-off local
profile. Retain session/job/authorization records, observations, receipts, private
profiles and unresolved exposure. Do not roll back the schema or reset a held cart.
If a browser outlives its worker, close that practice window manually before a new
request; expiry alone cannot reclaim it. The runtime does not automatically adopt
or reconnect to an orphan.

The next unblocked C4 slice is manager reconciliation of attempted/uncertain carts,
with an explicit, audited decision about their retained exposure. It must not retry
an addition or silently reuse permission. Hosted feasibility, real supplier access,
AI evaluation, financial controls, documents, confirmation and receiving remain
separate gates. Purchasing and checkout stay disabled.

The subsequent [reconciliation slice](C4_PO_CART_RECONCILIATION_LOCAL_EVIDENCE.md) now implements that local handoff. Its acceptance/release decisions are separate from inspection and never grant another addition.
