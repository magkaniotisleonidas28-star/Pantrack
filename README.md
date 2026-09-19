# Pantrack
Company-based café purchasing pilot built with React, TypeScript, Vinext and Cloudflare D1.

## Implemented
ChatGPT sign-in, company-scoped catalog and history, sample catalog, product editing, quantity validation, grouped review, immutable order snapshots, server-computed estimated totals, idempotent preparation, supplier CSV export and reorder drafts.

Orders are prepared only: no supplier submissions, payments, verified inventory or AI forecasting. Fictional suppliers and prices are labeled in the app. New custom products remain price-unverified. Sample minimums are guidance, not live supplier rules. Unsaved order quantities are temporary; saved orders and products use D1.

## Development
Follow [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) for the pinned Node/pnpm versions, local D1 setup, development sign-in, reset commands, and verification. No production credentials are needed. Generate new migrations with `pnpm db:generate`; apply them locally with `pnpm db:migrate:local`. The logical DB binding is declared in `.openai/hosting.json`.

## Next integration milestone
1. Obtain approved catalog and order API documentation for one pilot supplier.
2. Add supplier account authorization via secret storage.
3. Refresh price, availability, case size, delivery cutoff and minimum spend before approval.
4. Add queued submission and reconciliation with supplier order IDs. Never retry ambiguous submissions without reconciliation.
5. Distinguish prepared, submitting, accepted, rejected and needs-review per supplier; add cancellation only when supported.
6. Complete the [M2 Supabase setup and review](docs/M2_SETUP.md) before a shared multi-staff pilot.
7. Add invoice parsing with human SKU approval once an AI provider is configured.

## Verification
TypeScript and production build passed. An isolated API harness using SQLite verified sample initialization, server totals, preparation status, duplicate retry protection, negative-quantity rejection, owner isolation and missing-auth rejection. Live supplier and payment integrations are absent. Browser UI QA and WebMCP runtime validation were not performed in this session.

## Company accounts and order removal
The entry page offers verified email sign-in through Supabase; all data APIs reject anonymous requests. Company creation grants the signed-in creator owner membership. Company membership is checked server-side before reading or changing a catalog or order. Owners can create, rename, and switch among their companies. A local preference remembers the selected company; it is never used as authorization. M2 now implements Supabase email/password sessions, invitations and membership management; real-provider acceptance and deployment review remain pending. See [M2 setup](docs/M2_SETUP.md) and [local evidence](docs/M2_LOCAL_EVIDENCE.md).

Prior user-scoped data remains in its original storage scope, represented as the existing owner's first company on their next visit. The legacy owner columns now hold a membership-verified company scope. Additive migration 0001 creates companies, memberships and removal tombstones; migration 0000 is unchanged.

Prepared, unsent orders can be removed after confirmation. An atomic database batch checks the persisted status, records a minimal removal tombstone and removes the prepared order. Sent/accepted orders cannot be removed. Removed IDs cannot be reused by a delayed preparation retry.

API regression checks passed for company catalog/order separation, ownership rejection on reads and writes, old-data preservation, sent-order protection, repeat deletion, replay protection and anonymous rejection. Production compilation and TypeScript passed; browser QA was not requested.

## Payment methods
The company Payment methods tab uses Stripe-hosted Checkout in setup mode. It does not collect PAN/CVC in Pantrack or create charges. The server stores only Stripe customer references, scoped to company, Stripe account and test/live mode. Masked card metadata is fetched from Stripe. Setup, confirmation, default selection and removal require owner membership; foreign customer/card/session references are rejected.

Activation requires STRIPE_SECRET_KEY configured as a Sites runtime secret for the app operator's Stripe account. No key is currently configured. Use a test key first and validate hosted setup, cancellation, default and removal with Stripe test cards before enabling a live key. Installing a connector alone does not provision this application secret. The return origin is the current Pantrack Site URL in app/api/payments/route.ts; update it for a domain change. API version is pinned to 2024-06-20.

Saved Stripe payment methods cannot automatically pay arbitrary suppliers. Supplier-specific purchasing and payment integrations remain separate, and no charge endpoints are implemented. Staff billing permissions are not exposed; only company owners can manage cards.

