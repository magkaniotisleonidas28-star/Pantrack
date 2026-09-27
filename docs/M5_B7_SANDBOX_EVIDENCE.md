# B7 Clover sandbox acceptance — in progress

**Target:** fictional Clover sandbox merchant connected to a dedicated fictional
company on the `pantrack-dev` Worker. No production merchant, real customer,
real payment, supplier, or purchase is in scope. M5 remains open until the provider
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

The normal paid latte, mapped extra-shot, and unmapped-modifier/replay cases
have direct sandbox evidence. The other cases remain pending; local
mocked-provider checks do not establish their provider behavior.

| Case | Clover order/event ID | Expected ingredient use | Actual ingredient use | Result and resolution |
| --- | --- | --- | --- | --- |
| Paid latte sale | Order `ABBD68VDTWENM`; event `ABBD68VDTWENM:1790389081000` | 200 mL milk, 18 g espresso, 1 cup | 200 mL milk, 18 g espresso, 1 cup | Passed once in sandbox; applied with reason `inventory_applied` |
| Extra-shot modifier | Order `141JW0CZY9X76`; event `141JW0CZY9X76:1790391186000` | 200 mL milk, 36 g espresso, 1 cup | 200 mL milk, 36 g espresso, 1 cup | Passed once in sandbox; applied with reason `inventory_applied` |
| Unmapped modifier and replay | Order `5XK8NJ9JW6NAW`; event `1b2accac56436a6f14bd62fb0e7d3674072657bcc27a0f023fe64b6fc5a572ed` | Zero while held; after mapping and replay, 200 mL milk, 36 g espresso, 1 cup once | Zero while held; then 200 mL milk, 36 g espresso, 1 cup once | Passed in sandbox after an accidental dismissal and audited owner recovery; see below |
| Duplicate webhook and polling | Order `8092KSCCQ51TT`; event `8092KSCCQ51TT:1790444517000` | 200 mL milk, 18 g espresso, 1 cup once | 200 mL milk, 18 g espresso, 1 cup once | Passed for one locally constructed authenticated duplicate notification and one owner polling run; no native Clover retry was observed |
| Unpaid cancellation | Order `DNY2CAPBYN098`; event `DNY2CAPBYN098:1790478351000` | No use and one cancellation event | One held cancellation, owner dismissed; no use | Passed for the already deleted sandbox order through a `deletedTime` reconciliation scan; see below |
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
  validation applied no migrations. The owner subsequently reported revoking
  the temporary merchant API test token in Clover. This revocation is
  owner-attested; no independent token-list check was performed.

### One fictional extra-shot latte (2026-09-25 local / 2026-09-26 UTC)

- The development sync gate was absent before the test. The dedicated B7
  company had one prior sale, one consumption application, and three exact
  consumption stock events. Exact pre-sale balances were 14,941.647136 mL
  milk, 2,249.96185 g espresso, and 999 cups. Read-only D1 queries confirmed
  the sandbox merchant binding, the native latte and extra-shot mappings, and
  active recipe amounts of 200 mL milk, 18 g base espresso, one cup, and
  18 g additional espresso for the modifier.
- The owner created a separate temporary merchant-specific sandbox API token
  for this case and entered it only through a hidden local Terminal prompt.
  Clover's non-creating atomic checkout showed exactly one mapped latte
  (`DX2XHRRJEVE8M`) with one mapped extra shot (`E52ZXJVB7JX48`) and a
  $6.00 total. The first preview with an implicit modifier price failed the
  total guard; setting the existing $1 modifier price explicitly passed.
  Earlier confirmation attempts stopped before order creation, including one
  while the sync gate was off. Their local result files were absent, and D1
  sale/application counts remained unchanged.
- The owner confirmed one sale through the local runner. Clover returned paid
  sandbox cash order `141JW0CZY9X76`, line `CGFVBZVCWJ620`, modification
  `3X91EB049ST7J`, and payment record `ZRKBW6VSQFRTM` for 600 cents. The
  runner saved only non-secret IDs and status locally; no token, real card, or
  customer details were sent through chat or committed. The saved Pantrack
  normalized event contains exactly one latte line and one extra-shot modifier
  with the expected Clover IDs.
