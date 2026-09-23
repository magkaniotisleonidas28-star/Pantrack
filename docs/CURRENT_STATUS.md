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

The approved Supabase/Cloudflare design is implemented on `main`. Seven-day single-use invitations, membership roles, protected ownership transfer, account recovery, CSRF protection and security history have automated coverage. The owner completed and accepted a development-provider walkthrough of password rules, confirmation, sign-in/out, fictional-company roles, invitation, ownership transfer, recovery, concurrent-session revocation, and security history. The membership panel still required a full page refresh after acceptance in another browser; the owner accepted that limitation for this walkthrough. This is user-observed development evidence, not independent security verification. C1/M2 remain provisional because the intended Cloudflare build has not passed and the authentication-flow/migration review has not been recorded. See [setup](M2_SETUP.md), [decision record](decisions/0001-m2-authentication.md), [local evidence](M2_LOCAL_EVIDENCE.md), and [development auth evidence](M2_DEV_AUTH_EVIDENCE.md).

## M3 local implementation

A4's persistent exact inventory behavior is implemented and passes the complete
local pipeline. It includes exact curated/custom unit classification, atomic
stock movements and physical-count reconciliation, immutable recipe/modifier
versions, the durable A-to-B consumption port, migration guardrails, and
company/role authorization coverage. The manager UI and exact API are behind
`PANTRACK_EXACT_INVENTORY_PREVIEW=enabled`; the gate is off by default. B4's
local implementation now uses that same gate for the coordinated durable-sales
and exact-inventory cutover. See [M3 local evidence](M3_LOCAL_EVIDENCE.md) and
[B4 local evidence](M4_B4_LOCAL_EVIDENCE.md).

This does not accept M3. Person B's compatibility review is recorded in the B4
evidence and found no inventory-specific workaround. A5 now includes a local
read-only older-data report, but the owner's fictional-data review, M2 gate,
and Person A's completed M3 acceptance record remain open. No remote migration
or deployment has occurred.

## Deployment health

Repository CI is green for documentation-repair commit `333dbbd`
([run 35426054567](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35426054567)). The separate
[Cloudflare Workers build](https://github.com/magkaniotisleonidas28-star/Pantrack/runs/105852072919)
for that commit failed. The owner removed the misconfigured Worker and domain;
there is still no successful build on the intended host or deployment claim.
The Supabase Preview check passed, but that check does not prove that Pantrack's
email templates, callback URLs, runtime variables, or authentication walkthrough
are configured and working. Diagnose the Cloudflare build before attempting a
public release, and keep production data and real users out of this environment.

## Your setup status

| Service | Reported status | Still needed |
| --- | --- | --- |
| GitHub | Repository connected; milestone branches consolidated into `main`; current Ubuntu and Windows CI passed. | Keep `main` as the only long-lived branch. Use isolated, short-lived workstream branches/worktrees only while multiple contributors are active, then merge and delete them. Preserve the required checks. |
| Supabase | The owner accepted the development-provider manual walkthrough using fictional accounts. Automated provider tests remain separate. | Record the authentication-flow and migration review; do not treat the manual walkthrough as hosted or production security verification. |
| Cloudflare | The owner removed the previously misconfigured Worker and domain. No intended-host build has passed. | Diagnose and pass the intended Cloudflare build before C1/M2 acceptance or merging the integration branch; obtain separate approval before any configuration or deployment action. |
| Custom domain | None required yet. | A free temporary URL will be `https://WORKER-NAME.magkaniotisleonidas28.workers.dev`. Buy/add a custom domain before a real café pilot. |

Never send, commit, or paste Supabase keys, Cloudflare API tokens, OAuth secrets,
supplier credentials, or payment details into chat or source control.

## What you need to do next

1. Review the additive M2 migration and authentication flow, and record the
   owner's findings without calling the review independent.
2. Diagnose the intended Cloudflare build. Do not create/configure a Worker or
   deploy without separate approval; keep C1/M2 provisional until it passes.
3. Review the local A5 older-data report with fictional data, then complete
   M3 acceptance evidence before B5/M4 acceptance.
4. Do not migrate remote D1, configure production secrets, or invite real users
   while these gates remain open. Keep `http://127.0.0.1:5173` as the
   development Supabase Site URL until a reviewed hosted URL is available.

While the M2 acceptance owner performs those steps, the other two workstreams
may begin local-only M3 design/fixtures and the M4 event contract against fakes.
They must follow the individual checklists in
[the milestone roadmap](PANTRACK_MILESTONES.md#step-by-step-checklist-for-each-person)
and the [AI development playbook](AI_DEVELOPMENT.md). This parallel preparation
does not make M3 or M4 complete before their prerequisite evidence exists.

## Remaining roadmap

| Milestone | Status | Main work still required |
| --- | --- | --- |
| M2 — authentication and RBAC | Manual development-provider walkthrough accepted by owner; C1/M2 provisional | Resolve the intended Cloudflare build and record authentication-flow/migration review. See [development evidence](M2_DEV_AUTH_EVIDENCE.md). |
| M3 — inventory and recipes | A4 and older-data report implemented locally; acceptance pending | Person B's compatibility review is recorded. Review A5 with fictional data after the M2 gate; keep the exact preview disabled by default. |
| M4 — POS ingestion | B4 implemented locally; acceptance pending | Complete the dedicated B4 visual walkthrough, obtain prerequisite M2/M3 acceptance and review, then complete B5 evidence. Clover remains B6. |
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
- [Detailed milestone readiness and decisions](MILESTONE_READINESS.md)
- [Full milestone roadmap](PANTRACK_MILESTONES.md)
- [Branch consolidation record](BRANCH_CONSOLIDATION.md)
