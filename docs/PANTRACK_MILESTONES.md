# Pantrack Development Milestones

Version: 1.0
Purpose: Working specification for developing Pantrack with Codex in VS Code
Product goal: Estimate ingredient inventory from completed menu-item sales, calculate replenishment to manager-defined target levels, and safely submit supplier orders with minimal manual work.

## 1. Product outcome

Pantrack should let each business:

1. Create a company workspace with isolated users, products, recipes, register settings, suppliers, and orders.
2. Record an opening physical inventory count for every ingredient.
3. Connect a POS system or import completed sales.
4. Convert each sold menu item into ingredient consumption using recipes and modifiers.
5. Subtract calculated consumption from estimated inventory without double counting sales.
6. Calculate the amount required to reach a manager-defined target stock level, considering confirmed incoming deliveries and supplier pack sizes.
7. Create a purchasing proposal grouped by supplier.
8. Submit approved proposals to real suppliers and track uncertain, rejected, accepted, partially fulfilled, and delivered orders.
9. Run scheduled checks automatically with budgets, limits, alerts, audit records, and an emergency pause control.

The system is an inventory estimate. Physical counts remain necessary for reconciliation because spills, over-pouring, theft, spoilage, unrecorded extras, and incorrect recipes cannot always be inferred from register data.

## 2. Current baseline

The existing prototype already contains:

- Company workspaces and access checks.
- Product catalog and supplier/SKU/pack information.
- Prepared orders and removable unsent order history.
- Inventory setup, opening counts, usage, waste, receipts, and incoming stock.
- Recipe definitions and manual sales imports.
- Manager-defined target stock and supplier-pack rounding.
- Purchasing recommendations.
- Generic vendor-connection and purchasing-control framework.
- Company-specific POS selection.
- Register-item-to-recipe mappings.
- CSV sales preview and import.
- Authenticated company sales-ingestion endpoint with duplicate protection.
- Clover OAuth authorization and menu loading code.
- Payment-method interface with incomplete live configuration.

The prototype does not yet prove:

- Real Supabase email confirmation, login, and recovery against a configured development project.
- Live Clover order synchronization.
- Complete modifier, cancellation, refund, and remake handling.
- A native connection for every POS provider listed in the interface.
- A working adapter for a real supplier.
- A provisioned background scheduler.
- Live payment configuration.
- Production monitoring, backup/recovery, or security readiness.
- A complete sale-to-delivery test with a real café, register, and supplier.

Treat every external integration as unverified until it passes its sandbox and pilot acceptance tests.

## 3. Non-negotiable engineering rules

- Work on `main` with focused commits per milestone; create a branch or pull request only when explicitly requested by the repository owner.
- Do not combine unrelated UI redesigns with integration or data-model work.
- Run locally and in sandbox environments before using live accounts.
- Never place API keys, OAuth secrets, access tokens, customer data, or payment details in source control, prompts, screenshots, logs, or browser code.
- Keep company data isolated in every query and mutation. Every company-owned record must be scoped by company ID and authorization.
- Require server-side role checks for owner and manager actions. Hiding a button is not authorization.
- Use idempotency for sales imports, webhooks, scheduled jobs, and supplier orders.
- Never silently discard an unknown POS item, modifier, ingredient, supplier product, or delivery change. Hold it for review and display the reason.
- Do not automatically restore ingredients because a financial refund occurred. Determine whether the item was prepared.
- Treat an unknown supplier-order response as unresolved. Do not retry a purchase until its status is reconciled.
- Keep automatic ordering disabled until reviewed-mode pilot acceptance is complete.
- Add schema changes through new migrations. Do not rewrite migrations already used in a deployed environment.
- Preserve audit records for inventory changes, sales imports, settings changes, proposals, approvals, submissions, failures, and delivery reconciliation.
- Use decimal-safe quantities and documented units. Money must remain integer cents or another exact representation.
- Add focused tests for authorization, idempotency, calculations, retries, and failure states. Avoid tests that only mirror implementation details.
- Do not change the live site or production data while completing local milestones unless the task explicitly authorizes a production deployment.

## 4. Core data flow

