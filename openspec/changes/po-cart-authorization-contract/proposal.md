# Proposal

## Why

POs must remain the purchasing record as the channel changes from emailed orders
to bounded cart preparation and manager checkout. The existing local preview
cannot serve as a production authorization contract.

## What Changes

- Adopt the dated PO-to-cart roadmap, preserving historical email and preview evidence.
- Define immutable, exact preparation inputs and separate cart/purchase/delivery states.
- Add server-side preflight and revalidation against saved POs and current membership,
  tested using the fictional supplier. Preflight is explicitly not a durable grant.
- Leave real suppliers, authorization persistence, reservations and execution disabled.

## Capabilities

### New Capabilities

- `po-cart-authorization`: Exact, company-scoped preparation input and authorization preflight boundary.

### Modified Capabilities

None. Existing draft review and preview behavior remain compatible.

## Impact

New focused contract/service/tests and purchasing roadmap documents. No new API,
schema, dependency, deployment, model call or supplier action. The next storage
slice must atomically persist authorization, quantity commitments and budget claims.
