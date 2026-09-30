# B8 — Pantrack Toast partner application packet

Prepared: 2026-09-30. Outcome: application material prepared locally for owner
review and private completion. The owner selected the integration-partner route.
Foundation commit `936f3ff` is preserved. B8/M6 remain incomplete.

The owner confirmed on 2026-09-30 that Pantrack is currently a **personal
project**, rather than a registered business. This is owner-reported project
status, not confirmation that Toast accepts this applicant type.

## How to use this packet

Copy the relevant drafts into a private working document, fill in the owner
details below, then adapt them to the actual questions in Toast's application.
These are reusable answers, not a transcription of the form: the application
form is linked in Toast's follow-up email. Review the wording before submitting.
No application, email, agreement acceptance, or credential request was submitted
by this task.

Toast's [application page](https://pos.toasttab.com/partners/integration-partner-application)
currently directs prospective partners to review its API agreement, follow the
resulting email instructions, and complete the application linked in that email.
The owner performs agreement acceptance and submission. Application submission
does not establish partner approval or sandbox access.

## Owner information checklist — complete privately

The fields below prepare the application; the actual form determines which
fields are required. Keep personal contact details, customer information,
private correspondence, and credentials outside this repository.

| Information | Private fill-in field or confirmed starting point |
| --- | --- |
| Product name | Pantrack |
| Applicant's legal business name and entity status | Owner reports a personal project, not a registered business; Pantrack is the product name. Confirm how Toast accepts an individual applicant if the form requires a legal business. |
| Authorized applicant's name, role, and authority to represent the business | Owner/developer of the personal project; name completed privately. Do not claim authority to represent an unregistered company. |
| Business email and phone, if requested | `[OWNER TO COMPLETE PRIVATELY]` |
| Website or public product page | `[OWNER TO CONFIRM]` — describe any prototype/demo URL accurately |
| Target customer | Cafés; intended future service across multiple businesses |
| Intended launch countries/regions | `[OWNER TO CONFIRM]` |
| Business/development stage and launch expectations | Development prototype; `[OWNER TO CONFIRM BUSINESS STAGE AND TIMING]` |
| Actual customers and adoption figures, if requested | `[OWNER TO CONFIRM]` — no production customer/adoption evidence is recorded in this packet |
| Interested Toast cafés or mutual customers | `[OWNER TO CONFIRM PRIVATELY WITH THEIR PERMISSION]` — no named café or confirmed Toast pilot is supplied |
| Commercial model, if requested | `[OWNER TO CONFIRM]` — pricing and commercial terms are not established by this packet |
| Supporting material | Use a sanitized fictional-data demo and accurately labeled development evidence |

Use a truthful response such as “not yet established” where applicable. Do not
invent a business registration, customer count, website, pilot commitment, or
launch date to fill a blank. Store a completed application copy privately.

## Simple walkthrough for the owner