```mermaid
flowchart TD
    A[Completed POS sale] --> B[Validate event and identity]
    B --> C[Map item and modifiers to recipe]
    C --> D[Calculate ingredient consumption]
    D --> E[Deduct estimated inventory once]
    E --> F[Compare stock plus incoming to target]
    F --> G[Round shortfall to supplier packs]
    G --> H[Create supplier proposal]
    H --> I{Ordering mode}
    I -->|Review| J[Manager approval]
    I -->|Automatic| K[Policy and budget checks]
    J --> L[Submit to supplier]
    K --> L
    L --> M[Track confirmation and delivery]
    M --> N[Receive and reconcile stock]
```

## 5. Milestone roadmap

| ID | Milestone | Depends on | Completion result |
|---|---|---|---|
| M0 | Local development baseline | None | The imported project runs safely in VS Code with a local database and tests |
| M1 | Repository quality and CI | M0 | Every pull request receives repeatable type, build, migration, and test checks |
| M2 | Independent authentication and company RBAC | M0–M1 | Users can securely sign in outside the original hosting environment |
| M3 | Inventory and recipe integrity | M1–M2 | Units, recipes, counts, and target calculations are reliable and auditable |
| M4 | POS ingestion foundation | M2–M3 | A provider-neutral sales-event pipeline handles retries and exceptions |
| M5 | Clover end-to-end pilot | M4 | Clover completed sales deduct inventory correctly in sandbox and pilot mode |
| M6 | Additional POS adapter framework | M4–M5 | A second POS proves that integrations share one stable internal contract |
| M7 | Replenishment and purchasing proposals | M3–M5 | Shortfalls produce explainable, safe proposals grouped by supplier |
| M8 | First real supplier adapter | M7 | One supplier can quote, accept, reconcile, and confirm a real test order |
| M9 | Scheduler, alerts, and operations | M5–M8 | Background work runs reliably with visible health and failure recovery |
| M10 | Payments and financial controls | M2, M8 | Payment responsibilities and limits are secure and explicitly defined |
| M11 | Pilot validation and controlled automation | M0–M10 | One business completes a measured sale-to-delivery pilot |
| M12 | Multi-company production readiness | M11 | The system can onboard additional businesses safely and supportably |

---

## M0 — Local development baseline

**Objective:** Make the repository reproducible on the developer computer without accessing production data.

### Tasks

- [x] Read the original project handoff, `package.json`, `.env.example`, authentication code, database access code, migrations, and test scripts.
- [x] Confirm the required Node and pnpm versions.
- [x] Install dependencies from the lockfile.
- [x] Configure a local Cloudflare-compatible D1 database or the supported local equivalent.
- [x] Apply all existing migrations to a new local database.
- [x] Create local-only development variables from `.env.example` using dummy or sandbox values.
- [x] Document how local authentication works. If the current host headers cannot be reproduced securely, add a clearly isolated development-only identity fixture that cannot run in production.
- [x] Run type checking, existing tests, and the production build.
- [x] Add `docs/LOCAL_DEVELOPMENT.md` with exact setup, reset, test, and run commands.
- [x] Confirm `.env`, database state, generated secrets, and dependency folders are ignored by Git.

### Acceptance criteria

- [x] A clean clone can be installed and started by following the documentation.
- [x] The home page loads locally.
- [x] A local company can be created or seeded without using production data.
- [x] Existing migrations apply in order to an empty local database.
- [x] Type checking, tests, and build complete successfully.
- [x] No real credentials or production records exist in the repository.


Implementation evidence (2026-09-18): local M0 acceptance passed on Windows with Node 22.23.2 and pnpm 11.25.0. See [M0 evidence](M0_LOCAL_EVIDENCE.md). The milestone branch was later consolidated into `main`. Production authentication and external integrations remain unverified.

### Codex prompt

> Implement M0 from `docs/PANTRACK_MILESTONES.md`. First inspect the repository and report the current local-development blockers. Then make the smallest changes required for a reproducible local setup. Do not access production services or weaken production authentication. Add `docs/LOCAL_DEVELOPMENT.md`, run the relevant checks, and show me the final diff and commands before committing.

---

## M1 — Repository quality and continuous integration

**Objective:** Make changes reviewable and prevent broken code or migrations from reaching the main branch.

### Tasks

