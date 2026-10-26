# Order closure — Part 3 of receiving (2026-10-26)

Scope: Part 3 of the [receiving plan](C4_RECEIVING_PLAN_20261026.md), built on the
[receipt posting port](C4_ORDER_RECEIPT_PORT_LOCAL_EVIDENCE.md) and
[delivery counts and approval](C4_DELIVERY_RECEIVING_LOCAL_EVIDENCE.md). Status: local,
fictional implementation verified. **No checkbox advances; C4/M8 remain open.**

## In plain terms

A confirmed supplier order now **closes** once nothing more is expected:

1. **Automatically**, when a manager approves the delivery that receives (or marks as
   "won't arrive") everything still expected.
2. **Early, by a manager or owner**, when the rest will not come. They give a reason,
   and everything still expected is marked "won't arrive" in the same single save.
   Stock items still on the way are taken off "incoming"; nothing is added to stock.

Closing an order:

- **frees its "in progress" spending hold**, so new orders fit within that limit again;
- **keeps counting its approved amount in the daily and monthly limits**, exactly as
  before. Counting the final paid amount instead waits on the postponed payment
  decisions;
- **stops counting**: staff no longer see the order, and the database refuses new
  counts for it;
- **is permanent**: closures can't be edited or deleted, and an order closes once.

An order can't be closed while a count waits for review; approve it or send it back
first. Orders fully received before this change show "Close order" and close without
a reason.

## Changes

| File | Change |
| --- | --- |
| [`0041_po_cart_order_closures.sql`](../drizzle/0041_po_cart_order_closures.sql) | New, additive, local only. Details below. |
| [`d1-po-cart-deliveries.ts`](../src/lib/d1-po-cart-deliveries.ts) | Reads the closure and the spending hold with each order. The approval that resolves everything adds the closure to its own batch. New `close`: owner or manager only, with replay-safe identity, a session re-check and lost-acknowledgment replay. It marks the rest as not arriving and releases stock lines' incoming through Part 1's port in the same batch. Counting a closed order is refused. |
| [`po-cart-delivery-contract.ts`](../src/lib/po-cart-delivery-contract.ts) | Strict `closeOrderSchema`; closure kinds `complete` and `closed_short` |
| [`/api/po-cart-deliveries`](../src/app/api/po-cart-deliveries/route.ts), [`authorization.ts`](../src/lib/authorization.ts) | New `close` action, which needs `operate` (owner or manager) at the company route |
| [`supplier-deliveries.tsx`](../src/components/workspace/supplier-deliveries.tsx) | "Close order early" with a required reason (or "Close order" when everything is in), and a closed summary saying the hold is freed |
| [`durable-cart.tsx`](../src/components/workspace/durable-cart.tsx), [`po-cart-authorization-contract.ts`](../src/lib/po-cart-authorization-contract.ts) | The spending reservation reads "Settled (order closed)" |
| [`po-cart-delivery-ui-check.mjs`](../scripts/po-cart-delivery-ui-check.mjs) | The served check now closes the order early in the browser |

### Migration `0041`

- **`po_cart_order_closures`:** one row per closed order (keyed by the confirmation),
  with a unique operation identity.
  - **Insert guard:**
    - a current owner or manager of that company closes a `confirmed` order whose
      job and authorization match and whose spending hold is still held;
    - no count is waiting for review;
    - `complete` releases nothing. `closed_short` carries a non-blank reason and
      releases positive whole packs, as text, once per receivable line;
    - **nothing remains owed:** for every confirmed line with packs and every extra,
      approved deliveries plus this closure account for exactly the confirmed packs,
      and every order-linked incoming line is fully received or released;
    - the `stock_receipt` flag matches whether Part 1's receipt rows exist for it.
  - **Permanent:** no updates or deletes.
- **Settling:** an insert trigger moves the order's reservation from `reserved` to the
  new `settled` state. The recreated reservation guard (unchanged from `0033`
  otherwise) allows `settled` only for a closed order, and nothing changes a settled
  hold again. The in-progress total sums `reserved` holds only, so settling frees it.
  The daily and monthly rules sum every started order whatever its state, so they
  keep counting the cap. Neither rule changed.
- **Counting:** the delivery count guard is recreated unchanged from `0040`, plus a
  refusal for closed orders.

## Verification

