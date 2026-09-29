# Pantrack current status

Updated: 2026-09-29

This is the single plain-language progress summary for Pantrack. It separates
work that has passed evidence checks from prototype features and future work.
No production customer data, real café sales, supplier orders, payments, or live
POS connections have been used.

## What is complete

### M0 — local development baseline

Complete and merged into `main` in commit `0a6986e`.

- The repository runs locally with Node 22.23.2 and pnpm 11.25.0.
- A local Cloudflare-compatible D1 database applies all nine existing migrations.
- Local-only variables, database state, dependencies, and generated secrets are
  ignored by Git.
- The home page, local sign-in fixture, company creation, company isolation, and
  sign-out were exercised through a real local HTTP smoke test.
- Setup, reset, run, and verification commands are documented in
  [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).
- Supplier submission and automatic ordering are blocked on the server until the
  supplier and reviewed-pilot milestones have real evidence.

### M1 — repository quality and CI

Complete and merged into `main` in commits `141fb31` and `703e5e4`.

- GitHub Actions runs on Ubuntu and Windows for every pull request and `main`.
- CI installs the locked dependencies, type-checks, runs all tests, checks schema
  and migrations, builds the Worker, applies local D1 migrations, and exercises
  the HTTP smoke test.
- CI correctly fails for a deliberate type error, a deliberately failing test,
  schema drift, missing migration entries, and SQL/schema mismatch.
- The documentation-repair commit `333dbbd` passed main-branch CI on both
  operating systems:
  <https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35426054567>.
- Contributor guidance and the pull-request template are in
  [CONTRIBUTING.md](../CONTRIBUTING.md) and [the PR template](../.github/pull_request_template.md).

## Existing prototype features

These features exist in the imported code and have local or mocked tests. They
are not proof of live production integration.

- Company workspaces, product catalog, inventory counts/receipts/use/waste, and
  recipes.
- Manual sales imports, CSV preview/import, register mappings, and an authenticated
  register bridge with duplicate protection.
- Target-stock calculations, supplier-pack rounding, review proposals, vendor
  connection framework, and scheduled-check endpoint.
- Clover OAuth authorization/menu loading, a gated fake-backed local sales
  adapter, and hosted Stripe payment-method setup.

The following remain unverified against real services: live Clover sales sync,
a second POS, a real supplier adapter, live payments,
provisioned background jobs, and automatic purchases.

## M2 implementation

The approved Supabase/Cloudflare design is implemented on `main`. Seven-day single-use invitations, membership roles, protected ownership transfer, account recovery, CSRF protection and security history have automated coverage. The owner completed and accepted a development-provider walkthrough of password rules, confirmation, sign-in/out, fictional-company roles, invitation, ownership transfer, recovery, concurrent-session revocation, and security history. The membership panel still required a full page refresh after acceptance in another browser; the owner accepted that limitation. The owner reports that a replacement Cloudflare build works, accepted that build step without a run link or commit record, and explicitly directed C1/M2 to be treated as complete on 2026-09-23. The owner subsequently reported completing the additive migration and authentication review. The [C2 closeout](C2_M2_CLOSEOUT.md) records that report, a separate agent inspection, the complete local pipeline, and deployment limits; no owner-authored review findings were supplied. This is owner-accepted development evidence, not independent security verification or production approval. See [setup](M2_SETUP.md), [decision record](decisions/0001-m2-authentication.md), [local evidence](M2_LOCAL_EVIDENCE.md), and [development auth evidence](M2_DEV_AUTH_EVIDENCE.md).

## M3 development acceptance

A4's persistent exact inventory behavior is implemented and passes the complete
local pipeline. It includes exact curated/custom unit classification, atomic
stock movements and physical-count reconciliation, immutable recipe/modifier
versions, the durable A-to-B consumption port, migration guardrails, and
company/role authorization coverage. The manager UI and exact API are behind
`PANTRACK_EXACT_INVENTORY_PREVIEW=enabled`; the gate is off by default. B4's
local implementation now uses that same gate for the coordinated durable-sales
and exact-inventory cutover. See [M3 local evidence](M3_LOCAL_EVIDENCE.md) and
[B4 local evidence](M4_B4_LOCAL_EVIDENCE.md).

