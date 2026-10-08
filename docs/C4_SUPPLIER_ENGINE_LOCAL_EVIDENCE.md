# C4 supplier engine — local simulation evidence

Recorded: 2026-10-01. Branch: `workstream-c/c4-supplier-engine`, based on
`b1aef5d`. This completes one C4 backend outcome. C4 as a whole, M7 acceptance,
M8 supplier acceptance and purchasing authorization remain open.

The [OpenSpec change](../openspec/changes/supplier-simulation-engine/proposal.md)
and [design](../openspec/changes/supplier-simulation-engine/design.md) describe
the agreed scope. The supplier engine can progress without a supplier replying:
this outcome uses deterministic fictional suppliers and has no network transport.

## Delivered behavior

- [Contracts](../src/lib/supplier-simulation-contract.ts) preserve immutable
  v1/v2 handoff quantities and pack conversions. One order contains up to 50
  lines for one company/supplier/account/location; mixed groups, duplicate
  products, nonwhole/zero packs and unsafe sources fail closed. Final quotes
  contain exact lines, fees, USD integer minor-unit totals and expiry.
- [Fake connector](../src/lib/fake-supplier-connector.ts) has frozen methods,
  private factory registration and deterministic acceptance, rejection, timeout,
  lost-response, malformed and mismatched-result scenarios. Copying its methods
  or injecting an arbitrary adapter cannot make the engine invoke a live
  transport. Capabilities distinguish supported, unavailable and unverified;
  current quotes/outcomes carry simulated provenance. Human/provider provenance
  names are reserved for later evidence, never inferred from these tests.
- [D1 engine](../src/lib/d1-supplier-simulation.ts) requires a server identity
  resolver returning user ID, then reads current membership itself. There is no
  caller-supplied role. Every public read/command requires owner/manager access;
  write batches recheck membership. Unknown command fields are rejected rather
  than copied into receipts.
- The engine reads saved origins and current proposal state, rebuilding the
  handoff without changing inventory, incoming stock or proposal history. Atomic
  guards check proposal revision/packs/status, exact inventory/configuration,
  latest settings and v2 Clover health. Changed, invalidated or canceled sources
  cannot authorize a send.
- Manager approval binds to the complete final quote and source, including
  prices, fees, totals and expiry. Requoting clears approval. Expired quotes
  require a new quote and approval.
