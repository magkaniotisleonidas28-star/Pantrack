## Why

Supplier access is unconfirmed, but Pantrack needs durable quote approval and recovery before connecting any provider. C4 can prove these behaviors locally without waiting for supplier replies or enabling purchasing.

## What Changes

- Add a D1-backed simulation engine consuming existing immutable v1/v2 replenishment handoffs.
- Add provider-neutral quote/capability/result types and a deterministic, network-free fake connector.
- Persist exact-quote approval, guarded sending, spending reservations, source holds, replay receipts and immutable audit history.
- Test authorization, concurrent sends/budgets, uncertain outcomes, reconciliation and crash recovery.
- Record portal assistance as a future investigation and manager-assisted ordering as its fallback.

## Capabilities

### New Capabilities

- `supplier-simulation`: Authorized, company-scoped quote-to-order simulations with durable duplicate prevention and recovery.

### Modified Capabilities

None. Existing replenishment handoffs and real purchasing gates are unchanged.

## Impact

Focused supplier modules and tests, additive D1 schema/migration, local evidence and roadmap status. No new HTTP routes, UI, network transport, remote migration, deployment, credentials, scheduler, incoming inventory or real order.
