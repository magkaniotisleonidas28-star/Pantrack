# C4 — PO-to-cart contract and authorization preflight

Date: 2026-10-09. Outcome: bounded local contract slice.
See [decision 0005](decisions/0005-po-backed-ai-cart-preparation.md),
[integration roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md) and
[OpenSpec tasks](../openspec/changes/po-cart-authorization-contract/tasks.md).

## Contract and observable behavior

[The contract](../src/lib/po-cart-preparation-contract.ts) separates client intent
(company, PO, expected revision, UUID operation identity) from server-loaded PO,
actor and versioned connection. It returns deeply immutable exact packs, prices,
stock conversions and mapping/configuration references. Unknown/inconsistent
prices, duplicate lines/SKUs, invalid conversions, changed revisions, canceled
sources and inactive/paused connections are held. It preserves legacy total-only
prices only when division is exact; quantities are never recalculated.

The complete snapshot and connection binding detect changes to account/location,
delivery address, quantities, conversions, mappings, currency, price and cap.
The fingerprint contains private PO content: it is an internal comparison value,
not a signed token, log field or model input. Cart, purchase and delivery state
vocabularies remain independent. There is no checkout capability.

[The read-only D1 service](../src/lib/d1-po-cart-preparation.ts) loads the current
saved PO through the existing draft service, derives actor from server identity,
checks owner/manager membership and rechecks membership/session after loading the
connection. Revalidation repeats those checks and compares the full binding.
No client-supplied identity, lines, cap or connection is accepted. Real mode is
refused, including review-only registry inputs.

**Every result says `authorization: required`.** This is an authorization preflight,
not an executable preparation grant. Repeating an operation is a deterministic
read, not a persisted idempotency receipt. No new route, application UI integration,
schema, job, reservation, incoming/stock write or external call was introduced.
The existing fictional browser preview and its file store remain independent.

## Local verification

- `pnpm test:focused cart-preview cart-preview-api purchase-order-review` passed before implementation (3 existing suites).
- `pnpm test:focused po-cart-authorization` passed. Real local D1 fixtures cover owner/manager access; anonymous, employee, wrong-company and revoked membership; session changes during reads; strict intent; current saved drafts, edits/review/cancellation; exact large integers and all binding invalidations. Full database comparisons prove no preflight writes.
- `pnpm typecheck` passed.
- `pnpm test` passed all 53 suites, including the existing preview/API and PO review regressions.
- `pnpm db:check` passed: 28 existing ordered migrations match schema and apply to fresh SQLite. This slice adds no migration.
- `pnpm build` passed. The existing framework reports unclassified auth-page routes; this is not a new failure.
- `pnpm db:migrate:local` passed with no pending migrations; `pnpm test:local` passed local auth/company isolation/default-off purchasing checks.
- `pnpm cart:check` passed all 16 offline Chromium scenarios across both layouts, with independent fixture-state checks and no model or supplier calls.
- `pnpm cart:check:http` passed served authentication/company/CSRF/strict-input, replay/account-cart locking, same-session inspection/reopening, source invalidation and unchanged-inventory checks.
- `openspec validate --all --strict` passed all six changes; `git diff --check` and changed relative-link checks passed.
- The final preservation check matched every pre-existing tracked non-document diff byte-for-byte and all existing milestone completion checkboxes unchanged. Existing untracked preview files were not edited.

No new UI was added; existing preview visual evidence retains its original stated
limitations. Hosted-fictional, real-AI and supplier tests were not run. Local served
checks create fictional companies only in local preview/smoke databases.

## Limits, handoffs and rollback

This proves local input/permission behavior only. It does not prove production
authorization, source freshness at commit time, atomic source/budget reservations,
durable jobs, worker fencing or hosted Browserbase behavior. Real-AI evaluation,
hosted-fictional tests, supplier validation, pilot and production remain unproved.
Model configuration, Browserbase/Render capabilities and separate budgets,
supplier permission and café authorization are external dependencies.

Next bounded C4 outcome: coordinate A's quantity-commitment and owner-budget
contracts, then add durable preparation authorization/replay receipts with atomic
PO/mapping/source/membership guards. Follow with durable jobs and worker/session
consumers. A read preflight cannot eliminate the race before an eventual write.
Keep real mode disabled until the complete gates are met.

Rollback removes the unused contract/service or their future callers; there is
no data migration to reverse. Preserve all existing PO history and unresolved
commitments. No deployment, paid evaluation, supplier contact/account access or
purchase occurred. The dated roadmap decision is product intent, not release acceptance.
