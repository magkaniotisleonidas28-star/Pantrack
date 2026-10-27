# Weekly drafts screens — Part 3 of weekly drafts (2026-10-26)

Scope: Part 3 of the [weekly drafts plan](C4_WEEKLY_DRAFTS_PLAN_20261026.md), on top of
[suggestions per supplier](C4_SUPPLIER_SUGGESTIONS_LOCAL_EVIDENCE.md) and
[weekly schedules](C4_WEEKLY_SCHEDULES_LOCAL_EVIDENCE.md). Status: local, fictional
implementation verified. **No checkbox advances; C4/M8 and C6/M9 remain open.**

## In plain terms

Owners and managers get a **Weekly drafts** section in the workspace:

- **Each schedule** shows the supplier and delivery location, the day and time, the
  cap margin, who the draft is for, Active or Paused, and the next run in the
  café's time zone.
- **Recent weeks** list each week's result: draft created (with the draft number
  and whether it was reviewed), nothing needed, skipped, held or failed, with the
  reason. On a phone, each week becomes a small labelled card.
- **Actions:**
  - **New schedule:** only supplier locations without a schedule are offered.
  - **Edit:** the supplier stays fixed.
  - **Pause / Resume:** changes apply from that moment.
- **The label:** an opened draft that a schedule created says "Created by the
  weekly schedule for the week of …".
- **Staff** never see schedules.

**What's different from the plan:** the plan said drafts would be labelled in the
draft *list*. That list comes from your teammate's order-history code, so to avoid
changing their files the label is on the **opened draft**, and each week on this
screen shows its **draft number**. Adding it to the list later is a one-line
change in their history query, best made together with them.

## Changes

| File | Change |
| --- | --- |
| [`/api/po-draft-schedules`](../src/app/api/po-draft-schedules/route.ts) | **GET** the list, or with `orderId` the schedule and week that created that draft; **POST** save, pause or resume. Owner or manager only (`purchasing`), with the same preview flag, loopback, company wrapper and CSRF as the other cart routes. |
| [`d1-po-draft-schedules.ts`](../src/lib/d1-po-draft-schedules.ts) | The list adds choices (active supplier locations, and owners and managers as responsible people) with a session re-check, and each week's draft number and status. New `origin(companyId, orderId)` for the draft label, owner or manager only. |
| [`weekly-schedules.tsx`](../src/components/workspace/weekly-schedules.tsx) and `weekly-schedules.css` | The screen. The confirmation appears only once the list has refreshed. An uncertain save offers an exact retry. |
| [`workspace.tsx`](../src/components/workspace/workspace.tsx), [`purchase-order-drafts.tsx`](../src/components/workspace/purchase-order-drafts.tsx) | The Weekly drafts section, shown only while the preview serves it. The opened draft asks the weekly route for its label, and shows nothing when the preview is off or the draft is manual. |
| [`po-draft-schedule-ui-check.mjs`](../scripts/po-draft-schedule-ui-check.mjs) and `pnpm cart:weekly-drafts:check` | Served browser check |

No migration. The draft service and its contract are unchanged. The label first came from the
draft's own data, but older upgrade tests run today's draft code on databases without the weekly
table. Asking the weekly route keeps the draft code independent of it, and all those tests pass
unchanged.

## Verification

| Check | Result |
| --- | --- |
| [`po-draft-schedules`](../tests/po-draft-schedules.mjs) (extended) | **Choices:** active groups only, and owners and managers but never staff. **Session:** losing the role mid-read returns nothing. **Draft label:** a scheduled draft reports its schedule and week; a manual draft reports none; staff and other companies are refused. **Weeks:** listed with draft number and status. |
| [`po-draft-schedules-api`](../tests/po-draft-schedules-api.mjs) (extended) | **Refusals:** anonymous, staff (the company route refuses both reading and saving), other companies, preview off, non-loopback and cross-site/CSRF. **Strict input:** unknown actions never reach a service. **Choices:** archived locations are not offered. **Saves:** private list; save, replay, pause, stale pause and resume over HTTP. **Label lookup:** answers for any draft, and staff are refused. |
| `pnpm cart:weekly-drafts:check` against `pnpm dev:cart-browser-worker`, in an isolated clean clone | **The real weekly check, through its token route:** a wrong token is refused, the week is recorded once, and it is skipped because an earlier draft waits. A repeated check adds nothing. **The screen:** shows that week and the earlier drafted week, with draft number and status. **New schedule:** a taken location is not offered; a margin over 100% shows an alert; the save then appears with its next run, and "New schedule" turns off once every location has one. **Edit** keeps the supplier. **Pause and resume** show the status. **Afterwards:** phone width has no overflow, including the week cards; the opened draft shows the label; staff are refused (403); there are no page errors. **Passed 3/3 on the final source.** |
| Visual review | Screenshots of the list, the form with its validation alert, the phone layout before and after the week-card fix, and the opened draft's label |
| Planted defects | **12 of 12 caught** on the final source; see the list below |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**151 suites**), `pnpm db:check` (44 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed on the final source. |

**About the served check:** the preview keeps live sales sync off, so any real
weekly check there is held or skipped, never drafted; that is the intended safety
rule. Drafting itself is proved by the `po-draft-schedules` suite. To show a
"draft created" week and the label, the check **seeds one earlier week as drafted**
through the database guards, linked to a real draft made through the app. The
current week's result comes from the real check.

The planted defects caught:

1. staff reading schedules through another route family. It first survived, because
   the service refused too, so the test now requires the company route's own
   refusal;
2. the route ignoring the preview flag;
3. any action pausing. It first survived, because the service refused the input
   too, so the test now requires the route's own message;
4. staff offered as responsible;
5. archived locations offered. It first survived because no location was archived,
   so the test data now has one;
6. no draft label;
7. the label lookup without an access check;
8. weeks without draft numbers;
9. the list without its session check. It first survived, and a test now removes
   the role mid-read;
10. taken locations offered on the screen (served check);
11. the margin not checked on the screen (served check);
12. the draft label hidden on the screen (served check).

## Limits and next

- Local fictional evidence only. Nothing was deployed. Cron is not wired, because
  that needs a deploy. No supplier, cart, approval or order was involved.
- The draft list doesn't show the label yet (see "What's different from the
  plan" above).
- **Rollback:**
  - Turn off `PANTRACK_CART_PREVIEW`.
  - Revert the commit; there is no migration.
- **The weekly drafts plan is complete locally (Parts 1–3).** What's next is the
  owner's choice. Options include:
  - in-app reminders and alerts (overdue deliveries, held weeks);
  - usage forecasting;
  - wiring real Cron when the online release resumes.
