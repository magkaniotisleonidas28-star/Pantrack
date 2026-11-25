# Clover P3: automatic check every 10 minutes — local evidence

Recorded: 2026-11-25. Branch: `workstream-b/clover-p3-scheduled-sync`, based
on `main` at `693e443` (after P1 and P2). It is **local evidence only**:
- nothing was deployed;
- no Clover account (sandbox or live) was contacted;
- Clover sync stays off on every hosted site.

This is step P3 of the
[Clover pilot connection roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md),
following [decision 0012](decisions/0012-clover-pilot-connection.md) item 4
and the ten-minute freshness policy of
[decision 0004](decisions/0004-m7-development-sales-freshness.md). The owner
chose "Every 10 minutes" on 2026-11-22.

## Before

Pantrack read Clover only:
- when Clover sent an Orders notice, which Clover doesn't promise to resend
  if it fails;
- or when someone pressed **Sync now**.

Each sync covers at most 24 hours, so catching up after a long gap needed
several presses.

## What changed

- **Worker entry** ([worker](../src/worker.ts)): a small Worker module that
  hands every request to vinext's handler as before, and adds a `scheduled`
  handler.
  - It uses vinext's documented delegate pattern: "import and delegate to it
    from a custom worker".
  - A type declaration for vinext's virtual module is added
    ([types](../src/vinext-worker-entry.d.ts)).
  - `wrangler.jsonc` now points `main` at it.
  - Local `pnpm dev` uses the same entry
    ([vite config](../vite.config.ts)).
  - The purchase-order and cart preview scripts keep their own entry.
- **Trigger:** `wrangler.jsonc` adds `"triggers": { "crons": ["*/10 * * * *"] }`.
  It only takes effect on a hosted site when that site is updated, which
  needs the owner's go-ahead.
- **The check** ([logic](../src/lib/clover-scheduled.ts)):
  - **When sales sync is off** (`PANTRACK_CLOVER_SYNC_ENABLED`, as on every
    hosted site today), it does nothing at all, not even a database read.
  - **Who is checked:** each café with both a Clover connection and a sync
    state for the current environment. The café furthest behind goes first.
  - **Catching up:** each café gets up to 6 passes per run, until its
    checkpoint is within 15 minutes of now. A café 3 days behind catches up in
    one run instead of 3 presses.
  - **Overlaps:** the existing per-café lease keeps runs from overlapping with
    a Clover notice, **Sync now** or another trigger. A café already syncing
    is skipped as `busy`. The existing duplicate protection keeps any sale
    from being counted twice.
  - **Errors:** one café's error is recorded on that café (`last_error`, as
    before) and doesn't stop the others.
  - **Time budget:** after 5 minutes no new pass starts, and the next run 10
    minutes later carries on.
  - **Log:** each run logs one line, for example
    `{"event":"clover.scheduled_sync","skipped":null,"cafes":[{"outcome":"synced","passes":1,"created":2,"paused":0}]}`.
    It has no company IDs, merchant IDs or Clover data.
- **The Sales and Home "last checked" label** from the
  [banner work](CLOVER_UNLINKED_BANNER_LOCAL_EVIDENCE_20261123.md) reads each
  café's last successful sync. With the trigger on, it stays within about 10
  minutes by itself.

There is no migration, and no API, permission or schema change.

## Tests

[`tests/clover-scheduled-sync.mjs`](../tests/clover-scheduled-sync.mjs) uses
an in-memory database from all migrations and a mocked Clover sandbox:
- **Sync off:** the trigger returns `sync_disabled` and makes no database
  query.
- **With a stand-in sync:**
  - a café 3 days behind takes 3 passes and catches up, ahead of a café that
    is already current;
  - a café never takes more than 6 passes in a run;
  - a run that used its 5-minute budget starts no new café;
  - a held lease is reported as `busy`, and an error as `failed`, while the
    other café still syncs.
- **With the real sync and four cafés:**
  - **a:** connected, 3 days behind, with sales 2.5 days, 1.5 days and 20
    minutes ago;
  - **b:** Clover fails;
  - **c:** disconnected;
  - **d:** another environment.

  Results:
  - two triggers and a direct sync (as from a notice or Sync now) start at
    the same moment;
  - neither trigger throws, and the overlapping check of café a is skipped as
    `busy` (repeated over three runs);
  - café b's error is reported and recorded on café b;
  - cafés c and d are skipped, and Clover is not read for them;
  - after the next trigger, café a's three sales each came off stock once
    (20 → 17), from three received sales;
  - café a's checkpoint is within 15 minutes of now, with no error and no
    lease left;
  - a later trigger with nothing new takes one pass and changes nothing.

## Build and local run

- `pnpm build` writes `dist/server/wrangler.json` with `"main": "index.js"`
  and `"triggers": {"crons": ["*/10 * * * *"]}`.
- The built `index.js` exports `{ fetch, scheduled }`.
- `pnpm dev` with the new entry:
  - `GET /` returned 200;
  - firing the trigger locally (`/cdn-cgi/handler/scheduled`) returned 200
    and logged
    `{"event":"clover.scheduled_sync","skipped":"sync_disabled","cafes":[]}`,
    since local sync is off.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 193 suites (including the new `clover-scheduled-sync`) |
| `pnpm db:check` | Passed: 56 ordered migrations match the schema; no new migration |
| `pnpm build` | Passed; `dist/server/wrangler.json` carries the 10-minute trigger |
| `pnpm db:migrate:local` | Passed |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed, using the new Worker entry in `pnpm dev` |

- **One earlier failure.** An earlier full run stopped at the unrelated
  `document-archive-api` suite: a 503 where 409 was expected, in its archive
  continuation check. This is the same suite that failed once on GitHub's
  Windows runner for PR #84. Run alone three times afterwards, it passed each
  time.
- **Fixes, then a clean run.** The two style issues that run found were then
  fixed: Prettier, and naming the Worker export. The full pipeline above
  passed after that.
- **ESLint** reports no problems in the new and changed files.

## Before turning it on (not done here)

The trigger starts working on a hosted site only after these steps, each with
the owner's go-ahead:
1. release this version to that site;
2. set `PANTRACK_CLOVER_SYNC_ENABLED=enabled` there.

Sync also still requires `CLOVER_ENVIRONMENT=sandbox` in code. Allowing the
live environment belongs to the pilot go-live (P7).

## Not covered

- **Running on Cloudflare's real schedule:** hosted only.
- **Removal or refused access:** a Clover app removal or refused access stops
  that café's checks with an error each run until step P4 handles it.
- **More than about 15 cafés:** spread over 10-minute runs, these would need
  a queue, which is not needed for the pilot.
