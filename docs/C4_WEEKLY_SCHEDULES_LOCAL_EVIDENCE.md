# Weekly schedules and the weekly check — Part 2 of weekly drafts (2026-10-26)

Scope: Part 2 of the [weekly drafts plan](C4_WEEKLY_DRAFTS_PLAN_20261026.md), built on
[suggestions per supplier](C4_SUPPLIER_SUGGESTIONS_LOCAL_EVIDENCE.md). Status: local,
fictional implementation verified. **No checkbox advances; C4/M8 and C6/M9 remain open.**

## In plain terms

An owner or manager sets a weekly time per supplier, for example "Mondays at 9:00,
Fictional Café Supply, north café". Each schedule names a responsible owner or
manager and a margin for the proposed spending cap.

When the time comes, the weekly check:

1. recalculates that supplier's suggestions from current stock (Part 1);
2. creates a **draft order for review** for the responsible person, labelled
   "Created by the weekly schedule";
3. records what happened that week.

It never prepares a cart, approves spending or orders anything.

**Each week is recorded once:**

| Result | When |
| --- | --- |
| Drafted | A draft was created; the record links to it |
| Nothing needed | Every item has enough on the shelf and on order |
| Skipped: paused | The schedule was paused |
| Skipped: draft waiting | The previous scheduled draft has not been reviewed yet |
| Held, with a reason | The sales data isn't current; the responsible person is no longer an owner or manager; the supplier is inactive; no suggested item has an estimated price; or a later week replaced a week still waiting to retry |
| Failed | Three attempts failed. Retries wait 15, then 30 minutes. |

**Timing:**

- **The café's time zone:** the one the owner set for spending limits. A schedule
  can't be saved without it.
- **Clocks falling back:** a time that happens twice runs once, at the first.
- **Clocks springing forward:** a time that doesn't exist runs at the first minute
  after the jump.
- **Missed weeks**, for example while checks were stopped: only the latest is
  drafted, never a backlog.
- **Changes:** creating, changing, pausing or resuming a schedule applies from that
  moment. A time that already passed is not drafted. The time zone changing can't
  repeat a week, because each week is identified by its local date.
- **Repeated, late or simultaneous checks** never draft a week twice. Only one check
  per company runs at a time.

**Proposed cap:** the estimated subtotal of the priced items plus the schedule's
margin, rounded up to the cent. Items without an estimated price are noted in the
draft. The manager confirms the cap at review, as for any draft.

**Safe recovery:** the exact draft input is saved before the draft is created. If
the check stops right after creating it, the next attempt re-sends that saved input
and gets back the same draft, even if stock changed in between.

## Changes

| File | Change |
| --- | --- |
| [`0043_po_draft_schedules.sql`](../drizzle/0043_po_draft_schedules.sql) | New, additive, local only. Details below. |
| [`po-draft-schedule-contract.ts`](../src/lib/po-draft-schedule-contract.ts) | Strict save and pause/resume input. Clock-change-exact `zonedInstant` and `latestDue`, and `proposedCap` |
| [`d1-po-draft-schedules.ts`](../src/lib/d1-po-draft-schedules.ts) | `D1PoDraftSchedules` lists, saves, pauses and resumes schedules (owner or manager, replay-safe, session re-check). `D1PoDraftScheduler.tick(companyId)` runs the weekly check. |
| [`/api/po-draft-schedules/tick`](../src/app/api/po-draft-schedules/tick/route.ts) | **Local stand-in for Cron.** It runs one company's check, authenticated with that company's existing scheduler token, compared only by hash. Preview flag and loopback only. Real Cron is not wired. |

Schedule settings get their routes and screens in Part 3.

### Migration `0043`

- **`po_draft_schedules`:** immutable versions; the latest version is current.
  - **Insert guard:**
    - versions are consecutive;
    - the saver and the responsible person are current owners or managers;
    - the supplier is active and the company has a time zone;
    - weekday 1–7, time `00:00`–`23:59`, margin 0–100%, canonical time and
      identity;
    - one schedule per supplier group, and a schedule never changes its group.
  - **Permanent:** no updates or deletes.
- **`po_draft_occurrences`:** one row per schedule and local week.
  - **Insert guard:** a week can only be claimed running on its first attempt, for
    the schedule's current version and weekday, in the current time zone, due no
    earlier than that version and no later than the claim.
  - **Update guard:**
    - only running or retrying weeks change, and their identity never does;
    - a re-claim needs the retry time or an expired lease, at most three attempts;
    - the draft input is recorded once, by the current holder;
    - retry times are in the future;
    - finished weeks need a reason, and only the holder finishes them;
    - "failed" needs three attempts, and "drafted" names an existing draft;
    - a rule that evaluates to a missing value counts as a refusal;
    - no deletes.
- **`po_draft_tick_leases`:** one check per company at a time.

## Verification

