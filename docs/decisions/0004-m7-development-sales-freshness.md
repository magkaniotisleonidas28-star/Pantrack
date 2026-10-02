# Decision: M7 development sales freshness

- Status: accepted by the owner
- Date: 2026-09-30
- Milestone: M7, workstream A8
- Scope: development Clover sandbox proposal reviews

## Context

The manager flow reads company-scoped Clover health before calculating and
saving a review. The local browser walkthrough demonstrated a stale-health
`409` once the fictional sync timestamps exceeded the provisional ten-minute
limit. The owner explicitly chose to keep that limit for development.

The [local evidence](../M7_A8_SERVED_LOCAL_EVIDENCE.md) separates fixture
verification from provider evidence. The accepted
[M5 sandbox scope](../M5_B7_ACCEPTANCE_REVIEW.md) requires owner polling as the
fallback for missed or failed webhooks. A freshness timestamp alone does not
prove that every provider sale was received.

## Decision

Retain `maxLagMs = 600000` in the server-derived development review policy.
At the time of a check, both the successful-sync timestamp and sales checkpoint
must have an age between zero and 600000 milliseconds, inclusive. Exactly ten
minutes is allowed; one millisecond older is stale. Missing, malformed, or
future timestamps cannot establish current health.

Current health also requires the sandbox merchant to match the company
connection, an enabled sync gate, no sync error, and no held Clover events.
Anonymous access, company isolation, and owner/manager write permissions remain
enforced by the existing routes.

New durable proposals and new quantity edits require current health, with the
source checked again in the conditional database write. A retry of a completed
operation may return its existing result; it never creates a second write.
Read-only previews may show degraded or unknown health with warnings.

On access, stale or changed source data invalidates an existing unresolved
proposal, requires a new review, and records the reason once. This is not a
background timer. Cancellation remains available to an authorized manager or
owner at the current revision. A successful later reconciliation does not
automatically clear an old proposal's invalidation; cancel and calculate a new
review from the current source.

## Alternatives considered

A longer or unlimited freshness window would permit new proposals to use older
sales inputs. The owner retained ten minutes for development. Pilot and
production limits must be reviewed separately with their operating evidence.

## Consequences

The existing runtime threshold stays unchanged. The preview explains the
accepted rule, and tests cover each timestamp independently at and beyond the
boundary, including expiry between a read and its database write.

This decision closes A8's development freshness-policy dependency. M7 remains
open for hosted browser, end-to-end, and concurrency evidence. It introduces
no migration, environment variable, or contract version. Reverting the UI
wording or this record requires no data repair; changing the policy later
requires a new reviewed decision.

Remote migrations, deployment, Clover requests, supplier submission, scheduling,
pilot operation, and production use are separate gates. This acceptance does
not authorize those actions.
