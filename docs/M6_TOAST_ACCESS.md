# B8 — Toast access handoff

Updated: 2026-09-30. Toast is the owner's selected second POS. The owner
confirmed that Toast API access is not available yet. The
[local adapter foundation](M6_B8_ADAPTER_FOUNDATION.md) can be reviewed now;
native Toast connection and sandbox acceptance remain open.

The owner has selected the **integration-partner application** route. The
[application packet](M6_TOAST_PARTNER_APPLICATION.md) now contains reusable
product/technical drafts and private owner fill-in fields. It is prepared locally;
submission, agreement acceptance, and approval are not recorded.

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
   Credential values belong in secret storage. No application, agreement,
   message to Toast, or account change was submitted by this task.

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
| Application material | [Draft packet](M6_TOAST_PARTNER_APPLICATION.md) prepared locally; owner details pending |
| API agreement acceptance | No owner acceptance recorded; not performed by this task |
| Application submission/date | No submission recorded; not performed by this task |
| Toast response / use-case eligibility | Pending; no response or eligibility confirmation recorded |
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
in the roadmap. No runtime, API, schema, deployment, or provider account changed.
Rollback is a revert of this documentation commit; the foundation remains intact.
