# Pantrack vendor connector v1

This is an adapter contract, not a claim that any particular supplier accepts these requests. Implement it against the supplier's approved API and test in its sandbox before enabling automatic mode.

## Transport and authentication
Pantrack sends POST JSON to the company's configured HTTPS endpoint. Optional Authorization: Bearer TOKEN. No redirects, credentials in URLs, private/local hosts or custom ports. Each request includes protocol: "pantrack.vendor.v1" and account: the saved vendor account reference. Verify your token and authorize that account on your server.

Never collect or return card numbers, CVC, bank credentials, or supplier passwords in responses. Use the supplier's approved account/payment authorization.

## Capabilities — read-only test
Request: {"protocol":"pantrack.vendor.v1","account":"CUSTOMER","action":"capabilities"}
Response:
{"protocol":"pantrack.vendor.v1","quotes":true,"orders":true,"status_lookup":true,"idempotency":true,"enforces_max_total":true,"no_substitutions":true}

Return true only when the adapter actually implements these guarantees.

## Quote — no purchase
Request:
{"protocol":"pantrack.vendor.v1","account":"CUSTOMER","action":"quote","reference":"UUID","currency":"USD","delivery_address":"...","items":[{"sku":"MILK-104","unit":"case","quantity":2}]}
Response:
{"quote_id":"q_123","currency":"USD","total_cents":5200,"expires_at":"2027-01-01T12:00:00.000Z","items":[{"sku":"MILK-104","unit":"case","quantity":2,"unit_price_cents":2400}]}

Total must include all tax, freight, fees and discounts. Check stock, minimum order, delivery availability and cutoffs before issuing a quote. Return non-2xx for an impossible order. Quotes must bind the exact account, address, SKUs, units, quantities and total. Pantrack refuses mismatched lines, excess price increases and excess delivered totals.

## Order — real external purchase
Request:
{"protocol":"pantrack.vendor.v1","account":"CUSTOMER","action":"order","reference":"UUID","idempotency_key":"SAME_UUID","quote_id":"q_123","max_total_cents":5200,"allow_substitutions":false}
Accepted response: {"status":"accepted","order_id":"VENDOR-ORDER-123"}
Definitively rejected response: {"status":"rejected"}

Persist the idempotency key before calling the supplier. Repeated requests must resolve to the same supplier order, never another purchase. Enforce the maximum total and no substitutions atomically with submission. A timeout is NOT a rejection: return unknown until reconciled.

## Status — never create an order
Request: {"protocol":"pantrack.vendor.v1","account":"CUSTOMER","action":"status","reference":"UUID"}
Response: {"status":"accepted","order_id":"VENDOR-ORDER-123"} or {"status":"rejected"} or {"status":"canceled"} or {"status":"unknown"}.

Do not treat a temporary not-found response as definitive rejection. Reconcile against the vendor's records.

## Scheduled checks
Company owners can generate a dedicated scheduler key in Suppliers & automation → Schedule & setup.
Configure an external scheduler to POST the displayed URL with Authorization: Bearer TOKEN.
The scheduler is not provisioned by the app. Calls are due-gated by the company's saved interval. Use hourly calls for a 24-hour policy if desired. Keys authorize only due checks for that company, not settings edits. Rotate keys to revoke access.

## Safety and limits
- Start paused or review-only, using real supplier sandbox facilities. The current application blocks automatic mode and all supplier submissions until M8 supplier validation and M11 reviewed-pilot authorization are complete.
- Test connector behavior against timeouts, duplicate calls and rejected orders before any future automatic mode is enabled.
- Only allowed real products, fresh counts and verified vendors can submit.
- USD integer cents; daily budgets use UTC. Pending/unknown outcomes retain spending reservations.
- Open proposals and unresolved orders hold their products from new replenishment proposals.
- Record actual deliveries in Inventory with the proposal UUID as the receipt note before closing accepted orders.
- Existing vendor credentials and proposed orders are company-scoped. Tokens are encrypted with the app's runtime encryption key.
- Browser automation and arbitrary vendor APIs require their own approved adapter; they do not become compatible by pasting a shopping URL.
