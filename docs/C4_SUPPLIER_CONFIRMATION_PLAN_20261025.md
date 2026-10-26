# C4 supplier confirmation and order-linked incoming stock — plan (2026-10-25)

Status: **plan only.** No code, schema or runtime change. No checkbox advances;
C4/M8 and A8 remain open.

## In plain terms

After a manager checks out on the supplier's website, the supplier confirms the
order, usually by email. This work lets the manager **record that confirmation in
Pantrack**: the supplier's order number, the items and quantities confirmed, final
prices, extra charges, and the expected delivery date. Pantrack then counts the
confirmed items as **incoming stock**, exactly once, until they are delivered.

It comes in two parts, each reviewed separately:

1. **The stock side** (the inventory team's area, built at the owner's request): a
   safe way to add incoming stock for one confirmed order. It never counts an order
   twice, and it never wipes out another order's or a manual incoming amount.
2. **The confirmation record:** what the manager enters, with duplicate protection.
   It highlights differences from the approved order and keeps the budget reserved
   until delivery is checked. A confirmed total above the order's approved cap
   waits for the **owner's** approval before anything counts as incoming.

Everything stays in the test-only cart preview, with fake data and typed details
only (no file attachments). Nothing goes live and nothing contacts a supplier.
Recording deliveries (receiving) is a later, separate task.

## Owner decisions (2026-10-25)

| Question | Decision |
| --- | --- |
| Who builds the incoming-stock port, which the roadmap assigns to workstream A | **Build both parts here.** Nobody has changed A's inventory files since 2026-10-20. Part 1 stays in new A-owned modules, plus one guard in the manual incoming setter. |
| Attachments (supplier email/PDF) | **Typed details only for now.** Private file storage is a later outcome. |

**Defaults chosen in this plan** (say if you want them changed):

- **Over-cap confirmations need the owner.** The owner controls spending, so
  approving a confirmed total above the cap is owner-only, with the same recent
  password confirmation as loosening a limit.
- **Within the cap, there is no tolerance yet.** Every price and quantity difference
  is shown and recorded. The deferred price-tolerance decision is only needed for
  later automation.
- **A manual "incoming" edit cannot go below what confirmed orders still owe** for
  that product. The screen explains why.

## Where it fits

- The [PO rollout](PURCHASE_ORDER_ROLLOUT.md) and the
  [integration roadmap §8](PO_AI_CART_INTEGRATION_ROADMAP.md) require the following:
  - manager-entered evidence with provenance;
  - "checkout completed" alone is not confirmation;
  - duplicate references are rejected within the company/supplier/account;
  - replays never add incoming twice;
  - commitments convert into order-linked incoming without replacing other
    incoming quantities;
  - uncertain exposure is kept until reconciled.
- The [milestone ownership note](PANTRACK_MILESTONES.md) assigns A the atomic
  multi-product confirmation/receiving port and says C must not write inventory
  through sequential movements. This plan builds that port in A's modules, inside
  one batch with C's record.

## Part 1 — order-linked incoming port (A domain)

- **Schema** (one additive migration; the number is assigned at merge time):
  - `inventory_order_incoming`: one row per confirmed stock line. It holds company,
    confirmation, line, product, config id and version, dimension, the confirmed
    quantity in exact minor stock units, the received quantity (0 until receiving),
    actor and time.
  - It is append-only, except that a later receiving outcome may increase
    `received`.
  - A database guard keeps each product's `incoming_minor` at or above the sum it
    still owes to confirmed orders.
- **Port** (new module, `src/lib/d1-inventory-order-incoming.ts`): returns guarded
  statements that a caller includes in **its own** batch, for several products at
  once.
  - **Steps:** for each line, it inserts the order-incoming row, adds the quantity
    to `incoming_minor` under the balance version guard, writes an exact inventory
    event, and keeps the legacy inventory mirror in step.
  - **Conversion:** quantities come from the frozen pack conversion in the
    authorization. Today's settings are never used.
  - **Refusals:** a stale balance, a changed or inactive config, a dimension
    mismatch or a duplicate confirmation line refuses the whole batch.
- **The manual setter** (`d1-inventory-management.ts`, the `incoming` action)
  refuses a value below the outstanding order-linked sum. The database guard backs
  this up.
- **Tests:**
  - multi-product atomicity;
  - exact-once replay;
  - another order's incoming, and manual incoming, are never replaced;
  - stale-version and config races;
  - the manual setter floor;
  - legacy mirror parity;
  - the Wrangler splitter, D1 pattern limits, fresh and populated upgrades;
  - planted defects.

## Part 2 — confirmation record (C4)

- **Schema** (a later migration):
  - `po_cart_confirmations`: company, id, job/authorization/order, supplier
    reference, account and location, currency, confirmed lines (SKU, packs, unit
    price), charges, expected delivery, item subtotal and total, state, provenance
    `manager_entered`, actor and times.
  - A unique supplier reference per company, supplier and account.
  - Replay receipts.
  - A commitment transition that lets confirmation deactivate the authorization's
    commitments once order-linked incoming exists.
- **Service and API** (`/api/po-cart-confirmations`, gated like the other cart
  routes):
  - **Who:** owners and managers record; owners approve over-cap.
  - **Precondition:** the job's verified cart is accepted and its reservation is
    held.
  - **Matching:** confirmed lines are matched to the authorized lines by SKU. An
    unmatched SKU (a substitution) is held for review and adds no stock.
  - **Within the cap:** one batch writes the confirmation, the port statements,
    the commitment transfer and the audit.
  - **Above the cap:** the confirmation is saved as awaiting owner approval, with
    no incoming. Owner approval, after password confirmation, applies it in one
    batch.
  - **Budget:** the reservation stays until delivery reconciliation.
- **Manager screen:** a "Record supplier confirmation" form beside the accepted
  cart. It shows the differences, and the confirmation's state and history. The
  other contributor's PO history and export work is not modified; the record
  becomes available to it through its own read.
- **Tests:**
  - permissions (anonymous, wrong company, employee, manager, owner);
  - CSRF;
  - duplicate references;
  - replay;
  - over-cap approval;
  - substitution hold;
  - exact-once incoming;
  - commitment transfer;
  - races with cancellation and abandonment;
  - a served browser check;
  - planted defects.

## Limits, coordination and rollback

- **Migration queue:** only one schema change may be in the queue at a time. Part
  1's migration merges before Part 2's is generated.
- **Not included:**
  - receiving and delivery counts;
  - attachments;
  - real suppliers;
  - payment;
  - hosted changes;
  - automatic retries or channel switching.
- **Rollback:** turn off `PANTRACK_CART_PREVIEW`. Never delete rows or rewrite used
  migrations; forward repair uses a new migration.
