# C4 — durable fictional PO cart authorization

Date: 2026-10-09
Scope: one C4 backend outcome, following the [read-only preflight](C4_PO_CART_CONTRACT_LOCAL_EVIDENCE.md).
Status: local implementation verified; C4/M8 acceptance remains open.

## Outcome

Reviewed POs can now retain explicit preparation permission, exact quantity
commitments and cap exposure across service/database reopen. Authorizing records
the reviewed revision and full immutable PO, manager identity, fictional
supplier/account/location and connection version, exact lines/conversions,
estimates and budget-policy version. Draft `reviewed` semantics are unchanged.

Authorization, generated quantity commitments, cap reservation, audit and permanent
replay receipt commit in one guarded D1 batch. Failure rolls them all back. One
unreleased authorization per PO and one active commitment per company/product
prevent duplicate work. A per-PO generation gives deterministic current history
even when authorizations share a timestamp.

`POST /api/po-cart-authorizations` accepts:

- `authorize`: companyId, orderId, expectedRevision and UUID operationId.
- `cancel`: companyId, authorizationId, expectedRevision, UUID operationId and reason.

`GET` accepts companyId and orderId and returns the current authorization, claims,
reservation, audit and validity. Owners/managers only; employees, anonymous,
wrong-company and revoked callers are denied. Mutations use the existing actual
origin/JSON/Fetch-Metadata CSRF checks. The route requires
`PANTRACK_CART_PREVIEW=enabled` and hostname `127.0.0.1`; it is off by default.
The server derives identity, connection, quantities and cap. There are no setup
or start endpoints and no manager-screen changes in this outcome.

Operation identity binds actor and normalized complete intent permanently. A
different actor or input conflicts. Exact retries return an immutable historical
receipt **beside current state**, including after cancellation/invalidation.
Current head, claims, audit and validity predicates are read in one database
snapshot, preventing mixed old-permission/new-cancellation responses. An old
receipt never becomes current authority.

## Sources, cancellation and A/C handoff

The service reuses the draft service's source predicates and checks the complete
reviewed PO, active configuration/classification, applicable proposal/inventory/
settings and Clover freshness, registry profile/mapping/custom-unit versions,
current connection and policy, and both caller and original authorizer membership.
Predicates run again inside mutation transactions, including the internal start
marker. Missing connection or policy blocks new authorization; there are no
runtime defaults for either.

PO edits/cancellation invalidate permission with an audit event in the same draft
transaction. They release quantity and budget only if preparation never started.
Other source changes make permission unusable while retaining its claims until
an explicit safe cancellation. Cancellation after start retains exposure and
commitments; it establishes no supplier purchase cancellation. Repeated safe
cancellation releases once.

The A/C shared-file changes are the additive schema/migration and the draft
service's public internal `sourceGuards` method. New migration guards prevent A
origins or renewed/edited/sending proposal commitments from bypassing active PO
claims. A invalidation and cancellation remain allowed. Simulation holds and PO
claims exclude each other in both directions; historical simulations remain intact.

`po_cart_commitments.proposal_id` identifies the original A commitment as the
**same purchasing quantity**, not an additional shortfall. Authorization leaves
A history unchanged. Future aggregate commitment readers must substitute an
active PO claim for its linked proposal (exclude matching A proposal IDs), rather
than adding both. Safe PO cancellation releases the PO claim; an uncanceled
original proposal continues its own conservative hold.

`revalidate` is an internal advisory read. `markPreparationStarted` is an internal
guarded, replay-safe marker before a future consumer's first attempted mutation;
it creates no job/browser or lease. Future workers still need claims, fencing,
attempt history and revalidation at every external mutation boundary. A successful
start retry reports current state and does not authorize another attempt.

## Migration and compatibility

[0028 SQL](../drizzle/0028_po_cart_authorizations.sql), its
[snapshot](../drizzle/meta/0028_snapshot.json) and the journal add seven tables,
company-scoped foreign keys, unique active claims, immutable configuration/audit
guards, atomic spending checks and draft/A/simulation transition guards. No used
migration was rewritten. Connection and budget versions are append-only. This
slice deliberately provides no configuration mutation API.

