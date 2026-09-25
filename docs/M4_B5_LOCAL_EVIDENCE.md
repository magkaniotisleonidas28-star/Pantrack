# M4 B5 local acceptance evidence

Date: 2026-09-24

Workstream item: B5 — accept M4 for local development

Evidence level: local D1, deterministic contract tests, served loopback UI/API, and repository CI

## Task contract and boundary

The owner accepted M2 and M3 for development. B1's `pantrack.sales.v1` decision and B2–B4 implementations are on `main`. B5 reviews concurrency, recovery, authorization, privacy, migration compatibility, and the gate-on local flow as one reviewable M4 acceptance outcome. The exact preview remains off remotely. There is no live POS, Clover sandbox merchant, hosted D1 `0012` application, hosted Worker smoke, supplier action, or production data in this evidence.

The acceptance level chosen for B5 is **local development**, plus green Ubuntu and Windows repository checks. Native provider signature verification is an adapter responsibility in B6/M5; M4 validates the currently connected manual/CSV entry points and authenticated bridge ingress. Neither a mocked provider nor a local bridge token is native-provider evidence.

## M4 task evidence

| M4 task | Local evidence |
| --- | --- |
| Minimal metadata and replay | B2 normalization/redaction tests, B3 `sales_events` and separately expiring `sales_event_fragments`, and the B5 stored-row inspection. The immutable hash, state transitions, attempts, resolutions, and audits remain after fragment expiry. |
| Size, schema, company, source authentication | `sales-ingestion-contract` checks UTF-8 limits, schema/quantity/identity validation, server-derived company and source binding, and roles. `register-bridge` checks its 50,000-byte body limit and authenticated company-bound token path. Native signatures remain B6. |
| Idempotency identity | B2 identity/conflict tests, `sales-event-store-contract` concurrent receipts, B4 concurrent sale tests, and B5 served duplicate with unchanged stock. |
| Durable states and separate receipt/application | B3 D1 store and migrations, B2 state-machine tests, B4 exact consumption, and B5 persisted received/held/applied transitions with two permanent consumption applications. |
| Retry and held queue | B2 crash-after-apply and retry tests, B3 lease expiry/restart tests, B4 held-event tests, and B5 served mapping hold followed by audited replay. |
| Exception review and actions | B4 manager UI and route tests cover held reasons, retry, replay, dismissal, occurrence confirmation, conflict resolution, and corrections. B5 inspected the owner Sales & exceptions view and served correction application. |
| Refund/remake/cancel/reopen policy | Accepted B1 decision and B2 policy tests. A financial refund or cancellation does not automatically restore consumed ingredients; a reviewed correction is a separate audited stock movement. |
| CSV and bridge compatibility | B4 source-namespace, legacy deduplication, recipe CSV, mapped CSV, bridge inferred-time, and replay tests; `register-bridge` retains legacy request/response and CSV parsing. |

## Acceptance criteria

| Criterion | Evidence and result |
| --- | --- |
| Duplicate delivery changes inventory once | PASS: B2/B4 tests and B5 served manual duplicate; milk remained at 90.000000 after the duplicate. |
| Concurrent duplicates cannot both apply | PASS: B2 concurrent receipt and B4/D1 concurrent application tests; exactly one permanent application per identity. |
| Unknown item/modifier holds the whole event | PASS: B2 unknown-item/modifier and A2 all-or-nothing tests; B5 unknown mapped item held with milk unchanged at 90.000000. |
| Mapping repair permits safe replay | PASS: B4 test and B5 served repair/replay; milk changed from 90.000000 to 80.000000 once, with a replay audit. |
| Before-opening-count event does not apply | PASS: `inventory-consumption-contract` and `inventory-consumption-d1` cutoff tests. |
| Refund does not automatically restore ingredients | PASS: B1 policy, B2 refund/cancellation tests, and B4/UI correction behavior. B5's reviewed correction restored 10.000000 milk and one cup exactly once. |
| No tokens or unnecessary customer/payment data in logs or stored payload | PASS: B2 sensitive-looking payload injection tests, B3 allowlist/30-day expiry tests, B5 stored-row allowlist and expiry inspection, and local server output review. The fictional B5 rows held normalized facts, SHA-256 hashes, and allowlisted fragments only. |

## B5 finding and repair

The first served mapping replay wrote the held-to-received resolution and audit but returned 409 because `D1SalesEventStore.resolve` relied on per-statement `meta.changes` in D1 batch results. Local Wrangler omitted those counts. B5 changed batch acknowledgments to transactional `SELECT changes()` for resolution, correction audit, occurrence confirmation, conflict dismissal, lease recovery, and fragment cleanup. The D1 test wrappers now omit batch metadata, matching the served runtime. A fresh served replay, correction, and employee-access run passed afterward.

No schema, migration, public request body, provider contract, or gate default changed. The existing migrations `0010` and `0012` were reviewed as additive and company-scoped; `b4-data-foundations`, `m4-data-foundations`, and `pnpm db:check` prove older rows remain unchanged, fresh application succeeds, and SQL agrees with snapshots and journal. A nonlocal repair would be forward-only: leave the preview off, retain history, and add a new migration rather than rewriting one.

## Verification and UI review

- Reproduction: in a fresh isolated worktree, run `pnpm local:setup`, `pnpm db:migrate:local`, and `node scripts/b5-review-fixture.mjs seed`. Add `PANTRACK_EXACT_INVENTORY_PREVIEW=enabled` to that worktree's ignored `.dev.vars`, start `pnpm dev --port 5173`, run `node scripts/b5-local-http.mjs`, and then `node scripts/b5-review-fixture.mjs verify`. Stop the server and remove the local preview setting afterward. The HTTP script consumes its fixture and expects a fresh seed.
- PASS: 10 focused suites for sales, D1, inventory, authorization, and compatibility.
- PASS: isolated gate-on served HTTP flow with fictional company, exact stock, duplicate, held mapping, replay, correction, anonymous/wrong-company/employee denial, and persisted audit/foreign-key checks.
- PASS: Safari owner view showed the exact stock values and applied sales/correction controls. Employee view showed only state and occurrence time, with no sale or correction controls or sensitive references. The local server was stopped and its ignored preview setting removed afterward.
- PASS: `pnpm typecheck`, `pnpm test` (19 suites), `pnpm db:check` (13 migrations), `pnpm build`, `pnpm db:migrate:local` (no pending migrations), `pnpm test:local`, focused ESLint, and `git diff --check`.
- PASS: Ubuntu and Windows repository checks on B5 commit `479bb93` in [branch run 35956951513](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35956951513). [PR #5](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/5) merged as `d41294a`.
- PASS: Ubuntu and Windows checks on merge commit `d41294a` in [main run 35957224092](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35957224092).

## Acceptance and handoff

B5/M4 is accepted for local development on 2026-09-24, supported by the isolated served walkthrough, contract and compatibility tests, and green branch and main CI. This is repository evidence; no independent person reviewed it. The B6 handoff is the accepted `pantrack.sales.v1` service and `pantrack.inventory-consumption.v1` port; Clover adapter authentication, merchant/location binding, cursor reconciliation, token lifecycle, and sandbox cases belong to B6/B7. Hosted development D1 migration `0012` and Worker smoke remain separate gates before remotely enabling the exact preview. Keep supplier submission and automatic purchasing disabled.
