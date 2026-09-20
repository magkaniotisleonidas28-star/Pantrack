# M4 B3 local evidence — durable sales-event data foundations

Date: 2026-09-19
Evidence level: local D1 and deterministic fakes only

## Scope proved

B3 adds an additive D1 event store for the accepted
[`pantrack.sales.v1` contract](decisions/0003-m4-sales-ingestion.md). It does not
route manual sales, CSV imports, the authenticated bridge, or Clover into the
new store, and it does not call the A2 inventory service from an existing route.
Those cutovers remain B4 work.

The shared asynchronous store contract requires a company ID for every read and
mutation. Both the in-memory contract fake and `D1SalesEventStore` cover exact
and concurrent duplicates, identity conflicts and conflict dismissal, revision
ordering, one processing lease per lineage, immutable attempt results, expired
lease recovery, replay/retry/dismiss resolution history, correction audit
linkage, retained-fragment cleanup, and wrong-company denial.

Generated migration `0010_aromatic_the_initiative.sql` adds immutable normalized
event facts, separately deletable retained fragments, current state and leases,
append-only transitions, attempt starts and results, identity conflicts,
resolutions, audits, and pending corrections. Composite company keys and foreign
keys isolate tenants. A partial unique index serializes processing by company and
order lineage. Reviewed triggers record state history and apply receipt-time
revision supersession atomically.

## Compatibility and retention evidence

`tests/m4-data-foundations.mjs` applies migrations 0000–0009, seeds two companies
with same-reference legacy `sales_imports` rows and an existing register mapping,
then applies 0010. Every pre-existing table row remains byte-for-byte unchanged,
all new tables are initially empty, and foreign-key/integrity checks pass.

`tests/sales-event-store-contract.mjs` runs the same behavior against the
in-memory and D1 stores. It also proves manual, mapped-CSV, and bridge source
namespaces cannot collide; a new store instance can read the same SQLite-backed
state; and 30-day cleanup deletes only the audit fragment while retaining the
payload hash, normalized facts, attempts, transitions, resolutions, and audits.

No arbitrary provider payload, credential, payment detail, or customer data is
stored. Only the validated normalized sales document, validated A2 result and
issue JSON, and the allowlisted audit fragment use JSON columns.

## Verification

- PASS — `pnpm typecheck`
- PASS — `pnpm test:focused sales-ingestion-contract sales-event-store-contract m4-data-foundations inventory-consumption-contract register-bridge inventory-sales m2-security` (7 suites)
- PASS — `pnpm test` (13 suites)
- PASS — `pnpm db:check` (11 ordered migrations match schema/snapshot/journal and apply fresh)
- PASS — `pnpm build`
- PASS — `pnpm db:migrate:local` (0010 applied locally; 32 commands)
- PASS — `pnpm test:local`
- PASS — `git diff --check`

The first sandboxed local migration and smoke-test attempts could not bind to
`127.0.0.1` (`EPERM`). The same exact local-only checks passed after granting the
narrow loopback permission. No remote migration, deployment, live POS contact,
customer data, credential, or purchase was used.

## Rollback and handoff

This migration is additive. Before any future remote application, rollback is
forward-only: stop application use of the new store while retaining its tables,
then repair through a new migration. Do not rewrite migration 0010.

B4 is the next unblocked Person B item after the A2 handoff review: integrate the
published inventory-consumption contract exactly once and add the held-event
workflow without changing this immutable event history. M4 is not complete;
route cutover, exception UI, legacy deduplication at cutover, and external
acceptance evidence remain outstanding.