- During the brief sync window, a development Worker tail showed a Clover
  `POST /api/clover/webhook` request with `200` response at
  `2026-09-26T02:53:08.150Z`. Only route, timing, status, and the Clover user
  agent were used as evidence; the request body and auth header were not
  retained. This directly proves a Clover webhook reached the Worker during
  the sale. The captured trace does not identify which order revision was in
  that request. Pantrack's new sales event occurred at `02:53:06.000Z`, was
  received at `02:53:07.093Z`, and reached `applied` with reason
  `inventory_applied`. Sync last succeeded at `02:53:08.978Z` with no error.
- After the sale, exact balances were 14,741.647136 mL milk, 2,213.96185 g
  espresso, and 998 cups: differences of exactly 200 mL, 36 g, and one cup.
  D1 then contained two total sales events, two consumption applications,
  and six exact consumption stock events for this company, one application
  and three stock events more than the pre-sale baseline.
- The temporary sync secret and local sale-window marker were removed
  immediately after the paid result. A Worker secret-name check confirmed
  `PANTRACK_CLOVER_SYNC_ENABLED` absent and
  `CLOVER_WEBHOOK_AUTH_CODE` present. Development D1 remains at `0015`; no
  migration or source-code deployment was needed. The owner subsequently
  reported revoking the temporary extra-shot test token in Clover. This is
  owner-attested; no independent token-list check was performed.

### Duplicate notification and polling for one fictional latte (2026-09-26)

- Before this case, the dedicated company had two applied Clover sales events,
  two consumption applications, six exact consumption stock events, and
  balances of 14,741.647136 mL milk, 2,213.96185 g espresso, and 998 cups.
  The development sync gate was absent. The owner created a separate temporary
  sandbox merchant API token and entered it only into a hidden local Terminal
  prompt. A non-creating checkout preview confirmed exactly one unmodified
  mapped $5 latte and the sandbox cash tender.
- The owner confirmed one sandbox cash sale. Clover returned paid order
  `8092KSCCQ51TT` and payment `REVP83GWKZMX6` for 500 cents. The local
  runner saved its non-secret order ID immediately and blocks a second sale.
  A Worker tail observed a real `POST /api/clover/webhook` immediately after
  payment with a `404` response. D1 still showed two sales and an unchanged
  checkpoint. The timing suggests the new sync secret had not propagated to
  that Worker invocation; the trace does not prove the cause or identify the
  notification body. This failed delivery is recorded, not counted as a
  successful native webhook or a complete missed-event recovery test.
- After selecting the correct B7 company in Pantrack, the owner used **Sync
  now** to reconcile the existing paid order. The UI reported **1 new event,
  0 held**. D1 recorded event `8092KSCCQ51TT:1790444517000` once with one
  latte line, no modifiers, state `applied`, and reason `inventory_applied`.
  It added one consumption application and exactly three `sale_consumption`
  events: -200 mL milk, -18 g espresso, and -1 cup. Balances became
  14,541.647136 mL milk, 2,195.96185 g espresso, and 997 cups. Sync last
  succeeded at `2026-09-26T17:50:26.775Z` without an error.
- A local runner then constructed an Orders UPDATE notification for that same
  merchant and order, with Clover app ID and the order's provider revision.
  Its first attempt used a different code and received `401`; no sync attempt
  or stock change followed. The runner's one-attempt guard stopped an
  accidental rerun. After preserving that rejected result, the owner entered
  the distinct saved **Clover Auth Code** from the app's Webhooks summary at a
  hidden Terminal prompt. The corrected, locally constructed notification
  returned `200` at `2026-09-26T17:56:38Z`. D1 showed a new sync attempt and
  success at `17:56:39.603Z`, but still only three company sales events,
  three consumption applications, and nine exact consumption stock events;
  balances were unchanged. The Auth Code was not sent through chat, printed,
  saved by the runner, or committed.
- The owner then used **Sync now** once more. The UI reported **0 new events,
  0 held**, and D1 showed a successful attempt at
  `2026-09-26T17:57:41.230Z`. A final read-only D1 check found one event for
  order `8092KSCCQ51TT`, three company sales and applications, nine exact
  consumption stock events, and the same three balances. The temporary sync
  gate was deleted; Worker secret-name listing confirmed it absent and
  `CLOVER_WEBHOOK_AUTH_CODE` present. No migrations or source-code deployment
  were used. The owner reported revoking the temporary merchant API token in
  Clover; no independent token-list check was performed.
- This proves one authenticated **simulated repeat notification** and one
  reconciliation poll did not deduct stock twice for the paid sandbox order.
  It does not prove Clover's own retry policy, the content of the earlier real
  webhook request, or broader missed-event recovery behavior. B7 and M5
  remain open for the other provider cases.

