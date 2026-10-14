# Proposal

## Why

Saved purchase-order drafts can only be viewed or canceled. Managers need to correct them and record a review without authorizing an order.

## What Changes

- Versioned, audited draft editing and review-only manager sign-off.
- Review invalidation after edits, immutable history, and safe concurrent retries.
- One focused responsive editor with a compact draft list and spending summary.

## Capabilities

### New Capabilities

- `purchase-order-draft-review`: Edit and review saved drafts without purchase approval or external effects.

### Modified Capabilities

None. Foundation and registry changes remain compatible.

## Impact

C4 service, API, purchasing preview, additive D1 migration, focused tests and local evidence. Existing company/role guards and default-off preview remain. No remote migration, deployment, supplier contact, stock changes or budget reservations.
