# Decision: stock levels that allow for real-world inaccuracy

- Status: accepted by the owner (product direction); implementation in steps
- Date: 2026-11-20
- Roadmap: step R1 ([plan](../STOCK_LEVELS_AND_ALERTS_ROADMAP.md#r1--reliable-stock-levels))
- Builds on: exact inventory (counts, deliveries, sales use and waste), the
  versioned restocking settings, and the supplier list

## Context

Pantrack estimates what is on the shelf from the last count, deliveries, sales
(through recipes) and recorded waste. Real use never matches exactly: pours
vary, staff drink coffee, and not all waste is recorded. If Pantrack thinks
there is more than there really is, the café runs out before Pantrack says to
reorder.

Today, in the exact inventory system:
- each product has a **typed target level**, a typed daily use (used only for
  the shelf-life limit), a count reminder, and pack rules;
- every count already stores Pantrack's **estimate before the count** and the
  **difference** found;
- sales use and waste are stored as dated stock events.

The older system has a fixed "spare" amount and a 5% accuracy allowance. Both
are typed by hand, and the exact system does not use them. Nothing learns from
how wrong the estimates turned out to be.

## Decisions

1. **Pantrack suggests, a person approves.** When the records show a product
   needs a different level, Pantrack shows the suggested change and why. An
   owner or manager accepts or ignores it. Nothing changes on its own, and an
   accepted change is saved as a new version of that product's restocking
   settings, with "accepted Pantrack suggestion" as the reason.
2. **Levels come from real usage.** For each supplier, an owner or manager
   records once how often they order and how many days delivery takes. For
   each product, Pantrack suggests:

   *level = everyday use × (days until the next delivery could arrive + days
   between orders) + spare*

   Any product can still be overridden by hand.
3. **Everyday use is measured, not typed.** Between two counts, real use is
   *first count + deliveries received − second count*. This includes use that
   was never recorded. Pantrack compares it with the use it recorded (sales
   plus waste) and shows the gap as a percentage, for example "about 8% more
   is used than recorded". Where counts are too few, recorded use is used and
   labelled as such.
4. **Balanced by default.** The spare amount is sized so a product would run
   short in roughly 1 delivery cycle in 20. It is calculated from how much
   everyday use varies and how long a delivery takes. Cautious (about 1 in
   100) and Lean (about 1 in 7) can be chosen for the café, and for any single
   product.
5. **Not enough history means no suggestion.** A suggestion needs at least two
   counts at least 7 days apart, and at least 14 days of recorded use.
   Otherwise the product shows "Not enough history yet" and keeps its current
   level.
6. **Anyone can report "We just ran out".** Employees, managers and owners can
   report it, through a new narrow permission like recording waste. A report
   never changes stock by itself, because employees cannot count stock. An
   owner or manager can confirm it as a count of zero. A product that ran out
   gets a larger spare suggestion even if the arithmetic says otherwise. Each
   report is kept, with who reported it and when.
7. **Explained in plain words.** Every suggestion says why, for example "Oat
   milk: suggested 14 cartons (now 10). You use about 2 a day, delivery takes
   2 days and you order weekly. Recent counts found about 8% less than
   expected, and it ran out once in the last 4 weeks."
8. **Exact inventory only.** These changes apply to the exact inventory system
   used by recipes, sales and waste. The older system is unchanged.
9. **No ordering change.** Suggested levels feed the existing restocking
   suggestions and order page only. Supplier submission and automatic
   purchasing stay behind their own gates.

## Consequences

- Each product's level improves as more counts are taken, so regular counts
  matter more. Products whose estimates drift a lot can be flagged for more
  frequent counts.
- The delivery rhythm per supplier becomes a required setup step for
  suggested levels. Until it is set, Pantrack can still show measured use and
  accuracy.
- This touches workstream A's restocking domain (settings, review and
  calculation modules). Each step lists its handoff and must not change
  existing restocking results for a product whose level has not been accepted.
- Run-out reports and accepted suggestions create the measured history that
  alerts (R2) will rely on.