The owner read the [M3 evidence](M3_LOCAL_EVIDENCE.md) and
[A5 review](M3_A5_OWNER_REVIEW.md) and accepted A5/M3 for development on
2026-09-23. A separate [A5 acceptance record](M3_A5_ACCEPTANCE.md) documents
the independent AI migration review and the owner's 2026-09-24 reaffirmation
of local development acceptance; that decision did not authorize a remote
migration or deployment. Person B's compatibility review found no
inventory-specific workaround. The fictional older-data screen walkthrough
passed, and viewing it changed no stock or recipe. The complete local pipeline
passed again for A5.
This opened M3's prerequisite for B5; M4's subsequent local acceptance is
recorded below. Development D1 and the Worker now have separate
[hosted validation evidence](C2_HOSTED_DEV_EVIDENCE.md). The exact preview is
off again after the fictional walkthrough. The owner authorized a `main` push
even if the replacement Cloudflare connection auto-deploys.

## M4 local-development acceptance

The accepted [B1 design](decisions/0003-m4-sales-ingestion.md), B2/B3 tests and
data foundations, and B4 exact-sales integration are on `main`. The B4
[local closeout](M4_B4_LOCAL_EVIDENCE.md) includes the employee-status privacy
follow-up, an isolated fictional served check, and a complete local pipeline
rerun on 2026-09-24. The owner accepted the completed B4 local artifacts on
2026-09-24. B5/M4 is accepted for local development on 2026-09-24, supported by
the [B5 evidence](M4_B5_LOCAL_EVIDENCE.md): concurrency, recovery, authorization,
privacy, compatibility, an isolated fictional gate-on served walkthrough, and
green Ubuntu and Windows CI on the B5 branch and merged `main` commit. The B5
walkthrough found and fixed a D1 batch-acknowledgment defect during held-event
replay. Native Clover authentication and signatures and Clover sandbox cases
remain unverified. Development D1 `0012` and a fictional hosted Worker
walkthrough have now been verified separately in
[C2 evidence](C2_HOSTED_DEV_EVIDENCE.md). The exact preview is off remotely.

## Deployment health

