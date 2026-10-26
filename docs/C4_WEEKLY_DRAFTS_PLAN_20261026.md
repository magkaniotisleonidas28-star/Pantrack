# Weekly order drafts — plan (2026-10-26)

Owner-selected next C4 local slice, toward the M9 weekly-draft task in
[PANTRACK_MILESTONES](PANTRACK_MILESTONES.md#m9--scheduler-alerts-and-operational-health)
and §9 of the [integration roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md). Local and
fictional only: no real Cloudflare Cron, deploy, email, supplier contact or purchase.
**No checkbox advances.**

## In plain terms

A manager sets a weekly time for each supplier, for example "Mondays at 9:00 for
Baldor". When that time comes, Pantrack **recalculates the restocking suggestions**
for that supplier's items from current stock, then prepares a **draft order** from
them. The draft waits for a manager to review it, like any other draft.

Today a suggestion is each item's target amount minus what is on the shelf and
already on order, rounded up to whole packs. Sales use up stock, so a busy week
gives a bigger suggestion. Forecasting next week's usage from past sales is a
separate, later project.

The schedule never prepares a cart, never approves spending and never orders.
Those steps stay with a person.

## How it behaves

- **Time:** uses the café's time zone (already set by the owner for spending
  limits). Each weekly time has exactly one identity, such as
  "schedule S, Monday 2026-11-02". A repeated or late check can't make a second
  draft for the same week.
- **Clock changes:** when clocks spring forward and 2:30 doesn't exist, the draft
  runs at the next valid minute. When clocks fall back and 1:30 happens twice, it
  runs once, at the first 1:30.
- **Missed times:** if checks stop for a while (for example the server is down),
  only the most recent missed week is drafted, never a backlog.
- **Overlap:** one check runs per company at a time. A second simultaneous check
  waits or does nothing.
- **Who it's for:** each schedule names a responsible manager. The draft is created
  for them and marked "Created by the weekly schedule". If they are no longer a
  manager or owner, the week is **held** with a clear reason, and nothing is
  drafted.
- **Pause:** a schedule can be paused and resumed. Paused weeks are recorded as
  skipped, not caught up.
- **Proposed cap:** the draft's proposed spending cap is the estimated subtotal plus
  the schedule's margin. It is only a proposal; the manager confirms or changes it
  at review, as today.
- **Fresh numbers or nothing:** if an item's stock count is missing or the sales
  data isn't up to date, the same review rules as the manual plan apply: the item
  is held for review, or the week is held, instead of guessing.
- **One draft at a time:** if the schedule's previous draft still hasn't been
  reviewed, the week is skipped and says so.
- **Every week is recorded:** drafted, nothing needed, skipped (paused or a draft
  still waiting), held (with a reason) or failed after bounded retries.

## What the code check found

The saved suggestions today are not linked to real suppliers. Each one carries a
placeholder supplier ("unverified"), and its pack size comes from the item's own
settings. Pantrack's **supplier list** already records which items each supplier
sells and in which pack size, but suggestions don't use it yet. Linking the two
is an open roadmap item (§2, "connect A's proposals to versioned supplier
mappings").

A weekly draft "for Baldor" needs that link, so it comes first. Each item also has
a manager-entered **daily use** estimate, which today only limits shelf life. The
later forecasting project can build its targets from it.

## Parts

### Part 1 — suggestions per supplier (no database change)

- For one supplier, account and delivery location in the supplier list, recalculate
  each mapped stock item's suggestion **now**:
  - use workstream A's existing target calculation, with the same rules for stale
    counts, missing opening counts, sales data lag, capacity, shelf life, minimums
    and multiples;
  - count in **that supplier's pack size**, from the mapping's exact conversion.
- The result is a draft-ready list of whole packs, plus the items held for review,
  each with a reason. Nothing is saved yet.
- **Tests:** fresh numbers after sales and deliveries, different pack sizes per
  supplier, every hold reason, wrong-company and staff refusals. This is A's area,
  which the owner approved building here.

### Part 2 — schedules and the weekly check (one migration)

- **Schema:**
  - versioned `po_draft_schedules`: supplier, account, location, weekday, local
    time, margin, responsible manager and paused flag;
  - `po_draft_occurrences`: unique per schedule and local week, with the result
    and the draft it created;
  - a per-company lease for overlapping checks.
- **Weekly check:** `tick(now)` finds each schedule's latest due week, claims it
  once, runs Part 1, and creates a supplier-list draft through the existing draft
  service, guarded as a manager's would be. Bounded retries end in held or failed.
- **Check trigger:** a loopback-only preview route stands in for Cron, which is
  not wired.
- **Tests:** simulated clock and injected failures. Duplicate, concurrent and late
  checks; both clock changes; a time zone change; pause and resume; a waiting
  previous draft; a removed manager; nothing needed; lost acknowledgments; access.

### Part 3 — screens

- Schedule settings for owners and managers.
- Each schedule's recent weeks and next run.
- Drafts created by a schedule are labelled in the draft list.
- A served browser check.

### Later, not in this plan

- Real Cloudflare Cron wiring (needs a deploy, so separate authorization).
- Email reminders.
- Forecasting next week's usage from past sales (workstream A's area; a separate plan).
- The wider alerts list.

## Decisions for the owner

Answered by the owner on 2026-10-26:

| Decision | Answer |
| --- | --- |
| Where the draft's items come from | Recalculate the suggestions at draft time from current stock (and build it here, in A's area). Usage forecasting is a separate later project. |
| A previous scheduled draft still not reviewed | Skip the week and say so |
| Who may set schedules | Owners and managers |
| Other database changes in progress | None; the teammate confirmed |

## Verification plan

- Anonymous, wrong-company, staff and revoked-manager refusals for every route.
- Wrangler split and local apply; fresh and populated upgrades.
- Planted defects, the full local pipeline, and a served check in the isolated clone.
