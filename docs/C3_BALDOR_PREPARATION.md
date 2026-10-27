# C3 — Baldor supplier preparation

Prepared: 2026-09-30. Status: research packet and inquiry draft ready.
This is one C3 preparation outcome. Baldor approval, testing access, a working
supplier connection, and M8 acceptance remain pending.

## PO-backed browser direction — 2026-10-09

[Decision 0005](decisions/0005-po-backed-ai-cart-preparation.md) supersedes the
2026-10-03 email-first direction. The [rollout](PURCHASE_ORDER_ROLLOUT.md) and
[integration guide](PO_AI_CART_INTEGRATION_ROADMAP.md) plan Stagehand-assisted
Browserbase cart preparation and manager-controlled checkout. AI never checks
out. The earlier email PO inquiry/acceptance work is deferred, not an active gate;
no supplier has been contacted. Historical API preparation remains optional M13.

C3 must establish permitted browser use, café/account/location authorization,
exact product codes/packs/conversions, delivery rules, current prices and fees,
payment responsibility and a safe testing arrangement. Neither published ordering
instructions nor an existing café account establishes automation permission.
Baldor's previously reviewed access restrictions remain unresolved; do not bypass
them, sign in or test against Baldor until permission and explicit scope exist.

Keep sanitized access decisions here, with account material private. Validate
hosted-fictional behavior and separately budget Browserbase/worker costs before
supplier tests. First test cart preparation without a purchase. A low-risk manager
checkout needs separate authorization and uses existing supplier payment terms.
Pantrack cannot enforce the manager's final external checkout cap; reconcile
confirmation and delivery separately. Missing approval leaves the real connector
disabled while fictional development continues.

### Browser-access inquiry — owner reviews and sends

**Status: withdrawn by the owner on 2026-10-26 ([decision 0006](decisions/0006-m10-payment-and-limits.md)); never sent.** Whether Baldor's terms allow automated access stays an open question, and any real Baldor session still needs separate explicit authorization. The draft is kept for reference: ask the supplier's appropriate contact whether Pantrack may
use a controlled hosted browser to prepare a cart from an exact reviewed PO,
with manual sign-in/2FA and a human performing all checkout. Confirm permitted
automation, required agreements/restrictions, supported authentication domains,
account/location verification, test account/environment and test costs. Request
an approved read/cart-only test scope, exact product/pack sources, delivery/payment
rules and recovery options. Do not identify the café or imply its permission.
Sending this inquiry requires separate explicit authorization.

## What the owner selected

- Baldor is the first supplier candidate.
- The owner reports an existing New York City café that already uses Baldor.
  The café is a future pilot candidate; permission to access its account,
  process its data, or place an order has not been established.
- Develop the shared connection framework and use fictional testing first.
  The café should participate after connection development and testing.
- B8 is on hold while Toast reviews the submitted application. Supplier
  preparation and the [waste and margin roadmap](WASTE_AND_MARGIN_ROADMAP.md)
  can proceed independently.

Keep café identity, contacts, account numbers, delivery addresses, private
prices, invoices, agreements, and credentials outside this repository.

## Current evidence

Official public pages were checked on 2026-09-30 (historical research, not
reverified supplier terms in this change). They establish public ordering
guidance, not permission for Pantrack browser automation or an API.
The superseded email-first packet also recorded a 2026-10-03 recheck of Baldor's
website/telephone ordering guide; it did not establish emailed PO acceptance.
That historical observation remains preparation evidence, not browser permission.

