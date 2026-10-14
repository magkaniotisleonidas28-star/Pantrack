## Context

C4 has a strict read-only handoff consumer but no durable supplier core. Existing proposal origins/states and exact inventory/settings versions can serve as source authority. Supplier access is pending. This change is local backend evidence, separate from M7 acceptance, M8 provider permission and pilot purchasing gates.

## Goals / Non-Goals

Prove exact quote approval, tenant authorization, durable idempotency, bounded exposure and uncertain-send recovery. Do not introduce routes, UI, network calls, live credentials, scheduling, inventory updates or real orders. Portal assistance is a later feasibility investigation with manager-assisted ordering as the fallback; supplier silence does not prevent building the core.

## Decisions

- A server-injected identity resolver supplies only user ID; membership is read from D1 for every operation and guarded again in write transactions. No caller-supplied role is accepted.
- Use a branded factory-created fake connector rather than structurally accepting arbitrary adapters. Quote/status contracts remain provider-neutral, but this entry point cannot invoke a real transport.
- Read immutable origins and mutable proposal state without changing either. Rebuild their canonical handoff and compare exactly, then guard source versions and Clover health atomically at create/quote/approve/send. Reject mixed groups, duplicate products, held sales, invalidations and nonpositive/nonwhole packs.
- Store orders, immutable quotes/approvals/events/operation receipts, source holds and budget reservations in additive migration 0024. Partial uniqueness on active proposal and product holds blocks new order/proposal IDs or revisions bypassing a pending send. Accepted holds remain until a later receiving design; rejected holds release. Cancellation occurs before holds are acquired.
- Each guarded D1 batch includes a receipt with a database write guard. Source checks use separate no-write assertions in that same batch to stay below D1's per-query bound-parameter limit. A failed assertion hits the receipt guard trigger and rolls back everything. Durable receipts, rather than D1 change counts, establish success after lost acknowledgments. Request fingerprints use canonical full JSON, including actor; all persisted payloads are bounded and validated.
- UTC-day USD integer fixture limits are required server configuration. Sending reserves funds atomically. Daily exposure includes accepted orders from today plus all sending/unknown reservations regardless of day; rejected reservations release. These values are not production policy defaults.
- The winning send operation records a unique claim before calling the fake once. Replays and concurrent losers never invoke it. Send returns its immutable claim receipt; get/history expose subsequent outcome. An acknowledgment loss after the claim is treated as a crash and does not call the fake. A crash after the claim is conservatively reconciled; a missing reference remains unknown. Only matching authoritative simulated terminal evidence settles it, and terminal outcomes never downgrade.
- Manager approval binds to the complete final quote (lines, fees, totals, expiry, group and source fingerprint). Requoting clears approval; send rechecks expiry and current fixture policy. There is no implicit approval for an estimate.
- Check expiry before committing and again before invocation. If it expires during acknowledgment of a persisted claim, skip invocation and record unknown with holds retained, following the same conservative recovery as a crash after claiming.

## Risks / Trade-offs

Source holds intentionally block accepted quantities until a later receiving workflow. Unknown outcomes can indefinitely consume budget; manager review/reconciliation is safer than resending. SQLite concurrency tests prove local transactional behavior, not hosted D1 or supplier behavior. Quotes and approvals add storage but preserve auditability. Canonical payload comparison is simpler and collision-free at this bounded local scale compared with hash-only approval.

## Migration Plan

Generate one additive migration and Drizzle snapshot/journal. Append guards for immutable evidence and valid simulation states. Verify a fresh database and upgrade compatibility with existing records. Run all local checks and local migrations only. Code rollback leaves additive tables/history intact; forward repair uses a new migration. No remote migration or deployment is authorized by this task.
