# Owner approval of over-cap confirmations — local evidence (2026-10-26)

Scope: the [over-cap approval plan](C4_OVER_CAP_APPROVAL_PLAN_20261026.md), Part 3 of
[supplier confirmation](C4_SUPPLIER_CONFIRMATION_PLAN_20261025.md), following
[decision 0006](decisions/0006-m10-payment-and-limits.md). Status: local, fictional
implementation verified. **No checkbox advances; C4/M8 and C7/M10 remain open.**

## In plain terms

When the supplier confirms an order for more than its approved cap, the
confirmation screen shows the **owner** an "Owner review" panel. It says:

- how far over the cap the order is;
- which limits approving it would exceed, and by how much: per order, the order's
  own day and month, and in progress.

The owner can then do one of two things.

**Approve the full total, after confirming their password** (within five minutes).
In one save:

- the order's held amount rises from the cap to the confirmed total, so every limit
  counts what the café will pay. This happens even when it goes over a limit, as
  the owner chose; new carts are then refused until spending is back under;
- the confirmed items are added to incoming stock once;
- the order's product holds end;
- the order can then be counted, received and closed as usual.

**Leave it held with a note,** for example "Ask the supplier to drop the fee".
Nothing else changes, no stock is added, and no delivery can be counted.

**Who can do what:** managers see "Waiting for the owner's review" and have no
controls. Approvals and notes are permanent.

## Changes

| File | Change |
| --- | --- |
| [`0044_po_cart_confirmation_reviews.sql`](../drizzle/0044_po_cart_confirmation_reviews.sql) | New, additive, local only. Details below. |
| [`d1-po-cart-confirmations.ts`](../src/lib/d1-po-cart-confirmations.ts) | `approveOverCap` (owner, recent password) and `holdOverCap` (owner, note required): replay-safe, with a session re-check and lost-acknowledgment replay. `get` adds the approval, notes, limit warnings and whether the viewer can review. |
| [`po-cart-confirmation-contract.ts`](../src/lib/po-cart-confirmation-contract.ts) | Strict review schemas, warning and receipt types, and `confirmedIncoming` for a recorded confirmation |
| [`/api/po-cart-confirmations`](../src/app/api/po-cart-confirmations/route.ts) | New `approve_over_cap` and `hold_note` actions. The route passes the signed-in user's password-confirmation time. |
| [`d1-po-cart-deliveries.ts`](../src/lib/d1-po-cart-deliveries.ts) | Approved over-cap orders are received like confirmed ones |
| [`supplier-confirmation.tsx`](../src/components/workspace/supplier-confirmation.tsx) and its CSS | The owner review panel, the password prompt, notes, the approved summary, and the manager's waiting message |

### Migration `0044`

- **`po_cart_confirmation_reviews`:**
  - **Insert guard:**
    - the reviewer is a current **owner**;
    - the confirmation is over the cap, and its hold is still held at the cap;
    - there is no approval yet;
    - an approval names exactly the confirmed total, with a password-confirmation
      time no later than the approval and at most five minutes before it;
    - a note needs text and no total;
    - a missing value counts as a refusal.
  - **One approval per confirmation** (a partial unique index).
  - **Permanent:** no updates or deletes.
- **Raising the hold:** an insert trigger raises the order's held amount to the
  approved total.
  - The reservation guard is recreated (unchanged from `0041` otherwise) to allow
    that one rise, only from the cap, and only to the approved total.
- **Treated like a confirmed order once approved:** the delivery count, order
  closure and product-hold release guards are recreated. Each is copied from its
  latest version, with only that condition changed.

## Verification

