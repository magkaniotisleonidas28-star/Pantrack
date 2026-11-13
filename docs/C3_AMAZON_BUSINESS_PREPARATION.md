# C3 — Amazon Business supplier preparation

Prepared: 2026-11-13. Status: owner decision recorded; account and developer
registration pending. Per [decision 0007](decisions/0007-amazon-business-first-supplier.md),
Amazon Business is the first real supplier target, through its official API.
Public documentation was read on 2026-11-13; no Amazon account was created or
used and nobody at Amazon was contacted.

Keep account names, emails, IDs, identity documents, keys and tokens outside this
repository and outside the conversation. Record only sanitized status here.

## Owner checklist

The owner does each step. None needs Pantrack code or a shared secret.

1. **Create an Amazon Business account** for the US marketplace at
   business.amazon.com. Use your own business details. Use a café's account only
   with its explicit permission.
2. **Create a developer email** just for this, such as
   `yourname_abapi@yourdomain` (Amazon asks for `_abapi` in the name and not a
   group mailing list).
3. **Invite it:** in Amazon Business, open **Account Details → Business
   Settings → Add people**, enter the developer email and give it the **Tech**
   role. Accept the invitation from that inbox.
4. **Register in the Solution Provider Portal** with the developer email:
   **Register**, your organization name, then under "Solution Type Setup" choose
   **Build applications that use SP APIs**. Do **not** choose "Offer services";
   Amazon says that choice cannot be undone and blocks production access.
5. **Tell me when step 4 is done.** The free practice version (sandbox) becomes
   available at this point, so connector work can start while the next steps
   proceed.
6. **Verify identity** in the portal: business information, contact details, a
   government photo ID and a bank or card statement as proof of address, then a
   short video call with Amazon. The person must be able to sign for the
   business.
7. **Submit the developer profile** (Developer Registration Access Form) and
   request the **Business Product Catalog** and **Order Placement** roles.
   Describe the use plainly: cart preparation from reviewed purchase orders, with
   a manager approving every order.
8. **Report the outcome** (approved, denied with reason, or still waiting). If
   denied, Amazon allows fixing the reason and resubmitting.

Later, creating the sandbox app client gives keys. Store them only where the
setup instructions say, never in chat or Git.

## C3 items for Amazon Business

| Decision or handoff | Current status |
| --- | --- |
| First supplier and route | Amazon Business, official API (decision 0007) |
| Amazon Business account | Pending; the owner creates it |
| Solution Provider Portal and identity verification | Pending |
| Developer profile and roles | Pending; Business Product Catalog and Order Placement to request |
| Sandbox access | Pending step 4; static sandbox covers Cart and Product Search, not Ordering |
| Who places the order | Open; the Cart API path ends with an Ordering API call, and website visibility of API carts is unverified |
| Order submission | Disabled until its own gate records evidence; trial mode places no order |
| Products, packs, prices and delivery | Unverified for the café's items |
| Payment responsibility | The account holder's existing terms ([decision 0006](decisions/0006-m10-payment-and-limits.md)); Pantrack never sees payment details |
| Café account use | Needs the café's explicit permission |
| Approval time | No stated timeframe; the owner may revisit the route if it runs long |

## Build sequence

1. **Fakes:** an Amazon Business connector contract against local fakes,
   reusing the shared PO engine's authorization, limits, duplicate prevention and
   cart states. Local evidence only.
2. **Static sandbox:** Product Search and Cart against the sandbox once step 4 is
   done. Sandbox evidence only.
3. **Trial mode:** after approval, a separately authorized trial order that
   Amazon processes without placing.
4. **Real cart or order:** a separately authorized, low-risk test after the
   order-placement question is decided. No automatic purchasing.

## Rollback

This preparation changes documentation only. Revert the commit to undo it. No
account, message, order or payment needs reversal.
