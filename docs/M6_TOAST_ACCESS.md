# B8 — Toast access handoff

Updated: 2026-09-30. Toast is the owner's selected second POS. The owner
confirmed that Toast API access is not available yet. The
[local adapter foundation](M6_B8_ADAPTER_FOUNDATION.md) can be reviewed now;
native Toast connection and sandbox acceptance remain open.

The owner has selected the **integration-partner application** route. The
[application packet](M6_TOAST_PARTNER_APPLICATION.md) now contains reusable
product/technical drafts and private owner fill-in fields. The owner's agreement
completion is now supported by Toast's confirmation viewed directly in Safari;
the owner submitted the linked application on 2026-09-30. Toast's receipt
confirmation was observed directly in Safari. Approval and testing access
remain pending.

The owner reports that Pantrack is a **personal project**, not a registered
business. The packet includes a simple walkthrough and short draft answers for
that stage. Toast's acceptance of an individual applicant remains unconfirmed;
do not infer it from access to the public application page.

Toast's public API agreement (checked 2026-09-30) contains a competing-product
restriction in section 2.4(vii) and business insurance requirements in section
4.8. The owner now reports reviewing the terms and believes clarification has
been received. No clarification details or provider confirmation were supplied
for this tracker; record this as owner-reported review, not verified eligibility
or partner approval. The packet's clarification draft remains available. No
message has been sent and no agreement accepted by the agent.

## Application submission sequence — owner actions

1. Complete the packet's business/contact/customer details in a private copy.
2. Open Toast's [partner application page](https://pos.toasttab.com/partners/integration-partner-application)
   and review the linked API agreement. Complete agreement acceptance yourself
   only if you choose to proceed and are authorized to represent the applicant.
3. Follow Toast's email instructions and submit the application linked there
   yourself. Use the packet's drafts after checking the actual form questions.
4. Keep confirmations/correspondence private; record only a non-sensitive
   submission status/date below. Ask Toast to confirm the use case's eligibility,
   approval requirements, costs/terms, and sandbox availability.

This sequence follows the current application page. Submission is a separate
stage from approval and credential provision. The agent has not sent a message,
submitted a form, accepted an agreement, or requested credentials.

## Owner and C3 checklist

