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

## Fictional catalog and mapping fixture

On 2026-09-25, the dedicated B7 company received three fictional exact opening
counts. Each count took effect at `2026-09-25T04:22:00.000Z`, after the Clover
connection cutoff (`2026-09-25T04:10:46.387Z`). These are synthetic test
balances, not observed physical stock:

| Sample product | Stock unit | Fictional opening count | Purchase unit and quantity |
| --- | --- | ---: | --- |
| Whole milk (`sample-0`) | mL | 15,141.647136 | case, 15,141.647136 mL (4 US gallons) |
| House espresso blend (`sample-4`) | g | 2,267.96185 | bag, 2,267.96185 g (5 lb) |
| 12 oz hot cups (`sample-8`) | each | 1,000 | case, 1,000 each |

The active **B7 Latte 12 oz (fictional)** recipe is lineage
`7151ba96-4da6-4a95-8d7a-ef8a8aaafe6d`, version
`e58c4f2c-fac4-49fb-a06a-eb15aeda9ad6`, active from
`2026-09-25T04:24:47.198Z`. Its stored ingredients are 200 mL whole milk,
18 g espresso, and one hot cup. Its active **B7 Extra shot (fictional)**
modifier is lineage `6ae3d2f6-2a92-47c1-a9ad-8b52cb64bc62`, version
`682d8fec-57f1-4130-b86a-c75f029fd319`, active from
`2026-09-25T04:25:45.560Z`; it adds 18 g espresso.

In the fictional Clover sandbox merchant, item **B7 Latte 12 oz (fictional)**
(`DX2XHRRJEVE8M`, $5.00) was created. Modifier **B7 Extra shot (fictional)**
(`E52ZXJVB7JX48`, $1.00) was created in group **B7 Latte add-ons
(fictional)** (`VSM8D8JA34X9C`). Clover confirmed the group was assigned to
the latte item. An initial assignment through the modifier-group page showed
an error and left zero assigned items; assigning from the latte item page then
showed success and the group ID on the item. No order was created.

Pantrack's owner controls loaded the Clover menu and modifiers and saved these
native mappings for environment `sandbox` and merchant `4ZJYT1HV8X6Y1`:

| Clover ID | Pantrack lineage |
| --- | --- |
| Item `DX2XHRRJEVE8M` | Recipe `7151ba96-4da6-4a95-8d7a-ef8a8aaafe6d` |
| Modifier `E52ZXJVB7JX48` on item `DX2XHRRJEVE8M` | Modifier `6ae3d2f6-2a92-47c1-a9ad-8b52cb64bc62` |

Read-only development D1 queries confirmed the three exact balances, active
ingredient amounts, one item mapping, and one modifier mapping. The same check
found zero sales events, zero consumption applications, zero exact sale events,
and no sync attempt; the sync checkpoint still equals the connection cutoff.
The exact inventory preview was removed after recipe setup, and a hosted page
reload showed the ordinary inventory screen. A final Worker secret-name check
found neither `PANTRACK_EXACT_INVENTORY_PREVIEW` nor
`PANTRACK_CLOVER_SYNC_ENABLED`. This establishes fixture readiness only;
webhook verification and all provider cases below remain pending.

## Webhook verification setup slice (2026-09-25)

- Commit `c909cf5` adds an encrypted, ten-minute Clover verification-code
  receipt for the dedicated fictional company. Capture requires an active
  sandbox Clover connection and the temporary
  `PANTRACK_CLOVER_WEBHOOK_SETUP_COMPANY_ID` Worker secret. The challenge still
  returns `200`; ordinary notifications still require the separate sales-sync
  gate. The owner-only, no-cache `/api/clover/webhook/setup` control reads or
  clears the challenge. Code values are excluded from source, logs, and audit
  records; capture and clearing write metadata-only audit records.
- The generated additive `0015_silky_overlord.sql` creates only
  `clover_webhook_challenges`, with a company foreign key. Existing `0014` was
  reviewed before generation. Local tests cover expiry, replacement, clearing,
  anonymous, wrong-company, manager and employee access, and sync-off behavior.