- [x] Add clear scripts for type checking, focused tests, complete tests, build, and migration generation/checking.
- [x] Add a CI workflow for pull requests using the locked Node and pnpm versions.
- [x] Cache dependencies safely without caching secrets or local databases.
- [x] Run type checking, meaningful tests, and production build in CI.
- [x] Detect uncommitted generated migrations or schema/migration mismatch.
- [x] Add a pull-request template containing scope, schema changes, security impact, tests, screenshots when relevant, and rollback notes.
- [x] Add `CONTRIBUTING.md` with branch, commit, migration, and review conventions.

### Acceptance criteria

- [x] CI passes on the baseline main branch.
- [x] A deliberate type error fails CI.
- [x] A deliberately failing test fails CI.
- [x] A schema change without its generated migration fails or is clearly detected.
- [x] CI does not require production secrets.

Implementation evidence: all six original suites, type checks, migration checks, and production build passed. Deliberate type/test/schema failures were detected. Hosted pull-request CI passed on Ubuntu and Windows (run 35356413026), and documentation-repair commit `333dbbd` passed main CI on both systems (run 35426054567). See [M1 evidence](M1_CI_EVIDENCE.md). The milestone branch was consolidated into `main`.

### Codex prompt

> Implement M1 only. Use the existing package manager and scripts. Add a minimal CI workflow and contributor documentation. Do not deploy or change application behavior. Demonstrate that the normal pipeline passes and explain which deliberate failures it would catch.

---

## M2 — Independent authentication and company permissions

**Objective:** Replace hosting-specific identity assumptions with secure authentication suitable for the chosen deployment platform.

Implementation and local acceptance checks are recorded in [M2 evidence](M2_LOCAL_EVIDENCE.md). The implementation is on `main`, and hosted repository CI passes. Real Supabase email/login/recovery verification, the failed Cloudflare Worker build, and migration/authentication review remain pending; these checked items describe automated implementation evidence, not production acceptance.

### Product decisions approved

- [x] Choose the production authentication provider and deployment host.
- [x] Decide whether a person can belong to multiple companies.
- [x] Confirm roles: owner, manager, and employee.
- [x] Define who can invite/remove users, connect integrations, approve orders, enable automation, and view financial settings.

### Tasks

- [x] Implement verified server-side sessions.
- [x] Link authenticated users to memberships; do not trust client-provided company IDs or roles.
- [x] Add company invitations with expiration, single use, and role assignment.
- [x] Add membership management and safe ownership transfer rules.
- [x] Create a centralized authorization helper and apply it to every API route.
- [x] Add CSRF protection where cookie-based mutations require it.
- [x] Add session expiration, logout, and account-recovery behavior.
- [x] Record security-relevant membership and integration-setting changes in an audit log.

### Acceptance criteria

- [x] Anonymous requests cannot read or modify company data.
- [x] A member of Company A cannot access Company B by changing URL or request fields.
- [x] Employees cannot connect POS/vendor accounts, change automation, or view payment controls unless explicitly authorized.
- [x] Managers can perform only the actions listed in the permissions matrix.
- [x] Invitation replay and expired invitations are rejected.
- [x] Authorization tests cover every API family.

### Codex prompt

> Implement M2 using the authentication provider documented in the repository decision record. Create a permissions matrix first, then centralize authorization and migrate one API family at a time. Preserve company isolation. Add tests for anonymous access, wrong-company access, role restrictions, invitation replay, and session expiry. Do not deploy until I review the migration and authentication flow.

---

## M3 — Inventory, units, and recipe integrity

**Objective:** Ensure stock calculations remain consistent as products, units, recipes, and counts change.

### Tasks

- [ ] Define supported stock units and conversion policy. Avoid silent free-text conversions.
- [ ] Distinguish purchase unit, stock unit, and recipe unit.
- [ ] Require an explicit conversion such as one case = 128 fl oz or one bag = 1,000 g.
- [ ] Prevent incompatible unit changes while stock, incoming deliveries, or active recipes exist unless a reviewed migration is performed.
- [ ] Version recipes so historical sales remain explainable after a recipe changes.
- [ ] Add recipe status: draft, active, and archived.
- [ ] Add modifier recipes for extra shots, milk substitutions, sizes, toppings, and other measurable changes.
- [ ] Add an opening-count timestamp and reject sales that predate that cutoff.
- [ ] Add reconciliation reports comparing estimated stock to physical counts.
- [ ] Preserve inventory events for count corrections, use, waste, sales, receipts, and adjustments.
- [ ] Explain every replenishment calculation in the UI: target, on hand, incoming, shortfall, pack conversion, limits, and final recommendation.

