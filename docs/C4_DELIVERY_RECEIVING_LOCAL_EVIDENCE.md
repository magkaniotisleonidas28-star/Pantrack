# Delivery counts and manager approval — Part 2 of receiving (2026-10-26)

Scope: Part 2 of the [receiving plan](C4_RECEIVING_PLAN_20261026.md), built on the
[receipt posting port](C4_ORDER_RECEIPT_PORT_LOCAL_EVIDENCE.md). Status: local,
fictional implementation verified. **No checkbox advances; C4/M8 remain open.**

## In plain terms

When a delivery arrives for a confirmed order:

1. **Someone counts it.** Staff see a new **Deliveries** section in their workspace,
   listing supplier orders that are still waiting for items.
   - For each item, they enter the packs that arrived and how many are damaged,
     plus when the delivery arrived and an optional note.
   - **It is a blind count:** staff see item names and pack descriptions only,
     never the expected amounts or any prices.
   - Managers and owners can count from the order panel too.
2. **A manager or owner reviews it** in the order panel, which shows the count
   beside what is still expected. For each item, they choose:
   - how many good packs to accept;
   - any extra packs (only once everything expected is accepted);
   - whether the rest "won't arrive".

   Damaged packs are never added. Anything not accepted stays expected.
3. **Approve or send back.**
   - **Approval** moves the accepted packs into stock in the same single save, using
     Part 1, exactly once. Items that aren't stock are recorded but change no stock.
   - **"Ask for a recount"** needs a reason; nothing changes, and someone counts again.
   - The same person may count and approve. Both names are recorded.

Only one count per order can wait for review at a time. Counts and decisions can't be
edited or deleted. When everything is received or marked "won't arrive", the order
says so and takes no more counts. Closing it and freeing its spending hold is Part 3.

## Changes

| File | Change |
| --- | --- |
| [`0040_po_cart_deliveries.sql`](../drizzle/0040_po_cart_deliveries.sql) | New, additive, local only. Details below. |
| [`po-cart-delivery-contract.ts`](../src/lib/po-cart-delivery-contract.ts) | Strict count, approval and recount schemas. `receivables` (confirmed lines with packs, plus substituted extras), `progress` (accepted, released and owed packs per line), `checkCount` and `decide`. `decide` converts stock lines to exact minors at the order's frozen conversion. |
| [`d1-po-cart-deliveries.ts`](../src/lib/d1-po-cart-deliveries.ts) | `staff` (the blind list), `manager` (the comparison and history), `count`, `approve` and `recount`. Each has replay-safe identity, a session re-check before saving, and lost-acknowledgment replay. Approval batches Part 1's port statements with the decision. |
| [`/api/po-cart-deliveries`](../src/app/api/po-cart-deliveries/route.ts) | Same gates as the other cart routes: preview flag, loopback, company wrapper and CSRF |
| [`authorization.ts`](../src/lib/authorization.ts) | New route family `deliveries` and permission `countDeliveries`. Any member may count; approve and recount need `operate` (owner or manager). |
| [`delivery-count.tsx`](../src/components/workspace/delivery-count.tsx), [`supplier-deliveries.tsx`](../src/components/workspace/supplier-deliveries.tsx) and `deliveries.css` | The blind count form and staff list; the manager's progress, review and history |
| [`employee-workspace.tsx`](../src/components/workspace/employee-workspace.tsx), [`durable-cart.tsx`](../src/components/workspace/durable-cart.tsx) | A staff **Deliveries** section, shown only while the preview serves it. The deliveries panel appears for a confirmed order. |
| [`po-cart-delivery-ui-check.mjs`](../scripts/po-cart-delivery-ui-check.mjs) and `pnpm cart:delivery:check` | Served browser check |

### Migration `0040`

- **`po_cart_deliveries`:** one row per count.
  - **Indexes:** count and decision operation identities are unique, and a partial
    unique index allows only one **pending** count per order.
  - **Insert guard:**
    - the row starts as `counted`, with no decision fields;
    - a valid, non-empty count, a note of at most 1,000 characters, and canonical
      times with arrival no later than counting;
    - the counter is a current owner, manager or employee **of that company**;
    - the order is a `confirmed` (within-cap) confirmation with a matching job.
  - **Decision guard:**
    - only `counted` becomes `approved` or `recount`, once;
    - the count fields never change;
    - the decider is a current owner or manager;
    - a recount carries a non-blank reason and no decision;
    - an approval carries a valid decision, and its `stock_receipt` flag must
      match whether Part 1's receipt rows exist.
  - **Permanent:** no deletes.
- **`po_cart_delivery_guards`:** an abort table. The approval inserts into it if its
  own update did not decide the pending row, so a recount landing during an
  approval saves nothing, not even stock.

## Verification