| Topic | Evidence and remaining decision |
| --- | --- |
| Ordering | Baldor describes account-based website ordering and telephone ordering. Its website provides product selection and current pricing. [Ordering guide](https://www.baldorfood.com/how-to-order) |
| Business minimums | Minimums vary by customer type and location. The café's actual minimum must be confirmed; do not copy home-delivery minimums or old brochure figures. [Business minimum guidance](https://help.baldorfood.com/hc/en-us/articles/360022183633-What-is-the-order-minimum-for-business-accounts) |
| Delivery | Baldor lists a New York warehouse and directs customers to confirm service coverage. Exact delivery days, cutoffs, windows, and fees for this café remain pending. [Business delivery guidance](https://help.baldorfood.com/hc/en-us/articles/360021978654-Does-Baldor-deliver-to-business-accounts-in-my-area) |
| Supplier software access | No Baldor-approved Pantrack API, EDI connection, shared integration service, endpoint, or credentials are confirmed. The reviewed pages do not establish whether such access is available. |
| Contact route | Use the café's representative later with permission, or Baldor's public support route to request the appropriate integration contact. No inquiry has been sent. [Baldor request form](https://help.baldorfood.com/hc/en-us/requests/new) |

## One shared system, with reusable connectors

In the revised design, the shared PO engine owns preparation authorization,
limits/reservations, duplicate prevention, separate cart/purchase/delivery states,
incoming stock, receipts and audit history. A browser connector discovers exact
products and prepares/verifies carts within those boundaries; managers control
checkout. Future approved API connectors can reuse the same commercial record.
Account setup, product mappings, capabilities and contract tests still vary.

The existing [generic connector](../src/lib/vendor-adapter.ts) posts the
Pantrack-specific `pantrack.vendor.v1` format. Baldor's shopping website is not
a confirmed endpoint for that format. The [purchasing engine](../src/lib/purchasing-engine.ts)
currently blocks submission unconditionally. The [C4 fake consumer](C4_A7_HANDOFF_EVIDENCE.md)
proves a local proposal handoff only; it has no supplier client.

Future common capabilities should cover account/connection health, catalog and
pack data, price/availability validation, cart preparation/verification, manager
handoff, confirmation and invoice/delivery reconciliation. API submission remains
optional M13; AI checkout remains separate M14. Label each capability as supported, unavailable,
or unverified. Consume A's immutable proposal without recalculating its
shortfall in the connector. Preserve manual order-list export when a supplier
does not provide an approved automated route.

## Historical API inquiry draft — M13 preparation, owner reviews and sends

**Status: unsent.** The owner can use Baldor's request form to ask for the
integration team. Add any contact details privately. This draft does not
identify the café or claim its authorization.

**Subject:** Pantrack development access and approved Baldor integration options

Hello Baldor team,

I am developing Pantrack, a café inventory and replenishment software
prototype. It would help managers review ingredient stock, prepare supplier
order proposals, and reconcile confirmed orders and deliveries. Supplier
submission and automatic purchasing are currently disabled.

An existing New York City café that uses Baldor may participate later in a
separately authorized pilot. We would like to develop and test the connection
before using its live account or placing orders.

Could you direct us to the appropriate integration contact and confirm:

1. Which software connection methods Baldor permits: API, EDI, an approved
   integration service, or another supported channel?
2. Whether a personal-project developer can apply, and which agreements,
   approvals, fees, or certification requirements apply?
3. Whether development access with a fictional account is available, and
   whether catalog, product codes, pack sizes, pricing, availability, quotes,
   order status, and invoices can be read without creating orders?
4. If submission is supported, how duplicate protection, uncertain responses,
   reconciliation, changes, cancellations, substitutions, and partial deliveries
   work, and whether these can be tested without a real purchase?
5. How restaurant-specific account authorization, delivery rules, payment terms,
   access revocation, credential storage, and data-use restrictions are handled?

Please share the approved documentation and secure access process. We are not
requesting a real order or a change to the café's account at this stage.

Thank you.

## Access and account checklist

Record non-sensitive status here; retain the actual account material privately.

| Decision or handoff | Current status |
| --- | --- |
| First supplier and region | Baldor / New York City, selected by owner |
| Future café and existing business account | Owner-reported; no independent account inspection or pilot permission |
| Integration contact / inquiry | Public routing option checked; browser-access inquiry withdrawn by the owner (decision 0006), never sent |
| Permitted Stagehand/Browserbase cart use, restrictions, capabilities and costs/terms | Pending Baldor confirmation; automation permission unverified |
| Hosted-fictional safety, Browserbase/worker budget and supplier test scope | Pending; no paid hosted or supplier test authorized |
| Fictional testing account and authorized environment | Pending; no credentials requested or stored |
| Account ownership, location authorization, and data-use permission | Pending for later café pilot |
| Product codes, pack quantities, stock-unit conversions, substitutions | Pending; no real café catalog imported |
| Account prices, price validity, minimums, cutoffs, fees, delivery windows | Pending account-specific confirmation |
| Payment responsibility and spending limits | Pending; no assumption that Pantrack pays or the existing account is charged |
| Idempotency and uncertain-order reconciliation | Required future contract; supplier behavior unverified |
| Status, invoice, and delivery matching | Required future contract; supplier behavior unverified |

### Product mapping worksheet — fill privately later

For a small pilot set, record Pantrack ingredient, exact Baldor product code,
variant/brand, purchase pack contents, inventory unit, conversion, price and
effective date, availability, substitution rule, and account/location binding.
Verify against approved catalog data or the café's authorized source. Hold
unknown codes or conversions for review. Do not invent real SKUs or prices.

## Sequence and handoff

1. **C3:** obtain permitted browser access, café/account/location authorization,
   exact mappings, payment/delivery rules and approved testing scope. Silence is
   not approval; retain sanitized confirmed terms only.
2. **C4:** complete one fictional PO-to-cart outcome at a time: exact authorization,
   durable jobs, session privacy, worker recovery, budgets and delivery contracts.
   Preserve offline regressions; hosted-fictional safety evidence is separate.
3. **A8 / C5:** accepted M7, supplier permission and hosted-fictional safety evidence
   gate supplier cart-only validation. A low-risk manager checkout needs separate
   authorization. Use A's atomic incoming/receiving port; no AI checkout.
4. **M11:** obtain written business/data permission and complete reviewed
   count-to-delivery pilot cycles with every PO line accounted for.
5. **M13:** after M12 and production users, prioritize actual supplier demand
   and pursue the historical API inquiry if appropriate. API access/testing and
   any real API order require their own evidence and explicit authorization.

If Baldor offers no test account, record that limit. The shared engine can still
be developed with fictional data, but direct Baldor validation requires a
separate plan for an approved account. Keep a manual reviewed order-list path
available while automated access is pending.

## Verification and rollback

This preparation changes documentation only. No public API, runtime contract,
schema, credential, deployment, schedule, or purchasing setting is changed.
Documentation checks and external-evidence limits are recorded in the
[feature roadmap handoff](WASTE_AND_MARGIN_ROADMAP.md#original-preparation-handoff).
Revert the preparation commit to undo the documentation changes. No Baldor
message, account change, order, payment, or café data import needs reversal.