### Acceptance criteria

- [ ] A sale uses the recipe version active for that sale/import decision.
- [ ] Editing a current recipe does not rewrite historical usage records.
- [ ] Incompatible units are rejected before inventory changes.
- [ ] A repeated sales batch does not deduct twice.
- [ ] A physical count resets or records estimation variance according to the documented rule.
- [ ] Target-stock calculation passes examples involving incoming stock, case rounding, capacity, shelf life, zero target, and stale counts.

### Codex prompt

> Implement M3 in small commits. Start with a unit and recipe-versioning design note and migration plan. Preserve existing inventory history. Add acceptance tests for the documented examples before changing the UI. Do not invent automatic unit conversions that the manager has not configured.

---

## M4 — Provider-neutral POS ingestion foundation

**Objective:** Create one internal sales-event model that native POS adapters and external integration services can use safely.

### Required internal event fields

- Provider and environment.
- Merchant/company mapping and location ID.
- External order ID, line-item ID, and stable event/version ID.
- Event type and event time.
- Item/variation ID and quantity.
- Modifier IDs and quantities.
- Order status and preparation/fulfillment evidence when available.
- Source payload hash and ingestion time.

### Tasks

- [ ] Store raw event metadata needed for audit and replay without storing unnecessary payment or customer data.
- [ ] Validate event size, schema, company mapping, provider identity, and credentials/signature.
- [ ] Use provider + merchant + event/version identity for idempotency.
- [ ] Add a durable processing status: received, processing, applied, held, failed, or superseded.
- [ ] Separate receipt of an event from application of inventory changes.
- [ ] Add retry-safe processing and a dead-letter/held-event queue.
- [ ] Add an exception screen for unmapped items, modifiers, invalid quantities, missing recipes, and events before the opening count.
- [ ] Add manual resolve, replay, dismiss-with-reason, and stock-correction actions with audit records.
- [ ] Define cancellation, refund, remake, and reopened-order policies based on consumption evidence.
- [ ] Keep the current CSV and bridge imports compatible with the same service.

### Acceptance criteria

- [ ] Duplicate delivery of the same external event changes inventory once.
- [ ] Concurrent duplicates cannot both apply.
- [ ] Unknown items and modifiers are held without partially deducting inventory.
- [ ] Fixing a mapping allows the held event to be replayed safely.
- [ ] Events before the opening-count cutoff are not applied.
- [ ] A refund does not restore ingredients unless a reviewed consumption rule says it should.
- [ ] Logs and stored payloads contain no access tokens or unnecessary payment/customer information.

### Codex prompt

> Implement M4 as a provider-neutral ingestion service. Write the event contract and state machine first. Reuse existing recipe deduction logic, but separate event receipt from inventory application. Add concurrency and duplicate tests, a held-event workflow, and audit records. Keep existing manual imports working.

---

## M5 — Clover sandbox and pilot integration

**Objective:** Convert the existing Clover authorization/menu work into reliable completed-sale synchronization.

### Tasks

- [ ] Register/configure a Clover sandbox app with the minimum required read permissions.
- [ ] Complete OAuth callback, encrypted token storage, refresh rotation, expiration, reconnect, and revocation behavior.
- [ ] Confirm merchant identity and bind it to exactly one authorized company connection.
- [ ] Import menu items, variations, and relevant modifier identifiers.
- [ ] Map Clover items/modifiers to active Pantrack recipes.
- [ ] Ingest completed/prepared Clover orders using the M4 event model.
- [ ] Add pagination/cursor checkpoints and a bounded initial-sync cutoff.
- [ ] Add webhook handling if available and polling reconciliation to recover missed events.
- [ ] Record last successful sync, last attempted sync, lag, error, and held-event count.
- [ ] Handle order changes, voids, refunds, reopened orders, and partial fulfillment according to the documented consumption policy.
- [ ] Add a connection health and “sync now” interface.