- The final post-change local pipeline passed: `pnpm typecheck`, `pnpm test`
  (25 suites), `pnpm db:check` (16 ordered migrations and fresh SQLite),
  `pnpm build`, `pnpm db:migrate:local`, and `pnpm test:local`. The local D1 and
  served smoke commands required loopback permission; both passed after that
  permission was granted. `git diff --check` passed.
- Development D1 listed only `0014` and `0015` as pending. Both applied through
  Wrangler; the ledger contains both, `migrations list` now reports none
  pending, the challenge table initially had zero rows, and
  `PRAGMA foreign_key_check` returned no rows. Worker version
  `c7a71856-bb22-417c-a6aa-a84a140a8767` was deployed to `pantrack-dev`,
  then the temporary company gate was set. A secret-name check found that gate
  and no `PANTRACK_CLOVER_SYNC_ENABLED` or `CLOVER_WEBHOOK_AUTH_CODE`. Hosted
  anonymous setup retrieval returned `401`; an empty ordinary webhook
  notification returned `404`. Read-only D1 counts showed zero sales events,
  zero consumption applications, and no sync attempt for the B7 company.
- Rollback: remove the temporary setup gate and redeploy the earlier B6 Worker
  code if the setup path fails. Leave additive `0014` and `0015` in place;
  use a new forward migration for any schema repair. Clear any stored challenge
  before removing the gate. Do not restore D1 or undo the A6 settings history.

### Direct Clover webhook setup

- In the Global Developer Dashboard's sandbox app `Pantrack B7 Sandbox`
  (`FGYWQ5J4GQ5H2`), Clover sent a verification request to the development
  `/api/clover/webhook` URL. The first code-entry prompt appeared before a
  stored challenge was present. A later synthetic challenge confirmed hosted
  capture; Clover's resent challenge replaced it. The signed-in Pantrack owner
  retrieved the unexpired real code through the no-cache setup control and
  entered it in Clover without recording its value here. Clover accepted
  **Verify**, then saved the URL and **Orders** as the sole event subscription.
  The saved Webhooks summary displayed that exact URL and `Subscriptions Orders`.
  This is direct provider dashboard evidence for URL and subscription setup,
  not evidence that any order notification has been delivered.
- The captured code row was deleted from development D1 (`changes: 1`), and a
  follow-up query found zero rows. The temporary setup gate was removed and a
  Worker secret-name check confirmed its absence. `PANTRACK_CLOVER_SYNC_ENABLED`
  remains absent. Read-only D1 checks found zero fictional sales events and
  zero inventory consumption applications. The owner entered the distinct
  code shown in Clover's saved Webhooks section directly into Cloudflare's
  `pantrack-dev` secret form. A subsequent read-only Worker list showed
  `CLOVER_WEBHOOK_AUTH_CODE` as `secret_text`; its value was not retrieved,
  logged, or placed in this report. The value cannot be independently proved
  until a separately authorized sandbox notification is received.

### Migration merge handoff

While B7 was being verified, A7 reached `origin/main` with a different,
local-only `0015` migration. Development D1 had already applied B7's `0015`,
so the merge kept B7's SQL and snapshot at that number. A7's additive SQL,
including its immutability triggers, moved unchanged to `0016`; its snapshot
and journal entry were regenerated from the merged schema. A later concurrent
A7 lifecycle migration also moved from its local-only `0016` to `0017`,
preserving its SQL backfill and triggers. The final merged local pipeline
passed TypeScript, 28 tests, the 18-migration fresh-database check, build,
local D1 application of `0016` then `0017` after B7 `0015`, and the served
smoke test. A7's original branch-only `0015` and `0016` were never applied to
development D1.
Development D1 deliberately remains at B7 `0015`; A7 `0016` is pending and
the later A7 lifecycle `0017` is also pending. Neither has remote authorization.
See the [A7 origin note](M7_A7_ORIGIN_NOTES.md) and
[A7 lifecycle evidence](M7_A7_LIFECYCLE_EVIDENCE.md) for the local-database
handoff.

## Earlier local checks

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

One normal paid-sale case has direct sandbox evidence. The other cases remain
pending; local mocked-provider checks do not establish their provider behavior.

