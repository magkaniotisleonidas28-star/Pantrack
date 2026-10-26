# Supplier confirmation record — Part 2 of supplier confirmation (2026-10-26)

Scope: Part 2 of the [supplier confirmation plan](C4_SUPPLIER_CONFIRMATION_PLAN_20261025.md),
built on the [order-linked incoming port](C4_ORDER_INCOMING_PORT_LOCAL_EVIDENCE.md).
Status: local, fictional implementation verified. **No checkbox advances; C4/M8
remain open.**

## In plain terms

After the practice cart is verified, the manager sees **Record supplier
confirmation**. They enter what the supplier confirmed:

- the supplier's order number and the expected delivery date;
- for every ordered line, the confirmed packs (0 if the supplier didn't confirm it)
  and the confirmed unit price;
- any substituted or extra items, and charges such as delivery fees or tax.

The form shows the running total against the order's approved cap. When saved:

- **Within the cap:**
  - each confirmed stock item is added to **incoming stock exactly once**, using the
    order's frozen pack sizes;
  - the products stop being "held" by the preparation, because incoming stock now
    covers them;
  - the budget stays reserved until the delivery is checked.
- **Over the cap:** the confirmation is recorded and **held for the owner's
  review**. No stock is added and the products stay held.
- **Either way:**
  - the supplier account is freed for the next cart, because the confirmation
    proves checkout happened;
  - the confirmation **can't be edited, duplicated or replaced**, and the same
    supplier order number can't be used twice on one account;
  - the confirmed order can no longer be cancelled from the preparation side,
    because cancelling a preparation never cancels a real purchase.

A checkout, or a ready cart, on its own is never a confirmation.

**Scope change from the plan:** the owner's approval of an over-cap confirmation
needs a way to count the extra spending against the owner's limits. That depends
on the money decisions the owner postponed, so it moves to a later **Part 3**.
Over-cap confirmations are safely held until then.

## Changes

| File | Change |
| --- | --- |
| [`0038_po_cart_confirmations.sql`](../drizzle/0038_po_cart_confirmations.sql) | New, additive, local only. Details below. |
| [`po-cart-confirmation-contract.ts`](../src/lib/po-cart-confirmation-contract.ts) | A strict request schema (every authorized line, whole packs and cents, a real delivery date, four charge kinds). `computeConfirmation` works out the differences, totals, state and incoming lines at the frozen conversion. |
| [`d1-po-cart-confirmations.ts`](../src/lib/d1-po-cart-confirmations.ts) | Owner/manager `get` and `record`, with replay-safe identity. One batch saves the confirmation, A's port statements (within the cap), the commitment release (within the cap) and the account release. |
| [`/api/po-cart-confirmations`](../src/app/api/po-cart-confirmations/route.ts) | Gated like the other cart routes (preview flag, loopback, company wrapper, CSRF) |
| [`supplier-confirmation.tsx`](../src/components/workspace/supplier-confirmation.tsx) and CSS | The form and the recorded summary. Differences are bolded, and an uncertain save offers an exact retry. |
| [`durable-cart.tsx`](../src/components/workspace/durable-cart.tsx) | Shows the form for a ready cart. After confirmation it shows "Supplier confirmed" and hides cancel, inspection and stale preparation guidance. |
| [`po-cart-confirmation-ui-check.mjs`](../scripts/po-cart-confirmation-ui-check.mjs) and `pnpm cart:confirmation:check` | Served browser check |

### Migration `0038`

- **`po_cart_confirmations`**:
  - one per job;
  - a unique supplier reference per company, supplier and account;
  - a unique operation identity;
  - immutable.
- **Insert guard**, which requires all of these:
  - manager-entered provenance and USD;
  - a trimmed reference;
  - a real ISO date;
  - canonical times;
  - consistent totals;
  - a state that matches the cap (`confirmed` when the total is at or below it,
    `needs_owner_review` when above);
  - an owner or manager actor;
  - the current **ready** job and revision, with its active authorization and
    revision, the same order, and a reservation still held at the cap.
- **`po_cart_confirmed_job_lock`:** the job state cannot change once confirmed.
  This also blocks permission cancellation and PO-edit invalidation, through the
  existing cascade.
- **Two existing guards, recreated from their exact `0033` text with one added
  case each:**
  - commitments may be released for a `confirmed` confirmation;
  - account ownership may end for any recorded confirmation.

The job's own `purchase_state` column is unchanged: it records preparation, and
the confirmation table is the source of truth for the purchase.

## Verification

| Check | Result |
| --- | --- |
| [`po-cart-confirmations`](../tests/po-cart-confirmations.mjs) | See the list below. |
| [`po-cart-confirmations-api`](../tests/po-cart-confirmations-api.mjs) | HTTP denial for anonymous, employee and wrong-company users. Default-off and loopback gates, actual CSRF/origin checks, strict intent (including a malformed date, which first crashed validation and is now fixed), concurrent identical saves returning one receipt, and private responses. |
| [`po-cart-confirmations-migration`](../tests/po-cart-confirmations-migration.mjs) | `0038` split by Wrangler keeps each trigger whole. Fresh and populated upgrades keep every table. A job prepared **before** the upgrade is confirmed after it and frees its account. |
| `pnpm cart:confirmation:check` against `pnpm dev:cart-browser-worker`, in an isolated clean clone | A real local browser worker prepares the practice cart. The manager then records a within-cap confirmation and an over-cap one through the form. Checked: states and messages, a refused second save, no cancel or stale guidance afterwards, no narrow overflow, unchanged stock (the practice catalog is non-stock) and no page errors. The run counts are in the final row. |
| Visual review | Form and summary screenshots. The review hid stale preparation guidance after confirmation. |
| Planted defects | **12 of 12 caught**; see the list below |
| `pnpm typecheck`, `pnpm test` (**134 suites**), `pnpm db:check` (39 migrations), `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` | Passed; served check runs: see the final row |

The `po-cart-confirmations` suite proves:

- **Access:** anonymous, employee and wrong-company users are refused.
- **Strict input:** missing or duplicate lines, impossible dates and fractional
  packs are refused, and so is a stale revision.
- **Within the cap:**
  - incoming increases by exactly the confirmed packs × the frozen conversion,
    including a reduced quantity;
  - commitments are released and the reservation stays held;
  - differences and charges are shown.
- **Once only:**
  - exact replay;
  - a reused identity with different input is refused;
  - one confirmation per order;
  - a duplicate reference within the account is refused.
- **Locked after confirmation:**
  - job cancellation and permission cancellation are refused, and the job stays
    ready;
  - the record cannot be edited or deleted;
  - the account is freed.
- **Lines:** zero packs adds no incoming but still releases the product; extra items
  cost money only.
- **Over the cap:** recorded for owner review with no stock effect, commitments
  held and the account freed.
- **Database rules:** with no confirmation, product holds and account ownership
  cannot be released directly.
- **Failures and access:**
  - a later physical count refuses and saves nothing;
  - a lost acknowledgment, injected on the save itself, replays;
  - an unready job is refused;
  - the wrong company is refused.

The planted defects caught:

1. no ready requirement (service and database). It first survived, because a stock
   count cutoff refused the unready case first; the test now moves past the cutoff;
2. over-cap totals applying stock;
3. no commitment release;
4. a release guard that accepts anything;
5. no job lock;
6. no account release;
7. an owner guard that releases anything;
8. duplicate references allowed (service and index);
9. not every line accounted for;
10. authorized packs used instead of confirmed packs;
11. editable confirmations;
12. replay ignoring the fingerprint.

## Limits and next

- This is local fictional evidence only. Nothing was deployed, no remote data
  changed, and no supplier, checkout or payment was involved. Hosted D1 has not run
  `0035`–`0038`. Typed details only; there are no attachments.
- **Part 3, later:** the owner's approval of over-cap confirmations, with spending
  accounting for the increase. It depends on the postponed M10 decisions.
- **Receiving:** staff delivery counts, which reduce order-owed incoming, is a later
  outcome.
- **Rollback:** turn off `PANTRACK_CART_PREVIEW`. Never delete confirmations or
  rewrite used migrations; forward repair uses a new migration.