### Acceptance criteria

- [ ] OAuth state/replay tests pass and tokens never reach browser logs or source control.
- [ ] Refresh-token rotation is atomic and recoverable.
- [ ] A completed sandbox latte sale deducts the correct milk, coffee, cup, and configured modifiers exactly once.
- [ ] An unmapped Clover modifier holds the event and does not partially deduct.
- [ ] Webhook retries and reconciliation polling do not duplicate usage.
- [ ] Disconnecting stops sync while preserving historical inventory events and mappings.
- [ ] A documented sandbox test report includes event IDs, expected usage, actual usage, and resolution of exceptions.

### Codex prompt

> Implement M5 against Clover's current official sandbox documentation. Keep automatic purchasing paused. Use the M4 ingestion contract and existing mappings. Complete sandbox tests for normal sales, duplicate delivery, modifiers, cancellation/refund cases, token refresh, disconnect, and missed-event recovery. Stop and list the exact developer-console settings or credentials I must supply; never ask me to paste secrets into chat or commit them.

---

## M6 — Additional POS adapters

**Objective:** Prove that Pantrack supports multiple POS systems through adapters rather than provider-specific inventory logic.

### Tasks

- [ ] Select the second POS based on a real pilot customer, API availability, permissions, cost, and approval requirements.
- [ ] Create a provider adapter interface for authorization, locations, catalog, incremental sales, webhooks, and health.
- [ ] Keep provider payload parsing inside the adapter.
- [ ] Translate provider events into the M4 internal contract.
- [ ] Store provider capabilities so the UI does not advertise unsupported sync behavior.
- [ ] Add connection status per company/provider/location.
- [ ] Document how to add future adapters and include a contract test suite.
- [ ] Keep CSV and authenticated bridge ingestion as supported fallback paths.

### Acceptance criteria

- [ ] Clover and the second provider pass the same ingestion contract tests.
- [ ] The inventory service contains no second-provider-specific logic.
- [ ] The UI accurately labels native connection, bridge connection, CSV-only, setup required, degraded, and disconnected states.
- [ ] A provider selection alone never appears as a working connection.

### Codex prompt

> Implement M6 for the selected second POS. First extract the stable adapter interface from the working Clover integration. Add provider capabilities and contract tests. Do not add placeholder “connected” states or list unsupported providers as functional integrations.

---

## M7 — Replenishment and purchasing proposals

**Objective:** Turn reliable inventory estimates into explainable proposals without prematurely placing purchases.

### Formula

For explicit target-stock mode:

```text
stock position = on hand + confirmed incoming
shortfall = max(0, target stock - stock position)
suggested packs = ceil(shortfall / stock units per purchased pack)
```

Then apply configured capacity, shelf-life, minimum-order, order-multiple, stale-count, expiration, and policy limits. Never reduce a safety rule silently.

### Tasks

- [ ] Version replenishment settings and record who changed them.
- [ ] Freeze a proposal snapshot containing inventory versions, settings, mappings, supplier SKU, pack conversion, price estimate, and calculation explanation.
- [ ] Group proposal lines by supplier/account/location.
- [ ] Add statuses: draft, review required, approved, sending, unknown, accepted, rejected, canceled, partially received, and closed.
- [ ] Prevent a new proposal from duplicating unresolved quantities.
- [ ] Recalculate or invalidate proposals when relevant inventory/settings change.
- [ ] Add manager edit with a reason and audit record.
- [ ] Add proposal totals, limits, delivery expectations, and warnings.

### Acceptance criteria

- [ ] The UI shows the inputs and arithmetic for every proposed line.
- [ ] Confirmed incoming inventory reduces the shortfall.
- [ ] Whole-pack rounding is correct.
- [ ] Capacity and shelf-life restrictions cap quantities and explain the cap.
- [ ] Stale or unverified inventory requires review.
- [ ] An unresolved supplier submission prevents duplicate purchasing.

### Codex prompt

> Implement M7 in review-only mode. Freeze calculation inputs in each proposal and make every quantity explainable. Add concurrency tests so inventory changes invalidate or safely recalculate stale proposals. Do not submit purchases in this milestone.