1. **Confirm the access route with Toast.** For Pantrack's intended service
   across multiple cafés, the owner selected integration-partner access, subject
   to Toast's approval. A restaurant-specific custom
   integration is a different route, initiated through the restaurant's Toast
   representative. Review the [partnership process](https://dev.toasttab.com/doc/devguide/integrationDevProcess.html),
   costs, agreement, approval requirements, and eligible pilot restaurant before
   treating the provider-selection gate as complete.
2. **Request sandbox access.** Obtain the approved sandbox hostname and a
   fictional restaurant GUID from Toast. Sandbox access is limited to partner
   and custom integrations; standard and analytics API access are production
   only. Use the hostname supplied by Toast rather than guessing a host. See
   [environments](https://doc.toasttab.com/doc/devguide/apiEnvironments.html).
3. **Keep credentials private.** Toast issues a client ID and client secret.
   Store them through the agreed local secret-manager/environment setup when
   the connection slice is ready. Do not paste either credential or bearer
   tokens into chat, source files, screenshots, reports, or command arguments.
4. **Confirm read permissions.** Ask Toast to approve `orders:read`,
   `menus:read`, and `restaurants:read` for the inventory-tracking use case.
   These cover orders without guest information, Menus V2, and restaurant
   metadata/availability. Current guidance reserves Menus V3 for ordering
   partners; inventory integrations should use V2. Verify actual granted scopes
   against the [scope reference](https://doc.toasttab.com/doc/devguide/apiScopes.html).
   The first connection slice needs no order/payment write permission.
5. **Confirm delivery options.** Establish whether this approved integration
   can subscribe to Orders updated webhooks and obtain the current subscription
   and authentication requirements. Plan bounded modified-date polling and
   pagination as recovery. Toast's [inventory integration checklist](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistInventory.html)
   describes both approaches. Pantrack advertises neither as implemented Toast
   functionality today.
6. **Record only the non-secret handoff.** Record the approved integration type,
   sandbox hostname, fictional restaurant GUID, granted scope names, webhook
   availability, test-access restrictions, and approval/cost decisions here.
   Credential values belong in secret storage. The owner completed agreement
   acceptance and application submission; the agent did not submit either.

## Next B8 implementation slice

Once the above access exists, implement one read-only connection outcome:
authenticate, verify access to the bound fictional restaurant, read a bounded
Menus V2 response, and report truthful company-scoped status. Review any new
credential/binding migration through the schema queue. Test anonymous,
wrong-company, forbidden-role, missing-scope, expired-token, timeout, and
disconnect behavior before a separately authorized sandbox validation.

Toast uses OAuth 2 client credentials via
`/authentication/v1/authentication/login`. After a token expires, request a new
token; Clover's rotating refresh-token logic does not apply. See
[authentication](https://doc.toasttab.com/doc/devguide/authentication.html).

Sales parsing, mapping, checkpoint/recovery behavior, authenticated webhooks,
and provider sale/refund/void/modifier evidence are later B8 outcomes. B8/M6
remain unchecked until a real second provider satisfies the roadmap evidence.

## Access record

| Item | Current evidence |
| --- | --- |
| Second POS | Toast, selected by owner |
| Access route | Integration-partner application, selected by owner |
| Applicant stage | Owner reports a personal project, not a registered business; individual eligibility unconfirmed |
| Personal-project / agreement questions | Owner reports reading the terms and believes clarification has been received; no details or independent provider verification supplied |
| Application material | [Draft packet](M6_TOAST_PARTNER_APPLICATION.md) adapted to the actual form in Safari; owner entered contact details privately and submitted the application. The hosted prototype was selected and labeled as requiring sign-in. |
| API agreement acceptance | Owner completed the agreement on 2026-09-30; Toast's confirmation email was observed directly in Safari. The agent did not accept it. |
| Application submission/date | Owner submitted on 2026-09-30; Toast's receipt confirmation was observed directly in Safari. The agent did not click Submit. |
| Toast response / use-case eligibility | Submission receipt observed; review response and eligibility confirmation pending. The receipt says a response may take up to 30 days; it does not promise approval. |
| API access | Owner reports none yet |
| Partner/custom approval and terms | Pending |
| Sandbox hostname and fictional restaurant | Pending |
| Read scopes | Requested scope plan only; not granted/verified |
| Credentials | Not supplied or configured by this task |
| Webhook availability | Pending provider confirmation |
| Native connection/catalog/sales | Not implemented |

Update a row only after the corresponding owner report or sanitized provider
evidence exists; label owner reports as such. Keep reference numbers, private
contacts, correspondence, agreement documents, and credential values outside
this tracker. For approved access, record only the sandbox hostname, fictional
restaurant GUID, scope names, webhook availability, and non-sensitive status of
approval/terms. A partner approval still needs an explicit sandbox access handoff.

## Packet completion and verification

The application packet and owner checklist are prepared locally on
`workstream-b/b8-toast-access-packet`, based on foundation commit `936f3ff`.
The submission sequence and five added official source URLs were checked on
2026-09-30; all five added relative Markdown links resolve. `git diff --check`
passed, and the full documentation diff was reviewed for private information,
unsupported claims, scope, and conflicting instructions. Runtime tests were
not rerun for this documentation-only task.

B8/M6 completion remains gated by the real second adapter and sandbox evidence
in the roadmap. The initial packet preparation changed no runtime, API, schema,
deployment, or provider account. Its rollback is a documentation revert; the
foundation remains intact. The later owner submission is recorded below.

## Personal-project walkthrough follow-up — 2026-09-30

The owner authorized the application walkthrough after confirming the
personal-project stage. Safari reached the official agreement page, and its
three initial fields and **I Agree** button were observed without entering
contact details or submitting. The packet now contains short answers and a
clarification draft for individual eligibility, the inventory use case, and
application/testing-stage insurance requirements. At that point, no Toast
clarification was recorded; submission and approval were not claimed.

Verification: `git diff --check` passed; all four unique relative link
occurrences across the two changed documents resolve. The official application
and agreement pages were checked through web reads, and the agreement's initial
form was observed directly in Safari. Runtime checks were not rerun because
this follow-up changes documentation only.

Subsequent owner report on 2026-09-30: the terms were read and the owner believes
clarification has been received. This does not establish agreement acceptance,
application submission, or Toast approval. The initial Safari form was observed
with owner-entered details and its **I Agree** action available. Contact values
were not copied into this tracker.

Subsequent direct observation on 2026-09-30: Toast's agreement-completion
confirmation was open in Safari. The agent followed its partner inquiry link
and reached the **Integration Request Application**. The owner was entering
business/contact answers. At that stage, submission and approval were pending.
No email address, personal name, message reference, or tracking-link value is
recorded here.

The owner confirmed USA, no current customer cafés or Toast integration
requests, no sales team, an initial focus on individual cafés/small groups,
and no organization initiatives in the form's listed categories. The form's
product and payment answers describe a prototype and disabled purchasing.
The integration description requests read-only fictional testing. Its API
access dropdown offered **Read & Write** and **I'm not sure**; the latter was
selected, with explicit read-only scope wording in the description. This is
an application choice, not granted API access. Clover is listed with its
development-only limit explained in the product answer.

The agent reviewed the owner-entered website and requested a relevant product
link before submission. The owner selected the existing hosted Pantrack
prototype, observed in Safari at
`https://pantrack-dev.christospsimadas25.workers.dev`. The form's website field
was updated and its product description explicitly states that the prototype
requires sign-in. The access-level answer and final Clover/organization answers
were verified visually, and the **Submit** button was observed without clicking
it. No website deployment or account change was performed. Financial/contact
values, the completed form, private correspondence, and any credentials remain
outside this tracker.

The owner then submitted the application on 2026-09-30. Safari showed
**Thank you!** and **Your submission has been received.** in place of the form.
The confirmation says a response may take up to 30 days because of application
volume and limited bandwidth. This proves receipt, not approval, applicant
eligibility, or testing access. The agent did not click **Submit**.

Next owner action: await Toast's review response and retain it privately.
No repeat application is needed. After approval, obtain the non-secret sandbox
handoff above before planning the separate read-only connection outcome.
Approval and testing access remain separate open gates.

Application closeout verification: `git diff --check` passed and all four
unique relative link occurrences across the two changed documents resolve.
The full diff was reviewed for private data and unsupported completion claims.
Runtime checks were not rerun for this documentation-only outcome.

Only this handoff and the packet changed. No runtime, schema, deployment,
provider credential, or agent-sent external message changed. The agreement and
application were completed by the owner; the agent observed both confirmations.
B8/M6 remain open. Revert the follow-up documentation commit to undo these
additions; a documentation revert does not withdraw the submitted application.
