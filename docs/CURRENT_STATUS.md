# Pantrack current status

Updated: 2026-09-23

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
- Clover OAuth authorization/menu loading and hosted Stripe payment-method setup.

The following remain unverified against real services: live Clover sales sync,
a second POS, a real supplier adapter, live payments,
provisioned background jobs, and automatic purchases.

## M2 implementation

The approved Supabase/Cloudflare design is implemented on `main`. Seven-day single-use invitations, membership roles, protected ownership transfer, account recovery, CSRF protection and security history have automated coverage. The owner completed and accepted a development-provider walkthrough of password rules, confirmation, sign-in/out, fictional-company roles, invitation, ownership transfer, recovery, concurrent-session revocation, and security history. The membership panel still required a full page refresh after acceptance in another browser; the owner accepted that limitation. The owner reports that a replacement Cloudflare build works, accepted that build step without a run link or commit record, and explicitly directed C1/M2 to be treated as complete on 2026-09-23. The user subsequently reported completing the additive migration and authentication review; a separate written review record remains unavailable. This is owner-accepted development evidence, not independent security verification, verified deployment, or production approval. See [setup](M2_SETUP.md), [decision record](decisions/0001-m2-authentication.md), [local evidence](M2_LOCAL_EVIDENCE.md), and [development auth evidence](M2_DEV_AUTH_EVIDENCE.md).

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
2026-09-23. Person B's compatibility review found no inventory-specific
workaround. The fictional older-data screen walkthrough passed, and viewing it
changed no stock or recipe. The complete local pipeline passed again for A5.
This opens M3's prerequisite for B5, but does not accept M4. Development D1 is
migrated through `0011`; application of B4's `0012` migration and hosted Worker
behavior remain unverified. The exact preview stays off remotely until those
checks pass. The owner authorized a `main` push even if the replacement
Cloudflare connection auto-deploys.

## Deployment health

On 2026-09-23, the new development D1 database in Cloudflare account
`46a94b92309dd488dadd02f6ae70e0ff` was migrated through `0011`. Wrangler
reported no pending migrations before this integration introduced `0012`.
Remote `migrations apply` failed on `0008` with `incomplete input`; unchanged
migrations `0008`–`0011` succeeded through Wrangler's file import path, and the
ledger and schema were verified. See the
[recovery note](M2_SETUP.md#development-d1-trigger-migration-recovery).
Application of the new `0012` migration has not been verified on that database.
No hosted Worker smoke or production acceptance is claimed from this evidence.

Repository CI is green for documentation-repair commit `333dbbd`
([run 35426054567](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35426054567)). The separate
[Cloudflare Workers build](https://github.com/magkaniotisleonidas28-star/Pantrack/runs/105852072919)
for that commit failed. The owner removed the misconfigured deployment and
integration, reports a replacement build is working, and accepts the build step
as complete. Its run link, tested branch, and commit are not recorded here, so
this is owner attestation rather than independently checked build evidence.
No deployment or hosted runtime behavior is claimed.
The Supabase Preview check passed, but that check does not prove that Pantrack's
email templates, callback URLs, runtime variables, or authentication walkthrough
are configured and working. Keep production data and real users out of this
environment until separately reviewed release evidence exists.

## Your setup status

| Service | Reported status | Still needed |
| --- | --- | --- |
| GitHub | Repository connected; milestone branches consolidated into `main`; earlier Ubuntu and Windows CI runs passed. | Keep `main` as the only long-lived branch. Preserve required checks on new commits. |
| Supabase | The owner accepted the development-provider manual walkthrough using fictional accounts and reports completing the authentication and migration review. Automated provider tests remain separate. | Record the completed review; do not treat the walkthrough as independent or production security verification. |
| Cloudflare | Owner reports a replacement build works and accepts the build step; run and commit details are unavailable. Development D1 has migrations through `0011`; `0012` application is unverified. | Verify the hosted Worker and apply `0012` before enabling the exact inventory preview. Do not claim independent build or hosted-runtime verification from the owner's build report. |
| Custom domain | The user reports that the domain is already in Cloudflare. No Worker route has been verified. | Use the development Worker's `workers.dev` URL for hosted smoke before deciding whether to attach the domain. |

Never send, commit, or paste Supabase keys, Cloudflare API tokens, OAuth secrets,
supplier credentials, or payment details into chat or source control.

## What you need to do next

1. Record the user-reported review of the additive M2 migration and
   authentication flow. C1/M2 was owner-accepted; do not call this independent
   security verification.
2. Treat the replacement Cloudflare build step as owner-accepted, not
   independently verified. Run hosted development smoke on the correct account.
   Development D1 migration `0012` is unverified; keep the exact inventory preview
   disabled until that migration and hosted runtime are checked.
3. A5/M3 is accepted for development. Review the separate B4 closeout branch
   and complete B5's M4 evidence and acceptance before starting B6/Clover.
4. Keep production data and real users out of this environment while these
   gates remain open. Keep `http://127.0.0.1:5173` as the
   development Supabase Site URL until a reviewed hosted URL is available.

Other workstreams can continue local-only work under their individual
[roadmap checklists](PANTRACK_MILESTONES.md#step-by-step-checklist-for-each-person)
and the [AI development playbook](AI_DEVELOPMENT.md). M4 remains unaccepted.

## Remaining roadmap

| Milestone | Status | Main work still required |
| --- | --- | --- |
| M2 — authentication and RBAC | C1/M2 accepted by owner for development; replacement Cloudflare build is owner-attested | Record the user-reported authentication and migration review and run hosted development smoke. No independent security or deployment verification is claimed. See [development evidence](M2_DEV_AUTH_EVIDENCE.md). |
| M3 — inventory and recipes | A5/M3 owner-accepted for development on 2026-09-23 | Local pipeline, Person B's compatibility review, and the A5 fictional screen walkthrough passed. Hosted `0012` migration and Worker behavior remain separate; keep the exact preview off remotely. |
| M4 — POS ingestion | B4 implemented and walked through locally; acceptance pending | Review the B4 closeout record, then complete B5 evidence and acceptance. Clover remains B6. |
| M5 — Clover | OAuth/menu prototype only | Sandbox merchant, completed-order sync, modifiers, cursors, reconciliation, health, and sandbox evidence. |
| M6 — second POS | Not started | Choose a real second provider and implement/test the shared adapter contract. |
| M7 — replenishment proposals | Prototype exists; not complete | Frozen snapshots, explainable lifecycle, edits/audit, quantity reservation, and concurrency tests. |
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
- [September 19 readiness snapshot and approved M2 permissions](MILESTONE_READINESS.md)
- [Full milestone roadmap](PANTRACK_MILESTONES.md)
- [Branch consolidation record](BRANCH_CONSOLIDATION.md)
