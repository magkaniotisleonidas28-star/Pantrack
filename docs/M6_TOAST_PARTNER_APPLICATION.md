# B8 — Pantrack Toast partner application packet

Prepared: 2026-09-30. Outcome: application material prepared locally for owner
review and private completion. The owner selected the integration-partner route.
Foundation commit `936f3ff` is preserved. B8/M6 remain incomplete.

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
| Applicant's legal business name and entity status | `[OWNER TO CONFIRM]` — Pantrack is the product name, not a verified legal entity |
| Authorized applicant's name, role, and authority to represent the business | `[OWNER TO CONFIRM]` |
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
