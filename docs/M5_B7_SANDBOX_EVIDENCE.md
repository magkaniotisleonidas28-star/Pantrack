# B7 Clover sandbox acceptance — in progress

**Target:** fictional Clover sandbox merchant connected to a dedicated fictional
company on the `pantrack-dev` Worker. No production merchant, real customer,
supplier, payment, or purchase is in scope. M5 remains open until the provider
cases below have direct evidence.

## Hosted preparation

- On 2026-09-24, `main` at `8e481cb` was pushed to `origin/main` after the
  development D1 migration. The initial Worker version was
  `982b9480-83b0-4581-aa72-e70e961f1931` at
  `https://pantrack-dev.christospsimadas25.workers.dev`.
- The webhook handshake fix was committed as `8c674c7`, pushed to
  `origin/main`, and deployed as Worker version
  `c1413505-f7ec-4e53-bb4c-db23f03e3d0e`. A hosted standalone
  verification challenge returned `200`; a normal empty notification returned
  `404` while the sync gate was off. After Send Verification Code was clicked,
  Clover displayed its code-entry field. The one-time code from its request
  is still needed before the webhook URL can be saved.
- Before applying `0013_low_stick.sql`, the development D1 ledger ended at
  `0012_tough_rage.sql`, `0013` was the only pending migration, and there were
  no duplicate environment/merchant bindings. The pre-migration D1 Time Travel
  bookmark was
  `0000000a-00000000-000050f1-38c20757f7211955d3aa7ac1ddd4c1c3`.
- Wrangler applied the five statements in `0013`. A subsequent migration list
  reported no pending migrations. Read-only inspection found the Clover item
  mapping, modifier mapping, and sync-state tables; `PRAGMA foreign_key_check`
  returned no rows. There were zero existing Clover connections.
- A new `VENDOR_ENCRYPTION_KEY` was generated directly into a Worker secret,
  and `CLOVER_ENVIRONMENT` was set to `sandbox`. Only secret names were listed;
  no values were printed or committed. `PANTRACK_CLOVER_SYNC_ENABLED` remains
  absent. The exact inventory preview was temporarily enabled to prepare the
  fictional fixture, then deleted while dashboard setup was pending. The
  ingredient counts and recipes still require a later gated fixture session.
- The public sandbox app ID was set as the `CLOVER_CLIENT_ID` Worker secret.
  This produced development Worker version
  `b7aba55c-24e0-4f44-9bb4-ea8e5aea423f`. At the time of this check,
  `CLOVER_CLIENT_SECRET` and `CLOVER_WEBHOOK_AUTH_CODE` remained unset.
- The hosted home page returned `200`, an anonymous Clover API request returned
  `401`, and an empty webhook request returned `404` while the sync gate was off.
- The signed-in owner created a dedicated development company,
  `B7 Clover sandbox café (fictional)` (`eb05567b-e227-4f28-ae02-b81f55e6918c`).
  Its sampled catalog is fictional. Ingredient counts and recipes are pending.
- A new US Clover sandbox test merchant, `Pantrack B7 Fictional Café`
  (`4ZJYT1HV8X6Y1`), was created through the Global Developer Dashboard.
  Its merchant dashboard loaded. No Clover order has been created yet.
- The draft web app `Pantrack B7 Sandbox` (`FGYWQ5J4GQ5H2`) was created for
  the United States. Its Site URL is the `pantrack-dev` HTTPS origin, its
  alternate launch path is `/`, and its default OAuth response is `CODE`.
  The owner approved and the dashboard saved exactly four READ permissions:
  Inventory, Merchant, Orders, and Payments. All WRITE and ecommerce
  permissions remain off. The app was not yet installed at this preparation
  checkpoint; the later OAuth connection below used that merchant.
- Clover requires its webhook verification request before the sales-sync gate
  can be enabled. The B6 route initially returned `404` for that request while
  the gate was off. A focused B7 fix now accepts only the bounded, standalone
  `verificationCode` challenge with no sales read, while ordinary notifications
  still return `404` until sync is enabled. Hosted response behavior passed;
  Clover's dashboard code entry and webhook subscription remain pending.
- The owner subsequently saved `CLOVER_CLIENT_SECRET` directly in the
  development Worker. A read-only secret-name check after deployment showed
  `APP_ORIGIN`, `CLOVER_CLIENT_ID`, `CLOVER_CLIENT_SECRET`,
  `CLOVER_ENVIRONMENT`, and `VENDOR_ENCRYPTION_KEY` as `secret_text`; no values
  were retrieved. `PANTRACK_CLOVER_SYNC_ENABLED` remains absent.