---

## M8 — First real supplier adapter

**Objective:** Submit one controlled order to one real supplier through a supported API or approved connector.

### Product decisions required

- [ ] Select the supplier from the pilot café.
- [ ] Confirm whether the supplier provides an API, EDI, marketplace app, punchout, approved integration service, or no automation channel.
- [ ] Confirm account ownership, delivery locations, catalog IDs, order minimums, cutoffs, fees, and payment terms.
- [ ] Define whether Pantrack pays or the supplier charges the business's existing account.

### Tasks

- [ ] Implement supplier authorization and credential rotation.
- [ ] Resolve Pantrack product IDs to exact supplier SKUs and pack units.
- [ ] Fetch or validate current availability, price, fees, minimums, and delivery details before submission.
- [ ] Require a quote snapshot and policy checks before purchase.
- [ ] Send a stable idempotency key when supported; otherwise build an explicit duplicate-prevention strategy.
- [ ] Persist sending before the external call.
- [ ] Treat timeouts and ambiguous responses as unknown and reconcile through supplier status before retrying.
- [ ] Record external order ID and immutable submission details.
- [ ] Support rejected, canceled, substituted, partially fulfilled, and accepted responses.
- [ ] Convert accepted quantities to incoming inventory once.
- [ ] Close incoming quantities only when delivery receipt is recorded.

### Acceptance criteria

- [ ] Connector capability testing cannot place an order.
- [ ] Review mode requires explicit manager approval.
- [ ] A real low-risk test order uses the intended account, delivery location, SKU, pack count, and limits.
- [ ] A simulated timeout produces unknown status and no automatic retry.
- [ ] Reconciliation resolves unknown status without duplicate submission.
- [ ] Price or quantity outside configured tolerance blocks purchase.
- [ ] Supplier confirmation creates incoming inventory exactly once.

### Codex prompt

> Implement M8 for the selected supplier's supported integration method. Use review mode and sandbox/test facilities where available. Preserve the proposal snapshot and idempotency behavior. Build explicit unknown-outcome reconciliation and demonstrate it with a simulated timeout before any real test order.

---

## M9 — Scheduler, alerts, and operational health

**Objective:** Run synchronization and purchasing checks without requiring the website to remain open.

### Tasks

- [ ] Choose and document the scheduler/queue platform.
- [ ] Add authenticated, idempotent scheduled jobs for POS sync, reconciliation, purchasing checks, and supplier status checks.
- [ ] Use per-company leases to prevent overlapping runs.
- [ ] Add bounded retries with backoff and a terminal held/failed state.
- [ ] Add an operations page with last success, last attempt, lag, failure reason, unresolved events/orders, and next run.
- [ ] Add alerts for disconnected POS, expired credentials, sync lag, unmapped events, failed proposals, unknown supplier outcomes, spending-limit blocks, and stale inventory.
- [ ] Add alert acknowledgement and escalation ownership.
- [ ] Add structured logs and request/job correlation IDs without secrets.
- [ ] Document recovery steps for every terminal job state.

### Acceptance criteria

- [ ] Jobs run when no user has the website open.
- [ ] Concurrent scheduler delivery does not duplicate sales, proposals, or orders.
- [ ] Temporary failures retry within documented limits.
- [ ] Persistent failures become visible and notify the correct owner.
- [ ] Operations status distinguishes healthy, delayed, degraded, paused, and disconnected states.

### Codex prompt

> Implement M9 using the selected scheduler and notification channels. Keep every job idempotent and company-scoped. Add operational status before enabling the schedule. Demonstrate duplicate scheduler delivery, transient retry, permanent failure, and recovery behavior.

---

## M10 — Payments and financial controls

**Objective:** Define and secure how supplier purchases are charged and limited.

### Tasks

- [ ] Document payment responsibility for each supplier: supplier account terms, saved supplier card, external checkout, or platform-managed payment.
- [ ] Avoid storing raw card numbers, security codes, or unencrypted payment credentials.
- [ ] Complete provider-hosted payment setup where required.
- [ ] Restrict payment setup and viewing to authorized owners.
- [ ] Add per-order, per-day, and optional per-month company limits.
- [ ] Add supplier/product allowlists and automatic-order eligibility.
- [ ] Require reauthentication or an equivalent high-confidence action before enabling automatic mode or changing high-impact limits.
- [ ] Audit every limit, payment, and mode change.
- [ ] Display estimated versus final supplier totals and reconciliation differences.

