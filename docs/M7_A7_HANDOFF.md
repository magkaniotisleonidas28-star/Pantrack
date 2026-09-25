# A7 proposal handoff to Person C

The A-owned `pantrack.replenishment-handoff.v1` contract is defined in
[`replenishment-lifecycle.ts`](../src/lib/replenishment-lifecycle.ts). It freezes
the company and proposal IDs, product, supplier mapping and account, proposed
packs and stock units per pack, estimated line and proposal totals, safety limits,
delivery expectation, warnings, inventory/config/settings versions, edit reason,
review reasons, and source invalidation reasons. Money is
represented as a currency code and decimal minor-unit string; pack counts and
stock quantities are strings so JSON does not lose precision.

Every A7 handoff is `review_only` and has `supplierSubmissionAllowed: false`.
The current supplier, sales, and price sources are fictional fixtures. C4's
[`fake supplier consumer`](../src/lib/c4-fake-supplier-consumer.ts) validates
this handoff and holds it, including when an `approved` status is present. Its
[cross-workstream test](../tests/c4-a7-supplier-handoff.mjs) proves that no
supplier call occurs. Person C must independently
enforce the M8 gate before adding any real adapter. The A7 status graph names
`sending`, `unknown`, `accepted`, `rejected`, and receipt states for future
auditing; naming a state does not enable submission.

A source version mismatch invalidates the review quantity. An owner or manager
may propose a quantity edit with a recorded reason only while source versions
match. The pure validator rejects a changed company, employee role, missing
reason, noncanonical quantity, order multiple violation, missing opening count,
and safety limit overrun. The immutable origin remains unchanged. Migration
`0017` and `D1ReplenishmentLifecycle` record the edit and its actor in an
append-only audit event before the edited handoff is returned.

The local A → C contract test is recorded in [C4 handoff evidence](C4_A7_HANDOFF_EVIDENCE.md).
Supplier decisions, remote migrations, and M7 acceptance are still pending.