- A hosted OAuth attempt on the dedicated B7 company selected fictional merchant
  `4ZJYT1HV8X6Y1` but returned `clover=failed`; a read-only D1 check found no
  connection or sync checkpoint. Diagnostic commits `c5178c6` and `b252911`
  made callback failures observable without logging codes or tokens. A filtered
  Worker tail then showed a token-exchange transport error. A temporary,
  redacted diagnostic identified the exact runtime error: Cloudflare Workers
  rejects `fetch` with `redirect: 'error'` before sending the request.
- Commit `6a7706d` changed Clover token, refresh, and API requests to
  `redirect: 'manual'`, with non-2xx responses still rejected, and removed the
  temporary transport-message diagnostic. It was pushed to `origin/main` and
  deployed to `pantrack-dev` as version
  `12fbb8fe-0762-4bc3-8152-aa67afabbd6f`.
- On 2026-09-25, the owner selected `Pantrack B7 Fictional Café` in Clover's
  sandbox OAuth screen. Pantrack returned `clover=connected` and displayed
  `Authorized · sandbox`, merchant `4ZJYT1HV8X6Y1`, and a disabled sales-sync
  control. A read-only remote D1 query confirmed one connection for dedicated
  company `eb05567b-e227-4f28-ae02-b81f55e6918c`, environment `sandbox`,
  merchant `4ZJYT1HV8X6Y1`, and matching initial `started_at`/`checkpoint`
  (`1790309446387`). A second read-only query found one `clover.connected`
  audit record and zero Clover connections for the separate hosted-validation
  company. No secret or token value was queried. This proves the fictional
  merchant connection, not the remaining B7 provider cases.

## Local checks

- `pnpm typecheck` — passed.
- `pnpm test` — passed, 21 suites; Clover fixtures use mocks.
- `pnpm db:check` — passed, 14 ordered migrations and fresh database.
- `pnpm build` and Wrangler deploy dry run — passed.
- `pnpm db:migrate:local` — no pending local migrations.
- `pnpm test:local` — passed served local smoke test.
- After the webhook setup fix: `pnpm test:focused clover-connection`,
  `pnpm typecheck`, `pnpm test` (21 suites), `pnpm db:check`, `pnpm build`,
  and `pnpm test:local` — passed. The first attempted focused
  command included an unsupported `--` separator and did not run; the corrected
  focused command passed.
- After the OAuth callback and Worker redirect fix: `pnpm typecheck`,
  `pnpm test` (21 suites), `pnpm db:check`, `pnpm build`,
  `pnpm db:migrate:local` (no pending migrations), and `pnpm test:local`
  passed. The focused Clover test additionally covered safe failure codes,
  anonymous/wrong-user/forbidden-role callbacks, audit-write rollback, and
  manual redirect mode. These are local mocked-provider checks.

## Clover provider cases

The following are **pending**, not inferred from the local checks:

| Case | Clover order/event ID | Expected ingredient use | Actual ingredient use | Result and resolution |
| --- | --- | --- | --- | --- |
| Paid latte sale | Pending | 200 ml milk, 18 g coffee, 1 cup | Pending | Pending |
| Extra-shot modifier | Pending | 200 ml milk, 36 g coffee, 1 cup | Pending | Pending |
| Unmapped modifier and replay | Pending | No use until reviewed mapping and replay | Pending | Pending |
| Duplicate webhook and polling | Pending | One deduction | Pending | Pending |
| Unpaid cancellation | Pending | No use | Pending | Pending |
| Refund and paid cancellation | Pending | No automatic restock | Pending | Pending |
| Later paid revision | Pending | Positive incremental use once | Pending | Pending |
| Access-token refresh | Pending | Sync continues after rotation | Pending | Pending |
| Missed webhook and polling recovery | Pending | One deduction after reconciliation | Pending | Pending |
| Disconnect | Pending | No new sync; history retained | Pending | Pending |

## Gate and recovery

Keep `PANTRACK_CLOVER_SYNC_ENABLED` unset until the fictional merchant, app,
permissions, webhook secret, dedicated company, and native mappings are ready.
Turn it off after testing. An app rollback does not undo additive migration
`0013`; preserve the tables and use a new migration for any schema repair.
The D1 bookmark is a recovery reference, not a request to restore data.
