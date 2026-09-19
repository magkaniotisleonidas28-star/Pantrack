# Pantrack current status

Updated: 2026-09-19

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

The following remain unverified against real services: Supabase login/email delivery,
live Clover sales sync, a second POS, a real supplier adapter, live payments,
provisioned background jobs, and automatic purchases.

## M2 implementation

The approved Supabase/Cloudflare design is implemented on `main`. Seven-day single-use invitations, membership roles, protected ownership transfer, account recovery, CSRF protection and security history have automated coverage. The current Linux and Windows CI jobs pass. Provider tests still use mocked responses; real email confirmation/login/recovery and migration/authentication review remain pending. See [setup](M2_SETUP.md), [decision record](decisions/0001-m2-authentication.md) and [local evidence](M2_LOCAL_EVIDENCE.md).

## Deployment health

Repository CI is green for documentation-repair commit `333dbbd`
([run 35426054567](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35426054567)). The separate
[Cloudflare Workers build](https://github.com/magkaniotisleonidas28-star/Pantrack/runs/105852072919)
for that commit failed, so there is no successful deployment claim.
The Supabase Preview check passed, but that check does not prove that Pantrack's
email templates, callback URLs, runtime variables, or authentication walkthrough
are configured and working. Diagnose the Cloudflare build before attempting a
public release, and keep production data and real users out of this environment.

## Your setup status

| Service | Reported status | Still needed |
| --- | --- | --- |
| GitHub | Repository connected; milestone branches consolidated into `main`; current Ubuntu and Windows CI passed. | Keep `main` as the only long-lived branch. Use isolated, short-lived workstream branches/worktrees only while multiple contributors are active, then merge and delete them. Preserve the required checks. |
| Supabase | The GitHub Supabase Preview check passes, which indicates an app connection but does not establish working Pantrack authentication. | Confirm the development project settings, Email provider, templates, callback URLs, and real confirmation/login/recovery walkthrough. |
| Cloudflare | Repository integration is active and attempted a Worker build for current `main`; that build failed. | Diagnose the failed build before deployment. Do not configure production data or users while M2 acceptance remains open. |
| Custom domain | None required yet. | A free temporary URL will be `https://WORKER-NAME.magkaniotisleonidas28.workers.dev`. Buy/add a custom domain before a real café pilot. |

Never send, commit, or paste Supabase keys, Cloudflare API tokens, OAuth secrets,
supplier credentials, or payment details into chat or source control.

## What you need to do next

1. Diagnose the failed Cloudflare Workers build for the current `main` commit.
2. In the Supabase project, open **Authentication → Providers**, enable **Email**, and
   keep email confirmation enabled.
3. In **Authentication → URL Configuration**, keep these local redirect URLs:

   ```text
   http://127.0.0.1:5173/auth/callback
   http://localhost:5173/auth/callback
   ```

   Keep `http://127.0.0.1:5173` as the Site URL until Pantrack has an actual
   deployed Worker URL. Do not add the wildcard `*-pantrack...workers.dev` as a
   callback URL.
4. Configure the development project's URL and publishable key through ignored
   local variables. Never use or expose a service-role key.
5. Do not migrate remote D1, configure production secrets, or invite real users
   yet. M2 now implements verified Supabase sessions and company role checks;
   complete the setup and provider walkthrough in [M2_SETUP.md](M2_SETUP.md).

While the M2 acceptance owner performs those steps, the other two workstreams
may begin local-only M3 design/fixtures and the M4 event contract against fakes.
They must follow the individual checklists in
[the milestone roadmap](PANTRACK_MILESTONES.md#step-by-step-checklist-for-each-person)
and the [AI development playbook](AI_DEVELOPMENT.md). This parallel preparation
does not make M3 or M4 complete before their prerequisite evidence exists.

## Remaining roadmap

| Milestone | Status | Main work still required |
| --- | --- | --- |
| M2 — authentication and RBAC | Implemented on `main`; acceptance pending | Local checks and hosted Linux/Windows CI passed. Configure and verify real Supabase email/login/recovery, resolve the Cloudflare build, and review the authentication flow and migration. See [M2 evidence](M2_LOCAL_EVIDENCE.md). |
| M3 — inventory and recipes | Prototype exists; not complete | Decimal/unit policy, immutable recipe versions, modifiers, opening-count cutoff, reconciliation history, and tests. |
| M4 — POS ingestion | Prototype exists; not complete | Provider-neutral event model, held-event queue, safe replay/dismiss/correction, event identity, and refund/cancellation policy. |
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
- [Detailed milestone readiness and decisions](MILESTONE_READINESS.md)
- [Full milestone roadmap](PANTRACK_MILESTONES.md)
- [Branch consolidation record](BRANCH_CONSOLIDATION.md)