| Check | Result |
| --- | --- |
| [`po-cart-over-cap-approval`](../tests/po-cart-over-cap-approval.mjs) | See the list below. |
| [`po-cart-confirmations-api`](../tests/po-cart-confirmations-api.mjs) (extended) | **Access:** managers are refused by the service's own owner check, and approval without a password returns `reauthentication_required`. **Input:** strict actions and notes. **Within the cap:** there is nothing to review. |
| [`po-cart-confirmation-reviews-migration`](../tests/po-cart-confirmation-reviews-migration.mjs) | `0044` split by Wrangler keeps all eight triggers whole. Fresh and populated upgrades keep every table. An over-cap confirmation recorded **before** the upgrade is approved after it, raising its hold and opening it for receiving. |
| Older upgrade tests | `po-cart-order-closures-migration` now applies later migrations before running today's services, as `po-cart-deliveries-migration` already did. |
| `pnpm cart:confirmation:check` (extended) against `pnpm dev:cart-browser-worker`, in an isolated clean clone | **Setup:** a real local browser worker prepares the practice cart; within-cap and over-cap confirmations are recorded. **Owner review:** the panel shows the overage and the per-order limit warning. Leaving it held without a note shows an alert; with a note, the note is listed. **Approve** opens the password prompt; practice sign-in has no password, so confirmation fails and **nothing is approved** (no approval, one note, no incoming). **A manager** then sees "Waiting for the owner's review" with no controls. **Afterwards:** no narrow overflow and no page errors. **Passed 3/3 on AC power on the final source.** The first attempt, on battery, timed out in the practice-browser cart preparation before reaching the review (the known battery-only flake). |
| Visual review | Screenshots of the owner panel with its warning and password prompt, and of the manager's waiting view |
| Planted defects | **22 of 23 caught.** The other one is a duplicate of a rule that still holds, so behaviour is unchanged; see below. |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**153 suites**), `pnpm db:check` (45 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed on the final source. |

The `po-cart-over-cap-approval` suite proves:

- **Access:**
  - managers see the order waiting, and owners can review;
  - anonymous users, managers, staff and other companies' owners can't approve or
    add notes.
- **Password:**
  - approval needs a confirmation within five minutes;
  - with none, or one six minutes old, nothing is saved.
- **Held with a note:**
  - a blank note is refused, exact replay works, and a reused identity is refused;
  - the hold, incoming and product holds stay unchanged.
- **Approval:**
  - the held amount rises to exactly the confirmed total;
  - incoming grows by the frozen conversion, once, and product holds end;
  - exact replay works;
  - a second approval or a later note is refused;
  - staff can then count the delivery.
- **Within the cap:** nothing to review; an unknown confirmation is missing.
- **Limits:** with tight owner limits, the warnings name per-order, that day and
  in progress, with exact amounts (the month is not exceeded). Approval still
  succeeds and counts the full total, and the next new cart is refused.
- **Failures:**
  - a stock change during approval saves nothing;
  - a lost acknowledgment replays.
- **Database rules:**
  - **refused reviews:** a manager; a wrong total; no, old or future password times;
    blank notes; notes with a total; an unknown kind; another company;
  - **refused before approval:** counting, closing (even marking everything as not
    arriving), raising the hold and releasing product holds;
  - **refused after approval:** another approval or a later note, and raising the
    hold to anything but the approved total;
  - edits and deletes are refused.

The planted defects caught:

1. managers approving;
2. no password check;
3. an old password accepted;
4. approval adding no incoming;
5. product holds kept;
6. warnings ignoring the increase;
7. the day limit not checked;
8. notes without text;
9. receiving ignoring approval;
10. the route without the approve action;
11. the database letting managers review;
12. accepting another total;
13. ignoring the password window;
14. a missing password time passing;
15. blank notes;
16. approval not raising the hold;
17. the hold rising without approval;
18. counting before approval;
19. closing before approval. Its test was added before this defect ran;
20. product holds released before approval;
21. editable reviews;
22. deletable reviews.

**The duplicate:** removing the explicit "no reviews after approval" rule (and
making the one-approval index non-unique) changes nothing. Approval raises the held
amount above the cap, so the rule "the hold is still at the cap" refuses any later
review.

## Limits and next

- Local fictional evidence only. Nothing was deployed, and no supplier, checkout
  or payment was involved.
- The approval with a real password is proved by the service and HTTP suites with
  an injected confirmation time. Practice sign-in can't confirm a password.
- **Rollback:**
  - Turn off `PANTRACK_CART_PREVIEW`.
  - Never delete reviews or rewrite used migrations; forward repair uses a new
    migration.
- **Supplier confirmation Parts 1–3 are complete locally.**
