# Proposal

## Why

Durable fictional cart jobs need a separate worker without database credentials.
HTTP retries, revoked credentials and crashes must preserve the existing fences,
reservations and uncertainty rules before connecting a browser consumer.

## What Changes

- Add immutable scoped worker identities, hashed expiring credentials and audit in additive migration 0030.
- Add a default-off loopback bearer API with current credential guards inside every committing transaction and minimal worker projections.
- Add a separate Node 22 fake worker with private journal, bounded UUID-preserving retries and conservative restart recovery.
- Add private local credential fixtures and separate-process/served-D1 acceptance commands.

## Capabilities

### New Capabilities
- `authenticated-po-cart-worker`: Local authenticated worker transport and fake client.

### Modified Capabilities
None. Manager APIs and the independent browser preview remain compatible.

## Impact

Workstream C4 only. No browser integration, hosting, owner credential-management
API/UI, paid/model/supplier calls, order placement or inventory effects. C4/M8 remain open.