### Unmapped modifier case blocked before sale (2026-09-26)

- For this one B7 case, the fictional merchant received a second $1 modifier,
  **B7 Unmapped extra shot (fictional)** (`DTAG1KQEQ6WHP`), in the existing
  latte add-ons group (`VSM8D8JA34X9C`). The group remained assigned to the
  fictional latte (`DX2XHRRJEVE8M`). Pantrack loaded the Clover modifier but
  did not map it to an inventory modifier. A read-only Clover API check found
  both the older mapped extra shot and the new modifier available at 100 cents
  in the same group, with the latte assigned.
- The owner entered a temporary merchant API token only into hidden local
  Terminal prompts. A non-creating atomic checkout preview passed for exactly
  one fictional latte with the new modifier and a 600-cent total. Three guarded
  create attempts using the same one-sale runner returned HTTP `400` from
  Clover's `/atomic_order/orders`: first with modifier ID and amount, then
  with name and availability, then with the merchant-returned price and group
  ID. The last rejection was at `2026-09-26T18:36:46.748Z`. Each attempt
  stopped before payment and preserved a local rejection result; no order ID
  was returned. The last JSON error response was 68 bytes, but the runner did
  not retain a diagnostic error field, so the precise Clover rejection reason
  remains unknown. Clover's [atomic-order guide](https://docs.clover.com/dev/docs/create-an-atomic-order)
  documents checkout as non-creating and describes create-time `400` errors.
- After the last rejection, Clover Merchant Dashboard's **Today** order list
  still showed only the earlier $5 order `8092KSCCQ51TT`. Development D1
  remained at **3 sales events, 3 consumption applications, and 9 exact
  consumption stock events**. Whole milk stayed at 14,541.647136 mL,
  espresso at 2,195.96185 g, and hot cups at 997. There was no held event
  to map or replay, and no ingredient deduction from this attempted case.
- Both temporary Worker secrets, `PANTRACK_CLOVER_SYNC_ENABLED` and
  `PANTRACK_EXACT_INVENTORY_PREVIEW`, were removed and a secret-name check
  confirmed them absent. `CLOVER_WEBHOOK_AUTH_CODE` remained present. The
  owner reported revoking the temporary **Pantrack B7 unmapped modifier test**
  token; its name was then absent from the Clover token list. During an
  earlier dashboard inspection, the token value appeared in the automation
  tool's accessibility output. It was not put in source control or the report,
  and the revocation closes that temporary credential exposure. Local runner,
  diagnostic, result, and window-marker files were deleted after recording
  the non-secret evidence here.
- This case does **not** satisfy the B7 unmapped-modifier acceptance criterion.
  A later, separately controlled run needs Clover's create-time error details
  or a supported sandbox register path, then one paid modified sale, a held
  event with unchanged stock, mapping and one audited replay. No schema,
  Worker code, or production state was changed for this attempted case.

### Guarded unmapped-modifier follow-up (2026-09-26)

- The owner created a new temporary sandbox merchant token and entered it only
  into a hidden local Terminal prompt. A new guarded runner confirmed the
  merchant, enabled cash tender, available $1 unmapped modifier, latte group
  assignment, and a non-creating atomic checkout for exactly one $6 latte.
  The owner confirmed the one-sale phrase; the runner waited until the two
  development Worker gates were set to the exact literal `enabled`.
- The runner made one create request to Clover's atomic-order endpoint. Clover
  returned HTTP `400` at `2026-09-27T01:34:40.113Z`. The runner recorded
  `create_rejected` and attempted no payment. Clover returned a 68-byte body
  marked JSON, but the runner could not parse it and retained no raw body or
  credential; the precise rejection reason is still unknown. The local result
  guard prevents another create attempt from the same runner.
- Both temporary Worker gates were deleted immediately. A subsequent secret
  name check found `PANTRACK_CLOVER_SYNC_ENABLED` and
  `PANTRACK_EXACT_INVENTORY_PREVIEW` absent while
  `CLOVER_WEBHOOK_AUTH_CODE` remained present. Read-only development D1 checks
  still found **3 sales events, 3 consumption applications, and 9 exact sale
  consumption stock events**. Milk, espresso, and cups remained at
  **14,541.647136 mL**, **2,195.96185 g**, and **997**. No Pantrack sale was
  ingested and no ingredient was deducted in this attempt.
