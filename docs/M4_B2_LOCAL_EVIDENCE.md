# M4 B2 local evidence — fake-backed receipt and held-event core

Date: 2026-09-19

Scope: workstream B, checklist item B2 from the [milestone roadmap](PANTRACK_MILESTONES.md#person-b--sales-ingestion-and-pos-sequence).

## Outcome

The provider-neutral service in [`sales-ingestion.ts`](../src/lib/sales-ingestion.ts) locally proves validation, canonical identity, duplicate/conflict receipt, revision ordering, held/failed workflows, five-minute lease recovery, operator replay/dismiss/correction requests, tenant authorization, payload redaction, and mapping/A2 result handling.

This is fake-backed evidence only:

- `InMemorySalesEventStore` is an atomic in-process fake with snapshot/reload support. It is not durable D1 storage.
- `FakeSalesMappingPort` is an in-memory fake. It is not a provider or database mapping integration.
- Inventory checks use the published [`InventoryConsumptionPort`](../src/lib/inventory-consumption-contract.ts) and its [`FakeInventoryConsumptionPort`](../src/lib/inventory-consumption-fake.ts). They do not write Pantrack's real inventory tables.

No schema, migration, existing import routing, live POS connection, or exception-management UI changed. Manual, CSV, and bridge imports remain on their legacy path. The bridge change only enforces its existing 50,000-byte limit by UTF-8 bytes.

## Local behavior proved

The focused [`sales-ingestion-contract.mjs`](../tests/sales-ingestion-contract.mjs) suite proves:

- server-derived company/source binding; anonymous, wrong-company, source-mismatch, and forbidden-role rejection before storage;
- RFC 3339, revision, identity, whole-number quantity, uniqueness, line-count, source-size, and 65,536-byte retained-fragment validation;
- canonical SHA-256 event/source/application identities, stable line/modifier ordering, a 30-day expiry, allowlisted audit retention, and exclusion of tested customer, payment, header, token, cookie, and note data;
- exact and concurrent duplicate receipt, identity conflicts, supersession, stale revisions, serialized lineage claims, applied-event immutability, and snapshot/reload history;
- unknown item/variation/modifier and all exercised A2 configuration/version/cutoff holds without partial application;
- preparation, inferred-time, cancellation, refund, remake, reopen, unchanged, positive-delta, restorative/mixed-delta, and modifier-only-delta policies;
- A2 applied, replayed, held, rejected, idempotency-conflict, integration-defect, and unavailable outcomes;
- expired-lease interruption, explicit retry, repeated unresolved replay, dismissal, pending correction authorization/audit, sanitized employee reads, and crash-after-A2-apply recovery with one inventory deduction.

The focused [`register-bridge.mjs`](../tests/register-bridge.mjs) suite proves that exactly 50,000-byte ASCII and multibyte JSON bodies are accepted and 50,001-byte bodies are rejected, while the bridge request/response shape and legacy import behavior remain unchanged.

## Verification

All commands ran successfully in this worktree on 2026-09-19 with the repository's bundled Node 22.23.2 and pnpm 11.25.0 toolchain:

```text
pnpm typecheck
pnpm test:focused sales-ingestion-contract inventory-consumption-contract register-bridge inventory-sales m2-security
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
git diff --check
```

Results:

- TypeScript reported no errors.
- The five requested focused suites passed.
- All 11 repository test suites passed.
- All 10 existing migrations matched the schema and applied to a fresh test database.
- The application build completed.
- Local D1 reported no pending migrations after applying the existing migration set.
- The local HTTP smoke test passed anonymous/forged-header rejection, fixture sign-in, company creation, catalog, tenant isolation, and sign-out.
- Diff whitespace validation passed.

## Boundaries, rollback, and handoff

B2 does not establish real persistence, provider sandbox behavior, pilot behavior, or M4 acceptance. M4 remains blocked on B3's persistent event storage, B4's real inventory/UI integration, accepted M2–M3 prerequisites, and B5 evidence. No roadmap or status checkbox was updated.

Rollback is code-only: revert commits `405433b`, `9cca202`, and `7660b90`. There is no database rollback because B2 added no migration or schema change. The bridge limit can be rolled back independently by reverting `9cca202`, although that would restore the unsafe JavaScript-code-unit approximation.

The next unblocked workstream-B item is B3: implement the same store contract with additive D1 event, processing, held/replay, and audit structures through the migration merge queue. B3 must preserve the identities, state rules, immutable history, authorization boundary, and fake-vs-persistent evidence distinction recorded in the [accepted M4 decision](decisions/0003-m4-sales-ingestion.md).