On 2026-09-23, the new development D1 database in Cloudflare account
`46a94b92309dd488dadd02f6ae70e0ff` was migrated through `0011`. Wrangler
reported no pending migrations before this integration introduced `0012`.
Remote `migrations apply` failed on `0008` with `incomplete input`; unchanged
migrations `0008`–`0011` succeeded through Wrangler's file import path, and the
ledger and schema were verified. See the
[recovery note](M2_SETUP.md#development-d1-trigger-migration-recovery).
On 2026-09-24, `0012` applied to that development D1 database. Its ledger and
tables were verified, with no pending migration. The newly deployed development
Worker passed hosted HTTP and fictional sign-in/inventory/sale checks; see
[C2 hosted evidence](C2_HOSTED_DEV_EVIDENCE.md). No production acceptance is
claimed.

Repository CI is green for documentation-repair commit `333dbbd`
([run 35426054567](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35426054567)). The separate
[Cloudflare Workers build](https://github.com/magkaniotisleonidas28-star/Pantrack/runs/105852072919)
for that commit failed. The owner removed the misconfigured deployment and
integration, reports a replacement build is working, and accepts the build step
as complete. Its run link, tested branch, and commit are not recorded here, so
this is owner attestation rather than independently checked build evidence.
That earlier build report remains owner attestation; the separate development
Worker deployment and hosted behavior are documented in the C2 evidence.
The Supabase Preview check passed, but that check does not prove that Pantrack's
email templates, callback URLs, runtime variables, or authentication walkthrough
are configured and working. Keep production data and real users out of this
environment until separately reviewed release evidence exists.

## Your setup status

| Service | Reported status | Still needed |
| --- | --- | --- |
| GitHub | Repository connected; milestone branches consolidated into `main`; earlier Ubuntu and Windows CI runs passed. | Keep `main` as the only long-lived branch. Preserve required checks on new commits. |
| Supabase | The owner accepted the development-provider manual walkthrough using fictional accounts and reports completing the authentication and migration review. The [C2 closeout](C2_M2_CLOSEOUT.md) records that report and an agent inspection. Automated provider tests remain separate. | Hosted signup/recovery callbacks and independent security review remain release follow-ups. |
| Cloudflare | The earlier replacement build report is owner-attested. Development D1 has advanced through B7 `0015`; the deployed `pantrack-dev` Worker passed a fictional hosted walkthrough and the later C2 read-only smoke. See [C2 evidence](C2_HOSTED_DEV_EVIDENCE.md) and [closeout](C2_M2_CLOSEOUT.md). | Keep the exact preview off. Hosted signup/recovery callbacks and independent security review remain release follow-ups. |
| Custom domain | The user reports that the domain is already in Cloudflare. No Worker route has been verified. | Decide whether to attach the domain after the development `workers.dev` validation; the current hosted evidence uses that URL. |

Never send, commit, or paste Supabase keys, Cloudflare API tokens, OAuth secrets,
supplier credentials, or payment details into chat or source control.

## What you need to do next

1. C2's [development closeout](C2_M2_CLOSEOUT.md) now records the owner's
   reported additive M2 migration/auth review and a separate agent inspection.
   A and B may use the M2 development gate. Keep hosted signup/recovery and
   independent security review on the release follow-up list.
2. Use the [C2 hosted evidence](C2_HOSTED_DEV_EVIDENCE.md) for the completed
   development D1 `0012` and Worker walkthrough. Keep the exact inventory
   preview disabled. The earlier replacement build report remains owner-attested.
3. A5/M3, B5/M4, and B6's Clover adapter are accepted for local development.
   B7 hosted preparation applied development D1 `0013` and deployed B6 to
   `pantrack-dev`; see [B7 evidence](M5_B7_SANDBOX_EVIDENCE.md). The dedicated
   fictional company is now connected to its Clover sandbox merchant. Recorded
   provider cases are still required. The dedicated fictional catalog,
   opening counts, active latte recipe/modifier, and native Clover mappings
   are recorded in the B7 evidence. B7's webhook setup slice applied additive
   development D1 migrations `0014` and `0015`, verified and saved the
   development URL with an Orders-only Clover subscription, and saved the
   webhook auth-code secret name. The temporary challenge and setup gate are
   gone. Two explicitly approved fictional paid latte cases now have direct
   sandbox evidence: a base latte deducted 200 mL milk, 18 g espresso, and
   one cup; an extra-shot latte deducted 200 mL milk, 36 g espresso, and one
   cup. Each produced one applied event and one consumption application. The
   temporary sync gate was removed after each. A third paid fictional base
   latte was imported once by owner reconciliation after its first observed
   webhook returned `404`; a locally constructed authenticated repeat Orders
   notification and a subsequent owner poll created no extra event or stock
   use. A separate unmapped-modifier attempt added a fictional Clover
   modifier but stopped before any sale: three atomic-order create requests
   returned `400`, with no new order, sales event, or stock use. The temporary
   token was revoked. A fourth guarded follow-up also returned `400` before
   payment; development D1 showed no new sale or ingredient use. The owner
   reported no new $6 Clover order and revocation of the follow-up token. A
   later paid $6 fictional latte with the unmapped modifier held with zero
   stock use, then deducted 200 mL milk, 36 g espresso, and one cup exactly
   once after reviewed mapping and audited owner replay. The event was
   accidentally dismissed during UI automation; an owner-only audited
   recovery replay completed the case. The latest temporary token was
   owner-reported revoked and both Worker gates are off. A later fictional
   unpaid-cancellation attempt created and deleted one $5 latte with zero
   payments and no ingredient use. Clover retained its ID in a deleted-order
   list but returned `404` for order detail, exposing an adapter gap. A focused
   deletion-list scan then reconciled that already deleted order as one held
   cancellation. Owner review dismissed it with an audit reason and no stock
   use. A separate paid $5 fictional latte then synced once and consumed the
   expected 200 mL milk, 18 g espresso, and one cup. Clover rejected the
   single DELETE attempt on that paid order with HTTP 400. The owner later
   issued one full $5 sandbox cash refund of that same order. Clover's
   refund-expanded response confirmed its linked payment/refund; the old
   sync-shaped response still said Paid at the same modification time. A
   focused adapter fix now expands refunds and records the linked refund as
   a separate immutable revision. One guarded development reconciliation
   applied a stock-neutral refund event. D1 has **8 sales events, 5
   consumption applications, and 15 consumption movements**; the expected
   refund impact of zero additional ingredient use or restock matched actual
   balances. Both gates are off and the temporary read-only token was
   owner-reported revoked. The local zero-line paid-deletion policy change
   still has no direct sandbox proof because Clover rejected the DELETE.
   A later $5 fictional cash latte was paid while sync was off; D1 still had
   zero events for it until one **Sync now** reconciliation in the authenticated
   owner workspace. That scan applied one sale and consumed exactly 200 mL
   milk, 18 g espresso, and one cup, with no conflict. D1 now has **9 sales
   events, 6 consumption applications, and 18 consumption movements**. Both
   gates are off, and the temporary token was owner-reported revoked. A later
   owner menu read during the natural OAuth refresh window advanced both
   token expiries and kept the same sandbox merchant authorized. One later
   owner reconciliation after rotation returned zero new or held events,
   advanced the checkpoint, and left stock unchanged. Both gates are off.
   A later owner-driven disconnect removed Pantrack's stored Clover tokens;
   reauthorization restored the same fictional merchant and a menu read.
   Development D1 retained all mappings, nine sales events, six consumption
   applications, 18 movements, the sync checkpoint, and exact stock balances.
   A later fictional order was paid for one latte, synced once, then revised
   with a second paid latte on the same order. The two applied revisions each
   consumed only one latte's ingredients: 200 mL milk, 18 g espresso, and one
   cup. D1 now has 11 sales events, 8 consumption applications, and 24
   movements, with zero conflicts. Both temporary gates are off, and the
   owner reports revoking the temporary merchant token. A later controlled,
   authenticated B7 webhook received `503` for one fictional $5 paid latte;
   no Clover retry was observed in a 20-minute trace. One separate owner
   reconciliation applied its sale with exactly 200 mL milk, 18 g espresso,
   and one cup used. D1 now has 12 sales events, 9 applications, and 27
   movements. The temporary probe was removed from source and the development
   Worker, both sync gates are off, and the owner reports revoking the
   temporary B7 merchant token. Native Clover retry behavior and other B7
   cases remain open.
   A subsequent controlled loss of one sandbox refresh response exercised
   Clover's recovery endpoint using the preceding token. The owner menu read
   succeeded after recovery, as did a modifier read on the restored ordinary
   Worker. D1 stayed at 12 sales events, 9 applications, 27 movements, and the
   same exact balances and sync checkpoint. The one-use probe and its Worker
   secrets were removed. This closes that one lost-response case; native
   webhook retry, the rejected paid-order DELETE path, and other B7 limits
   remain open. See [B7 evidence](M5_B7_SANDBOX_EVIDENCE.md).
   Concurrent local-only A7 migrations were moved to `0016` and `0017` in
   the merge; development D1 remains at `0015` until A7's separate remote
   gate is authorized.
4. Keep production data and real users out of this environment while these
   gates remain open. Hosted sign-in worked at the development `workers.dev`
   URL; signup and recovery callback configuration there still needs a
   separate check. Preserve the local Supabase callback configuration while
   reviewing any hosted URL change.

Other workstreams can continue local-only work under their individual
[roadmap checklists](PANTRACK_MILESTONES.md#step-by-step-checklist-for-each-person)
and the [AI development playbook](AI_DEVELOPMENT.md). M4's acceptance is limited
to local development; the hosted fictional check does not cover native-provider
behavior.

## Remaining roadmap

| Milestone | Status | Main work still required |
| --- | --- | --- |
| M2 — authentication and RBAC | C1/M2 accepted by owner and C2 evidence closed for development; replacement Cloudflare build remains owner-attested | The [C2 closeout](C2_M2_CLOSEOUT.md) records the reported review, local pipeline and read-only Worker smoke. Hosted signup/recovery callbacks and independent security verification remain release follow-ups. |
| M3 — inventory and recipes | A5/M3 owner-accepted for development on 2026-09-23 | Local pipeline, Person B's compatibility review, and A5 fictional screen walkthrough passed. Hosted fictional exact count and consumption passed; the exact preview is off again. |
| M4 — POS ingestion | B5/M4 accepted for local development on 2026-09-24 | [B5 evidence](M4_B5_LOCAL_EVIDENCE.md) covers local concurrency, recovery, authorization, compatibility, served behavior, and green branch/main CI. A hosted fictional sale and duplicate check passed; Clover remains B6/B7. |
| M5 — Clover | B6 local adapter deployed to development; fictional sandbox merchant connected; webhook URL and Orders subscription saved; paid latte, modifier/replay, duplicate/polling, unpaid deletion, full refund, missed-sale polling recovery, natural token refresh, lost-response recovery, disconnect/reconnect, later paid revision, and controlled webhook-failure cases recorded; M5 remains open | [B6 evidence](M5_B6_LOCAL_EVIDENCE.md) covers development behavior. [B7 evidence](M5_B7_SANDBOX_EVIDENCE.md) records nine paid latte deductions across sandbox cases, one held sale with zero partial use and an audited recovery replay, a simulated duplicate and owner poll, an unpaid deletion dismissed without stock use, one linked full $5 refund with zero additional stock use, two sales recovered by owner polling, one OAuth rotation and one controlled lost-response recovery, same-merchant reauthorization with history and stock retained, and one paid order revision that used only the added latte's ingredients. One authenticated webhook received a controlled `503`, but native retry was not observed in 20 minutes. Clover rejected a paid-order DELETE with HTTP 400; that deletion path remains unproved. Sync remains off. |
| M6 — second POS | Not started | Choose a real second provider and implement/test the shared adapter contract. |
| M7 — replenishment proposals | A6 core and A7 lifecycle/handoff complete locally; C4's fake consumer and one A8 local sale-to-proposal integration test passed; M7 not accepted | A8 still needs accepted M5 inputs, a real sales-readiness source, and further concurrency and end-to-end proposal evidence. Development D1 has not applied the A7 origin/lifecycle migrations. See [A6 local evidence](M7_A6_LOCAL_EVIDENCE.md), [A7 lifecycle evidence](M7_A7_LIFECYCLE_EVIDENCE.md), [C4 contract evidence](C4_A7_HANDOFF_EVIDENCE.md), and [A8 local slice](M7_A8_LOCAL_SALE_PROPOSAL_EVIDENCE.md). |
| M8 — supplier adapter | Not started | Select supplier, build approved integration, sandbox/timeout tests, incoming-stock and delivery reconciliation, then one approved low-risk test order. |
| M9 — operations | Prototype endpoint only | Provision scheduler/queue, retries, alert channels, operations page, and recovery runbooks. |
| M10 — financial controls | Partial prototype | Confirm supplier payment model, limits, eligibility, owner reauthentication, and financial audit/testing. |
| M11 — café pilot | Not started | Written business permission, one POS/supplier/location, measurements, two reviewed count-to-delivery cycles, alerts, pause test, and manager sign-offs. |
| M12 — production readiness | Not started; requires M11 | Onboarding, backups/restores, export/deletion, rate limits, security review, monitoring, support, and tenant-isolation release testing. |

## Important dependencies

```text
M2 → M3 → M4 → M5 → M6 / M7 → M8 → M9
                   M2 + M8 → M10
M0 through M10 → M11 → M12
```

M11 cannot be skipped. It provides the real-world sale-to-delivery evidence that
must exist before Pantrack can safely onboard multiple companies or enable any
limited automation.

## Evidence and detailed documents

- [M0 local evidence](M0_LOCAL_EVIDENCE.md)
- [M1 CI evidence](M1_CI_EVIDENCE.md)
- [M4 B2 fake-backed local evidence](M4_B2_LOCAL_EVIDENCE.md)
- [M4 B3 local D1 evidence](M4_B3_LOCAL_EVIDENCE.md)
- [M4 B4 local exact-sales evidence](M4_B4_LOCAL_EVIDENCE.md)
- [M4 B5 local acceptance evidence](M4_B5_LOCAL_EVIDENCE.md)
- [C2 hosted development validation](C2_HOSTED_DEV_EVIDENCE.md)
- [M5 B6 local Clover evidence](M5_B6_LOCAL_EVIDENCE.md)
- [M5 B7 sandbox acceptance in progress](M5_B7_SANDBOX_EVIDENCE.md)
- [September 19 readiness snapshot and approved M2 permissions](MILESTONE_READINESS.md)
- [Full milestone roadmap](PANTRACK_MILESTONES.md)
- [Branch consolidation record](BRANCH_CONSOLIDATION.md)
