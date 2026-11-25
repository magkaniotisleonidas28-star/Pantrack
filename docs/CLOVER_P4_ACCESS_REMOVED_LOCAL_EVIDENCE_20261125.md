# Clover P4: Clover access removed — local evidence

Recorded: 2026-11-25. Branch: `workstream-b/clover-p4-access-removed`, based
on `main` at `59822c9` (after P1 to P3). It is **local evidence only**:
- nothing was deployed;
- no Clover account (sandbox or live) was contacted;
- Clover sync stays off on every hosted site.

This is step P4 of the
[Clover pilot connection roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md),
following [decision 0012](decisions/0012-clover-pilot-connection.md) item 6.
The owner asked to continue after P3 merged on 2026-11-25.

## Before

Removing the app in Clover, or Clover refusing Pantrack's access, was only
noticed when a later request failed. Every sync then failed with a generic
"authorization expired" error. The owner wasn't told clearly, and automatic
checks kept trying.

## What Clover's documentation says (read 2026-11-25)

Clover's "Use webhooks" page:
- **Notices:** they are `{ appId, merchants: { <merchant>: [{ objectId, type, ts }] } }`,
  checked with the `X-Clover-Auth` code.
- **Apps events:** they use the key `A` for "App is installed, uninstalled,
  or the subscription is changed".
- **Not stated:**
  - what follows `A:` in the object ID;
  - which `type` an uninstall sends;
  - whether tokens are revoked on uninstall;
  - whether failed deliveries are retried.

Pantrack therefore treats an authenticated `A:` event with type `DELETE` as a
removal, and catches a refused token separately. Step P5 records what the
sandbox actually sends.

## What changed

- **Recording a removal** ([logic](../src/lib/clover-access.ts),
  [migration](../drizzle/0056_clover_access_removals.sql)). Each removal is
  stored with its reason and time in `clover_access_removals`, one row per
  café, and audit-logged as `clover.access_removed`.
  - **`app_removed`:** the café removed the app in Clover. The stored tokens
    are deleted, so Pantrack reads nothing more until the owner reconnects.
  - **`access_refused`:** Clover refused the stored tokens. They are kept,
    and a later Clover request that works clears the notice. A one-off error
    can't strand the café.

  In both cases these are kept:
  - recipe links;
  - Not tracked marks;
  - the sync checkpoint;
  - all sales history.

  Nothing is recorded when that merchant's connection is already gone.
- **Clover notices** ([webhook](../src/lib/clover-webhook.ts)). An Apps
  `DELETE` notice records `app_removed`, but only when:
  - it carries the right `X-Clover-Auth` code;
  - it names this app;
  - it is for a connected merchant.

  It works even while sales sync is off, so a removal is noticed before the
  pilot turns sync on. Other cases:
  - unauthenticated notices: 404 with sync off, 401 with sync on, as before;
  - another app: 403;
  - an unknown merchant: ignored;
  - a subscription change (`UPDATE`): not treated as removal;
  - order notices: behave as before.
- **Refused access** ([token handling](../src/lib/clover.ts)). These count as
  `access_refused`:
  - a current access token that Clover rejects (401);
  - a refresh token Clover refuses (401, including after a refused recovery);
  - an expired refresh token.

  Clover outages (5xx), busy responses and missing permissions (403) are not
  treated as removal.
- **Automatic checks stop.**
  - The 10-minute check ([P3](CLOVER_P3_SCHEDULED_SYNC_LOCAL_EVIDENCE_20261125.md))
    skips a café with a removal.
  - Order notices for it are accepted, but no sync runs.
- **Reconnecting** with **Connect Clover**:
  - **Same Clover account:** the callback clears the notice, and the same
    links and checkpoint carry on.
  - **Different account:** existing protections still refuse it. Clover must
    confirm the merchant (`merchant_mismatch`), and a Clover account can't
    serve two cafés (unique merchant index).
  - **Disconnect** also clears the notice.
