# PO-backed AI cart integration roadmap

Adopted: 2026-10-09. Workstream C; A owns inventory/proposal truth.
See [decision 0005](decisions/0005-po-backed-ai-cart-preparation.md),
[milestones](PANTRACK_MILESTONES.md), [rollout](PURCHASE_ORDER_ROLLOUT.md) and
[current status](CURRENT_STATUS.md). This is an implementation roadmap, not
completed acceptance. Every numbered step is a separate reviewable outcome;
split larger steps further before implementation. Implementation gates below
remain unchecked until their complete evidence exists.

## Workflow and boundaries

**Weekly PO draft and reminder → manager reviews → AI prepares and verifies cart
→ manager checks out → manager records supplier confirmation → staff record
delivery → manager approves inventory updates.**

POs remain the purchasing record. AI never checks out, recalculates purchasing
needs or interprets a ready cart as a purchase. The manager starts preparation.
Sign-in and checkout are desktop-first; PO review, status and receiving remain
responsive. Keep PDF/native Excel exports and searchable purchasing history.
Supplier email dispatch and its infrastructure are deferred; notification email
is separate. Never automatically fall back to another ordering channel after an
uncertain browser or checkout outcome.

Cloudflare owns authentication, authorization, PO/job truth and state transitions.
A Render Node 22 background worker handles automation through authenticated
internal HTTP endpoints; it receives no D1 credentials. Baldor is the first
supplier candidate, subject to [C3 access gates](C3_BALDOR_PREPARATION.md).
Unrelated sales, Toast, inventory, pilot and security gates remain intact.

## 1. Baseline and feasibility — C4

- [ ] Preserve PO/fictional-cart work and all 16 offline browser scenarios; record the current regression baseline separately from earlier evidence.
- [ ] Add a controlled hosted fictional storefront; a cloud browser cannot reach the computer-only fixture directly. Deployment needs separate authorization.
- [ ] Test Stagehand **4.1.0**, current configured model and Browserbase together before changing SDK versions. Keep deterministic CDP/Playwright operations where the current Stagehand page driver proved unreliable.
- [ ] Extend real-AI evaluation to product discovery and independent cart verification across both layouts and normal, changed-price, unavailable, wrong-pack, ambiguous and malicious-content scenarios.
- [ ] Retain the durable cumulative **$5 model-evaluation ceiling**; reserve conservatively before each call, including uncertain/failed calls. Record a separate Browserbase/worker budget before paid hosted testing.
- [ ] Record exact SDK/model/configuration/storefront versions, cart results, safe holds, interventions, elapsed time, manager effort, token/browser usage and a manual comparison.

**Completion:** recorded results for that exact hosted combination. Missing model
configuration, Browserbase capabilities, hosting or budget block hosted evaluation
only. Offline development continues. Real-AI evaluation remains pending until
local configuration is available; do not run it implicitly with routine checks.

## 2. PO authorization and mappings — C4 with A handoff

- [ ] Connect A's proposals to versioned real supplier/account/location/product mappings; fictional/review-only mappings cannot authorize real execution.
- [ ] Preserve exact requested packs, stock quantities and frozen conversions; hold unknown mappings instead of inventing quantities or non-stock classifications.
- [ ] Separate draft review, preparation authorization and supplier confirmation; retain existing `reviewed` semantics.
- [ ] Bind authorization to the PO revision, connection/profile/mapping versions, supplier account, delivery location, complete lines, currency, estimates and proposed cap. Any change invalidates it.
- [ ] Atomically persist authorization, quantity commitments, duplicate-source protection and spending reservations; unresolved work must suppress duplicate replenishment.
- [ ] Make ordering email optional for browser-enabled suppliers without rewriting historical snapshots or removing supplier records.

**Completion:** only a current, durably authorized PO provides real cart
instructions. Read-only preflight is not a grant or reservation. The initial
[contract slice](C4_PO_CART_CONTRACT_LOCAL_EVIDENCE.md) addresses preflight and
binding only. The [durable fictional slice](C4_PO_CART_AUTHORIZATION_LOCAL_EVIDENCE.md)
now persists permission, A/C commitments and cap reservations with current-source
guards, safe cancellation and replay receipts. This real-execution gate remains
open for production mappings, real owner policies and applicable external evidence.

## 3. Durable application storage — C4