### Acceptance criteria

- [ ] Pantrack never receives or logs raw card data when hosted payment collection is used.
- [ ] Employees and unauthorized managers cannot access payment controls.
- [ ] Orders exceeding any limit are blocked before submission.
- [ ] Unresolved/unknown orders count against the budget until reconciled.
- [ ] Automatic mode cannot be enabled without at least one verified supplier, eligible products, limits, and alert owner.

### Codex prompt

> Implement M10 using hosted/tokenized payment flows and the documented supplier payment model. Add authorization tests and budget-reservation concurrency tests. Do not collect raw card details or enable automatic purchasing.

---

## M11 — Pilot validation and controlled automation

**Objective:** Prove the complete workflow with one café before allowing unattended purchases.

### Pilot stages

1. **Shadow inventory:** Import real sales while the café continues its normal process. Compare Pantrack estimates with physical counts.
2. **Recommendation only:** Generate purchasing suggestions; managers compare them with actual orders.
3. **Reviewed submission:** Managers approve Pantrack proposals sent through the real supplier adapter.
4. **Limited automation:** Allow only selected products with conservative budgets and alerts.

### Tasks

- [ ] Select one location, one POS, one supplier, and a small group of stable products.
- [ ] Obtain explicit permission from the business for sandbox/pilot data and ordering.
- [ ] Set opening counts, recipes, modifiers, targets, pack conversions, supplier mappings, and count schedule.
- [ ] Create a pilot runbook and rollback/pause process.
- [ ] Measure sync completeness, held events, inventory variance, proposal accuracy, duplicate rate, order failures, and delivery differences.
- [ ] Reconcile physical counts at an agreed frequency.
- [ ] Investigate systematic recipe variance and adjust through reviewed configuration changes.
- [ ] Keep an emergency global/company pause control visible and tested.
- [ ] Obtain manager sign-off before each increase in automation.

### Exit criteria

- [ ] No duplicate inventory deduction or duplicate supplier order during the pilot.
- [ ] All missed/held sales are visible and recoverable.
- [ ] Inventory variance stays within the pilot's agreed tolerance for the selected products.
- [ ] Every submitted order has an audit trail from sales through calculation, approval, supplier response, and receipt.
- [ ] Alerts reach the responsible person and recovery instructions work.
- [ ] The business completes at least two successful count-to-delivery cycles in reviewed mode.
- [ ] Limited automation remains within configured product and spending limits during a defined observation period.

### Codex prompt

> Prepare M11 without broadening scope. Add the pilot dashboard, pause controls, metrics, and runbook needed for one café, one POS, and one supplier. Do not enable automatic mode by default. Produce a pilot evidence report template and list every external action the café manager must perform.

---

## M12 — Multi-company production readiness

**Objective:** Onboard additional businesses without mixing data, integrations, or operational responsibility.

### Tasks

- [ ] Create a guided onboarding checklist for company, staff, products, inventory, recipes, POS, supplier, limits, alerts, and pilot validation.
- [ ] Add company-level integration capability/status instead of global assumptions.
- [ ] Add backup, restore, retention, deletion, and export procedures.
- [ ] Add rate limits and abuse controls to public/authenticated ingestion routes.
- [ ] Complete dependency, secret, authorization, webhook, SSRF, audit-log, and data-isolation security review.
- [ ] Add production monitoring, error tracking, uptime checks, and incident response.
- [ ] Test schema migration and rollback/recovery using production-like data volume.
- [ ] Add support tools that reveal status without exposing credentials or unrelated company data.
- [ ] Define service limits, support ownership, privacy terms, and customer offboarding.
- [ ] Run a tenant-isolation test suite before each production release.

### Acceptance criteria

- [ ] A new company can complete onboarding without developer database edits.
- [ ] Connections, tokens, mappings, jobs, proposals, budgets, and alerts remain company-scoped.
- [ ] Backup restoration is tested and documented.
- [ ] A security review has no unresolved critical findings.
- [ ] Production dashboards and alerts identify company-specific failures without leaking company data.
- [ ] Customer deletion/export behavior is documented and tested.

