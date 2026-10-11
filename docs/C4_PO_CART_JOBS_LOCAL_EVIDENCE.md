# C4 — durable fictional preparation jobs

Date: 2026-10-09. Outcome: one C4 backend protocol following
[saved preparation permission](C4_PO_CART_AUTHORIZATION_LOCAL_EVIDENCE.md).
Status: local only; C4/M8 acceptance stays open and purchasing stays disabled.

## Behavior and contracts

Migration `0029_po_cart_jobs` adds six tables: jobs, account-cart owners, immutable
attempts, immutable results, events and permanent operation receipts. A job freezes
the authorization inputs and enqueue revision. It references the existing quantity
commitments and cap reservation; enqueue/claim/attempt/results create no additional
reservation, stock, confirmed incoming or supplier order.

One job is permitted per authorization. Cart ownership is keyed by
company/supplier/account, excluding delivery location and connection version.
Ownership remains until explicit safe cancellation, independently of the worker
lease. The persistent ownership row retains its increasing fence after release.
The public authorization allowlist still supports only the existing fictional
supplier/account/location; the shared-location storage test grants no broader access.

`/api/po-cart-jobs` requires `PANTRACK_CART_PREVIEW=enabled`, hostname `127.0.0.1`,
and current owner/manager membership. Mutations use the existing company wrapper
and actual origin/CSRF protection. Bodies are strict server-derived intent:

- POST `enqueue`: `companyId`, `authorizationId`, `expectedRevision`, UUID `operationId`.
- GET: `companyId`, `jobId`; returns current job, validity, authorization/reservations,
  ownership, attempts, results and events.
- POST `cancel`: `companyId`, `jobId`, expected job revision, UUID operation and reason.

Mutation responses return `{receipt,current}`. Receipts bind normalized input and
actor permanently. Reusing an operation with another actor/input conflicts; an old
enqueue receipt alongside canceled current state never revives permission. Workers
cannot call claim/heartbeat/attempt/result/recovery through this route.

## Internal worker protocol

`D1PoCartJobs` accepts a configured internal `workerId`; request bodies cannot select
one. `claim`, `heartbeat`, `beginAttempt`, `recordResult` and `recoverExpired` have
UUID operation identities. Leases last 60 seconds using server time; production
lease guards additionally evaluate SQLite time inside the final transaction.
Ownership transfers increase the fence. Worker transitions require exact current
job revision, account ownership, worker, fence and unexpired lease.

Current original-authorizer and enqueuer membership, exact reviewed PO, inventory
configuration, proposal/Clover health, supplier profile/mapping, connection and
policy predicates are checked in the committing batch. Reads evaluate these same
predicates beside current job state; they do not return historical validity as
current permission.

The authorization service exposes internal guarded composition so permission start,
the first immutable line intent, job event and replay receipt commit together before
the fake provider call. Failure rolls all of them back. Each line can be attempted
once, and another line cannot start while a prior attempt lacks a verified result.
Verification compares the complete frozen line, including SKU, packs, price and
stock conversion. Mismatches/uncertainty require review; ready requires every line's
exact result and valid inputs. Purchase remains `not_confirmed`, delivery `outstanding`.

`beginAttempt` also returns ephemeral `providerCallAllowed`. It is true only for an
acknowledged new attempt with current valid ownership. Exact retries and recovered
lost acknowledgments return false. A receipt is never a reusable call capability.
The future browser consumer must honor this decision, recheck before its mutation,
and enforce session/action restrictions. Database fencing cannot undo an external
action; actual browser execution and authenticated worker transport are not tested here.

## Recovery and cancellation

An expired lease with no attempts and never-started valid permission returns the
same job to queued with a newer fence. Attempted or stale work moves to
`review_needed`; it retains cart ownership, quantity commitments and cap exposure.
It cannot automatically replay a line or start a fresh browser session.

Manager cancellation before start atomically cancels permission/job and releases
ownership/reservations once. Started cancellation stops further work and retains
all unresolved holds. Permission changes through the existing authorization API or
PO edit/cancel trigger the job transition and lease fencing in that same transaction.
Other source changes make use invalid and require explicit safe cancellation.
Preparation cancellation does not assert supplier cancellation. Started work has
no release/reconciliation path in this slice.

## Local verification

- Four focused suites: `po-cart-jobs`, `po-cart-jobs-api`, `po-cart-job-sources`,
  `po-cart-job-migration`. They cover anonymous/role/company/revocation/CSRF/gates,
  concurrent enqueue/claims, permanent replay, lost acknowledgments, exact results,
  line ordering, database-clock expiry, stale workers, all source-version races,
  transaction rollback, cancellation and process-memory independence.
- Disk SQLite close/reopen preserves attempts, receipts, held ownership and exposure;
  a worker without a user session can recover held work through the internal protocol.
- A populated 90-table upgrade preserves every existing row, including legacy started
  authorization. The migration applies through Wrangler's SQL splitter. Fresh local
  D1 applies all 30 migrations; all 20 new triggers exist and foreign-key checks pass.
  Schema/snapshot/journal checks report 96 application tables.
- Full local pipeline: `pnpm typecheck`, `pnpm test` (60 suites), `pnpm db:check`,
  `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local`.
- Served local D1: `node scripts/po-cart-jobs-http-check.mjs`,
  `node scripts/po-cart-authorization-http-check.mjs`, `pnpm cart:check:http` passed.
  `pnpm cart:check` passed all 16 existing offline browser scenarios across both layouts.
- `pnpm exec openspec validate --all --strict`, `git diff --check` and changed relative
  links checked. Runtime logs live under ignored `.sites-runtime/`; no hosted evidence.

The existing file-backed browser preview is unchanged and does not consume these
jobs. No UI, worker HTTP endpoint, browser session, hosting, model call, real supplier
access, checkout, stock or incoming writer was added. Fictional $500/order and $1,000
outstanding policies remain explicit test fixtures, not real spending approval.

## Rollback and handoff

Disable `PANTRACK_CART_PREVIEW` to stop access/new work. Preserve all job and
authorization tables, receipts, attempts, ownership and unresolved commitments.
Do not delete used migrations or reset data; schema repair requires a new migration.
Conservative holds can block an account until explicit reconciliation is implemented.

Next unblocked C4 outcome: authenticated worker transport consuming this internal
protocol, with scoped worker identity, replay-safe HTTP and local fake-worker tests.
Browser/session integration, manager progress UI, hosted feasibility, real mappings,
owner financial controls, supplier permission, confirmation/receiving and pilot
acceptance remain separate outcomes.
