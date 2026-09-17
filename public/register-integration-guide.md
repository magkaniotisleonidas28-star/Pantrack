# Connect any POS through an adapter

Pantrack supports company-specific provider settings, a standard CSV format, and an authenticated sales ingestion endpoint. Naming a provider does not mean a native integration exists. Clover authorization/menu loading is implemented; automatic Clover sales sync and native integrations for other providers are not implemented.

A developer or integration service must obtain authorized sales access from your POS and translate its data into the contract below. POS availability, permissions, paid access and vendor approval vary. No credentials should be placed in browser code or URLs.

## Setup
1. Configure real inventory, opening counts, stock units and recipes.
2. Save register mappings with exact provider, location and item IDs. Provider names and IDs are case-sensitive. Map variations to the appropriate recipes.
3. Under Setup & register, generate a company access token. Store it as a secret in the integration service. It is shown once. Replace or revoke it from Pantrack as needed.
4. POST to the company endpoint displayed in Pantrack with Content-Type: application/json and Authorization: Bearer YOUR_TOKEN.

Example JSON (replace all example IDs with saved mappings):
```json
{
  "reference": "store1-order123-final",
  "lines": [
    {"provider":"Example POS","location":"store-1","itemId":"latte-small","quantity":30}
  ]
}
```

An accepted request deducts mapped recipe ingredients immediately. It does not submit a supplier order. Purchasing remains governed by Suppliers & automation and its separate scheduler.

## Import contract and responsibility of the adapter
- Send prepared/consumed item quantities only, after the opening inventory count. Do not backfill sales already reflected in a physical count or imported through another channel.
- Use a stable unique reference (maximum 80 characters) per immutable batch, including merchant/location identity. Retry the exact same reference and payload after a transient failure. A repeat returns success with replayed:true and does not deduct stock again. Reusing a reference with different contents does not apply a correction.
- Maximum 20 lines and 20 distinct ingredients per request. Quantities must be whole numbers from 1 to 10,000. Fractional sales are unsupported.
- Missing mappings, changed ingredient units or absent opening counts reject the batch before deductions. Fix configuration then retry the identical batch reference. Never silently skip unknown items.
- The adapter must handle POS authentication, event signatures, pagination, durable event queues, retries, rate limits and missed-event recovery.
- The adapter must resolve modifiers/substitutions before sending supported recipe mappings. Do not assume a base latte recipe covers extra shots or a milk substitution. Hold unsupported orders for review.
- Do not send canceled/unprepared items. A financial refund does not automatically restore consumed ingredients. Changes to already imported orders require explicit reviewed stock corrections; negative quantities are unsupported.
- Do not use CSV/manual imports and the adapter for the same sales. Idempotency does not match a manual reference to an unrelated POS reference.
- 401: wrong or revoked company token. 415: wrong content type. 413: payload too large. 422: invalid payload or inventory/configuration failure; inspect the error. Transient database errors may also return 422; retry with the same reference after resolving the cause.
- Last accepted request indicates ingestion activity, not comprehensive sync health or proof that every POS sale arrived.

## CSV fallback
Use exactly: provider,location,item_id,quantity. A file may contain 1–20 rows and must be under 50 KB. Standard quoted fields are supported. Upload fills the existing preview only; reviewing and clicking Import sales & deduct stock applies it. Use unique batch references and avoid overlapping already imported sales.

## Before unattended operation
Test with a nonproduction company, reconcile ingredient deductions against prepared sales, and verify duplicate/retry handling. Implement exception alerts and reconciliation for your POS before turning on unattended purchasing. Each new native POS integration can feed this same inventory import service.