| Check | Result |
| --- | --- |
| [`po-cart-order-closures`](../tests/po-cart-order-closures.mjs) | See the list below. |
| [`po-cart-deliveries-api`](../tests/po-cart-deliveries-api.mjs) | **Closing:** anonymous, other-company and staff refusals over HTTP. The company route itself refuses staff. Strict input; a second close is refused (409). The last approval closed the order and settled its hold. |
| [`po-cart-order-closures-migration`](../tests/po-cart-order-closures-migration.mjs) | `0041` split by Wrangler keeps all six triggers whole. Fresh and populated upgrades keep every table. An order received in full **before** the upgrade shows as complete with its hold still held, then closes after it and settles. |
| [`po-cart-deliveries`](../tests/po-cart-deliveries.mjs) | Part 2's suite still passes; its completing approval now also closes the order. |
| `pnpm cart:delivery:check` against `pnpm dev:cart-browser-worker`, in an isolated clean clone | **Setup:** a real local browser worker prepares the practice cart. **Flow:** after the recount and approval, one oat milk pack is still expected and the order still takes counts. "Close order early" without a reason is refused with an alert. With a reason, the order shows as closed with the reason and the freed hold. The count and close forms disappear, progress shows the rest as "won't arrive", and the cart's reservation reads "Settled (order closed)". A further count is refused (409), stock is unchanged, there is no narrow overflow, and there are no page errors. **Passed 3/3 on AC power on `de5b9f4`.** |
| Visual review | Screenshots of the early-close form with its reason alert, and the closed order at desktop and phone width |
| Planted defects | **25 of 25 caught**; see the list below |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**143 suites**), `pnpm db:check` (42 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed on `de5b9f4`. Part 2's upgrade test now applies later migrations before running today's service. |

The `po-cart-order-closures` suite proves:

- **Automatic closing:**
  - the approval that resolves everything closes the order and settles the hold;
  - the in-progress total drops by exactly the order's cap, while daily and monthly
    usage stay the same;
  - a partial delivery keeps the order open.
- **Closing early:**
  - anonymous, staff and other-company users are refused, and so is a count waiting
    for review;
  - a reason is required whenever something is still expected;
  - the rest is marked "won't arrive". Stock items' incoming drops by exactly what
    was owed, on-hand stock is unchanged, and other incoming stays;
  - exact replay works, and a reused identity with a different reason is refused;
  - an order with nothing left to receive closes without a reason.
- **The limit works again:** with the in-progress limit full, a new order is refused.
  After one order closes, the same new order fits.
- **After closing:** staff no longer see the order, counts are refused, and closing
  twice is refused.
- **Failures:**
  - a stock change during closing saves nothing;
  - a lost acknowledgment replays;
  - two concurrent closes save once;
  - a revoked manager is refused.
- **Database rules** (each refused row breaks exactly one rule):
  - complete while owed;
  - an unknown kind;
  - no reason;
  - still owed;
  - an unknown line;
  - a duplicate line;
  - leading zeros or numbers instead of text;
  - claiming stock without receipts;
  - staff or another company;
  - incoming stock not released;
  - a count waiting for review (the same row is accepted once it is sent back);
  - settling without a closure;
  - changing a settled hold;
  - editing or deleting a closure;
  - counting a closed order.

The planted defects caught:

1. approval never closes;
2. approval always closes;
3. staff may close;
4. closing needs no reason;
5. closing posts no stock release;
6. closure replay ignoring the fingerprint;
7. the view ignoring closure releases;
8. counts after closing (service and database);
9. closing despite a pending count (service and database);
10. the database ignoring a pending count;
11. the database closing with packs owed;
12. the database closing early without a reason;
13. unknown lines;
14. duplicate lines;
15. leading zeros;
16. numbers instead of text;
17. the stock flag not matching receipts;
18. the database letting staff close;
19. incoming left owed;
20. closing without settling the hold;
21. settling without a closure;
22. a settled hold changing again. It first survived, because only real state changes
    were tested, so a test now rewrites a settled hold to itself;
23. editable closures;
24. deletable closures;
25. the route letting staff close.

## Limits and next

- This is local fictional evidence only. Nothing was deployed, no remote data
  changed, and no supplier, checkout or payment was involved. Hosted D1 has not run
  `0035`–`0041`.
- The practice catalog is non-stock, so the served check proves the screens and
  records. The stock release is proved by the service and migration suites.
- Daily and monthly limits keep counting the approved cap. Counting the final paid
  amount, invoices and supplier payment wait on the postponed payment decisions.
- **Rollback:**
  - Turn off `PANTRACK_CART_PREVIEW`.
  - Never delete closures or rewrite used migrations; forward repair uses a new
    migration.
- **Receiving is complete locally (Parts 1–3).** Remaining C4 work outside this plan:
  - owner approval of over-cap confirmations (supplier confirmation Part 3), which
    waits on the postponed payment decisions;
  - the gates that keep live purchasing disabled.