- [ ] Replace preview file receipts with company-scoped supplier connections and private browser-context references; jobs, immutable inputs, attempts, verified results and transition history.
- [ ] Store active account-cart ownership across shared delivery locations, leases/fencing tokens, permanent replay receipts, spending reservations and unresolved checkout exposure.
- [ ] Persist three independent state dimensions below; no browser observation alone confirms a purchase.
- [ ] Use additive migrations; inspect SQL/snapshot/journal, fresh apply, populated upgrade, compatibility and forward-repair plan.

| Dimension | States |
| --- | --- |
| Cart | queued, preparing, sign-in needed, review needed, ready, handed to manager, expired, canceled, failed |
| Purchase | not confirmed, outcome unknown, confirmed, cancellation requested, cancellation confirmed |
| Delivery | outstanding, partially received, received, closed |

**Completion:** reopening Pantrack and restarting the worker preserve jobs,
ownership and uncertainty. Canceling preparation never cancels a supplier purchase.

## 4. Render worker — C4 / C6

- [ ] Add a Node 22 background worker that claims jobs through authenticated Cloudflare endpoints; keep local, hosted-fictional and real modes distinct.
- [ ] Claims use expiring leases and monotonic fencing tokens; stale workers cannot publish results. Heartbeats and events have replay-safe identities.
- [ ] Recheck authorization, current PO revision, connection and company/supplier pause before every mutation. Serialize by company/supplier login/cart, including shared-location accounts.
- [ ] Record attempted writes before calling the browser. A crash or uncertain write stops for review; do not start another browser automatically.
- [ ] Prove duplicate claims, lease expiry, stale workers, out-of-order/duplicate events, temporary errors, restart during handoff and explicit recovery.

