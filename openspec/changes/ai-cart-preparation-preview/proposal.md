# Proposal

## Why

Managers need a short path from a reviewed purchasing list to a supplier cart. Prove exact cart preparation and recovery locally before promising support for Baldor or another live supplier.

## What Changes

- Add an isolated fictional cart preview, a local visible-browser worker, and reviewed-draft controls.
- Verify exact SKU, pack, quantity and price; preserve existing cart contents and stop on uncertainty.
- Add offline scenario tests and an explicitly invoked real-AI evaluation with a cumulative $5 ceiling.
- Record local evidence separately from supplier access and pilot evidence; keep purchasing disabled.

## Capabilities

### New Capabilities

- `cart-preparation-preview`: authorized, revision-bound, replay-safe preparation of a controlled fictional cart with manager handoff.

### Modified Capabilities

None.

## Impact

C4 only. Extend the draft screen and local Vite preview; add Node-only browser tooling and isolated file receipts. No production database migration, deployment, supplier connection or checkout submission.