- The owner checked the fictional merchant's **Today** orders and reported no
  new $6 order, then reported revoking the temporary **Pantrack B7
  held-modifier follow-up** API token. These are owner-reported Clover checks;
  no independent merchant API order-list or token-list check was performed.
  The held-event and replay acceptance case remains open. No schema, Worker
  code, or production state was changed in this follow-up. The temporary local
  runner, window marker, and result file were removed after recording this
  non-secret evidence.

### Paid unmapped-modifier sale, hold, and audited replay (2026-09-27 UTC)

- The owner created the temporary **Pantrack B7 modifier atomic fix** token for
  this fictional merchant and entered it only into a hidden local Terminal
  prompt. An atomic checkout preview with Clover's documented create shape
  omitted the modifier and returned $5, so the runner stopped before creating
  anything. A guarded $6 preview with the known nested modifier shape then
  passed. The owner entered `PAY ONE B7 UNMAPPED LATTE`; the runner waited for
  the development sync window before creating an order.
- With both temporary Worker gates briefly enabled, the runner used Clover's
  custom-order sequence: create one open order, add the known latte inventory
  item, apply modifier `DTAG1KQEQ6WHP`, update the total to 600 cents, verify
  the returned item/modifier/price, and record one sandbox cash payment. Clover
  returned order `5XK8NJ9JW6NAW`, line `ABV1XGMSRP6NC`, modification
  `GMYKBTH3W87PP`, and paid payment `TT5FQTCB8M36T`. The sync gate was deleted
  immediately after the held event was confirmed; no real card or customer
  details were used. The observed D1 event receipt followed the paid order by
  about three seconds, but no Worker tail captured this request, so its native
  webhook route and body are not independently proved here.
- Before this sale, the B7 company had 3 sales events, 3 consumption
  applications, and 9 `sale_consumption` stock events. Balances were
  14,541.647136 mL milk, 2,195.96185 g espresso, and 997 cups. The new event
  `1b2accac56436a6f14bd62fb0e7d3674072657bcc27a0f023fe64b6fc5a572ed`
  contained one latte and the new Clover modifier. It transitioned through
  received and processing to **held** with `unknown_modifier` at
  `2026-09-27T01:46:35.868Z`. D1 then had 4 sales events but still only 3
  applications and 9 consumption stock events. All three balances were
  unchanged: **zero partial deduction**.
- In the dedicated B7 company, the owner mapped the new Clover modifier to
  existing Pantrack modifier lineage `6ae3d2f6-2a92-47c1-a9ad-8b52cb64bc62`,
  which adds 18 g espresso. A read-only D1 check confirmed the active mapping.
  During UI automation, I clicked a flattened table cell intending **Replay**;
  it activated **Dismiss** instead at `2026-09-27T01:51:03.940Z`. I reported
  the mistake immediately. D1 showed a dismissed event and still no new stock
  use. The audit retains this transition and its reason.
- A focused code change added an owner-only, reason-required replay control
  for dismissed events, with the same atomic state transition and audit trail
  as held-event replay. Anonymous, other-company, employee, and manager
  requests are denied. The complete local pipeline passed before development
  deployment. The deployed Worker version was
  `8bf21843-f119-4ba3-8f08-180b14727134`. The owner control replayed this
  one dismissed event at `2026-09-27T01:59:16.532Z` using a reason that names
  the accidental dismissal and reviewed mapping; D1 then recorded processing
  and **applied** with `inventory_applied` at
  `2026-09-27T01:59:16.883Z`.
- After replay, D1 had 4 sales events, **4 consumption applications**, and
  **12 sale-consumption stock events**. This event had exactly one application
  (key `5ab69310e74ef58f681313c53614a1bb436a1857c7ea5b3e78b7bc874a393b00`)
  and three stock movements: **-200 mL milk, -36 g espresso, -1 cup**. Balances
  became 14,341.647136 mL milk, 2,159.96185 g espresso, and 996 cups. These
  equal the $5 latte recipe plus one reviewed 18 g extra shot, exactly once.
- The owner reported revoking the temporary Clover merchant token; no
  independent token-list inspection was made. A Worker secret-name check
  confirmed both `PANTRACK_CLOVER_SYNC_ENABLED` and
  `PANTRACK_EXACT_INVENTORY_PREVIEW` absent, with
  `CLOVER_WEBHOOK_AUTH_CODE` still present. No migration, production change,
  supplier action, or purchase was made. The temporary local runner, window
  marker, and result file were deleted after this non-secret evidence was
  recorded. B7 remains open for native retry,
  refund/cancellation, token refresh, disconnect, and missed-event recovery.

