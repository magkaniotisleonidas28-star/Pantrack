# Clover P1: one unusual order can't stop syncing — local evidence

Recorded: 2026-11-25. Branch: `workstream-b/clover-p1-unreadable-orders`,
based on `main` at `9dfae82`. It is **local evidence only**: nothing was
deployed, no Clover account (sandbox or live) was contacted, and Clover sync
stays off on every hosted site.

This is step P1 of the
[Clover pilot connection roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md),
following [decision 0012](decisions/0012-clover-pilot-connection.md) item 5:
"An unusual order never blocks the others." The owner asked to "start P1" on
2026-11-25.

## Before

`normalizeCloverOrder` threw an error for any order it couldn't read safely.
The error ended the whole sync. The checkpoint did not move, so every later
sync failed on the same order until someone stepped in.

## What changed

- **Reasons**
  ([order reader](../src/lib/clover-orders.ts)). Each problem now raises
  `CloverUnreadableOrder` with one of five reasons:

  | Reason | Order shape |
  | --- | --- |
  | `clover_custom_amount` | A line with no menu item (an amount typed in at the register) |
  | `clover_sold_by_weight` | `unitQty` other than one whole item |
  | `clover_order_too_large` | 100 or more lines, or 100 or more options on one line |
  | `clover_refund_mismatch` | Refund details or amounts that don't add up |
  | `clover_unreadable_order` | Anything else: missing lines, option or line identity, payment time, detail that doesn't match its list entry, or details intake refuses |

- **Paused sale.** `readCloverOrder` turns an unreadable order into its own
  paused sale (`pausedCloverOrder`):
  - it has **no lines**, so nothing can come off stock;
  - its time is inferred and is never later than now;
  - its identity is the order and its modified time, as usual.

  A refund that doesn't add up takes the next revision and a `refund-review`
  identity, like a readable refund. That way, a paid receipt already stored
  for the same modified time is never overwritten.
- **Deleted orders.** An unreadable deleted order becomes a plain Clover
  deletion with no lines. The existing rules already handle that case, and
  nothing is put back in stock (decision 0003).
- **Sales intake**
  ([intake](../src/lib/sales-ingestion.ts),
  [model](../src/lib/sales-event-model.ts),
  [store](../src/lib/d1-sales-event-store.ts)):
  - **Stored reason.** A paused order is stored with `unreadable`, and it
    stays held with that reason however often it is tried again.
  - **Who can send one.** Only a native Clover source may send one, only with
    no lines, and only with a known reason.
  - **Unchanged.** Unpaid open orders, and orders created before connecting,
    are still ignored as before.
- **Sync** ([sync](../src/lib/clover-sync.ts)):
  - every order goes through `readCloverOrder`;
  - a detail that doesn't match its list entry, or details intake refuses (for
    example invalid line IDs), pause that order under its list identity;
  - other failures still stop the sync, as before: Clover outages, invalid
    order pages, the page limit and database errors;
  - so does a sale time slightly ahead of Pantrack's clock (up to 5 minutes,
    from clock drift). That order is not paused for good; the next sync reads
    it once the time has passed;
  - the result gains `paused`, the number of orders paused in that run.
- **Sales review list**
  ([labels](../src/lib/sales-hold-labels.ts),
  [screen](../src/components/workspace/sales-exceptions.tsx)):
  - each paused order shows its reason in plain words, for example "Custom
    amount with no menu item";
  - it says: "Nothing was taken from stock. Check the order in Clover, then
    dismiss it or record the sale by hand."

**Review**:
- **Try again** keeps a paused order paused.
- **Dismiss** records the review.
- **A later change in Clover** arrives as a new revision of the order, is read
  as usual and is applied once.

There is no migration: pause reasons are stored as text in the existing
`last_reason` and `normalized_json` columns. There is no API or permission
change.

## Tests

[`tests/clover-unreadable-orders.mjs`](../tests/clover-unreadable-orders.mjs),
with an in-memory database from all migrations and a mocked Clover sandbox,
covers:
- **Reasons:**
  - each of the five reasons, and that normal orders read as before;
  - unpaid and pre-connection orders are still ignored;
  - a paused order has no lines and a time no later than now;
  - the refund revision rule;
  - deleted orders.
- **One sync with good orders on both sides of six unusual ones** (custom
  amount, weighed item, 100 lines, refund mismatch, invalid line ID,
  mismatched detail):
  - the two good orders each take one cup, once (10 → 8);
  - each unusual order is held with its reason;
  - there is no sync error, and the checkpoint advances;
  - `paused` is 6.
- **Running the sync again:** nothing new and no extra stock change.
- **A payment time 2 minutes ahead of the clock** stops that run as before,
  and the order is not paused for good.
- **Review:**
  - **Try again** keeps the custom-amount order paused, with no stock change;
  - a person can **Dismiss** the weighed one.
- **A corrected revision** of the custom-amount order in Clover is applied
  once (8 → 7), and a further sync adds nothing.
- **Intake rejects:**
  - a paused order from a non-Clover source;
  - a paused order with lines;
  - an unknown reason.

The existing Clover, sales and A8 suites (22) pass unchanged, including the
sales module's pinned public exports.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 191 suites (including the new `clover-unreadable-orders`) |
| `pnpm db:check` | Passed: 55 ordered migrations match the schema; no new migration |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the changed files.

## Not covered

- **Sandbox behaviour** for these order shapes. Step P5 records what Clover
  actually sends for custom amounts, weighed items, refunds and voids.
- **Taking part of an order.** A paused order is held whole, as decision 0012
  says; "Not tracked" lines are step P2.
- **Outages and page limits.** A Clover outage, an invalid orders page or the
  page limit still stops a run without moving the checkpoint, as before.
  Automatic catch-up is step P3.
- **Hosted sites and real cafés.**