Tests explicitly provision **$500 per order and $1,000 total outstanding cart
exposure**, reserving the PO's cap rather than its item subtotal. These values are
fictional test policy, not real spending approval, daily/monthly owner controls,
or the separate simulation engine's spending policy. Started/canceled or stale
reserved work remains in total cart exposure across dates and service restarts.

Fresh SQLite schema/journal/snapshot verification passes for 29 migrations and 90
tables. A populated 0000–0027 upgrade preserves all 83 prior tables byte-for-byte
at the row level, including reviewed PO/history/receipts and legacy inventory;
existing supplier simulation regressions pass. A real file close/reopen preserves
unresolved reservations, permission state, audit and permanent cancellation receipts.

Wrangler initially rejected this migration's `released_at=CASE` trigger expression
with `incomplete input`: its splitter failed to recognize the CASE boundary.
The new migration uses whitespace before CASE. The populated-upgrade test also
executes the shipping Wrangler splitter, and AGENTS.md records the prevention
rule. Corrected SQL applied through Wrangler to both existing local databases and
a new empty local D1 database (all 0000–0028), with no remote migration.

## Verification in this worktree

All successful checks below ran after implementation. The full pipeline was rerun
after the status-snapshot fix. Routine checks used fictional providers and no AI,
paid browser services, live integrations or orders.

| Command | Result |
| --- | --- |
| `pnpm test:focused po-cart-authorizations-api po-cart-persistence po-cart-sources-migration po-cart-authorization purchase-order-review` | Passed: durable security/race/recovery contracts and preflight/draft compatibility. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | All 56 suites passed, including existing A and simulation consumers. |
| `pnpm db:check` | 29 migrations match schema/snapshots and apply fresh. |
| `pnpm build` | Passed; gated API included in Worker. |
| `pnpm db:migrate:local` | Passed with 0028 applied, then no pending migrations on rerun. |
| `pnpm test:local` | Served default environment auth/company/isolation smoke passed. |
| Fresh Wrangler `d1 migrations apply DB --local` with isolated persistence | All 29 migrations passed. |
| `node scripts/po-cart-authorization-http-check.mjs` against `pnpm dev:cart` | Real local D1/API config, concurrent PO replay, budget race, cancellation/current receipt, status and unchanged inventory passed. |
| `pnpm cart:check:http` against `pnpm dev:cart` | Existing served cart API regression passed. |
| `pnpm cart:check` | All 16 offline browser scenarios passed across both layouts. |
| `openspec validate --all --strict` | All seven changes passed. |
| `git diff --check` and changed relative-link checks | Passed. |

The three new focused suites cover anonymous/company/employee/revoked access,
revocation immediately before authorize/cancel/start commit, original-authorizer
revocation, strict intent and actual CSRF, concurrent operations/product/budget
claims, late transaction rollback, lost acknowledgments, actor-bound permanent
replay, PO/source changes, exact registry conversions, safe release and retained
uncertainty, equal-clock history, concurrent cancellation reads, restart and
populated/fresh migration compatibility. Preparation changes neither stock nor
confirmed incoming; deliberate source-mutation fixtures are separate.

## Limits, rollback and next outcome

This is local fictional backend evidence. No deployment, remote data change,
real-supplier authorization, model call, Browserbase/Render setup, browser job,
checkout, stock or incoming effect was added. The existing independent browser
preview remains a bounded experiment and does not consume these grants yet.
Real mapping provenance, financial controls, hosted privacy/capability evidence,
supplier permission, confirmation/receiving and pilot gates remain open.

Rollback disables `PANTRACK_CART_PREVIEW` and preserves all seven tables, audit,
receipts and unresolved claims. Do not delete reservations or recreate used
migrations; forward repair needs a new migration and reconciliation evidence.
Conservative product holds may block legitimate overlapping purchases. There is
deliberately no release path for started work until a later explicit reconciliation
contract exists.

The subsequent [durable fictional job protocol](C4_PO_CART_JOBS_LOCAL_EVIDENCE.md)
now consumes these grants through guarded first attempts, account-cart ownership,
immutable results and fenced recovery, retaining uncertainty. Authenticated worker
transport is next. Hosted feasibility can proceed separately only with its required
configuration and explicit paid-test authorization.
