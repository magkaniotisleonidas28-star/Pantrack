# B7/M5 Clover sandbox acceptance review — 2026-09-29

**Decision status: owner review pending.** This review compares the
[B7 checklist and M5 criteria](PANTRACK_MILESTONES.md) with the
[sandbox case report](M5_B7_SANDBOX_EVIDENCE.md) and current read-only
development state. B7 and M5 remain open. The review created no Clover order,
payment, sales event, stock movement, migration, or Worker change.

## Recommendation

Accept M5 **for the tested development sandbox scope only** if the owner
explicitly approves this narrower reliability criterion: repeated authenticated
notifications and reconciliation polls must apply a sale at most once, and a
missed or failed webhook must be recoverable by owner polling. The current
criterion says "webhook retries and reconciliation polling do not duplicate
usage"; native Clover redelivery after a `503` has not been observed. Clover's
[webhook guide](https://docs.clover.com/dev/docs/webhooks) requires `200 OK`
and describes notification testing, but does not state a retry schedule or
guarantee redelivery. A real webhook reached Pantrack and received the
controlled `503`; one separate owner poll recovered its sale exactly once.

The proposed scope includes mapped paid orders and positive revisions, mapped
modifiers, held unknown modifiers, full refunds with no automatic restock,
unpaid deletion held for owner review, token refresh/recovery, same-merchant
reconnection, and polling recovery. Do not claim direct sandbox coverage for
native retry, paid-order DELETE, voids, reopened orders, partial fulfillment,
menu variations, or multi-page order scans. Clover rejected the one paid-order
DELETE with `400`; the owner completed a linked full refund of that paid order
through the merchant dashboard instead. Clover documents the
[order DELETE endpoint](https://docs.clover.com/dev/reference/orderdeleteorder),
so this single rejection is a limit of the tested order and merchant, not proof
that every paid-order DELETE is unsupported.

If the owner requires native redelivery or any of the unobserved order states
for B7 acceptance, keep B7 open. The next bounded action should establish the
provider's retry contract with Clover before another fault-injection sale;
the 20-minute `503` observation supplied no retry timing to test against.

## Evidence against the M5 tasks

| M5 task | Evidence and judgment |
| --- | --- |
| Sandbox app and minimum read permissions | **Sandbox:** the dedicated app, merchant, verified URL, Orders subscription, and four read grants were recorded in the B7 report. The Clover dashboard was not rechecked today because its Safari session is expired. |
| OAuth, encryption, refresh, expiration, reconnect, revocation | **Mixed:** sandbox OAuth, natural refresh, lost-response recovery, and same-merchant reconnect passed. Encrypted storage, expiry failure, and state replay have local tests. Clover-side app revocation was not exercised; temporary merchant-token revocations were owner-reported. |
| Merchant identity and one-company binding | **Sandbox:** development D1 still binds merchant `4ZJYT1HV8X6Y1` to the B7 fictional company. The unique-binding rule has a local migration test. |
| Menu items, variations, modifier identifiers | **Mixed:** the fictional latte and modifier IDs were loaded from Clover. A variation-specific and multi-page menu case was not exercised. |
| Item and modifier mappings | **Sandbox:** the base latte, extra shot, and later reviewed unmapped modifier were mapped to active exact recipe versions; the held sale applied only after review. |
| Completed/prepared order ingestion | **Sandbox:** paid latte sales and one later paid addition applied exactly once. The owner-approved B6 policy treats fully paid orders as consumed; preparation was not independently observed. |
| Pagination, checkpoint, initial cutoff | **Mixed:** sandbox owner sync advanced a checkpoint and recovered missed sales; page bounds, cutoff, and failure behavior passed mocked local tests. A multi-page Clover order scan was not exercised. |
| Webhook and polling | **Mixed:** a real authenticated Orders webhook reached the Worker, and owner polling recovered its failed delivery. A locally constructed authenticated repeat and a later poll caused no extra use. Native Clover retry remains unverified. |
| Sync health fields | **Mixed:** the hosted owner view showed last attempt, success, checkpoint, lag, held count, and disabled state. Failure handling has local tests. |
| Changes, voids, refunds, reopened orders, partial fulfillment | **Mixed:** a paid positive revision, one unpaid deletion, and one full linked refund have direct sandbox evidence. Paid DELETE returned `400`; void, reopened, and partial fulfillment cases have no direct sandbox evidence. Partial-refund and cancellation normalization have mocked coverage. |
| Connection health and Sync now | **Sandbox:** the B7 owner view showed the authorized merchant and successful menu reads; several guarded owner Sync now runs recorded results. Sync is off between cases. |

## Evidence against the M5 acceptance criteria

| Criterion | Review result |
| --- | --- |
| OAuth state/replay and token secrecy | **Local pass, sandbox connection pass.** Callback/state tests reject replay and unauthorized roles; credentials are encrypted in D1 and were handled through hidden input or Worker secrets. This does not establish an independent log-security audit. |
| Atomic, recoverable refresh rotation | **Local and sandbox pass for one loss.** Natural rotation, one deliberately lost refresh response, Clover recovery, persisted replacement, and a later ordinary Worker read passed. Save-failure and refusal paths passed local mocked tests during the temporary probe. |
| Correct latte and modifier consumption once | **Sandbox pass.** Base latte: 200 mL milk, 18 g espresso, one cup. Extra shot: 200 mL milk, 36 g espresso, one cup. The later paid revision consumed only its newly added latte. |
| Unknown modifier holds without partial deduction | **Sandbox pass.** The $6 fictional latte held with zero use, then applied 200 mL milk, 36 g espresso, and one cup once after audited mapping and replay. |
| Webhook retries and polling do not duplicate usage | **Partly proved.** An authenticated locally constructed repeat notification and owner poll did not duplicate use; a real `503` delivery was later recovered by polling. No native Clover retry was observed in 20 minutes. Literal native-retry acceptance remains unproved. |
| Disconnect preserves history and stops sync | **Sandbox pass for Pantrack-side disconnect.** The owner disconnected and reauthorized the same merchant; mappings, checkpoint, sales history, and stock remained. Clover-side app uninstall/revocation was not tested. |
| Report has event IDs, expected/actual use, exceptions | **Pass for recorded cases.** The B7 report identifies sandbox orders and revisions, exact movements, held-event resolution, refund, and recovery limits. |

## Current development check and handoff

Read-only development D1 on 2026-09-29 still had **12 Clover sales events, 9
consumption applications, and 27 sale-consumption movements**. Balances were
13,341.647136 mL milk, 2,069.96185 g espresso, and 991 cups. The checkpoint
remained `1790638224152`, last error was null, and the connection had no active
lease. Worker secret **names** included `CLOVER_WEBHOOK_AUTH_CODE` but no sales
sync, exact-inventory, or B7 token-probe gate. Development D1 remains at
`0015`; A7's later migrations have not been applied there.

Today's focused `clover-b6-local` and `clover-connection` test suites passed.
They use mocked Clover responses and are distinct from the direct cases above.
No schema, runtime, or public API contract changed in this review. A rollback
would revert only this review document and its status link. If the owner accepts
the narrowed development scope, record the decision and revised retry
criterion explicitly before checking B7/M5 or starting B8. Otherwise leave
both open and select one named provider gap for the next task.
