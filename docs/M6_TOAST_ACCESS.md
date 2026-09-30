# B8 — Toast access handoff

Updated: 2026-09-30. Toast is the owner's selected second POS. The owner
confirmed that Toast API access is not available yet. The
[local adapter foundation](M6_B8_ADAPTER_FOUNDATION.md) can be reviewed now;
native Toast connection and sandbox acceptance remain open.

## Owner and C3 checklist

1. **Confirm the access route with Toast.** For Pantrack's intended service
   across multiple cafés, pursue integration-partner access. This is a planning
   recommendation, subject to Toast's approval. A restaurant-specific custom
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
| API access | Owner reports none yet |
| Partner/custom approval and terms | Pending |
| Sandbox hostname and fictional restaurant | Pending |
| Read scopes | Requested scope plan only; not granted/verified |
| Credentials | Not supplied or configured by this task |
| Webhook availability | Pending provider confirmation |
| Native connection/catalog/sales | Not implemented |
