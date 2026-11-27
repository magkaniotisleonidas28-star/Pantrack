# Clover name lookups wait for a sales check — local evidence

Recorded: 2026-11-27. Branch: `workstream-b/clover-name-lookup-wait`, based on
`main` at `2805dc8` (after the
[refund-with-tip fix](CLOVER_REFUND_TIP_LOCAL_EVIDENCE_20261126.md)). It is
**local evidence only**: nothing was deployed, and no Clover account was
contacted. This fixes the last code finding from the P5 sandbox session of
2026-11-25/26 (step P5 of the
[Clover pilot roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md)).

## The finding

On the development site, the owner opened **Sort them out** on the Sales page
at 22:20:34 UTC. Pantrack looked up the Clover item names, but the 10-minute
check was reading Clover at that moment (22:20:32–22:20:34). The lookup failed
at once, and the list showed "Couldn't get names from Clover, so item codes
are shown", with codes such as `RGRE8QX46R5PA` instead of "Latte".

The cause: every Clover request takes the café's Clover lease, so that two
requests never rotate the same tokens at once. A request that found the lease
taken gave up straight away.

## What changed

- **Name lookups wait** ([connection](../src/lib/clover.ts),
  [adapter](../src/lib/clover-pos-adapter.ts)). `withClover` takes an
  optional `waitMs`. While another request holds the lease, it tries again
  every half second until `waitMs` has passed. Looking up menu items and
  options waits up to `CLOVER_NAME_LOOKUP_WAIT_MS` = 20 seconds. A sales check
  within its [budget](CLOVER_SYNC_BUDGET_LOCAL_EVIDENCE_20261126.md) usually
  takes a few seconds.
- **The lease stays exclusive.** The waiting request only reaches Clover
  after the other one lets go.
- **Plain messages:**
  - with no Clover connection: "Connect Clover first.", at once;
  - if the lease is still taken after the wait: "Clover is busy with another
    request. Try again in a moment."
- **Sales checks don't wait.** A Clover notice, **Sync now** and the 10-minute
  check still step aside at once when a name lookup holds the lease, so a
  Clover notice is answered quickly. The next check carries on, as before.
- **Try again** ([Sales banner](../src/components/workspace/clover-sales-status.tsx)).
  If names still can't be fetched, the message now has a **Try again** button,
  instead of needing the list to be closed and reopened.

There is no migration, and no API, permission or schema change.

## Tests

[`tests/clover-name-lookup-wait.mjs`](../tests/clover-name-lookup-wait.mjs)
runs the real Clover route, connection code and sync against an in-memory
database from all migrations and a mocked Clover sandbox:
- with Clover free, names come back at once;
- with the lease held by another request and released after 1.2 seconds, the
  lookup waits, returns "Latte", and reaches Clover only after the release;
- the real sync and a lookup started together both succeed; the lookup runs
  after the sync, and the sync records no error;
- a lease that is never released gives up after the wait with the busy
  message, without calling Clover;
- a sync still doesn't wait when the lease is taken, and the next sync clears
  its error;
- with no connection, the lookup says "Connect Clover first." without
  waiting.

Run against the code before the fix, it fails ("the lookup waited instead of
failing"). The existing Clover connection, access-removed, scheduled-sync,
budget, Not tracked, unlinked and POS adapter suites pass unchanged.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 197 suites (including the new `clover-name-lookup-wait`) |
| `pnpm db:check` | Passed: 57 ordered migrations match the schema; no new migration |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the changed source files or the new test.

## Not covered

- **The hosted re-run** needs a release and the owner's go-ahead.
- **The Try again button** has no browser check of its own. It reuses the
  banner's existing name lookup.
