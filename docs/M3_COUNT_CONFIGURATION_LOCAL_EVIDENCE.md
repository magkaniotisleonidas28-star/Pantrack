# A4 stock configuration and physical count evidence

Date: 2026-09-22. Outcome: internal stock configuration and physical-count
writers work locally in a SQLite-backed D1 harness. A4 and M3 are not complete.

## Task contract

Add one reviewable A4 behavior slice over the existing A3 tables: classify a
product's stock unit, change that unit safely, and record exact physical counts
with a sale cutoff and variance. Keep the earlier A2/A4 work intact. A verified
session must supply the actor; owner/manager permission and company ownership
are checked by the services and again in each write transaction. There is no
new migration, route, screen, external call, deployment, or live data action.

## Behavior

- [Configuration service](../src/lib/inventory-configuration-service.ts)
  activates a new company/product-scoped configuration. It can select a curated
  unit or version a custom unit with an explicit conversion. It records exact
  purchase-pack quantity when supplied. A same-dimension display-unit change
  keeps canonical on-hand, incoming and count cutoff values. A dimension change
  is rejected after stock movements, counts, incoming stock, recipes or legacy
  history. A newly classified product starts with zero exact balance and needs
  a new opening count; legacy amounts are never guessed or converted.
- [Physical count service](../src/lib/physical-count-service.ts) converts the
  entered amount exactly, rejects future or backdated counts, writes measured
  stock and a cutoff, and resets estimated use. The first classified count is
  an opening count with unknown prior estimate and variance. Later counts save
  the estimate before the count and signed variance. Legacy unclassified counts
  stay unknown rather than becoming invented exact measurements.
- Both services use inspection tokens and a transaction-level snapshot guard so
  a concurrent sale, stock edit, unit change or permission loss cannot silently
  overwrite a newer state. Balance changes, history and audit records commit
  together or roll back together. No current HTTP route calls these services.

## Local proof and limitations

[Configuration tests](../tests/inventory-configuration-service.mjs) cover
curated/custom unit versions, canonical balance preservation, pack conversion,
dimension restrictions, count integration, forbidden actors, company isolation,
membership revocation and failed-write rollback.
[Count tests](../tests/physical-count-service.mjs) cover opening and later
counts, `-1.500000 g` variance, cutoff behavior through the internal sale port,
legacy unknown counts, backdated/future rejection, concurrent sales, stale
tokens, forbidden actors, company isolation and failed-write rollback.

The local SQLite transaction harness is shaped like D1; it is not an actual
Cloudflare Worker/D1 execution. These services do not change the current
inventory screen or legacy writes. Legacy records changed after A3 backfill
must be reconciled before any authority switch. Large-history snapshot size,
independent security review, route authorization and manager UI still need
work. No live POS, supplier, hosted CI, pilot or production behavior is proved.

## Verification and handoff

- PASS: focused `node scripts/test.mjs inventory-configuration-service physical-count-service`.
- PASS: full `node scripts/test.mjs` (19 suites).
- PASS: `pnpm typecheck`, focused ESLint on both new TypeScript services,
  `pnpm db:check` (11 migrations), and `pnpm build`.
- PASS: diff whitespace review and changed relative documentation links.
- NOT RUN: local Worker HTTP smoke test and local migration application. No
  schema or route changed; the previously recorded duplicate `nodejs_compat`
  startup problem is unchanged.

No migration or shared A2 contract changed. Rollback is removal of the two
unused services and their tests; they have not written runtime data. The next
unblocked A4 work is reconciling legacy updates and routing authorized
inventory/recipe/sale writes through the new services with a reviewed manager
interface. A1 acceptance, A3 migration review, M2 acceptance and A5 handoff
remain separate gates. Do not check A4 yet.
