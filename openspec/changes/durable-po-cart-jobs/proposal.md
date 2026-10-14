# Proposal

## Why

Saved fictional preparation permission needs durable jobs and exclusive account-cart
ownership before a worker can safely consume it. A lost response or crashed worker
must never silently repeat an attempted cart write.

## What Changes

- Add persistent jobs, cart ownership, fenced leases, immutable attempts/results,
  audit and permanent replay receipts, reusing authorization reservations.
- Add gated manager enqueue/status/cancel API and internal fake-worker operations.
- Compose first-attempt recording with authorization start in one guarded D1 batch.
- Recover only never-attempted jobs automatically; retain uncertain work for review.

## Capabilities

### New Capabilities
- `durable-po-cart-jobs`: Local fictional job ownership and recovery protocol.

### Modified Capabilities
None. Existing authorization APIs and browser preview remain compatible.

## Impact

One additive migration and focused backend/API/tests. No UI, browser integration,
worker transport, hosting, credentials, model calls, real suppliers or inventory effects.
