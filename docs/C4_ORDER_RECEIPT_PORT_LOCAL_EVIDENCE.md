# Order receipt posting port — Part 1 of receiving (2026-10-26)

Scope: Part 1 of the [receiving plan](C4_RECEIVING_PLAN_20261026.md), built in
workstream A's inventory modules at the owner's request. Status: local, fictional
implementation verified. **No checkbox advances; C4/M8 and A8 remain open.**

## In plain terms

This is the stock side of receiving: a safe way to move an approved delivery from
"incoming" into "in stock". Nothing calls it yet. Part 2's delivery count and manager
approval will call it, in one step with the approval.

For each confirmed order line, one approved delivery can:

- **accept** packs, which move from incoming into stock;
- **release** packs the supplier will never send, which leave incoming without
  adding stock;
- **add excess**, more than the order owed. This counts as stock but never against
  the order, and only on the delivery that completes that line.

It works **exactly once per delivery**, however often anyone retries. It never
touches another order's incoming or incoming entered by hand. If anything changed
in the meantime, nothing is saved.

**Stock count rule:** if staff did a full stock count after the delivery arrived
but before the manager approved it, the count already included those items. The
approval then lowers incoming **without adding the items to stock a second time**,
and the stock history says why.

## Changes

| File | Change |
| --- | --- |
| [`0039_inventory_order_receipts.sql`](../drizzle/0039_inventory_order_receipts.sql) | New, additive, local only. Details below. |
| [`inventory-management-contract.ts`](../src/lib/inventory-management-contract.ts) | `OrderReceiptLine`, `OrderReceiptInput` and `OrderReceiptRow`; `OrderIncomingRow` gains `releasedMinor` |
| [`d1-inventory-management.ts`](../src/lib/d1-inventory-management.ts) | `orderReceiptStatements` (the port) and `orderReceipts` (a reader). `orderIncomingOwed` and `orderIncoming` now account for released amounts. |
| [`schema.ts`](../src/db/schema.ts) | `inventoryOrderReceipts`; `released_minor` on `inventoryOrderIncoming` |

### The port

`orderReceiptStatements` returns guarded statements for the **caller's own batch**,
like the confirmation port. Before returning anything, it refuses:

- a receipt that was already posted;
- lines that don't belong to the order;
- non-canonical or all-zero amounts;
- more than the line still owes;
- misplaced excess;
- a future or invalid delivery time;
- an approval time at or before the latest count.

Inside the batch, it re-checks:

- that the receipt is still unposted;
- each product balance (version, on hand and incoming);
- each older inventory record;
- each order line's received and released totals.

Then it writes receipt rows, one exact `order_receipt` event per product, the balance,
and the older inventory record. When stock is added, the event is dated at the
delivery time; when a count already included the delivery, it is dated at the
approval.

### Migration `0039`

- **`inventory_order_receipts`:** a permanent receipt log, one row per line per receipt.
  - **Rules:**
    - canonical amounts, at least one of them positive;
    - a valid `stock_added` flag and canonical times;
    - delivery no later than recording;
    - the event identity tied to the receipt and product;
    - receiving never exceeds the line;
    - excess only on the receipt that accepts the rest of the line, with nothing released.
  - **Permanent:** no updates or deletes.
  - **Effect:** an `AFTER INSERT` rule grows the order line's totals, so the receipt log
    and the line always agree.
- **`inventory_order_incoming.released_minor`:** defaults to `'0'`, so lines from
  before the upgrade are unchanged.
- **Three recreated `0037` guards:**
  - **insert:** the new released amount must also start at 0;
  - **update:**
    - received and released are canonical, only grow, and never exceed the confirmed
      quantity together;
    - both must equal the receipt-log totals, so a direct update is refused;
  - **floor:** owed is now confirmed − received − released.

## Verification

| Check | Result |
| --- | --- |
| [`inventory-order-receipts`](../tests/inventory-order-receipts.mjs) | See the list below. |
| [`inventory-order-receipts-migration`](../tests/inventory-order-receipts-migration.mjs) | `0039` split by Wrangler keeps all seven triggers whole. Fresh and populated upgrades keep every table and value; existing lines get released `'0'`. An order confirmed **before** the upgrade is received and partly released after it, leaving manual incoming unchanged. |
| [`inventory-order-incoming`](../tests/inventory-order-incoming.mjs) (updated) | Its direct `received` update is now refused, and a receipt row grows the line instead. Positional raw inserts include the new column, and released starting above 0 is refused. |
| Planted defects | **17 of 17 caught**; see the list below |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**136 suites**), `pnpm db:check` (40 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed. |

The `inventory-order-receipts` suite proves:

- **Partial deliveries, across products:**
  - exact mL minors;
  - on-hand and incoming change by exactly the accepted amounts;
  - the older inventory record follows;
  - another order and manual incoming are untouched;
  - events and the receipt log are correct;
  - a later delivery completes the line;
  - a completed line refuses more.
- **Exactly once:** a replay with any lines is refused, two prepared postings of one
  receipt race and the second aborts, and nothing else changes.
- **Won't arrive:** released amounts lower incoming without stock. A release-only
  receipt is valid, and the line is then closed.
- **Excess:** refused unless the receipt accepts the rest of the line with nothing
  released, including on an already completed line. Allowed excess adds stock only.
- **Count cutoff:**
  - a count after the delivery leaves stock at the count, lowers incoming and
    records why;
  - a count before the delivery lets the delivery add stock, dated at the delivery;
  - a count at the approval time refuses the posting.
- **All or nothing:** a stale balance, a balance-only change, a stale older record, a
  competing receipt, a line-only ledger write, a count, or a failing caller statement
  each abort every product.
- **Refusals:**
  - invalid, duplicate, unknown or all-zero lines;
  - a future or malformed delivery time;
  - an unknown order;
  - another company.
- **Database rules:**
  - raw receipt rows with bad amounts, flags, times, event identities, products or
    lines are refused, and the receipt rule itself refuses over-receiving;
  - receipts can't be updated or deleted;
  - direct line updates are refused;
  - a valid raw row grows its line;
  - the floor and manual receiving exclude released amounts.

The planted defects caught:

1. no count-cutoff rule;
2. no excess completion check;
3. no whole-receipt guard;
4. no balance guard;
5. no line guard. It is masked by the balance guard for normal writers, so the test
   adds a line-only writer;
6. incoming not reduced;
7. released amounts added to stock;
8. no older-record on-hand update;
9. no service check for more than owed;
10. owed ignoring released amounts;
11. line totals not required to match the receipt log;
12. the receipt log not growing the line. The first version of this defect was
    ineffective, and was rewritten;
13. the floor ignoring released amounts;
14. the database allowing excess anywhere;
15. the database allowing over-receiving. Another database rule masked it, so the
    test now requires the receipt rule's own refusal;
16. deletable receipts;
17. released amounts allowed to start above 0.

## Limits and next

- This is local fictional evidence only. Nothing was deployed, no remote data
  changed, and no supplier, checkout or payment was involved. Hosted D1 has not run
  `0035`–`0039`.
- **Rollback:**
  - Nothing calls the port yet, so leaving it unused is safe.
  - Never delete receipts or rewrite used migrations; forward repair uses a new
    migration.
- **Next, Part 2:** staff blind delivery counts and the manager's approval screen,
  calling this port in the approval batch.
