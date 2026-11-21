# Stock levels, alerts, expiry and invoices — roadmap

Owner request, 2026-11-20: four ideas, discussed first and then planned and
built one at a time.

1. **R1 — Reliable stock levels:** allow for the inaccuracy of estimates, so
   things don't run out before Pantrack says to reorder.
2. **R2 — Low-stock and run-out alerts:** remind people when items are
   running low, and when something is about to run out.
3. **R3 — Expiry dates and reminders:** for perishable items.
4. **R4 — Supplier invoices:** process and store invoices from supplier
   orders.

The owner agreed this order on 2026-11-20. R1 makes the numbers trustworthy
before R2 sends alerts based on them. R3 reuses the R2 alerts and the delivery
records. R4 is the largest and needs its own decisions about cost, privacy and
how long to keep records.

Each step is one reviewable outcome, with tests and an evidence record. Nothing
here sends orders to suppliers, and every new screen runs on fictional local
data until the owner authorizes a hosted trial.

## R1 — Reliable stock levels

Owner choices on 2026-11-20:
[decision 0011](decisions/0011-reliable-stock-levels.md).
- Pantrack suggests and a person approves.
- Balanced by default (runs short about 1 delivery cycle in 20).
- Levels come from real usage and each supplier's delivery rhythm.
- Everyone can report "We just ran out".

| Step | Outcome | Schema? | Done when |
| --- | --- | --- | --- |
| R1a | Decision 0011 and this plan | No | Owner reviewed and merged |
| R1b | **Usage and accuracy, read only.** On each product's stock screen: measured everyday use between counts, recorded use (sales and waste), the unrecorded gap as a percentage, how far off the estimate was at each recent count, and "Not enough history yet" where data is thin. Calculated from existing records; nothing is saved | No | Pure calculation module with tests for deliveries between counts, opening counts, unit conversions, gaps and thin data; company and role tests on the read; browser check on desktop and phone |
| R1c | **"We just ran out".** Any role can report it from the stock list or the Waste page. Owners and managers see open reports and can confirm one as a count of zero, or dismiss it | Yes (run-out reports; new narrow permission) | Anonymous, wrong-company and role tests; a report never changes stock; confirming uses the existing count path; duplicate taps are idempotent |
| R1d | **Delivery rhythm per supplier.** Owners and managers record "order every N days" and "delivery takes N days" on each supplier | Yes (additive, versioned with the supplier) | Versioned like other supplier details; validation (1–60 days); role tests; existing supplier lists and order drafts unchanged |
| R1e | **Suggested levels.** A café-wide caution setting (Balanced by default; Cautious and Lean available) and a per-product override. Each product with enough history shows a suggested level with a plain explanation. Accept saves a new restocking-settings version; Ignore hides that suggestion until the numbers change | Yes (caution setting; suggestion decisions) | Arithmetic tests for each caution level, the run-out step-up and the thin-data refusal; an accepted suggestion changes only that product's level; results are unchanged for every product without an accepted suggestion; browser check |
| R1f | **Owner trial and acceptance** | Hosted only with the owner's authorization | Over about 4 weeks of real use: run-out reports, count differences and accepted suggestions are reviewed with the owner |

Handoffs: R1b, R1c and R1e touch workstream A's restocking modules
(`d1-replenishment-settings`, `d1-replenishment-review`, inventory
quantities). R1d touches the purchasing supplier list (workstream C). Each
change adds its own module and test rather than reshaping those files, and is
coordinated with whoever is active on workstream A.

How the spare amount is sized (R1e): spare = a caution factor × how much daily
use varies × the square root of the days covered (delivery days plus days
between orders). The factors are 1.04 for Lean (about 1 in 7), 1.65 for
Balanced (about 1 in 20) and 2.33 for Cautious (about 1 in 100). A run-out
report in the last 4 weeks raises the suggestion by one step, for example from
Balanced to Cautious, for that product only.

## R2 — Low-stock and run-out alerts (outline)

Agreed direction, to be detailed in its own decision when R1 is in place:
- "Running low" uses the same rule as the restocking suggestions, so alerts
  and the order page never disagree.
- Alerts say "will probably run out by Thursday" instead of claiming an item
  is empty; a real "empty" comes from R1c run-out reports.
- One daily summary, plus an urgent alert only when something will run out
  before the next delivery could arrive.
- Each person chooses whether they receive alerts.
- First delivery channels: a list of alerts inside Pantrack and a daily email.
  Phone notifications and text messages are later options with their own costs.
- Workstream C owns scheduling and alerts.

## R3 — Expiry dates and reminders (outline)

Agreed direction, to be detailed in its own decision after R2:
- Dates are recorded when a delivery arrives, not once per product.
- Items marked perishable get a "keeps for N days from delivery or opening"
  setting, so most dates are calculated; a printed date can be typed where it
  matters.
- Reminders arrive before expiry, through R2.
- An expired item can be recorded as waste in one tap, reason filled in.
- Only items marked perishable are tracked this way, to limit typing.

## R4 — Supplier invoices (outline)

Agreed direction, to be detailed in its own decision after R3:
1. Store: photograph or upload an invoice and attach it to its order; owners
   and managers only.
2. Read: an AI reads lines and prices under a monthly cap, and a person
   confirms (the same pattern as photo waste).
3. Compare the order, the delivery and the invoice: price increases, swaps,
   missing items and overcharges; confirmed prices can update the catalog.

Decisions needed before R4 starts: how long invoices are kept, who can see
them, the monthly reading cap, and whether a supplier (such as Amazon
Business) can provide invoices electronically instead.
