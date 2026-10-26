# Order-linked incoming stock port — Part 1 of supplier confirmation (2026-10-25)

Scope: Part 1 of the [supplier confirmation plan](C4_SUPPLIER_CONFIRMATION_PLAN_20261025.md).
This is A's atomic order-linked incoming port, built in A's modules at the owner's
request. Status: local, fictional implementation verified. **No checkbox advances;
C4/M8 and A8 remain open.** Nothing calls the port yet; Part 2's confirmation
record will.

## In plain terms

Pantrack can now add a confirmed supplier order to a product's **incoming stock**
safely:

- **Exactly once.** A confirmation can only be applied one time, as a whole.
- **Never overwriting anything.** It adds on top of any incoming amount typed in by
  hand, and on top of other orders.
- **All or nothing.** If any product in the order changed in the meantime,
  nothing is saved, and the caller can retry.
- **Using the order's frozen quantities,** not today's pack settings.

Today's manual tools now respect confirmed orders:

- someone typing in "expected incoming" **can't go below** what confirmed orders
  still owe, and the message says how much is still due;
- receiving a delivery by hand reduces only the manually entered part. The
  order-owed part is reduced by the future receiving task.

The database itself enforces that floor too.

## Changes

| File | Change |
| --- | --- |
| [`0037_inventory_order_incoming.sql`](../drizzle/0037_inventory_order_incoming.sql) | New, additive, local only. Details below. |
| [`inventory-management-contract.ts`](../src/lib/inventory-management-contract.ts) | `OrderIncomingLine`, `OrderIncomingInput` and `OrderIncomingRow`, the A → C port contract |
| [`d1-inventory-management.ts`](../src/lib/d1-inventory-management.ts) | `orderIncomingStatements`, `orderIncoming` and `orderIncomingOwed`; the manual `incoming` floor; the `receive` (from incoming) clamp |

### Migration `0037`

- **`inventory_order_incoming`:** one row per confirmed stock line. It holds the
  company, confirmation, line, product, frozen config, dimension, exact quantity,
  received quantity (starts at 0), event, actor and time.
  - Rows cannot be deleted.
  - Only `received` may change, and only upward, up to the confirmed quantity.
- **`inventory_port_guards`:** any insert aborts the batch.
- **`inventory_balance_order_floor`:** a product's `incoming_minor` can never drop
  below what its confirmed orders still owe, and its unit dimension cannot change
  while they owe anything.

### How the port works

`orderIncomingStatements` returns statements for the **caller's own batch**.

- **Inside the batch, it re-checks:**
  - that the confirmation has not been applied yet;
  - each product's exact balance (version, config, dimension and incoming);
  - each product's legacy mirror version.
- **Then, per product, it:**
  - inserts one order-incoming row per line;
  - writes one `order_incoming` inventory event;
  - adds the summed quantity to `incoming_minor` under the version;
  - updates the legacy mirror to match.
- **Before building any statement, it refuses:**
  - invalid or duplicate lines;
  - non-positive or non-canonical quantities;
  - a dimension mismatch;
  - an unconfigured product;
  - a time at or before the latest physical count;
  - an already-applied confirmation.

## Verification

| Check | Result |
| --- | --- |
| [`inventory-order-incoming`](../tests/inventory-order-incoming.mjs) | See the list below. |
| [`inventory-order-incoming-migration`](../tests/inventory-order-incoming-migration.mjs) | `0037` split by Wrangler keeps each trigger whole. Fresh and populated upgrades leave every existing table, including existing incoming, unchanged. The port then adds on top (3 + 4 = 7). Foreign-key and integrity checks pass. |
| `d1-pattern-limits` | Passes; every new pattern fits D1's 50-byte limit |
| Planted defects | **12 of 12 caught**; one is noted below the list |
| `pnpm typecheck`, `pnpm test` (**130 suites**), `pnpm db:check` (38 migrations), `pnpm build`, `pnpm db:migrate:local` (applied `0037`), `pnpm test:local` | Passed |

The `inventory-order-incoming` suite proves:

- **Adding and once-only:**
  - a 3-product confirmation adds 6 each beside a manual 3 (total 9), and 250 mL
    (exactly 250,000,000 minors; the legacy mirror is +250);
  - one event per product, with version before and after;
  - re-applying a confirmation with the same or different lines is refused;
  - two prepared applications of one confirmation: the second aborts inside its
    batch;
  - a second confirmation adds on top.
- **All or nothing:** a stale balance, an exact-only balance change, a stale legacy
  mirror, a later count and a failing caller statement each leave **nothing**
  applied, for any product.
- **Refusals:** each invalid input listed above.
- **Manual floor:** the manual floor message, the exact-floor allowance and the
  receipt clamp work.
- **Database rules:** direct SQL below the floor, a dimension change, deletes,
  quantity edits, decreasing or over-receiving, guard-table inserts and malformed
  rows are all refused; growing `received` is allowed.

The planted defects caught:

1. no whole-confirmation guard;
2. no balance guard;
3. no legacy guard;
4. replacing instead of adding;
5. no count cutoff;
6. no dimension check;
7. no legacy mirror update;
8. no manual floor;
9. no receipt clamp;
10. no database floor;
11. an editable order quantity;
12. received starting above 0.

The balance-guard defect first survived: the stale-legacy check masked it. An
exact-balance-only stale case was added, and it is now caught. Writing the suite
also found a real gap: a confirmation could be re-applied with *different*
lines. The whole-confirmation guard fixes it.

## Limits and next

- This is local fictional evidence only. Nothing was deployed and no remote data
  changed. Hosted D1 has not run `0035`–`0037`.
- Receiving, meaning reducing order-owed incoming as deliveries arrive, is a later
  outcome.
- **Rollback:** revert. The new tables stay empty until Part 2 uses them, and used
  migrations are never rewritten.
- **Next:** Part 2, the supplier confirmation record that calls this port.
