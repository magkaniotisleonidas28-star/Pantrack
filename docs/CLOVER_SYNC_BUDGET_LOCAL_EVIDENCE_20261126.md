# Clover sync within Cloudflare's per-run limits — local evidence

Recorded: 2026-11-26. Branch: `workstream-b/clover-sync-budget`, based on
`main` at `c428b32`. It is **local evidence only**: nothing was deployed, and no
Clover account was contacted. This fixes the critical finding from the P5
sandbox session of 2026-11-25/26 (step P5 of the
[Clover pilot roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md)). The owner asked to
"start" the fix.

## The finding

On the development site, 105 gift-card orders were created on the sandbox
test merchant within two minutes:
- Pantrack received 46 of them.
- Every later sync then failed with Cloudflare's error "Too many subrequests
  by single Worker invocation", and the checkpoint stayed put. The 10-minute
  check at 21:10 UTC failed at the same point.

The cause:
- **The limit:** Cloudflare allows a Worker run 50 outside requests on the
  free plan, and 1,000 requests to its own services such as D1.
- **The cost:** a sync re-read every order changed since its checkpoint minus
  one hour, and fetched each order's details from Clover, one request per
  order, even orders it had already received.
- **The result:** with more orders than that in the window, every run hit the
  limit at the same order. The checkpoint only moved at the end of a complete
  run, so it never moved.

## What changed

- **Budget per run**
  ([sync](../src/lib/clover-sync.ts)): each Worker run has one budget.
  - **Clover requests:** at most `CLOVER_FETCH_BUDGET` = 40, which leaves room
    under 50 for a token refresh and recovery. `PANTRACK_CLOVER_FETCH_BUDGET`
    can raise it on a paid plan; values outside 1–9,000 fall back to 40.
  - **New sales:** at most `CLOVER_NEW_SALES_BUDGET` = 20 recorded and applied
    per run. One new sale uses about 22 database requests in the test below,
    so 20 sales stay near 450, well under 1,000, even for recipes with more
    ingredients.
- **Already-received orders aren't read again.** For each page of the order
  list, one database query finds the latest revision Pantrack holds for each
  order, in chunks of 90 to stay under D1's 100 bound values. An order already
  received at that modified time is counted, not fetched again.
  - The exception is an order changed in the last 10 minutes, which is still
    read again: in Clover, a refund can appear on the same modified time after
    the sale was received.
  - Deleted orders come with the list, so they never need a separate fetch.
- **Carrying on where it stopped.** When the budget runs out, the sync stops
  cleanly and moves the checkpoint to the first order it didn't handle:
  - if it was the modified-orders list, to the cursor or the order's modified
    time;
  - if it was the deleted-orders list, the checkpoint doesn't move.

  The result has `partial: true`, the sync records success, and the next run
  re-lists from there, skipping what it already has. A Clover notice, **Sync
  now** or the 10-minute check all continue.
- **One budget per Worker run**:
  - the 10-minute check
    ([scheduler](../src/lib/clover-scheduled.ts)) shares one budget across its
    passes and cafés, ends a café's turn after a partial pass, and stops
    starting cafés once the budget is spent;
  - a Clover notice ([webhook](../src/lib/clover-webhook.ts)) uses one budget
    for all merchants in it;
  - **Sync now** gets its own.

There is no migration, and no API, permission or schema change.

## Tests

[`tests/clover-sync-budget.mjs`](../tests/clover-sync-budget.mjs) runs the real
sync against an in-memory database from all migrations and a mocked Clover
sandbox. It counts Clover requests and database requests per run.
- **Budget settings:**
  - the default is 40 requests;
  - `PANTRACK_CLOVER_FETCH_BUDGET` raises it;
  - a bad value falls back to 40.
- **A busy hour of 105 paid lattes** (the case that failed in the sandbox).
  Each run stays within budget:

  | Run | Clover requests | Database requests | New sales | Partial |
  | --- | --- | --- | --- | --- |
  | 1–4 | 22 | 449 | 20 | yes |
  | 5 | 24 | 450 | 20 | yes |
  | 6 | 9 | 120 | 5 | no |

  Results:
  - the checkpoint never moves back, and every run makes progress;
  - after 6 runs all 105 sales are received, and each takes its cup exactly
    once (1,000 → 895);
  - there is no sync error.
- **A quiet run afterwards** re-lists the hour with no detail requests, at
  most 4 requests in all, and changes nothing.
- **An order changed 2 minutes ago:** it is applied, and when a refund then
  appears on the same modified time, the next run reads it again and receives
  the refund as a new revision. No stock is put back (decision 0003).
- **The 10-minute check, with 30 more orders:** one run stops after one
  partial pass, within 40 Clover requests and 900 database requests. The next
  run finishes the rest, each order once (895 → 864 after the recent order).

The existing paging suite
([`tests/clover-pagination.mjs`](../tests/clover-pagination.mjs)) checks page
order and boundaries over 101 orders in a single run. It now passes an
unlimited budget, because paging rather than the budget is what it tests. All
other Clover, register and A8 suites pass unchanged.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 195 suites (including the new `clover-sync-budget`) |
| `pnpm db:check` | Passed: 57 ordered migrations match the schema; no new migration |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the changed source files or the new test. The
paging suite keeps its four existing unused-name warnings, the same as on
`main`.

## Not covered

- **The hosted re-run.** Repeating the busy-day test on the development site
  needs a release and the owner's go-ahead to turn sync on.
- **A paid Cloudflare plan:** raising the budget there is a setting
  (`PANTRACK_CLOVER_FETCH_BUDGET`), not tested.
- **The other two P5 findings:** refunds that include a tip, and name lookups
  colliding with a sync. They follow separately.
