# Milestone readiness

Assessment date: 2026-09-18. This report distinguishes existing prototype code from demonstrated acceptance. It does not mark a milestone complete. No production, merchant, supplier, payment, or pilot access was performed for this assessment.

M0 local acceptance passed (commit 0a6986e; draft PR #1). M1 code, local checks and hosted Ubuntu/Windows PR CI passed (run 35356413026; draft PR #2). Main-branch acceptance remains pending review/merge. M2 product decisions are pending. Later milestones retain their prerequisites in `PANTRACK_MILESTONES.md`, including the requirement to complete M11 before M12.

## Status and completion evidence

| Milestone | Current status | Blocking work or prerequisite | Evidence needed to mark complete |
| --- | --- | --- | --- |
| M0: Local baseline | Local acceptance passed | Review draft PR #1 before merging; see M0_LOCAL_EVIDENCE.md. | Clean local database initialization; documented reset/run commands; home page and company creation; successful type, test, and build commands; secret/ignore review. |
| M1: Quality and CI | Implemented; local and hosted PR checks passed | Main-branch run pending review/merge; see M1_CI_EVIDENCE.md. | Passing local pipeline and hosted PR CI; demonstrated failure on type errors, failing tests, and missing migrations; PR/commit reference. |
| M2: Authentication and permissions | Blocked on decisions | M0-M1; approve host, authentication provider, membership policy, and permission matrix. Implement verified sessions, invitations, account recovery, ownership rules, and security audit records. | Anonymous, cross-company, every-role/API-family, CSRF, session-expiration, invitation replay/expiration, logout, and last-owner tests; approved authentication decision record. |
| M3: Inventory and recipes | Partial prototype; prerequisite blocked | M1-M2; explicit units/decimal policy, immutable recipe versions and modifiers, sale/count cutoff, reconciliation history, and safe unit changes. | Tests for recipe history, fractional pack boundaries, modifiers, pre-count sales, concurrent duplicates, count variance, incompatible units, and target/incoming/capacity/shelf-life/zero-target/stale-count examples. |
| M4: POS ingestion | Partial prototype; prerequisite blocked | M2-M3; provider-neutral event identity, separate durable receipt/application, held queue, replay/dismiss/correction workflow, and consumption policy. | Duplicate/concurrent receipt and crash/retry tests; unknown item/modifier holds with no partial deduction; safe replay after mapping; preparation-aware refund/cancellation tests; payload redaction and authorization tests. |
| M5: Clover | OAuth/menu prototype; sandbox and pilot unverified | M4; approved sandbox app and company merchant mapping; completed order sync, modifiers, token rotation, cursors, reconciliation, and connection health. | Official-contract tests plus sandbox report with event IDs and expected/actual ingredient usage; refresh/replay, disconnect, missed-event recovery, void/refund, and unknown-modifier results. Mocks alone do not establish sandbox or pilot acceptance. |
| M6: Second POS | No validated second native adapter | M4-M5; select provider from an actual pilot business and approve access/permissions/costs; implement shared adapter contract and truthful capability states. | Clover and selected provider pass the same ingestion contract tests; second-provider sandbox evidence; provider-specific parsing stays outside inventory; disconnected/setup/degraded/bridge/CSV states demonstrated. |
| M7: Proposals | Partial prototype; prerequisite blocked | M3-M5; version settings, freeze explanations and account/location/SKU snapshots, add approval/edit audit, lifecycle states, and atomic unresolved-quantity reservations. | Target math and warnings visible in UI; concurrent proposal generation/approval and inventory-change tests; stale inputs require review; unknown submissions block duplicates; every edit has actor and reason. Keep implementation in review mode. |
| M8: Supplier | Generic connector only; no selected, validated supplier adapter | M7; select supplier and supported ordering channel; confirm account/location/catalog/terms; implement quote, submission, status, incoming, and delivery reconciliation. | Capability tests place no order; simulated timeout produces unknown without retry; reconciliation avoids duplicates; limits/price mismatch block; acceptance creates incoming once; explicitly authorized low-risk real test order and receipt evidence. |
| M9: Operations | Manual check/endpoint and lease prototype; scheduler unprovisioned | M5-M8; select scheduler/queue, notification channel, responsible owner, retry policy, and escalation process. | Jobs run with browser closed; duplicate delivery/overlap, transient failure, terminal failure, recovery, and alert delivery tests; healthy/delayed/degraded/paused/disconnected health evidence. |
| M10: Financial controls | Hosted card setup and some budget checks exist; supplier payment model unverified | M2 and M8; approve who pays and through which account; owner reauthentication, product/supplier eligibility, and full budget controls remain. | Hosted payment sandbox and ownership tests; no raw card handling; concurrent reservations including unknown orders enforce limits; audited configuration changes; automatic-mode eligibility gates. Do not activate automatic purchasing. |
| M11: Pilot | Not started; no permission or field evidence recorded | M0-M10; business permission, one location/POS/supplier, selected products, opening data, tolerances, schedule, and named manager. | Measured sales/count/proposal/order/receipt audit trail; visible/recoverable exceptions; verified pause and alerts; two successful reviewed count-to-delivery cycles; written manager sign-offs before each stage; defined observation period for limited automation. |
| M12: Production readiness | Not started; explicitly gated by M11 | Recorded M11 exit criteria; approved hosting/operations/support/retention decisions; onboarding, isolation, backup/recovery, abuse controls, and security review. | Production-like migration/restore exercise; full tenant-isolation suite; export/deletion tests; monitoring/incident drill; no unresolved critical security findings; release-readiness report. Preparing documents does not waive M11. |

Every completion claim also needs the common definition of done: relevant checks pass, additive migrations reviewed, authorization/failure cases covered, user-visible states and recovery documented, secrets absent, and a milestone-scoped commit or PR records evidence and remaining limitations.

## Decisions and external actions

| Owner | Required decision or action | Unblocks |
| --- | --- | --- |
| Product owner | Choose production deployment host and authentication provider. Confirm callback origins, session/account-recovery model, multiple-company membership, roles, invitations, and ownership transfer rules. Approve the proposed matrix below. | M2 and dependents |
| Hosting/authentication account owner | Provision a development/sandbox application and configure its allowed callback/logout URLs for the chosen host. Store credentials through ignored local variables or the host's secret store; do not paste secrets into chat or commit them. | M2 verification |
| Cafe owner/manager | Identify the pilot company, location, actual POS, supplier, and stable product subset. Give explicit permission for sandbox/pilot data and, separately, reviewed test purchases. Confirm recipes/modifiers, units, pack conversions, targets, count frequency, inventory tolerance, and alert owner. | M5-M8 and M11 |
| Clover developer/merchant account owner | Register/configure the sandbox app, approved redirect URL, minimum read permissions, test merchant/location/catalog, and webhook configuration if used. Install/authorize the app against the intended sandbox merchant. Run and record authorized sandbox sale cases; pilot authorization is separate. | M5 |
| Product owner and pilot manager | Select the second POS from actual business needs. Confirm API availability, developer/merchant approvals, locations, scopes, sandbox access, costs, and webhook/polling capabilities. A provider dropdown selection does not establish a connection. | M6 |
| Supplier account owner | Name the first supplier and supported API, EDI, approved connector, marketplace, or punchout channel. Obtain technical access/documentation and test facilities. Confirm account owner, delivery location, exact SKUs/pack units, order multiples/minimums, cutoffs, fees, substitutions, cancellation/status behavior, and payment terms. If no supported channel exists, select another supplier or keep purchasing manual. | M7 configuration and M8 |
| Supplier account owner and manager | Approve the concrete low-risk test order, account, delivery address, line quantities, and maximum cost only after sandbox/failure tests are reviewable. Record confirmation and actual delivery. General local-development authorization is not authorization to buy goods. | M8 acceptance and M11 |
| Operations owner | Choose scheduler/queue platform and notification channel. Name alert recipients, acknowledgement/escalation owner, retry/backoff limits, and recovery responsibility. Provision a sandbox schedule and verify notifications before enabling a live schedule. | M9 |
| Company owner | Select payment responsibility per supplier: supplier account terms, saved supplier card, external checkout, or platform-managed payment. Confirm who is charged, limits, currency, fees, and settlement reconciliation; configure provider-hosted sandbox setup only where needed. A Stripe card vault does not itself pay arbitrary suppliers. | M10 |
| Pilot manager | Sign off after shadow inventory, recommendation-only, and reviewed-submission stages; complete two reviewed count-to-delivery cycles. Authorize any limited-automation stage with named products, conservative limits, alert owner, observation period, and pause/rollback procedure. | M11 |
| Product/operations owner | After M11 evidence is accepted, approve production deployment, service/support ownership, retention/export/deletion rules, privacy terms, recovery objectives, monitoring, and incident response. Complete a separate deliberate release review. | M12 |

## Proposed M2 permissions: acceptance pending

This is a proposal, not the current permission implementation or an approved business policy. Users may belong to multiple companies with a separate role per company; the existing membership schema supports this. All access must derive from verified server sessions and company membership. Anonymous users have no company access.

| Action | Owner | Manager | Employee |
| --- | --- | --- | --- |
| Read company catalog, inventory, recipes, and operational health without credentials/payment details | Yes | Yes | Yes |
| Change catalog, recipes, units, targets, counts, receipts, waste, or sales mappings/imports | Yes | Yes | No |
| Resolve/replay held sales or make a documented stock correction | Yes | Yes | No |
| Read proposals/orders and their operational cost estimates | Yes | Yes | No |
| Create/edit proposals with a reason; approve reviewed orders within owner limits | Yes | Yes | No |
| Reconcile supplier responses/deliveries and acknowledge operational alerts | Yes | Yes | No |
| Connect/disconnect POS or supplier accounts; manage integration credentials | Yes | No | No |
| Invite/remove members, assign roles, rename company, or transfer ownership | Yes | No | No |
| View/manage payment methods, financial controls, allowlists, or spending limits | Yes | No | No |
| Enable/resume automation after required pilot sign-off and reauthentication | Yes | No | No |
| Immediately pause company automation | Yes | Yes | No |
| Export company data or request company deletion/offboarding | Yes | No | No |

Ownership transfer must verify the recipient and preserve at least one owner; self-removal or demotion cannot leave the company ownerless. A company owner cannot administer another company without membership. Global emergency pause and support operations require a separately defined platform-operator role, not an arbitrary company owner's privileges.

## Critical implementation findings

- Unit changes currently check only positive stock/incoming and do not check recipe references. Negative stock also requires protection. Recipe writes overwrite the current recipe; historical imports retain aggregated usage but no immutable recipe version.
- Sales imports check that an opening count exists but carry no sale occurrence cutoff. A delayed sale can therefore deduct stock already included in a later physical count. Count events omit the previous estimate and variance.
- Quantities and pack rounding use floating-point arithmetic. Define precision explicitly and test fractional boundaries before treating the arithmetic as decimal safe.
- Proposal snapshots omit inventory/settings versions and explanations. Inventory validation precedes an external quote, so changes during that call can invalidate approval inputs. Lease ownership and transactional quantity reservations need concurrency tests.
- Accepted supplier jobs do not automatically create confirmed incoming stock. Current delivery linkage relies on manually entered reference notes; acceptance and receipts need durable idempotent associations.
- M0 fixed the prototype purchasing exposure: server submission and automatic policy activation are blocked, and old automatic settings create review-only proposals. Tests cover direct/API/scheduled attempts. A future gate must require actual supplier and reviewed-pilot evidence before activation.

Sources inspected include `CODEX_HANDOFF.md`, `PANTRACK_MILESTONES.md`, `db/schema.ts`, inventory/sales/automation/company/payment API routes, `lib/inventory.ts`, `lib/import-sales.ts`, `lib/purchasing-engine.ts`, and existing local tests. Existing tests use mocked external services and local SQLite; they do not prove live integration readiness.

## Verification record

- M0: all local criteria passed; commit 0a6986e and draft PR https://github.com/magkaniotisleonidas28-star/Pantrack/pull/1. See M0_LOCAL_EVIDENCE.md.
- M1: all six local suites, typecheck, migration check and build passed. Deliberate type/test/migration failures detected. Hosted Ubuntu/Windows CI passed: https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35356413026. Main-branch run remains pending; see M1_CI_EVIDENCE.md.
- M2: provider/host and product-policy choices requested; acceptance pending.
- M3-M12: no completion claim. Later sandbox, purchase, deployment, and pilot evidence must be attached to the relevant milestone when actually obtained.