1. Open the [Toast application starting page](https://pos.toasttab.com/partners/integration-partner-application)
   and choose **Start Step 1**.
2. Review Toast's agreement. Its starting form asks for an email address, your
   name, and a company name. Complete contact details privately. Describe
   Pantrack as a personal project; do not present it as a registered company.
   If the form requires a registered business, ask Toast how an individual
   should apply before proceeding. The public starting page does not confirm
   personal-project eligibility.
3. Decide whether to accept the agreement yourself. Section 2.4(vii) restricts
   competing products, and section 4.8 lists business insurance requirements.
   Clarify how these apply to this personal project and fictional development
   testing before accepting if you cannot confirm compliance. This packet does
   not make a legal or agreement decision for you.
4. After completing that step, check your email, including spam, for Toast's
   application link. Open the linked form and adapt the prepared answers below
   to its actual questions.
5. Review the answers and submit the application yourself. Save the
   confirmation privately and report only “Submitted” and the date so the
   access tracker can be updated.
6. Approval and access to a testing restaurant are later steps. B8 remains open
   after application submission.

### Short answers to copy and adapt

**What is Pantrack?**

Pantrack is a personal software project being developed for cafés. It helps
managers track ingredient stock, recipes, deliveries, counts, and waste. It is
currently a working prototype.

**Why connect to Toast?**

We want to read menu and sales information from Toast so Pantrack can estimate
how many ingredients each sale used. This would reduce manual sales entry and
help café managers review their stock and replenishment needs. Unknown items
would be held for review, and repeated sales information would not deduct stock
twice.

**What access are we asking for first?**

We are asking whether this personal project and its inventory use case are
eligible for your partner program. If approved, we would like a testing account
with a fictional restaurant, initially with read-only menu, restaurant, and
sales access. The first test would connect to that restaurant and read its menu.

**How far along is it?**

The inventory prototype and common POS foundation have local tests. Clover has
passed a defined set of fictional development tests. The Toast connection has
not yet been built or tested with Toast. There is no production customer
evidence in this packet. Add actual customer interest only if you can confirm
it accurately and have permission to share it.

### Clarification message — owner reviews and sends

Toast's agreement lists `developer-support@toasttab.com` for API development
questions. Use that address to ask for the correct partner-application contact
if no partner contact has been supplied. This is a draft, not a sent message.

**Subject:** Pantrack personal-project eligibility and testing access

Hello Toast team,

I am developing Pantrack as a personal project, not a registered business.
It is a café inventory prototype. The proposed integration would read menus
and sales to estimate recipe-based ingredient use and help managers review
replenishment needs. Toast access has not yet been configured.

Before accepting the API agreement, could you please confirm:

- Whether an individual developing a personal project can apply, and how to
  complete the required company-name field accurately.
- Whether this inventory and replenishment use case is eligible under section
  2.4(vii).
- Whether the insurance requirements in section 4.8 apply at the application
  and fictional sandbox-testing stages, or whether a different development
  agreement is available.
- Whether an approved applicant can receive a testing account with a fictional
  restaurant and read-only menu, restaurant, and sales access, and what costs
  or prerequisites apply.

If this is not the correct team, please direct me to the partner-application
contact. Thank you.

## Reusable application drafts

### Product description

Pantrack is a café inventory and replenishment software prototype. It tracks
ingredient stock, recipes, physical counts, receipts, use, and waste. Its planned
Toast integration would translate menu-item sales and mapped modifiers into
recipe-based ingredient use, helping managers review estimated stock and prepare
replenishment decisions. Pantrack is intended to support separate workspaces
for multiple café businesses.

### Proposed integration and customer benefit

We propose a read-only Toast integration for restaurant and menu identification,
sales reconciliation, and recipe-based ingredient tracking. Managers would map
Toast items and modifiers to their own recipes. Pantrack would process stable
order identities and revisions, prevent duplicate ingredient deductions, and
hold unknown mappings for review. Counts and receipts would remain part of the
manager workflow. The intended benefit is less repeated sales entry and a clearer
record of expected ingredient use and replenishment needs.

The first development outcome would authenticate to an approved sandbox,
verify one fictional restaurant, and read its menu. Sales ingestion and recovery
would follow as separately validated outcomes. Supplier ordering is a separate
future integration; automatic purchasing remains disabled.

### Current development status and evidence

Pantrack has a company-scoped inventory/recipe prototype and a shared POS
adapter foundation tested locally. Its Clover integration has owner-accepted,
bounded development-sandbox evidence for recorded sales, modifier handling,
duplicates, revisions, refund behavior, connection lifecycle, and polling
recovery. Additional provider cases and pilot/production approval remain open.

Toast is selected as the second POS. Native Toast authentication, catalog access,
sales ingestion, and webhook handling are not implemented. A fictional second
provider fixture tests the common event contract locally; it is not a Toast
parser or Toast sandbox validation. Production customer/adoption claims are not
supported by the current project evidence.

### Requested access and development sequence

We request confirmation that Pantrack's inventory-tracking and reviewed
replenishment use case is eligible for a Toast integration partnership, together
with the applicable approval process and commercial terms. After approval, we
request the sandbox hostname, credentials delivered through a secure channel,
and access to a fictional restaurant for development.

Our proposed read scopes are `orders:read`, `menus:read` for Menus V2, and
`restaurants:read`, subject to Toast's approval. We would also like to confirm
Orders updated webhook availability, subscription/authentication requirements,
polling and pagination limits, and certification expectations. The initial
connection outcome would not create orders or take payments.

The scope request follows Toast's [current scope reference](https://doc.toasttab.com/doc/devguide/apiScopes.html).
Its [inventory integration checklist](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistInventory.html)
describes webhook and order-polling approaches; they remain planned Toast
capabilities in Pantrack.

### Customer demand — fill in privately

`[OWNER TO ADD AN ACCURATE ACCOUNT OF INTERESTED CUSTOMERS, OR STATE THAT NO
TOAST PILOT CUSTOMER IS CONFIRMED. SHARE NAMES OR CONTACTS ONLY WITH PERMISSION.]`

Toast's application page asks applicants to explain the proposed integration
and any mutual-customer interest. No customer endorsements are implied by the
drafts above.

## Owner submission checklist

1. Complete the private information checklist and review the product drafts.
2. Open the official [partner application starting page](https://pos.toasttab.com/partners/integration-partner-application).
3. Review the linked [API agreement](https://pos.toasttab.com/api-documentation-license-agreement).
   If you choose to proceed and have the authority to do so, complete its
   acceptance yourself. This packet makes no agreement decision for you.
4. Follow the email instructions and complete the linked partner application
   yourself using accurate business details and the adapted drafts.
5. Retain the submission confirmation privately. Report only a non-sensitive
   status and date for the [access tracker](M6_TOAST_ACCESS.md).
6. Follow up through the channel Toast supplies. Confirm eligibility, costs,
   approval requirements, and sandbox access; record unknowns as pending.

Toast's [partnership process](https://dev.toasttab.com/doc/devguide/integrationDevProcess.html)
describes review, agreements, development access, and later certification. No
approval date, response time, or acceptance is promised by this packet.

## Handoff and evidence limits

- **Owner/C3:** complete business details, submit the application, and provide
  the approved non-secret access handoff in [M6_TOAST_ACCESS.md](M6_TOAST_ACCESS.md).
- **B:** after approved sandbox access, plan one read-only Toast connection
  outcome using the [existing adapter foundation](M6_B8_ADAPTER_FOUNDATION.md).
  Native sales cases and B8 acceptance follow in separate tasks.
- **Local evidence:** this packet is grounded in current repository evidence
  and official Toast pages checked on 2026-09-30. The foundation's code/test
  evidence belongs to its earlier record; no runtime tests were rerun for this
  documentation-only outcome.
- **External evidence:** no Toast application submission, agreement acceptance,
  approval, credential provision, API call, or sandbox connection is proved.
- **Contracts/migrations/rollback:** no API, schema, runtime, or deployment
  change. Revert this documentation commit to remove the packet and tracker
  additions; foundation commit `936f3ff` remains intact.