- Sending persists its claim, source/product holds, full spending reservation
  and audit event in one batch before the fake call. Active product and proposal
  uniqueness prevents a new order, revised proposal or replacement proposal from
  bypassing an unresolved send. A source failure or budget race rolls back the
  entire batch. Per-source assertions stay below D1's
  [100-bound-parameter limit](https://developers.cloudflare.com/d1/platform/limits/).
- Explicit server fixture limits cap per-order and per-UTC-day USD exposure.
  Reserved sending/unknown amounts count across day boundaries. Accepted amounts
  count on their original send day; rejected amounts release. These are test
  fixtures, not production spending-policy defaults.
- States are `awaiting_quote`, `awaiting_approval`, `approved`, `sending`,
  `unknown`, `accepted`, `rejected`, `canceled`. Cancellation is pre-send only.
  Timeouts, malformed/mismatched results, missing lookup and crashes retain
  holds/exposure. Matching authoritative simulated acceptance/rejection settles
  the same reference, with no automatic resend or terminal downgrade.
- Operation IDs bind the complete command and actor. Identical replay returns
  immutable receipts, even after source/quote expiry; conflicting reuse fails.
  `send()` returns its recorded **sending claim**, while `get()`/`history()` show
  the subsequent outcome. Concurrent/replayed sends never call again. A lost
  database acknowledgment after claiming conservatively skips the fake call;
  reconciliation may then leave an unknown, held order. A send result is recorded
  even if the original actor loses membership during the call. Expiry is checked
  again before committing and before invocation. A quote that expires while the
  claim is acknowledged skips the call and becomes unknown with its holds intact.

## Verification

All commands below ran successfully in this worktree:

| Command | Evidence |
| --- | --- |
| `pnpm test:focused purchasing-safety c4-a7-supplier-handoff` | Existing purchasing hard block and handoff baseline passed. |
| `pnpm test:focused supplier-simulation-contract supplier-simulation-d1` | New contract and transactional SQLite suites passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | All 41 suites passed, including unchanged legacy purchasing gates. |
| `pnpm db:check` | All 23 migrations match Drizzle schema and apply on fresh SQLite; FK/integrity checks passed. |
| `VINEXT_NO_DEV_LOCK=1 pnpm build` | Worker build passed; existing route-classification notice remains. |
| `pnpm db:migrate:local` | `0024_supplier_simulation.sql` applied with 31 successful local commands. |
| `VINEXT_NO_DEV_LOCK=1 pnpm test:local` | Home/auth pages, anonymous/forged identity rejection, fictional sign-in/company creation, company isolation, CSRF and sign-out passed. |
| `openspec validate supplier-simulation-engine --strict` | Passed. |
| `git diff --check` and changed relative-link checks | Passed. |

The new suites cover 0021-to-0024 preservation, immutable evidence/terminal state,
50-line grouping, anonymous/wrong-company/employee denial, role revocation at
commit, full quote approval/requote/expiry, stale inventory/settings/config and
proposal revisions, v2 disabled/error/disconnected/stale/advanced Clover health,
same/different-operation send races, company-scoped budgets, source/product
hold bypasses, old-day unknown exposure, rejected release, restart with the same
fake provider, malformed and mismatched responses, not-found, lost database
acknowledgments, claim-without-call recovery, acceptance-before-result-commit
failure, transaction rollback and pre-send cancellation. Snapshots prove engine
commands do not change stock, incoming, original proposals or their history.

The SQL test harness deliberately reports zero batch change counts and enforces
D1's parameter bound. It is transactional SQLite, not hosted D1 concurrency
proof. The HTTP smoke tests existing routes; there is no supplier route/UI in
this outcome. It leaves one fictional company in local D1. Simulation fixtures
stay in isolated in-memory databases. Build/test logs are ignored under
`.sites-runtime/`; secrets and customer data are absent from tracked artifacts.

## Schema and recovery

[Migration 0024](../drizzle/0024_supplier_simulation.sql), its generated
[Drizzle snapshot](../drizzle/meta/0024_snapshot.json) and
[journal](../drizzle/meta/_journal.json) add seven tables: orders, quotes,
approvals, operation receipts, events, source/product holds and reservations.
Company-scoped foreign keys and partial active-hold indexes preserve isolation.
Triggers reject evidence edits/deletes, invalid transitions and failed batch
assertions. The migration changes no existing table or data. The upgrade test
compares preexisting fictional inventory/proposal/history rows byte-for-byte.

Code rollback leaves these additive tables and audit history intact. Do not
remove or rewrite an applied migration. A schema repair requires a new additive
migration. A `sending`/`unknown` order is reconciled against its original
reference; not-found is insufficient to release funds or quantity. Accepted
product/source holds intentionally remain active until a later receiving design
records a safe resolution. No manual force-release or resubmit exists here.

No remote migration, deployment, push, real supplier contact, credentials, order,
payment, scheduler or inventory receipt occurred. Existing purchasing hard
blocks, development authentication and integration settings are unchanged.

## Downstream handoff

A's handoff contract and proposal lifecycle were consumed without edits. Shared
schema/journal edits are scoped to this C4 integration; the next schema-bearing
branch must regenerate its next migration after this one merges.

The next independent supplier outcome is a **portal feasibility investigation**
using an authorized existing café account and its ordinary order workflow.
Record the available catalog/quote/order/status evidence and channel constraints
before connecting an adapter. Supplier permission to expose an API remains a
separate access question. Do not assume silence grants access or proves a portal
channel can be automated. This task did not access an account or contact anyone.

**Manager-assisted ordering is the fallback:** Pantrack prepares an immutable
proposal and reviewable order draft; the manager completes the supplier's normal
workflow and records its confirmed reference and totals. Build that workflow as
its own reviewed slice. Scheduling, alerts, receiving/delivery, payment controls,
hosted D1 behavior and a real supplier sandbox remain later gates. C4/M8 and
supplier submission/automatic purchasing stay open/disabled.

## Main integration — 2026-10-07

Replayed onto main `5bad73e` without changing its used `0022` guard repair or
`0023` auth fence. Drizzle regenerated this unpublished simulation migration as
`0024`; its custom triggers are unchanged. In the integration worktree,
`node scripts/test.mjs supplier-simulation-contract supplier-simulation-d1` and
`node scripts/check-migrations.mjs` passed (25 ordered migrations). This is local
evidence only; no remote schema or supplier behavior was enabled.