### Unpaid cancellation blocked at Clover deletion tombstone (2026-09-27 UTC)

- This one-case B7 attempt used a new fictional $5 latte order in the dedicated
  merchant `4ZJYT1HV8X6Y1`. The first temporary token was mistakenly created
  for a different sandbox merchant and its first merchant GET returned `401`;
  no order was attempted with it. The owner reported revoking that token and
  created the replacement under the correct B7 merchant. Both values stayed
  in hidden local Terminal input and out of source control.
- Before the order, development D1 showed **4 sales events, 4 consumption
  applications, and 12 `sale_consumption` stock events**. Balances were
  **14,341.647136 mL milk, 2,159.96185 g espresso, and 996 cups**. Both
  temporary Worker gates were absent. The guarded runner checked the B7
  merchant and $5 latte item before the owner entered the one-order creation
  phrase. It created Clover order `DNY2CAPBYN098` with latte line
  `7WDQ9N2CM4SPG`; an expanded read verified total 500 cents, payment state
  `OPEN`, exactly one latte line, and **zero payments**. Pantrack still had no
  event for the open order.
- After both development gates were briefly enabled, the runner rechecked
  that same unpaid order and sent **one** Clover order DELETE. Clover returned
  success at `2026-09-27T03:05:51.417Z`. A subsequent expanded detail GET
  returned `404`. The development Worker performed a sync attempt at
  `2026-09-27T03:05:52.174Z` and reported success at
  `2026-09-27T03:05:53.245Z`, but recorded **no event** for this order.
- With sync off, a separate read-only Clover check found both expanded and
  plain detail GETs returned `404`. A recent `modifiedTime` order list returned
  zero entries; a recent `deletedTime` order list returned one entry for this
  order, but its inspected projection had `state=OPEN`, `paymentState=OPEN`,
  and no `deletedTime` value. The current Pantrack adapter scans
  `modifiedTime` and then requires a successful detail GET, so it cannot
  ingest this deletion. This is direct provider evidence of an adapter gap,
  **not** a passing unpaid-cancellation case.
- D1 remained at **4 sales events, 4 applications, and 12 sale-consumption
  movements**; the milk, espresso, and cup balances were unchanged. Both
  temporary Worker secrets were deleted and a secret-name check confirmed
  them absent while `CLOVER_WEBHOOK_AUTH_CODE` remained present. No payment,
  production change, migration, supplier action, or purchase occurred. The
  owner reported revoking the correct-merchant temporary token; no
  independent token-list check was made. The temporary runner, marker,
  result, and read-only diagnostic files were deleted. Before repeating an
  unpaid cancellation, a focused adapter change must reconcile Clover deletion
  tombstones without inventing a sale or silently advancing past a
  cancellation; the resulting event and zero-use policy then need fresh
  sandbox evidence.

### Unpaid deletion reconciled and dismissed (2026-09-27 UTC)

- The B7 adapter now scans Clover's `deletedTime` order list as well as its
  normal `modifiedTime` list in the same checkpoint window. It treats a row
  from the deletion-filtered list as cancellation evidence even if Clover
  omits `deletedTime` from that row and order detail returns `404`. It retains
  expanded line IDs when supplied and holds cancellations with unknown
  preparation for review. No migration or new Clover order was needed.
- Local mocked-provider tests covered absent and expanded lines, duplicate
  scans, deletion-list failure without checkpoint advance, zero stock use,
  and the narrow authenticated Clover receipt exception. These are local
  contract checks, separate from the sandbox result below.
- Development D1 started with **4 sales events, 4 consumption applications,
  12 sale-consumption stock events**, and balances of **14,341.647136 mL
  milk, 2,159.96185 g espresso, and 996 cups**. The new Worker was deployed
  to `pantrack-dev`; the owner signed into the dedicated B7 company, where
  Pantrack showed `Authorized · sandbox` for merchant `4ZJYT1HV8X6Y1`.
  An initial gate window closed before any sync when the Pantrack session
  expired. The two temporary development gates were reopened for the review
  window after owner sign-in.
- One owner **Sync now** scan began at `2026-09-27T17:29:09.659Z` and
  succeeded at `2026-09-27T17:29:11.189Z` with **1 new event, 1 held** and
  checkpoint `2026-09-27T17:29:10.460Z`.
  Development D1 recorded event key
  `9485c2be0379c3c0f2e49e3f56671212b903dd26ef0e4258b4a86d530ab0835e`
  for order `DNY2CAPBYN098`, revision `1790478351000`, cancellation status,
  and original latte line `7WDQ9N2CM4SPG`. The provider list still did not
  expose an explicit preparation result; Pantrack held the event as
  `ambiguous_preparation` without an inventory application.
