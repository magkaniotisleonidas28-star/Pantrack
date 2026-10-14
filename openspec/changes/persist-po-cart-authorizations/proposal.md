# Proposal

## Why

Read-only cart preflight cannot remember manager permission or prevent duplicate
quantity and budget claims. C4 needs a durable fictional authorization boundary.

## What Changes

- Persist reviewed PO/actor/connection/policy inputs with atomic commitments,
  spending reservation, audit and permanent actor-bound replay receipts.
- Add default-off loopback company API authorize/status/cancel operations.
- Revalidate current sources and membership, invalidate on PO changes, and retain
  exposure after preparation starts until a later reconciliation outcome.
- Extend A proposal and simulation guards without altering their existing records.

## Capabilities

### New Capabilities

- `durable-po-cart-authorization`: Persisted fictional cart permission and claims.

### Modified Capabilities

None. Draft review and the independent browser preview remain compatible.

## Impact

One additive local migration, focused service/API/tests and A/C handoff evidence.
No UI, browser jobs, models, hosting, supplier access, stock or incoming writes.
