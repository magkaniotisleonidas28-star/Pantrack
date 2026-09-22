# A4 exact inventory preview and route evidence

Date: 2026-09-22. Outcome: a gated manager preview now connects the A4 exact
services to an authorized HTTP route and screen for new exact-only products.
A4 and M3 remain incomplete because migrated legacy records have not been
reconciled or cut over, the B4 sales path is not connected, and actual Worker D1
runtime acceptance remains open.

## Task contract

Connect the locally tested A4 configuration, physical count, recipe, modifier,
and consumption foundations to a manager-facing preview without creating two
authoritative stock balances. Preserve existing uncommitted work, legacy data,
and the B-side shared contract. Keep the route disabled by default; perform no
deployment, live integration, or external action.

## Changes

- [Exact inventory route](../src/app/api/inventory/exact/route.ts) is available
  only when `M3_EXACT_PREVIEW_ENABLED=true` is set in the runtime environment.
  It requires a verified session and current owner/manager membership for both
  reads and writes. It exposes guarded configuration, count, stock movement,
  recipe, and modifier actions without changing the A2 consumption contract.
- [Manager preview](../src/components/workspace/exact-inventory-panel.tsx) is
  shown in the inventory workspace only when that gated route is available.
  Managers can classify units, enter dated counts, record deliveries/use/waste
  or confirmed incoming stock, review draft ingredient values, and activate or
  archive recipe and modifier versions. The screen states that purchasing and
  older sales imports have not switched to this view.
- [Exact stock movement service](../src/lib/exact-stock-movement-service.ts)
  writes the balance, event and audit record in one guarded transaction. An
  opening count is required before deliveries, use or waste. Incoming stock
  may be set before that count. A stable update ID returns the original result
  on retry, even with an old inspection token; different input using the same
  ID is rejected. The UI retains the ID until a successful save.
- The [legacy inventory route](../src/app/api/inventory/route.ts) refuses writes
  to a product with an active exact configuration. Its transaction also checks
  that rule, so a simultaneous configuration cannot race a legacy write.
  The preview refuses configuration when a legacy JSON stock record exists.
  This confines preview writes to new exact-only products; it does not convert
  older records.
- [Legacy review report](../src/lib/legacy-m3-review.ts) compares current
  legacy stock settings and recipe contents with A3's preserved copies. It
  displays changes and missing reviewed versions/counts without guessing a
  conversion or modifying history.

## Local proof and remaining gates

[Route tests](../tests/exact-inventory-route.mjs) exercise real request handlers
with a SQLite-backed D1 adapter: anonymous, forbidden-role and wrong-company
denial; disabled preview; configuration, count, delivery replay, recipe and
modifier activation; stale edits; legacy-product refusal; and old-record drift.
[Movement tests](../tests/exact-stock-movement-service.mjs) exercise exact
delivery, incoming, use, waste, idempotency, company isolation, permission loss,
stale writes and rollback. The existing [legacy inventory tests](../tests/inventory-sales.mjs)
prove that its route blocks writes to exact-configured products.
The physical-count service test also proves that confirmed incoming stock can
precede the first exact count and stays recorded after that count.

- PASS: full `node scripts/test.mjs` (21 suites), including the route and
  movement suites.
- PASS: `pnpm typecheck`, focused ESLint, `pnpm db:check` (11 migrations), and
  `pnpm build`.
- PASS: diff whitespace and changed documentation link checks.
- NOT RUN: actual Worker D1 HTTP acceptance. The earlier local startup problem
  from duplicate `nodejs_compat` remains in C's platform workstream.

The preview remains **off by default**. Tests use SQLite transactions behind a
D1-shaped adapter, not a Worker binding. Its reads of all version history may
need paging or snapshot-size changes before rollout. No hosted CI, sandbox,
live provider, production or pilot evidence is claimed.

Before A4 can be checked: review and reconcile post-backfill legacy changes,
complete a safe authority switch with a maintained legacy projection, connect
the B4 sales application path to the exact consumption port after its handoff
review, and verify the manager flow in an actual local Worker/D1 environment.
A1/A3 review and M2 acceptance remain separate M3 gates. No migration was
created. Rollback is to keep the preview flag unset and remove the unused route,
screen and services; the existing legacy behavior then remains authoritative.