- **Screens**:
  - **Sales:** a red pill, "Clover access removed — reconnect", with
    **Reconnect Clover**
    ([component](../src/components/workspace/clover-sales-status.tsx)).
  - **Home:** the Clover card says "Access removed" and, for example,
    "Pantrack was removed in Clover, so sales aren't being read. Reconnect to
    continue.", with **Reconnect**
    ([home](../src/components/workspace/home-panel.tsx)).
  - **Setup:** Clover settings show when and why, and that links and history
    are kept ([settings](../src/components/workspace/clover-connection.tsx)).
  - **Status:** `GET /api/clover` (owner only, as before) adds
    `accessRemoved: { reason, at } | null`.

## Schema review

- **SQL:** one new table, `clover_access_removals`:
  - `company_id` is the primary key, linked to `companies`;
  - it holds the environment, merchant, reason and time;
  - `reason` is checked to be `app_removed` or `access_refused`.

  Nothing existing is changed.
- **Snapshot and journal:**
  - `0056_snapshot.json` adds exactly this table, with no changed or removed
    tables;
  - its `prevId` is the 0055 snapshot;
  - the journal adds entry 56 only.
- **Fresh database:** `pnpm db:check` applies all 57 migrations to a fresh
  SQLite database and matches the schema. `pnpm db:migrate:local` applied
  0056 to the demo database.
- **Compatibility.** With no rows:
  - behaviour is as before, except that refused tokens now give the clearer
    message;
  - code from before this change ignores the table.
- **Rollback / forward repair:**
  - deleting rows clears the notices; a café removed in Clover still has to
    reconnect, because its tokens are gone;
  - reverting the code leaves the table unused;
  - fixes go in a new migration.

## Tests

[`tests/clover-access-removed.mjs`](../tests/clover-access-removed.mjs) runs
the real Clover routes with an in-memory database from all migrations. Clover
is mocked.
- **Notices that change nothing:**
  - wrong or missing auth code (404 with sync off, 401 with sync on);
  - another app (403);
  - an unknown merchant;
  - an Apps `UPDATE`.

  Nothing is disconnected and nothing is audit-logged.
- **Removal notice, with sync off:**
  - `app_removed` is recorded and the café's tokens are deleted;
  - another café is untouched;
  - links, Not tracked marks, sales and the checkpoint are unchanged;
  - it is audit-logged once, and a repeated notice is harmless;
  - the status shows `accessRemoved`;
  - the 10-minute check skips the café without calling Clover.
- **Reconnecting:**
  - a merchant Clover doesn't confirm is refused (`merchant_mismatch`), and
    another café's Clover account is refused; the notice stays;
  - the same merchant reconnects, the notice clears, and links and checkpoint
    carry on.
- **Refused access:**
  - a rejected access token records `access_refused` with the tokens kept;
  - automatic checks stop, and an order notice runs no sync;
  - a working request then clears the notice;
  - a refused refresh token also records it;
  - a Clover outage (503) does not.
- **Disconnect** clears the notice and keeps the links, marks and sales.

The existing [Clover connection test](../tests/clover-connection.mjs) now
expects the clearer message ("Clover access was removed. Reconnect Clover to
keep sales coming in.") and the `access_refused` record when a refresh is
refused. Its check that the stored secret is unchanged still passes. The
existing Clover, sales, A8, POS and authorization suites (28) pass.

## Browser check (local, fictional data)

The demo café was given an `app_removed` record from an hour earlier, with its
fictional connection deleted. Clover requests were blocked in the browser.
- **Home:** the Clover card showed "Access removed · Pantrack was removed in
  Clover, so sales aren't being read. Reconnect to continue." with
  **Reconnect**.
- **Sales:** the red pill read "Clover access removed — reconnect", with
  **Reconnect Clover**. No unlinked banner was shown.
- No page errors and no Clover requests.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 194 suites (including the new `clover-access-removed`) |
| `pnpm db:check` | Passed: 57 ordered migrations match the schema and apply to a fresh database |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed (0056 was applied earlier for the browser check) |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports only the existing `companyName` warning in the home page, the
same as on `main`.

## Not covered

- **What Clover sends** on uninstall in the sandbox. Step P5 records it; if it
  differs, the matching rule changes in one place (`appRemoved`).
- **Missed notices.** Clover doesn't document retries. A removal notice that
  never arrives is caught by the refused-token path on the next check.
- **Emailing the owner:** not part of this step.
- **Hosted sites and real cafés.**