**Completion:** competing workers cannot prepare the same account cart.
[Render background workers](https://render.com/docs/background-workers) run
continuously and normally poll for work; Pantrack will use the Cloudflare claim
interface as its authoritative queue boundary. Hosting is not provisioned by this plan.

## 5. Supplier sign-in and session privacy — C4 / C9

- [ ] Owners configure/remove connections; authorized managers use them. Allocate a private Browserbase context per company and supplier login.
- [ ] Managers enter credentials and handle 2FA directly while automation is paused. Never send passwords, codes, payment fields or full account pages to the model.
- [ ] Explicitly disable session recording and browser logging for real accounts; verify actual API settings and provider capabilities before account access. Unavailable privacy controls block real sessions. Audit Stagehand/worker/model logging separately.
- [ ] Authorize Live View link issuance; treat links as sensitive bearer access, prevent caching/logging and terminate sessions on disconnect, revoked permission or expiry.
- [ ] Allow only configured supplier and necessary authentication domains; no restriction bypass. Disconnect terminates sessions, blocks future work and removes stored contexts, preserving purchasing audits. Failed cleanup remains visible for retry.
- [ ] Test tenant isolation, persistent login, expired sign-in, reconnect, explicit termination and deletion.

**Completion:** companies cannot share references or sessions, expired login
creates a sign-in task and disconnect removes future access. Browserbase
[contexts](https://docs.browserbase.com/platform/browser/core-features/contexts)
persist browser data; supplier login can still expire. Recording/logging controls
must be verified through [session configuration](https://docs.browserbase.com/reference/api/create-a-session),
not inferred from defaults.

## 6. First supplier connector — C5 after C3 gates

- [ ] Confirm Baldor permits the proposed access and account testing; use a small, verified product set.
- [ ] Verify signed-in account/location, exact codes, variants/brands and purchase packs; read current availability and prices.
- [ ] Use Stagehand for bounded discovery/extraction; trusted code validates candidates and performs only authorized cart additions. Never issue unrestricted “buy these products” instructions.
- [ ] Preserve unrelated cart items; requested SKUs already present require review. Reconcile known writes before continuing; uncertain writes, substitutions, changed packs/prices, ambiguity and unavailability stop for review.
- [ ] Independently reread the final cart before ready. An AI interpretation is never proof of exact contents.

**Completion:** every ready result matches the PO exactly; unsupported behavior
holds without guessing. Success with Baldor does not establish other suppliers.

## 7. Manager handoff — C5

- [ ] Extend existing PO detail with connection status, Prepare supplier cart, progress, per-line checks, held reasons/recovery, verified Review and checkout, and a post-checkout confirmation task.
- [ ] Show **No order has been placed**, observed item subtotal and separately unavailable/final tax/delivery charges. Reserve authorized exposure before handoff.
- [ ] Stop all automation/model calls before human control; recheck current PO, account/location and cart. AI cannot resume purchasing actions during handoff.
- [ ] Hand off the same hosted browser using interactive Live View. An ordinary supplier link does not transfer this session.
- [ ] Use a maximum 30-minute session with visible expiry warning. Expiry/lost connection after handoff leaves purchasing unresolved, with commitments retained.
- [ ] On phones explain the desktop checkout requirement; keep PO review/status/receiving responsive. First pilot uses existing supplier payment arrangements; new payment setup is excluded.

**Completion:** only the manager checks out and a lost session never becomes
confirmed or safely canceled. [Browserbase Live View](https://docs.browserbase.com/platform/browser/observability/session-live-view)
supports interactive control; provider capability alone is not Pantrack acceptance.

## 8. Confirmation and receiving — A/C, C5

- [ ] Initially record manager-entered supplier evidence with explicit provenance: order reference, account/location, confirmed lines/quantities/prices, charges, expected delivery and private supporting documents.
- [ ] A “checkout completed” action alone cannot establish confirmation. Audit differences from the PO and require reconciliation/renewed approval for changed exposure.
- [ ] Reject duplicate references within the relevant company/supplier/account scope; replayed confirmations/receipts never create incoming or stock twice.
- [ ] Use A's atomic order-linked incoming contract, converting commitments without replacing other incoming quantities.
- [ ] Staff record counts; managers approve exact stock effects using frozen conversions. Account for partial, damaged, substituted, excess and non-stock lines; close only after every line is fulfilled or explicitly resolved.
- [ ] Keep uncertain purchase commitments until reconciled; preparation cancellation does not establish supplier cancellation.

**Completion:** one confirmation and one approved receipt produce inventory
effects exactly once. Damaged/rejected goods add no usable stock; count-cutoff
conflicts hold for review.

## 9. Weekly drafts and operational alerts — C6 / M9

- [ ] Cloudflare Cron checks due schedules every 15 minutes. Require company timezone, weekly day/time, supplier/location and responsible manager.
- [ ] Use unique schedule-occurrence identities for drafts/reminders; handle delayed runs, DST and timezone changes without duplicate catch-up drafts.
- [ ] Generate reviewable drafts from current inventory proposals. The schedule never launches AI/Browserbase; the manager starts preparation and the server revalidates the draft.
- [ ] Provide in-app tasks and notification-provider email reminders; alerts cover expired login, held jobs, unresolved checkout, missing confirmation, overdue delivery/discrepancy and worker failure.
- [ ] Prove scheduling with the website closed, pause behavior, stale inventory, repeated ticks, missed reminders and acknowledgment/escalation ownership.

**Completion:** drafts/reminders run independently of the website and checkout
stays human-controlled. [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
uses UTC triggers; company-local weekly occurrence and DST semantics belong to
Pantrack's scheduler, with explicit tests.

## 10. Documents, history and release operations — C5 / C9

- [ ] Keep searchable PO, cart, confirmation and delivery histories together, including immutable historical versions and exact values.
- [ ] Add PDF and native XLSX exports labeling requested, observed, confirmed and received quantities; protect financial fields and private documents.
- [ ] Add company/supplier pauses, session cleanup, cost tracking, worker health, recovery and support diagnostics without credential access.
- [ ] Document onboarding, connection removal, retention, support access, backup restore and monitoring.
- [ ] Release disabled by default behind company/supplier allowlists only after applicable evidence gates.

**Completion:** managers can explain every order outcome and support can diagnose
failures without credentials. M12 release includes privacy, offboarding and recovery.

## Interface and ownership contract

Add versioned execution data alongside PO draft review; never repurpose `reviewed`.
Future application endpoints cover connections (connect/status/disconnect), cart
jobs (start/status/resume/cancel/handoff), PO preparation authorization,
confirmation/receiving and weekly schedule/reminder settings. Private worker
endpoints cover claim, heartbeat and events. Every mutation uses permanent
replay-safe operation identity and expected revision where applicable; the server
derives company access and actor. These are planned endpoints, not shipped routes.

Owners control connections and spending limits. Managers prepare/reconcile orders.
Employees record delivery counts without restricted finance/connection data.
A owns exact proposals, conversions and atomic inventory effects. C owns execution,
reservations and the server transition boundary; coordinate shared migrations.

## Acceptance test matrix

Routine checks use fictional providers and no model/supplier calls.

| Area | Required evidence |
| --- | --- |
| Permissions | Anonymous, wrong-company, employee denial, owner/manager access, CSRF/cross-origin and revoked membership |
| PO integrity | Changed revision, mapping, quantity, account/location, currency, price, cap and canceled source |
| Duplicates | Double clicks, replays, concurrent jobs, shared supplier login, duplicate confirmations and receipts |
| Worker recovery | Crash before/after write, expired lease, stale/out-of-order events, restart during handoff |
| Cart | Existing/unrelated/requested SKUs, wrong packs, unavailable/changed prices, ambiguity, partial additions, interrupted responses |
| AI boundaries | Malicious page text, invalid/wrong/incomplete output, refusal and exhausted budget |
| Checkout | Zero AI checkout submissions; automation paused for login/handoff; uncertain human outcome unresolved |
| Inventory | Preparation leaves stock unchanged; confirmation adds incoming once; approved receipt adds accepted goods once |
| Scheduling | Duplicate ticks, timezone/DST changes, pause, stale inventory and missed reminders |
| Privacy | No credentials, cookies, live links or payment data in logs, model inputs, exports or other-company responses |

Retain 16 existing browser scenarios and extend the matrix. Use fictional human
checkout to test same-session handoff, reopening, worker restart, cancel/reconcile
and expiry. Review loading, empty, preparing, sign-in, held, ready, handed-off,
expired/error states, keyboard access, both themes, long names and narrow layouts.
Inspect fixture cart state independently; never use AI's report as the verdict.

Hosted-fictional evaluation must exercise both layouts and the six scenarios in
step 1, persistent sign-in, same-session handoff, reconnect/termination and verified
privacy settings. Stop before the budget cannot cover another run. Missing or
partial evaluation remains incomplete. **Zero incorrect ready results, unauthorized
access, duplicate additions or AI checkout submissions** is the supplier-test
safety gate; any failure blocks supplier testing.

## Supplier validation and café pilot

After permitted access, account authorization and budgets are recorded:

1. Verify login, account/location identity and exact small-set mappings.
2. Prepare a cart without purchasing; test sign-in recovery and cart changes without bypassing restrictions.
3. Obtain separate authorization for one low-risk manager checkout.
4. Record supplier confirmation and reconcile delivery.
5. Complete at least two supervised count-to-delivery cycles, including a discrepancy.
6. Obtain manager sign-off on accuracy, usability, recovery and time saved.

M11 depends on its unchanged POS/inventory prerequisites too. M13 supplier APIs
remain optional after production users; M14 AI checkout/unattended purchasing is
a separate explicitly authorized automation project.

## Engineering evidence and release gate

Run focused checks first, then the applicable full pipeline:

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
pnpm cart:check
pnpm cart:check:http
openspec validate --all --strict
git diff --check
```

Verify changed relative links. Schema work additionally needs populated upgrades,
fresh-database results and a forward-repair plan. Keep local/offline,
hosted-fictional, supplier-test, pilot and production evidence separate. Acceptance
requires the complete authorized PO-to-delivery flow, correct history/inventory
and recoverable duplicate/uncertain outcomes.

External dependencies: local model configuration, Browserbase project capabilities,
Render hosting, notification setup, separate approved budgets, supplier permission
and café participation. Never request secrets in chat. Planning does not authorize
deployment, paid testing, account access, supplier contact or purchases.

Rollback disables new jobs/schedules, pauses automation and ends live sessions.
Preserve history and unresolved purchasing commitments for reconciliation.
Durable fictional authorization now has [local evidence](C4_PO_CART_AUTHORIZATION_LOCAL_EVIDENCE.md).
The [durable fictional job protocol](C4_PO_CART_JOBS_LOCAL_EVIDENCE.md) now consumes
those grants through guarded first attempts, exclusive account-cart ownership,
immutable attempt/result history, fenced leases and conservative recovery. Local
fake workers passed; the browser preview remains separate. Authenticated worker
transport now has [local evidence](C4_PO_CART_WORKER_LOCAL_EVIDENCE.md): scoped
hashed credentials, transaction-time revocation, private HTTP and a separate fake
worker with durable retry/recovery journals. The [local browser consumer](C4_PO_CART_BROWSER_LOCAL_EVIDENCE.md)
now uses that transport with immutable baseline/final evidence, private profiles
and conservative recovery. The [manager integration](C4_PO_CART_MANAGER_LOCAL_EVIDENCE.md)
now connects explicit authorization, Prepare, durable status/replay and cancellation,
with `pnpm dev:cart-manager` supervising separate local HTTP browser workers.
The [supervised practice browser](C4_PO_CART_BROWSER_SESSION_LOCAL_EVIDENCE.md)
now adds durable human ownership, private manual sign-in/read-only inspection and
explicit Close/Resume for verified zero-attempt work. Attempted/uncertain carts
now have [audited reconciliation](C4_PO_CART_RECONCILIATION_LOCAL_EVIDENCE.md): explicit
acceptance of a freshly verified exact cart or abandonment after a verified baseline
match, with retained history and atomic exposure release. Local migration `0033`
preserves earlier records. The [optional Stagehand reader](C4_PO_CART_AI_LOCAL_EVIDENCE.md)
now adds evaluation-only discovery and independent baseline/final cart extraction,
with the older and new evaluators sharing one cumulative $5 ledger. Offline checks
and the full local pipeline pass. The single real-model retry passed all six
rows-layout cases, then stopped at compact/normal on an add-response timeout;
40/72 required requests completed. Held work and the cumulative $0.704956
reservations are preserved. The owner reports a $0.04 balance decrease; itemized
billing reconciliation remains pending. The previous task's paid retry is exhausted.
The subsequent bounded offline investigation passed 60 fresh jobs across both
layouts/readers and 0/750/1,500 ms delays, without reproducing or explaining the
interruption. Private diagnostics, readiness/full-matrix budget preflight and
scoped crash-test cleanup are implemented. No new paid calls followed that investigation.
The newly authorized single matrix initially remained blocked and unconsumed,
under its original causal-fix prerequisite. The 2026-10-13
targeted follow-up passed 24 fresh jobs comparing diagnostics off/passive/form,
uneven inference timing and both sides of the heartbeat boundary. It produced no
failure or causal lead; all 12 confirmation slots were unused and paid execution
stayed blocked. The full local pipeline passed with 80 suites. The user subsequently
replaced the causal-fix prerequisite with one instrumented real matrix after all
fresh offline gates. Passive provider/browser diagnostics and all 20 frozen-source
gates passed, including 81 suites and the full pipeline. The one paid invocation
passed rows/normal, then stopped at rows/malicious on `AI_INCOMPLETE_EXTRACTION`
during catalog metadata before any addition in that case. All 14 requests completed;
the failed cart matches its baseline. The allowance is consumed with no retry;
cumulative reservations are $0.921518. Credentials were revoked and task previews
stopped. The historical timeout remains unresolved. The subsequent offline
metadata contract audit adds private numeric verdict diagnostics and preserves
strict completion/readiness checks. All 16 fresh synthetic browser cases passed:
four exact ready carts and twelve baseline-preserving holds, with no further
provider calls or additions on rejected-case restart. Paid outputs were not
retained, so their rationale cannot be reconstructed. The subsequent offline
single-snapshot repair replaces only Metadata's system prompt with an explicit
completeness check against the original snapshot/extracted JSON. All 16 fresh
synthetic cases, the uninterrupted 50-case safety suite, 12 passive served mocked
cases, four passive faults and the full local pipeline passed (81 suites).
Extraction instructions/schemas and strict guards remain unchanged; both real
budget locations and the consumed allowance retain their fingerprints. These
mocked checks prove construction and conservative local handling, not model
interpretation or improved reliability. Review and a separately authorized
validation plan are next; no paid retry is authorized and C4/M8 remain open.
The acceptance preparation adds optional private capture of exact parsed
`completed`/`progress` fields before the completion guard, in exclusive mode-0600
files capped at 16 KiB. The evaluator requires complete capture even with ordinary
diagnostics off. A separate single-use allowance at
`.sites-runtime/po-cart-workers/metadata-repair-acceptance/allowance.json` binds the
consumed predecessor fingerprint, final source, 21-step gate and immediately
verified model/settings/pricing. It is consumed durably before fixtures or model
requests. Creation refuses any existing file; the old allowance is never reset.
The added gate is the 16-case Metadata matrix, alongside all previous 20 checks.
Every served mocked Metadata file is fingerprinted. This task authorizes offline
preparation only; a subsequent explicit authorization is required for one paid
12-case matrix, at most 72 requests, within the unchanged cumulative $5 ceiling.
No paid probe, retry, model substitution or replay of attempted additions is allowed.
The fresh 16-case Metadata step passed, then the reliability gate stopped at job
25 on a second-addition response timeout after 24 passes. The partial cart,
account ownership and exposure remain held; no later browser step ran. All 82
suites and the separate non-browser pipeline passed, but served capture integration
and the complete gate remain unverified. Paid execution is blocked; review the
retained timeout before any separately reviewed browser follow-up.
Full local real-AI
acceptance precedes hosted fictional feasibility, which needs separate
authorization, configuration and budget.