### Codex prompt

> Implement M12 only after the pilot exit criteria are recorded. Focus on onboarding, tenant isolation, operational readiness, backup/restore, rate limiting, and security findings. Produce a release-readiness report with evidence for every acceptance criterion.

## 6. Definition of done for every milestone

A milestone is complete only when:

- [ ] Its scoped tasks and acceptance criteria are met.
- [ ] Relevant type checks, tests, migration checks, and build pass.
- [ ] Authorization and wrong-company cases are tested for new company-owned features.
- [ ] Failure, retry, idempotency, and concurrency behavior are tested when external events or purchases are involved.
- [ ] New environment variables are added to `.env.example` without values and documented.
- [ ] Secrets and personal/customer data are absent from the diff and logs.
- [ ] Migrations are additive and reviewed.
- [ ] User-facing states include loading, empty, success, failure, disconnected, and held/review states as applicable.
- [ ] Documentation explains setup, operation, failure recovery, and rollback.
- [ ] The final diff contains only milestone-related changes.
- [ ] A Git commit or pull request records the result and remaining limitations.

## 7. How to use this file with Codex

1. Keep this roadmap at `docs/PANTRACK_MILESTONES.md`.
2. Read [CURRENT_STATUS.md](CURRENT_STATUS.md) and begin with the first incomplete prerequisite milestone.
3. Work on one milestone at a time; do not ask Codex to implement the whole roadmap in one session.
4. Work on `main`; keep the milestone changes in focused commits.
5. Paste the milestone's Codex prompt into the Codex sidebar.
6. Ask Codex to inspect before editing and to identify any assumption that conflicts with the repository.
7. Keep normal workspace permissions enabled. Approve only commands you understand and that are necessary for the milestone.
8. Review the proposed schema and external-service changes before Codex applies them.
9. Require Codex to run the milestone checks and show the final diff.
10. Update the checkboxes and add a short implementation note with the commit or pull-request link.
11. Record acceptance criteria as complete only when supported by evidence.
12. Begin the next milestone in a new Codex session on `main` with the updated file.

## 8. Reusable Codex session prompt

```text
Read docs/CURRENT_STATUS.md and docs/PANTRACK_MILESTONES.md, then inspect the current repository.

Work only on milestone [MILESTONE ID AND NAME]. Do not implement later milestones or redesign unrelated screens.

Before editing:
1. Compare the milestone assumptions with the current code.
2. Summarize what is already complete, what is missing, and which files/data are affected.
3. Identify external credentials or console actions that I must perform. Never ask me to paste secrets into chat or source control.
4. Propose the smallest implementation sequence and the tests that prove the acceptance criteria.

During implementation:
- Preserve company isolation and server-side role checks.
- Keep external operations idempotent and auditable.
- Use additive migrations.
- Do not access production data or deploy unless I explicitly request it.
- Keep changes within this milestone.

Before finishing:
1. Run relevant type checks, tests, migration checks, and build.
2. Review the diff for secrets, unrelated changes, missing authorization, and misleading “connected” states.
3. Report each acceptance criterion as passed, failed, or blocked with evidence.
4. Update docs/PANTRACK_MILESTONES.md checkboxes only for criteria actually completed.
5. Suggest a commit message and list remaining blockers.
```

## 9. Decision log template

Create `docs/decisions/NNNN-title.md` when a choice affects architecture, security, data compatibility, or multiple future milestones.

```markdown
# Decision: [title]

- Status: proposed | accepted | replaced
- Date: YYYY-MM-DD
- Milestone: M#

## Context
[Problem and constraints]

## Decision
[Chosen approach]

## Alternatives considered
[Brief alternatives and why they were not selected]

## Consequences
[Benefits, costs, migration concerns, and follow-up work]
```

## 10. First recommended session

Begin with **M2 acceptance**, specifically the real Supabase walkthrough,
Cloudflare build diagnosis, and authentication/migration review. After M2 is
accepted, proceed to **M3 — Inventory, units, and recipe integrity**. Do not begin
live Clover sales or supplier integration until their prerequisite milestones
are complete and reviewed.