| Check | Result |
| --- | --- |
| [`po-cart-deliveries`](../tests/po-cart-deliveries.mjs) | See the list below. |
| [`po-cart-deliveries-api`](../tests/po-cart-deliveries-api.mjs) | **Access:** anonymous, other-company and staff-decision refusals over HTTP. The company route itself refuses staff decisions. **Gates:** default-off, loopback, and actual CSRF/origin checks. **Input:** strict intent, and no amounts in staff responses. **Saves:** concurrent identical counts give one receipt; responses are private; a second approval is refused. |
| [`po-cart-deliveries-migration`](../tests/po-cart-deliveries-migration.mjs) | `0040` split by Wrangler keeps all four triggers whole. Fresh and populated upgrades keep every table. An order confirmed **before** the upgrade is counted and approved after it. |
| `pnpm cart:delivery:check` against `pnpm dev:cart-browser-worker`, in an isolated clean clone | **Setup:** a real local browser worker prepares the practice cart, and the confirmation is recorded within the cap. **Staff:** see a Deliveries section with a blind count (no prices or expected amounts, three columns only). They save the count and see that it waits for a manager. They can't read the comparison (HTTP 403), and the form fits a phone width. **Manager:** sees accept defaults capped at what is expected. A recount without a reason is refused; with one, it is sent back. The manager counts again and approves with "won't arrive" on a short line and one extra pack. Progress shows the result, and history shows both entries with who counted and decided. **Afterwards:** a further count is refused (409), stock is unchanged (the practice catalog is non-stock), there is no narrow overflow, and there are no page errors. **Passed 3/3 on AC power on the final source** (`09843fb`). |
| Visual review | Screenshots of the staff count form at desktop and phone width, the manager review, the completed panel and the narrow manager panel |
| Planted defects | **20 of 20 caught**; see the list below |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**140 suites**), `pnpm db:check` (41 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed on `09843fb`. |

The `po-cart-deliveries` suite proves:

- **Blind and private:**
  - anonymous and other-company users are refused;
  - staff list entries carry only names, SKUs and pack descriptions, with no
    amounts or prices;
  - staff can't read the comparison.
- **Strict counts:**
  - every open item answered once;
  - damaged within received, and something must have arrived;
  - a real arrival time, not in the future;
  - exact replay works, and a reused identity with different input is refused;
  - only one pending count per order;
  - a count alone never changes stock.
- **Decisions:**
  - staff and other companies can't approve or recount;
  - every counted item must be decided;
  - accept no more than is expected and no more than the good packs;
  - extra packs only once everything expected is accepted, and never with "won't
    arrive";
  - a count is decided once.
- **Stock effects:**
  - accepted packs move from incoming into stock at the frozen conversion;
  - damaged packs stay out;
  - "won't arrive" reduces what is expected;
  - extra packs add stock only;
  - substitutes and non-stock items are recorded only;
  - a completed order takes no more counts.
- **Self-approval** is allowed, and both names are recorded.
- **Recount:** needs a reason, changes nothing, and lets someone count again.
- **Count cutoff, end to end:** a physical count after the delivery means approval
  adds no stock a second time.
- **Failures:**
  - a stock change during approval saves nothing;
  - a recount landing during approval saves nothing, not even stock;
  - a lost acknowledgment replays;
  - a revoked manager is refused.
- **Database rules:**
  - counts for other companies, mismatched jobs or pre-decided rows are refused;
  - staff decisions are refused;
  - an approval claiming stock without receipts is refused;
  - a recount without a reason is refused;
  - count edits, later decision changes and deletes are refused.

The planted defects caught:

1. staff may approve;
2. the staff list leaks expected packs;
3. damaged may exceed received;
4. accepting beyond what is expected. It first survived, because the good-pack
   limit refused the only case, so a test now accepts beyond what is expected
   within the good packs;
5. damaged packs accepted;
6. extra packs any time;
7. "won't arrive" ignored;
8. no stock posting;
9. no pending check and no pending index;
10. no decision guard statement;
11. replay ignoring the fingerprint;
12. the database letting staff decide;
13. the stock flag not required to match receipts;
14. a database recount without a reason;
15. counts editable at decision time;
16. decisions changeable. It first survived, and a test now edits an approved
    decision;
17. deletable counts;
18. database counts for other companies;
19. the route letting staff approve. The service check masked it at first, and the
    test now requires the route's own refusal;
20. the route blocking staff counting.

## Limits and next

- This is local fictional evidence only. Nothing was deployed, no remote data
  changed, and no supplier, checkout or payment was involved. Hosted D1 has not run
  `0035`–`0040`.
- The practice catalog is non-stock, so the served check proves the screens and
  records. The stock movement is proved by the service, port and migration suites.
- **Rollback:**
  - Turn off `PANTRACK_CART_PREVIEW`.
  - Never delete counts or rewrite used migrations; forward repair uses a new
    migration.
- **Next, Part 3:** order closure, which frees the order's in-progress spending hold.