| Case | Clover order/event ID | Expected ingredient use | Actual ingredient use | Result and resolution |
| --- | --- | --- | --- | --- |
| Paid latte sale | Order `ABBD68VDTWENM`; event `ABBD68VDTWENM:1790389081000` | 200 mL milk, 18 g espresso, 1 cup | 200 mL milk, 18 g espresso, 1 cup | Passed once in sandbox; applied with reason `inventory_applied` |
| Extra-shot modifier | Pending | 200 ml milk, 36 g coffee, 1 cup | Pending | Pending |
| Unmapped modifier and replay | Pending | No use until reviewed mapping and replay | Pending | Pending |
| Duplicate webhook and polling | Pending | One deduction | Pending | Pending |
| Unpaid cancellation | Pending | No use | Pending | Pending |
| Refund and paid cancellation | Pending | No automatic restock | Pending | Pending |
| Later paid revision | Pending | Positive incremental use once | Pending | Pending |
| Access-token refresh | Pending | Sync continues after rotation | Pending | Pending |
| Missed webhook and polling recovery | Pending | One deduction after reconciliation | Pending | Pending |
| Disconnect | Pending | No new sync; history retained | Pending | Pending |

### One fictional paid latte (2026-09-25 local / 2026-09-26 UTC)

- Before the test, read-only development D1 queries found zero sales events,
  zero consumption applications, and no sync attempt for the dedicated B7
  company. Exact balances were 15,141.647136 mL milk, 2,267.96185 g espresso,
  and 1,000 cups. The Clover sync secret was absent.
- The merchant's browser checkout accepted an amount and card details but could
  not include the mapped latte item. The owner therefore used a separate
  merchant-specific sandbox API test token locally. The test runner held it in
  a hidden Terminal prompt and never saved or sent its value through chat,
  source control, or the evidence report. Clover's preflight confirmed exactly
  one unmodified `B7 Latte 12 oz (fictional)` item (`DX2XHRRJEVE8M`) for $5.00
  and an enabled sandbox cash tender. No order was created during preflight.
- After the owner confirmed the one-sale prompt, Clover returned order
  `ABBD68VDTWENM`, line item `2TVNT197HHPWC`, and a `PAID` cash payment record
  for 500 cents (`T8SMM6M3QTB9C`). This is a synthetic sandbox cash record,
  not a real card charge or a live sale. The local runner recorded the order
  ID immediately after creation to prevent an accidental second run.
- The development Worker had `PANTRACK_CLOVER_SYNC_ENABLED` set only for this
  sale. Pantrack recorded exactly one Clover sales event for the order, state
  `applied` with reason `inventory_applied`, and exactly one inventory
  consumption application. The event occurred at
  `2026-09-26T02:18:02.000Z`; the Clover sync state shows an attempt at
  `02:18:02.185Z`, success at `02:18:04.699Z`, and no error. No manual
  **Sync now** was used. The timing is consistent with the subscribed Orders
  webhook triggering sync; a separate request trace was not retained, so
  webhook delivery itself is not independently proved here.
- Read-only D1 balances after the sale were 14,941.647136 mL milk,
  2,249.96185 g espresso, and 999 cups. The differences from the recorded
  opening counts are exactly 200 mL, 18 g, and one cup. A final read-only
  query found one sales event, one consumption application, and three exact
  stock events associated with consumption for the B7 company. There was no
  extra modifier or second order in this test.
- Immediately afterward, the sync secret was deleted from `pantrack-dev` and
  the local sale-window marker was removed. A Worker secret-name list confirmed
  `PANTRACK_CLOVER_SYNC_ENABLED` absent and
  `CLOVER_WEBHOOK_AUTH_CODE` present. Development D1 remains at `0015`; this
  validation applied no migrations. The temporary merchant API test token
  should be revoked in Clover now that its write permissions are no longer
  needed.

## Gate and recovery

Keep `PANTRACK_CLOVER_SYNC_ENABLED` unset between explicitly authorized B7
sandbox cases. It was removed after the one-sale validation. Any correction to
the fictional stock fixture should use an auditable inventory action rather
than deleting the accepted sale or consumption history. An app rollback does
not undo additive migration
`0013`; preserve the tables and use a new migration for any schema repair.
The D1 bookmark is a recovery reference, not a request to restore data.
