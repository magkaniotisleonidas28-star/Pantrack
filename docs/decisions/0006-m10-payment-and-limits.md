# Decision: M10 payment responsibility, fees and final-bill differences

- Status: accepted by the owner
- Date: 2026-10-26
- Milestone: M10 (C7), with C3/C4 supplier context
- Scope: how supplier purchases are paid and limited for the first café pilot

## Context

On 2026-10-25 the owner postponed four money decisions. The owner spending limits
([PR #13/#14 evidence](../C7_OWNER_SPENDING_LIMITS_LOCAL_EVIDENCE.md)), supplier
confirmation and receiving were built meanwhile. Each order already carries an
approved cap. Within-cap confirmations are recorded, and over-cap confirmations
wait for owner review. Daily and monthly limits count each started order's cap.

## Decisions

1. **Who pays: the café's existing supplier account.** The café keeps paying each
   supplier as it does today, on its existing account terms. Pantrack never
   collects, stores or sees payment details. No platform payment, saved-card or
   checkout-payment feature is built for the pilot.
2. **Fees count toward limits.** Tax, delivery and other charges count in full. An
   order's proposed cap, including a weekly schedule's margin, is meant to cover
   them. Confirmation totals already include charges.
3. **The cap is the line.**
   - A confirmed or final total up to the approved cap is accepted, and every
     difference from the estimate is shown and recorded.
   - Anything above the cap needs the owner's approval, with the same recent
     password confirmation as loosening a limit.
   - There is no automatic cushion above the cap.
   - Daily and monthly limits keep counting the approved cap, which is never less
     than an accepted total.
4. **The Baldor browser-access inquiry is not sent.**
   - The owner's view is that a manager supervising the cart preparation on the
     website does not need separate permission.
   - Open question: whether Baldor's website terms allow automated access. The
     [C3 research](../C3_BALDOR_PREPARATION.md) found access restrictions that
     were never resolved. Supervision does not by itself answer that, and the
     practical risk is the supplier blocking or closing the account.
   - Any session against the real Baldor site still needs a separate, explicit
     go-ahead for that exact test, per AGENTS.md. Until then, development stays
     fictional.

## Consequences

- **Owner approval of over-cap confirmations** (supplier confirmation Part 3) is
  now unblocked. It uses rule 3: owner only, with recent password confirmation.
- **No payment-handling work** is planned for M10 beyond documenting the account
  terms per supplier.
- **Final-amount spending accounting** is not needed: the cap stays the counted
  amount.
- **The unsent inquiry** in the C3 document is withdrawn, not deleted, so it can
  be revisited if the open question needs an answer.
