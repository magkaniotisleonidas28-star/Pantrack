# Clover busy seconds: paging fix — sandbox finding and local evidence

Recorded: 2026-11-28. Branch: `workstream-b/clover-same-second-paging`, based
on `main` at `0d794b2`.

This record has two kinds of evidence, kept apart:
- **Sandbox evidence:** the busy-period re-run on the development site, with
  the Clover sandbox test merchant and made-up sales.
- **Local evidence:** the fix and its tests, which are local only. The fix
  is not deployed.

It continues step P5 of the
[Clover pilot roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md) and the
[P5 session record](CLOVER_P5_SANDBOX_SESSION_20261126.md).

## Sandbox re-run (development site, 2026-11-28 UTC)

The owner approved releasing the P5 fixes (#89 to #91) to the development
site and repeating the busy-period test with sales sync on for the test, then
off again.

| Time (UTC) | What happened |
| --- | --- |
| 00:05:31 | Released `0d794b2` as version `47371446`, with sync off. There was no migration. A database export and a Time Travel bookmark were taken first. Home returned 200, and the unauthenticated webhook returned 404. The 10-minute trigger was confirmed. |
| 00:06:22 | Sync turned on (version `e2b0f339`). The unauthenticated webhook returned 401. |
| 00:10:32–00:10:47 | The 10-minute check took 20 of the 59 sales left from the first busy test (the [per-run budget](CLOVER_SYNC_BUDGET_LOCAL_EVIDENCE_20261126.md)), with no error. The first busy test had failed here with "Too many subrequests". |
| 00:11:50–00:13:36 | 105 new cash gift-card orders were made on the sandbox merchant through its REST API. |
| 00:11:52–00:12:20 | Clover notices added 32 more sales, with no error. |
| 00:12:43 | Every later sync failed with "Clover returned an invalid orders page", and the checkpoint stayed at 2026-11-26 21:06:21. |
| 00:20:32 | The 10-minute check failed the same way. |
| 00:21:22 | Sync turned off (version `a34b0d1c`, which keeps the current secrets). Home returned 200, and the unauthenticated webhook returned 404. |

At the end:
- 98 gift-card sales had been received: 46 from the first test and 52 here;
- no order revision was received twice;
- no sale was left half-processed;
- nothing came off stock, because gift cards are Not tracked.

The other 112 orders are still in Clover and will be read once sync is on
with the fix.

### Cause

Read-only requests to the sandbox, replaying the sync's own order-list
requests, showed two things.
- **Times are to the second.** Clover's sandbox gives `modifiedTime` to the
  second, such as `1795727193000`. In a busy period, several orders share one
  second.
- **An `id>` filter cancels the time filters.** When a page of 100 ended
  partway through a second, the sync asked for the rest of that second with
  `modifiedTime=T` and `id>last`. With an `id>` filter present, Clover
  ignored every `modifiedTime` filter, including the sync's time window. It
  returned any order with a larger ID, from any time.
- **Without the ID filter, it works.** `modifiedTime=T` on its own, with or
  without the window filters, returned only that second's orders, sorted by
  ID. `offset` paged through them correctly.

The sync refused the mixed page, as designed, so nothing was counted wrongly.
But each later run re-read the same window, reached the same page and
stopped. This only happens when a window holds more than 100 orders. The
local paging test didn't catch it, because its stand-in for Clover applied
all filters together.

## The fix (local)

[`syncClover`](../src/lib/clover-sync.ts):
- **No `id>` filter.** The rest of a busy second is read with
  `modifiedTime=T` and an `offset`, 100 at a time, inside the same time
  window.
- **Each page starts one order back.** That first order must be the last
  one already read. If it isn't, an order in that second changed meanwhile
  and Clover's offsets have shifted, so the sync reads the second again from
  its start. Orders already read in this run are skipped, so nothing is read
  or counted twice.
- **A changed order** gets a later time and is read at that time, as before.
- **When the second is done,** the next page starts strictly after it, as
  before.

Unchanged:
- the page limit of 20 (the checkpoint doesn't move if it is reached);
- the per-run budget;
- refusing pages that are out of order;
- the 1-hour overlap.

There is no migration, and no API, permission or schema change.

## Tests (local)

[`tests/clover-pagination.mjs`](../tests/clover-pagination.mjs):
- **Its stand-in for Clover now behaves like the sandbox:** with an `id`
  filter, it ignores the time filters. Run against the code before the fix,
  the suite fails with "Clover returned an invalid orders page", as the
  development site did.
- **The existing checks still pass:**
  - 101 orders with a page that shifts;
  - 125 orders in one second, plus a later order with a smaller ID;
  - an idempotent replay;
  - the 20-page limit;
  - a page in the wrong order is refused.
- **New: a busy second.** 300 orders: 40 a second apart, then 230 in one
  second, then 30 more. All 300 are received once; no `id` filter is sent;
  the busy second is paged with an offset.
- **New: a shift during paging.** 260 orders in one second, where an order
  already read changes while its second is being paged. The shift is
  noticed and the second is read again. All 260 are received once, and the
  next sync receives the changed order as a new revision.

[`tests/clover-sync-budget.mjs`](../tests/clover-sync-budget.mjs) passes
unchanged: 105 lattes in 6 runs, each within Cloudflare's limits.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 197 suites |
| `pnpm db:check` | Passed: 57 ordered migrations match the schema; no new migration |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the changed source file. The paging suite keeps
its four existing unused-name warnings, the same as on `main`.

## Not covered

- **The hosted re-run with this fix.** Releasing it to the development site
  and turning sync on again need the owner's go-ahead. The 112 waiting test
  orders are then the busy-period test.
- **Live Clover.** Whether live Clover also gives times to the second is not
  known. The fix works either way.
