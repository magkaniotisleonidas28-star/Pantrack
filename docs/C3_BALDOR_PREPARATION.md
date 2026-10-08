# C3 — Baldor supplier preparation

Prepared: 2026-09-30. Status: research packet and inquiry draft ready.
This is one C3 preparation outcome. Baldor approval, testing access, a working
supplier connection, and M8 acceptance remain pending.

## PO-first direction — 2026-10-03

The [adopted rollout](PURCHASE_ORDER_ROLLOUT.md) makes reviewed emailed POs the
first purchasing method, with optional API/EDI integration at M13 after users.
The historical API inquiry below remains unsent and is now a post-launch access
preparation option, not a launch prerequisite. No supplier has been contacted.

For C3/M8, obtain café permission, an accepted supplier ordering email/contact,
account/location/product references, pack conversions, delivery rules, payment
terms and explicit agreement on unknown-price spending caps. Record confirmations
privately and keep only sanitized decision status here. Baldor's ordering guide,
rechecked on 2026-10-03, describes website/telephone ordering and does not establish
email PO acceptance. Until confirmed, keep email submission disabled and use its
ordinary approved ordering process only under separate authorization.

Replies will go to the café inbox for manual recording in Pantrack. Verify the
Pantrack sending domain/Reply-To and private PDF storage later. Sending an email
does not prove supplier acceptance; confirmed quantities/prices and delivery
counts are separate evidence. Baldor browser automation remains outside scope.

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

Official public pages were checked on 2026-09-30. These establish public
ordering guidance, not permission for Pantrack to use a supplier API.

| Topic | Evidence and remaining decision |
| --- | --- |
| Ordering | Baldor describes account-based website ordering and telephone ordering. Its website provides product selection and current pricing. [Ordering guide](https://www.baldorfood.com/how-to-order) |
| Business minimums | Minimums vary by customer type and location. The café's actual minimum must be confirmed; do not copy home-delivery minimums or old brochure figures. [Business minimum guidance](https://help.baldorfood.com/hc/en-us/articles/360022183633-What-is-the-order-minimum-for-business-accounts) |
| Delivery | Baldor lists a New York warehouse and directs customers to confirm service coverage. Exact delivery days, cutoffs, windows, and fees for this café remain pending. [Business delivery guidance](https://help.baldorfood.com/hc/en-us/articles/360021978654-Does-Baldor-deliver-to-business-accounts-in-my-area) |
| Supplier software access | No Baldor-approved Pantrack API, EDI connection, shared integration service, endpoint, or credentials are confirmed. The reviewed pages do not establish whether such access is available. |
| Contact route | Use the café's representative later with permission, or Baldor's public support route to request the appropriate integration contact. No inquiry has been sent. [Baldor request form](https://help.baldorfood.com/hc/en-us/requests/new) |

## One shared system, with reusable connectors

In the proposed design, the shared purchasing engine owns proposal approval,
limits, duplicate prevention, sending/unknown/accepted states, incoming stock, delivery receipts,
and audit history. A supplier connector translates that engine's requests and
responses into the supplier's approved format. Suppliers using the same
approved integration service or document standard may share a connector;
account setup, product mappings, capabilities, and contract tests still vary.

The existing [generic connector](../src/lib/vendor-adapter.ts) posts the
Pantrack-specific `pantrack.vendor.v1` format. Baldor's shopping website is not
a confirmed endpoint for that format. The [purchasing engine](../src/lib/purchasing-engine.ts)
currently blocks submission unconditionally. The [C4 fake consumer](C4_A7_HANDOFF_EVIDENCE.md)
proves a local proposal handoff only; it has no supplier client.

Future common capabilities should cover account/connection health, catalog and
pack data, price/availability validation, quotes, submission, order status, and
invoice/delivery reconciliation. Label each capability as supported, unavailable,
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
| Integration contact / inquiry | Public routing option checked; inquiry drafted, unsent |
| Approved channel, documentation, capabilities, costs/terms | Pending Baldor confirmation |
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

1. **C3:** obtain separately authorized supplier email PO and café/account
   decisions. Silence is not approval. Record only confirmed sanitized terms.
2. **C4:** complete one local PO-first outcome at a time; preserve exact proposals
   and test draft/export, dispatch uncertainty, budget and delivery contracts
   against fakes. Local checks prove no supplier connectivity.
3. **A8 / C5:** accepted M7, approved email channel and provider/failure evidence
   gate one separately authorized low-risk email PO. Use A's atomic incoming and
   receiving port. No live café account use during preparation.
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