Local contract tests with mocked Stripe responses passed for unavailable-provider behavior, owner isolation, hosted setup parameters, masked output, foreign card/session rejection, default/removal, raw-card payload rejection and absence of charge operations. Production build and TypeScript passed. Real Stripe setup and browser QA remain unverified pending account configuration.

## Pantrack inventory and consumption
Inventory is a company-scoped estimate supported by opening counts, receipt/usage/waste entries, confirmed incoming quantities and corrections. Settings define stock units, units per purchase pack, storage, daily demand assumptions, lead time, reserves, review coverage, optional count reminders, capacity, shelf life and nearest expiry.

Recipes express every ingredient in its configured stock unit. Sales totals can be entered or staged from a strict recipe_id,quantity CSV, then imported with a unique reference. Sales deduct all mapped ingredients atomically; duplicate references cannot deduct again. Missing opening counts or changed units block imports. Variants/modifiers should be separate recipes. Extra unrecorded ingredients can be entered as usage. Negative theoretical balances are allowed after sales and trigger verification instead of silently clamping to zero.

The variation allowance is recipe consumption since last count multiplied by a user-configured percentage. It is a conservative planning heuristic, not an AI-derived probability or calibrated confidence score. Manual corrections reset accumulated estimated consumption. Optional count reminders are displayed in-app and do not send notifications. Reorder suggestions use effective stock, recorded incoming units, daily usage, lead time, reserve and coverage; whole purchase packs are limited by capacity/shelf-life settings and loaded into the existing order review flow.

Not connected: live POS events, supplier invoice OCR, automatic purchase submission, delivery webhooks, external scheduled messages, sensors, weather/seasonal AI forecasting or stockout probabilities. Sales ingestion and receiving are functional local workflows; app visits recalculate plans. Prepared orders never replenish inventory automatically.

Regression checks passed with SQLite for recipe depletion, duplicate sales, optimistic concurrency, receiving/incoming balances, correction reset, negative manual usage rejection, reorder math and isolation. Build and TypeScript checked; browser QA not requested.

## Editable vendors and automation
Suppliers & automation now owns editable vendor website, exact catalog supplier name, customer account, delivery address, notes, connector endpoint and an optional encrypted bearer token. The connector must implement public/vendor-connector-guide.md. Arbitrary vendor websites are not supported checkout integrations. Connections start unverified; editing clears verification, and unresolved proposals/orders block connection edits.

Available policy modes are paused (default) and review. Rules include allowed products, interval, per-order and UTC-day spend limits, and maximum delivered price increase. Review mode creates unsent proposals. Supplier submission and automatic mode are blocked on the server until the real supplier and reviewed pilot milestones are validated. Previously saved automatic policies run as review-only. A successful connector capability check does not authorize purchases.

A quote is validated against exact SKU/unit/quantity, expiry, per-line price, total including fees, and current spend limits. Budget is reserved atomically before the external order action. Every submission uses a stable idempotency reference. Uncertain outcomes stay held and are never automatically retried. The connector's status action reconciles them. Accepted orders close only after receiving evidence with the proposal reference exists in Inventory. Purchases and logs appear in Suppliers & automation → Proposals & orders.

VENDOR_ENCRYPTION_KEY is a runtime-only 32-byte base64 AES-GCM key configured in Sites. Company/vendor binding is authenticated encryption additional data. Do not rotate or delete it without migrating encrypted credentials. Neither connector tokens nor the key are exposed by list endpoints.

Unattended scheduling is not provisioned. Company owners can create/rotate a scheduler token; only its hash is stored. An external scheduler must POST the displayed tick URL with that bearer token. The endpoint runs only due checks, enforces a company lease, and uses the same saved policy. Pausing stops future runs but cannot cancel an in-flight vendor transaction. Public site access remains sign-in gated for all company data; the scheduler token authorizes only that company's due-check endpoint.

Validation: TypeScript and production build; SQLite/mocked connector tests for credential encryption, company isolation, review-only generation, duplicate protection, quote caps, atomic daily budget reservations, sample restrictions, unknown-outcome holds, reconciliation, receipt evidence and scheduler authentication. Real supplier checkout and browser QA were not exercised. Complete sandbox testing against the actual vendor adapter before live use.