| Check | Result |
| --- | --- |
| [`po-draft-schedules`](../tests/po-draft-schedules.mjs) | See the list below. |
| [`po-draft-schedules-api`](../tests/po-draft-schedules-api.mjs) | **Off unless enabled:** preview flag and loopback. **Token:** missing, wrong, unprefixed, oversized, unknown-company and another company's tokens are refused, and a refused call runs nothing. **Valid calls:** private responses; each company runs only its own check. |
| [`po-draft-schedules-migration`](../tests/po-draft-schedules-migration.mjs) | `0043` split by Wrangler keeps all six triggers whole. Fresh and populated upgrades keep every table. A supplier and time zone saved **before** the upgrade back a schedule after it, whose first week is recorded once. |
| Planted defects | **30 of 32 caught.** The other two are duplicates of rules that still hold, so the behaviour is unchanged; see the list below. |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**151 suites**), `pnpm db:check` (44 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed on this source. |

The `po-draft-schedules` suite proves:

- **Time:**
  - the first 01:30 when clocks fall back, and 03:00 after a skipped 02:30, in New
    York;
  - the week turns over exactly at the scheduled minute;
  - missed weeks collapse into the latest;
  - the cap rounds up.
- **Settings:**
  - anonymous, staff and other-company users are refused;
  - strict times, weekdays and margins;
  - a time zone is required first;
  - the responsible person must be an owner or manager;
  - an active supplier group;
  - exact replay, a stale version and a reused identity are handled;
  - a schedule keeps its group, one schedule per group;
  - the next run is listed.
- **Drafting:**
  - no draft for a time before the schedule existed;
  - Monday's draft has the recalculated packs, the cap with margin, the schedule
    note and the responsible creator;
  - repeated, concurrent and late checks add nothing.
- **Skips:**
  - the next week is skipped while the draft waits, and drafting resumes once it is
    reviewed;
  - two missed weeks give one draft for the latest;
  - paused weeks are recorded as skipped;
  - resuming and changing the time don't catch up;
  - a time zone change can't repeat the week.
- **Holds:**
  - stale sales (keeping the inputs it was decided on);
  - a responsible person demoted to staff;
  - nothing needed;
  - no estimated prices;
  - mixed prices give a cap from priced items plus a note.
- **Failures:**
  - a stop right after the draft is saved, with stock then changed, recovers to the
    **same** draft on the second attempt;
  - failed calculations retry at 15 and 30 minutes, not earlier, then fail after
    three attempts;
  - a retry recovers;
  - a week still waiting to retry is replaced by the next week;
  - a busy lease refuses a second check, and a released lease lets the next run;
  - a company without a time zone is skipped.
- **Database rules** (raw rows, each breaking one rule):
  - **Schedules refused:** a staff saver or responsible person; bad times, weekday,
    margin and status; a version gap; another company; a duplicate group; an
    inactive supplier; a group change; edits; deletes.
  - **Weeks refused:**
    - the wrong weekday; due after the claim or before the version; an old time
      zone; not starting as running; a second attempt on insert; a stale version;
      a malformed week;
    - changing a finished week or its identity; deletes;
    - re-claiming during the lease; a fourth attempt;
    - "drafted" without an existing draft; "failed" before three attempts; "held"
      without a reason; a retry time in the past;
    - another holder finishing; time going backwards.

The planted defects caught:

1. the later 01:30 when clocks fall back;
2. running before the spring-forward gap;
3. a future week;
4. the cap rounding down;
5. no skip while a draft waits;
6. paused weeks drafted;
7. stale sales drafted;
8. the draft input not saved before creating, caught by the stock-changed recovery;
9. the retry wait not growing;
10. no attempt limit;
11. the company lease ignored;
12. the lease never released. It first survived, and a test now runs a second check
    straight after;
13. stranded retries never replaced;
14. staff managing schedules;
15. the route skipping the token;
16. the route ignoring loopback;
17. the database letting staff save schedules;
18. or be responsible;
19. two schedules for one group;
20. a schedule changing group. It first survived, because the target group was
    taken, so the test now moves to an unused group;
21. any time accepted;
22. the database ignoring the weekday;
23. or allowing weeks before the version;
24. re-claiming during the lease;
25. more than three attempts. It first survived, and a raw fourth attempt is now
    refused;
26. missing values passing. **This was a real bug found by the tests**: a "held"
    week without a reason was accepted, because SQL treats a missing value as
    unknown rather than false. The rule now counts unknown as a refusal;
27. "drafted" without a draft. It first survived, because another rule refused
    first, so the test now records the input before trying;
28. another holder finishing;
29. editable schedules;
30. deletable week records.

**Duplicates, with no effect when removed:**

- Removing the service's "no catch-up before the version" check changes nothing,
  because the database refuses that week's insert, and the raw "before the
  version" test proves that rule.
- Removing the explicit "finished weeks are final" condition changes nothing,
  because every allowed change already requires a running or retrying week.

## Limits and next

- **Local fictional evidence only.** Nothing was deployed. Cloudflare Cron is not
  wired, because that needs a deploy. No supplier was contacted, and no cart,
  approval or order was created.
- **Sales data:** without a current sales connection, weeks are held, not guessed,
  matching how durable proposals already work.
- **Rollback:**
  - Turn off `PANTRACK_CART_PREVIEW`; nothing runs a check otherwise.
  - Never delete schedule versions or week records, and never rewrite used
    migrations; forward repair uses a new migration.
- **Next:** Part 3. Schedule settings screens for owners and managers, recent weeks
  and the next run, the "Created by the weekly schedule" label in the draft list,
  and a served browser check.
