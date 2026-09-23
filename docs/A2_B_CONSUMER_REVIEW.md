# A2 consumption contract: B-side technical review

Date: 2026-09-21
Scope: A2 consumer handoff; local code review and focused B-side repairs.
Status: A2 complete locally. Independent A2 review found no blocking issues;
the project owner approved the handoff in this conversation on 2026-09-21.
This review was recorded before publication. The B-side repairs are now on the
focused `workstream-b/a2-approved-consumer-20260922` integration branch;
merging into `main` and hosted CI are separate checks.

## What B must verify

B must consume [A's interface](../src/lib/inventory-consumption-contract.ts)
without performing inventory arithmetic itself. The relevant
[A1 decisions](decisions/0002-m3-quantity-and-recipe-model.md) and
[B1 decisions](decisions/0003-m4-sales-ingestion.md) agree on this boundary.

| Handoff responsibility | Review result and local evidence |
| --- | --- |
| Company and application identity | B supplies the event's company and stable application key. Replies now must match company, key and contract before callbacks or audit persistence. |
| Recipe time | B normalizes occurrence time to UTC; A selects the historical version. Applied replies must represent the same instant. Draft/legacy exclusion and boundary selection have A-side tests. |
| Quantities and extras | Whole menu-item counts and total modifier occurrences are decimal strings. B now combines repeated mapped modifier IDs using bigint; A owns unit conversion, recipe quantities and range checks. |
| Atomic deduction | A's contract promises all-or-nothing application. Fake and SQLite persistence tests cover failures with no partial deduction. B does not write ingredient balances. |
| Physical counts | Missing count and sale-at/before-count outcomes are held. B exposes the reason instead of adjusting the cutoff or deducting stock itself. |
| Retry identity | Crash-after-application recovery reuses the same key and records the replayed result without a second deduction. |
| Holds and errors | Unit/version/count problems are held. Invalid quantities/times are held; conflicting keys become identity conflicts. Contract defects fail processing; thrown storage errors become inventory unavailable. |
| Corrections and refunds | B's existing policy does not automatically restore stock after a financial refund; correction requests remain separately reviewed. |
| Authorization boundary | Authorization precedes A's internal port. Existing B tests cover anonymous, other-company and forbidden-role receipt/retry/replay/correction operations. No new endpoint was added. |

## Findings repaired in this review

1. **Repeated extras were not compatible with A2.** Two external modifier lines
   mapped to the same recipe modifier were sent as duplicate IDs. A correctly
   rejected that input, so an otherwise valid sale failed. B now combines their
   occurrence counts before calling A. A sale of two drinks with one plus two
   extras passes three modifier occurrences, not six. Large totals remain exact;
   an out-of-range ingredient result is held without changing balances.
2. **Inventory replies were not tied back to their request.** B accepted and
   persisted a reply without comparing its company, key, contract or sale time.
   B now rejects mismatched replies as `integration_defect` before invoking the
   post-apply callback or persisting the reply. Basic status/result-container
   checks also fail closed. This is an internal typed boundary, not a complete
   validator for arbitrary untrusted nested JSON.

Changes are limited to [B's service](../src/lib/sales-ingestion.ts) and
[its contract tests](../tests/sales-ingestion-contract.mjs), plus this review and
documentation links. The user explicitly requested completing B's A2 review.
Earlier A4 work was preserved. No shared type, migration, route, supplier gate
or deployment setting changed. The independent review and project-owner approval
below cover the two consumer changes. No approval under another person's name
is asserted.

## Verification

- PASS: pre-change `node scripts/test.mjs` (15 suites).
- Reproduced: new repeated-modifier regression failed with `failed` rather than
  `applied` before the service fix.
- PASS: `node scripts/test.mjs sales-ingestion-contract` after fixes and final
  test updates. Covers repeated extras, large-count holds, mismatched reply
  company/key/contract/time, existing outcome mapping and crash/retry recovery.
- Broad post-change run: all earlier suites passed; the last suite initially
  failed because a new fixture exceeded B's documented per-input count limit.
  Corrected the fixture to use accepted input counts, then reran that suite
  successfully. This was a test-fixture error, not a product failure.
- PASS: final `node scripts/test.mjs` rerun (all 15 suites) after that correction.
- PASS: `pnpm build`.
- PASS: `pnpm typecheck` and `eslint src/lib/sales-ingestion.ts`.
- PASS: diff whitespace review and changed relative links.
- NOT RERUN: local migration and HTTP smoke checks; this task changes no schema
  or route. The earlier duplicate `nodejs_compat` startup failure remains open.

All evidence is local (fakes and SQLite-backed D1 adapters). It does not prove
live D1 execution, hosted CI, POS sandbox behavior, or production acceptance.

## Independent review and owner approval

The [AI development rules](AI_DEVELOPMENT.md#6-concurrent-ai-work) say:
“Use a fresh AI review session plus the owning human for security, migrations,
purchases, and external integrations.” A separate read-only reviewer,
`/root/a2_independent_review`, inspected A2's interface/fake, the B consumer
repairs, tests and handoff documentation. It made no edits and reported:

> Independent A2 review complete: no blocking finding in scoped A2 interface/fake
> or the two B-side repairs.

The reviewer confirmed company-scoped identity, sale-time versions, physical-count
cutoffs, atomic calculations, exact modifier aggregation, reply checks before
callbacks/audit persistence and crash/retry key reuse. It recommended additional
tests for malformed result envelopes and foreign held/rejected replies, without
identifying a source-code blocker. Those regression tests were added and passed
with `node scripts/test.mjs sales-ingestion-contract`. No production source
changed after the independent review. The full 15-suite run also passed in this
acceptance session before the test-only additions.

The reviewer delivered its completed assessment in a message; its subsequent
final response was interrupted by a service usage limit. The assessment above
records that delivered review, not an invented successful final response. The
reviewer did not run tests; the primary agent ran the verification commands.

**Approver:** project owner (the user in this conversation), accepting responsibility
for the A2 handoff in place of the previously unassigned Person B approver.
**Authorization received:**

> Run an independent review, fix any findings, and record me as the person approving A2.

The independent review's nonblocking test recommendation is addressed. Owner
approval is recorded for A2's local contract/fake/consumer handoff only. It does
not accept A3 migrations, the A4 persistent service, M2/M3/M4, or any live operation.

## Publication and next work

A2 was checked as locally complete under the roadmap's local-slice rule. The
original shared contract was already committed. This focused branch carries
the reviewed B consumer repairs; the fake/engine extraction and other A4 work
remain on the separate `review/a4-local-overlap-20260922` branch. The B3/B4
reviewed-and-merged gate remains in force; no `main` merge or hosted CI result
is claimed here. B4 route/UI integration and M3/M4 acceptance remain incomplete.

The new persistent A4 port has its own
[local evidence and limitations](M3_LOCAL_EVIDENCE.md); this review does not
authorize connecting it to runtime routes or waive M2/A3 acceptance gates.
The A4 implementation overlap needs its own review. B can prepare B4 integration
tests using the approved contract after this focused change is merged.

Rollback: revert only this review's B service/test changes. Existing inventory
data and earlier A4 work are unaffected; no database repair is needed.
