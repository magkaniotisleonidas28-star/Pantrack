# Suggestions per supplier — Part 1 of weekly drafts (2026-10-26)

Scope: Part 1 of the [weekly drafts plan](C4_WEEKLY_DRAFTS_PLAN_20261026.md). It is the
first step of roadmap §2 ("connect A's proposals to versioned supplier mappings"),
built in workstream A's review module at the owner's request. Status: local,
fictional implementation verified. **No checkbox advances; C4/M8 and A8 remain open.**

## In plain terms

Pick a supplier, account and delivery location from the supplier list, and
Pantrack recalculates **right now** how much of each item that supplier sells
should be ordered, **in that supplier's own pack size**.

- It uses the same calculation as the manual restocking plan: the item's target,
  minus what is on the shelf and already on order, rounded up to whole packs. It
  also applies the same limits for capacity, shelf life, minimum and maximum.
- An item's minimum and maximum are set in its own pack size, and are converted
  exactly into the supplier's pack. A minimum rounds up and a maximum rounds down.
  For example, a minimum of one 30-unit case is three packs of 12.
  - A rule like "order in multiples of 2 cases" has no exact equivalent in another
    pack size, so that item is **held for review** instead of guessed.
- **Held, with a reason, and given no line:**
  - items never counted;
  - expired stock;
  - a supplier mapping that needs review;
  - a product mapped twice for the same supplier;
  - missing or outdated settings;
  - a multiple that can't be converted.
- **Flagged but still suggested:** an overdue count, and limits that conflict.
- **Sales data:** whether it is current is reported once for the whole list. Part 2
  decides what the weekly check does with it.
- **Read-only:** nothing is saved, reserved or sent. The result can be passed
  unchanged to create a supplier-list draft.

## Changes

| File | Change |
| --- | --- |
| [`d1-replenishment-review.ts`](../src/lib/d1-replenishment-review.ts) (A) | An optional supplier pack. Pack-count policies are converted to it exactly; an unconvertible multiple returns `pack_policy_unconvertible`. Without the option, behaviour is unchanged. |
| [`replenishment-proposal.ts`](../src/lib/replenishment-proposal.ts) (A) | The review's supplier may also be `manual_registry`, which marks a transient supplier-list review |
| [`d1-replenishment-proposal-origins.ts`](../src/lib/d1-replenishment-proposal-origins.ts) (A) | Durable proposals refuse supplier-list reviews and supplier packs, so saved proposals are unchanged |
| [`d1-supplier-suggestions.ts`](../src/lib/d1-supplier-suggestions.ts) (new) | `suggest` for one active supplier-list group: draft-ready lines, held items, items not needed and sales readiness. Owner or manager only, with a session re-check; at most 250 items. |

No migration, route or screen. The schedule (Part 2) and screens (Part 3) use
this service.

## Verification

| Check | Result |
| --- | --- |
| [`supplier-suggestions`](../tests/supplier-suggestions.mjs) | See the list below. |
| A and C suites touched by the change | `replenishment-review-d1`, `replenishment-proposal`, `replenishment-proposal-origins-d1`, `replenishment-lifecycle-d1`, `a8-sale-to-proposal-d1`, `a8-clover-review-contract`, `c4-a7-supplier-handoff`, `purchasing-suppliers` and `supplier-simulation-d1` pass unchanged. |
| Planted defects | **14 of 14 caught**; see the list below |
| Full local pipeline | `pnpm typecheck`, `pnpm test` (**144 suites**), `pnpm db:check` (42 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local` passed on this source. |

The `supplier-suggestions` suite proves:

- **Access:**
  - anonymous, staff and other-company users are refused by the suggestion's own
    check;
  - malformed input, unknown suppliers and a location under another account are
    refused.
- **Calculation:**
  - the same 70-unit need is 12 packs of 6 at one supplier and 6 packs of 12 at
    another;
  - the item's own pack gives the manual plan's answer;
  - minimums and maximums convert exactly. The checks use packs of 6 and 12,
    including uneven 12s, where rounding direction matters;
  - capacity is respected;
  - fresh stock and deliveries change the next result;
  - an item with enough is "not needed".
- **Holds and flags:**
  - an unconvertible multiple, a product mapped twice, a missing opening count and a
    retired pack measurement are held;
  - an overdue count is flagged;
  - sales lag is reported;
  - other accounts and locations stay out.
- **Read-only:** every table is unchanged.
- **Draft-ready:** the lines create a supplier-list draft with the same packs and
  exact stock quantities.
- **Transient:** durable proposals refuse supplier-list reviews and supplier packs.

The planted defects caught:

1. the supplier pack ignored;
2. the minimum rounding down. It first survived, because 30 divides by 6, so a test
   now uses packs of 12;
3. the maximum rounding up. It first survived for the same reason;
4. a multiple kept unconverted;
5. policies never converted;
6. duplicate products suggested;
7. a missing count treated as "not needed";
8. one stale mapping aborting the whole list;
9. other accounts included;
10. staff allowed. It first survived, because the supplier list's own check
    refused too, so the test now requires the suggestion's own refusal;
11. an overdue count not flagged;
12. sales readiness hidden;
13. the group not validated;
14. supplier-list reviews saved as proposals.

## Limits and next

- Local fictional evidence only. Nothing was deployed, and no supplier was
  contacted.
- Prices come from the mapping's estimate; review always confirms the cap.
- Forecasting usage from past sales remains a separate later project.
- **Rollback:** revert the commit. There is no migration and no stored data.
- **Next:** Part 2, schedules and the weekly check (one migration).