- The owner review used this reason: “Reviewed deleted Clover order
  DNY2CAPBYN098: original $5 latte was unpaid with zero payments;
  preparation is unknown. Dismiss cancellation without stock use.” D1 now
  shows state `dismissed` and one `dismiss` resolution for that event. Final
  counts are **5 sales events, 4 consumption applications, and 12
  sale-consumption stock events**. Milk, espresso, and cup balances remain
  **14,341.647136 mL, 2,159.96185 g, and 996** respectively.
- A Worker secret-name check confirms both temporary gates absent while
  `CLOVER_WEBHOOK_AUTH_CODE` remains present. No new Clover order, payment,
  token, migration, production change, supplier action, or purchase occurred.
  This one case does not prove native Clover retries, refunds, later paid
  revisions, token refresh, missed webhook recovery, or disconnect behavior;
  those B7 cases remain open.

### Paid cancellation blocked by Clover (2026-09-27 UTC)

- This single B7 attempt used the dedicated fictional merchant
  `4ZJYT1HV8X6Y1`. Before it, development D1 had **5 sales events, 4
  consumption applications, and 12 sale-consumption movements**. Balances
  were 14,341.647136 mL milk, 2,159.96185 g espresso, and 996 cups. Both
  temporary Worker gates were absent. A fresh temporary merchant token was
  entered only in a hidden local Terminal prompt.
- The guarded preflight checked that merchant, one unmodified mapped $5 B7
  latte, and an enabled cash tender. After the owner's one-sale confirmation,
  Clover returned order `MYYZBP7EV0H4A`, latte line `FHAA7HW611PYE`, and one
  sandbox cash payment `SNHQZ2EG5R5T0`. This was a fictional cash record,
  with no real charge. Pantrack's `pantrack-dev` Worker version
  `0322276c-dbe0-4a44-aa77-8ad7f13c4bde` was deployed for this case;
  no migration was needed.
- With both gates briefly enabled, one **Sync now** scan finished at
  `2026-09-27T23:27:08.227Z` with **1 new event, 0 held**. D1 recorded the
  order as an applied sale, revision `1790551499000`, and one inventory
  consumption application with exactly three movements: **-200 mL milk,
  -18 g espresso, -1 cup**. Balances became 14,141.647136 mL milk,
  2,141.96185 g espresso, and 995 cups. The checkpoint advanced to
  `1790551627439`. Both temporary gates were then deleted and secret-name
  inspection confirmed their absence.
- The separate guarded runner read the same order back as `PAID`, with one
  latte line and one payment, before the owner's single confirmation to send
  DELETE. Clover returned **HTTP 400** for that paid order at
  `2026-09-27T23:28:33.586Z`. The runner's durable attempt marker prevents a
  retry. Clover's Today list still showed the order as **Paid**, with one $5
  latte and a $5 cash payment. No refund or alternate cancellation action was
  attempted. Read-only D1 inspection after rejection still showed **6 sales
  events, 5 applications, and 15 movements**, with the same post-sale balances.
  No cancellation event or restock occurred. This is a provider-rejected paid
  deletion, **not** a passing paid-cancellation case.
- The code change in this branch makes a zero-line deletion tombstone a
  stock-neutral applied no-op when the same order already has applied
  consumption. Local contract and mocked-provider tests passed, but Clover
  did not emit a paid deletion tombstone in this case, so that path has **no
  direct sandbox evidence**. A distinct, explicitly approved refund or
  supported paid-cancellation flow is needed to finish that B7 case. The
  temporary merchant token must be revoked after this read-only diagnosis;
  the separate app Webhooks Auth Code stays in place.

## Gate and recovery

Keep `PANTRACK_CLOVER_SYNC_ENABLED` unset between explicitly authorized B7
sandbox cases. It was removed after the duplicate-delivery validation, the
rejected unmapped-modifier attempts, and the paid held-event replay. Any
correction to the fictional stock fixture should use an auditable inventory
action rather than deleting the accepted sale or consumption history. An app
rollback does not undo additive migration `0013`; preserve the tables and use
a new migration for any schema repair.
The D1 bookmark is a recovery reference, not a request to restore data.
