# Owner approval of over-cap confirmations — plan (2026-10-26)

Part 3 of the [supplier confirmation plan](C4_SUPPLIER_CONFIRMATION_PLAN_20261025.md),
unblocked by [decision 0006](decisions/0006-m10-payment-and-limits.md). Local and
fictional only. **No checkbox advances.**

Built and verified locally: [evidence](C4_OVER_CAP_APPROVAL_LOCAL_EVIDENCE.md).

## In plain terms

Sometimes the supplier confirms an order for more than its approved spending cap
(prices went up, extra items, delivery fees). Today such an order is recorded and
**held**: nothing is added to incoming stock and no delivery can be counted.

With this change, the **owner** reviews it and, after confirming their password,
approves it. Approval then:

- raises the order's counted amount to the confirmed total, for the in-progress,
  daily and monthly limits;
- adds the confirmed items to incoming stock once, as a within-cap confirmation
  does;
- lets deliveries be counted and the order close as usual.

Only owners can approve. Managers see that the order is waiting for the owner.

## Technical outline

- **One migration:**
  - a permanent `po_cart_confirmation_approvals` record (who, when, approved total,
    note, replay identity);
  - the reservation guard, recreated to allow raising the held amount to the
    approved total;
  - the delivery, closure and commitment guards, recreated to treat an approved
    over-cap confirmation like a confirmed one.
- **Service:** owner only, with recent password confirmation. The approval,
  reservation increase, incoming stock (Part 1's port) and product-hold release are
  saved in one batch, replay-safe.
- **Screen:** the confirmation panel shows the over-cap amount and an owner-only
  "Approve over-cap total" with the password prompt.
- **Verification:**
  - access tests;
  - migration split and upgrade;
  - planted defects;
  - the full pipeline;
  - a served check. Practice sign-in has no password, so it shows the prompt and
    that nothing is saved without confirmation, as the spending-limits check does.

## Decisions for the owner

Answered by the owner on 2026-10-26:


| Decision | Answer |
| --- | --- |
| The approved total would put the café over a daily, monthly or in-progress limit | **Count it, with a warning.** Approval is still allowed and the screen says by how much it goes over; new carts are then refused until spending is back under. |
| The owner does not want to approve | **Leave it held,** with the owner's note. No stock is added and no delivery can be counted; the manager sorts it out with the supplier. |
| Other database changes in progress | None; the teammate confirmed |
