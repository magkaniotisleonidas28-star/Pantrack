# C4 receiving: delivery counts and manager approval — plan (2026-10-26)

Status: **plan only.** No code, schema or runtime change. No checkbox advances;
C4/M8 and A8 remain open.

## In plain terms

After a supplier confirms an order, its items show as **incoming stock**. Receiving
is what happens when the delivery truck arrives:

1. **A staff member counts the delivery** on their phone or tablet: how many packs of
   each item arrived, and how many were damaged or wrong.
2. **A manager reviews the count** against what the supplier confirmed and approves
   it. Only then do the good items move from "incoming" to "in stock", **exactly
   once**, however many times anyone retries.
3. **When nothing more is coming**, the order is closed. Its budget hold is freed so
   it no longer counts as an order "in progress".

Deliveries can come in several parts (for example, a backorder arriving next week).
Each part is counted and approved on its own. Staff never see prices and can never
add stock by themselves.

Everything stays in the test-only cart preview with fake data. Nothing goes live,
and nothing contacts a supplier or makes a payment.

## Owner decisions (2026-10-26)

| Question | Decision |
| --- | --- |
| Do staff see the expected amounts while counting? | **No, it is a blind count.** Staff see item names and pack descriptions only. The manager sees the comparison. |
| Can the same person count and approve? | **Yes, and both steps are recorded.** The approval shows who counted and who approved. |
| Who builds the stock side, which the roadmap assigns to workstream A? | **Build it here**, the same as the confirmation port. Nobody has changed A's inventory files since 2026-10-11. |

## Where it fits

- The milestone task says: "Use A's atomic order-linked incoming/receiving port;
  staff count deliveries, managers approve accepted stock once, resolve
  partial/damaged/substituted/excess and non-stock lines before closure."
- The acceptance criteria say: "approved receipts add only accepted stock once",
  "staff cannot … approve or post inventory", and every line must reconcile,
  including count-cutoff conflicts.
- The [order-linked incoming port](C4_ORDER_INCOMING_PORT_LOCAL_EVIDENCE.md) already
  keeps a `received` amount per confirmed line, which only receiving may grow. The
  [confirmation record](C4_SUPPLIER_CONFIRMATION_LOCAL_EVIDENCE.md) keeps the budget
  reserved "until the delivery is checked". This plan finishes both.
- Only `confirmed` orders can be received. Over-cap orders waiting for the owner
  (Part 3 of supplier confirmation) have no incoming stock yet, so they cannot be.

## Part 1 — receipt posting (stock side, workstream A's area)

**What it does:** a safe way to move approved items from incoming into stock, in one
step, together with the manager's approval.

- **Schema** (one additive migration):
  - adds `released_minor` to `inventory_order_incoming`, defaulting to `'0'`. This
    is the part the supplier will never deliver;
  - recreates the existing guards so that `received` and `released` can only grow,
    and together never exceed the confirmed quantity;
  - "still owed" becomes confirmed − received − released, everywhere the floor
    rule uses it.
- **Port** (in A's inventory module): returns guarded statements that the caller adds
  to **its own** batch, as the confirmation port already does:
  - for each line, it grows `received` by the accepted amount and `released` by the
    "won't arrive" amount. Each change is guarded on the previous values, so a
    replay or a race changes nothing;
  - for each product, it lowers incoming by exactly those amounts and adds accepted
    amounts to on-hand stock;
  - it writes one exact `order_receipt` event per product and keeps the older
    inventory record in step.
- **Count-cutoff rule:** suppose a physical count happens **after** the delivery
  arrived but **before** the manager approves it. The count already included those
  items, so approval reduces incoming but **does not add them to stock a second
  time**. The event records why. This is the "count-cutoff conflict" in the
  acceptance criteria.
- **Excess:** more than the confirmed amount can never be posted against the order.
  The manager may accept the excess as separate stock, labelled "not on the
  confirmation — check the invoice".

## Part 2 — delivery count and manager approval (workstream C)

- **Schema** (one additive migration): `po_cart_deliveries`.
  - **One row per counted delivery:** who counted it and when it arrived, then the
    counted packs per line (good, damaged and extra), substituted and non-stock
    lines, and a note.
  - **Approval outcome:** approved or sent back for a recount, with the manager's
    decision for each line and the time.
  - **Rules:**
    - it can't be edited or deleted, and each save has a replay-safe identity;
    - a count can only be approved once.
- **Staff screen:** a new **Deliveries** section in the staff workspace.
  - It lists confirmed orders for the company that are still waiting for items:
    supplier, order number, expected date, and items with their pack descriptions.
    **No prices.**
  - Staff enter packs received and packs damaged for each line, plus a note.
    It is a **blind count**: no expected amounts are shown or returned to staff.
- **Manager screen**, in the existing order panel:
  - **Comparison:** the count shown against the confirmation and what is still
    owed.
  - **Decision for each line:**
    - accept the good packs;
    - reject the damaged ones;
    - keep a shortfall as "still expected", or mark it "won't arrive";
    - accept or decline any excess.
  - **Other lines:** substituted and non-stock lines are marked as received or not,
    with no stock change.
  - **Approval:** one save that writes the approval and Part 1's statements together.
    A refused or uncertain save offers an exact retry, the same as confirmation.

## Part 3 — order closure

- The order **closes** when every line is fully received or marked "won't arrive".
  The manager can also close it explicitly once nothing more is expected.
- **The budget:**
  - closing frees the order's **in-progress** budget hold, using a new `settled`
    reservation state;
  - **daily and monthly** spending keep counting the order's approved cap, exactly
    as today. Counting the final paid amount instead depends on the postponed
    payment decisions.
- A closed order can't be received again.

## Defaults chosen in this plan

- Owners and managers approve; staff count. Owners can also count.
- Deliveries are counted in **whole packs**, matching the confirmation. Loose units
  stay with the normal stock entry.
- Damaged items never enter stock automatically.

## Verification plan (each part)

- **Access:** anonymous, wrong-company, revoked and staff-approval refusal tests;
  staff responses never contain prices.
- **Database:** each new migration is split by Wrangler; fresh and populated
  upgrades work; earlier confirmations can still be received after the upgrade.
- **Behaviour:**
  - exactly-once posting under replay, concurrency and lost acknowledgments;
  - partial deliveries, damage, shortfall, "won't arrive", excess;
  - the count-cutoff case and other orders' incoming staying untouched.
- **Planted defects**, the full local pipeline, and a served browser check of
  count → approve → stock in the isolated clone.

## Not in scope

- Paying suppliers, invoices, and final-price spending accounting (postponed money
  decisions).
- The owner's approval of over-cap confirmations (supplier confirmation Part 3).
- Photos and attachments of delivery notes (typed details only, as before).
- Anything hosted or live.
