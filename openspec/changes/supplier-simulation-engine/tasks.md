# Tasks

## 1. Simulation contracts and storage

- [x] 1.1 Add bounded quote/result/capability contracts and branded deterministic fake connector; verify malformed quotes, whole packs, grouping and transport exclusion in focused tests.
- [x] 1.2 Add orders, immutable evidence, source holds and reservations in migration 0022; verify fresh schema, immutability, upgrade preservation and rollback/forward-repair documentation.

## 2. Durable engine

- [x] 2.1 Implement server-resolved membership, immutable source validation, quotes and exact approval; verify anonymous/wrong-company/employee, stale v1/v2 sources, requote and expiry tests.
- [x] 2.2 Implement atomic send claims, UTC spending limits, source holds and pre-send cancellation; verify concurrent duplicates, source reuse, conflicting operation IDs, budget races and transaction rollback.
- [x] 2.3 Implement uncertain outcomes, reconciliation and durable replay; verify restart, lost acknowledgment, crash-after-claim, malformed/mismatched result, not-found, rejection release and accepted terminal stability.

## 3. Verification and handoff

- [x] 3.1 Run the complete local pipeline and confirm unchanged inventory/proposal history and purchasing hard block.
- [x] 3.2 Self-review the diff, validate OpenSpec and relative links, and publish local evidence/current-status handoff with provider and portal gates still open.
