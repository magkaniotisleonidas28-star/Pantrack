# A5 — M3 acceptance review

Updated: 2026-09-23. Workstream A. **A5 remains open.** This records the
completed local checks and the exact evidence still needed to accept M3. It
does not approve a remote migration, deployment, live integration, or purchase.

## Task contract

Objective: check every M3 task and acceptance criterion on the current `main`
integration, confirm that Person B can consume A's published interface, and
hand off a reviewable acceptance decision. The review uses the isolated
`workstream-a/a5-acceptance-20260923` worktree based on `da6fa86`. The only
behavior change is a focused planning-safety fix; no schema or production data
changes are part of this packet. Complete A5 only when
the M2 prerequisite, all M3 evidence, named review, and definition of done are
recorded. Preserve the exact inventory preview gate in its default-off state.

## M3 task and criterion evidence

| Roadmap requirement | Local evidence | Result |
| --- | --- | --- |
| Explicit stock, purchase, and recipe units and conversions | [A1 decision](decisions/0002-m3-quantity-and-recipe-model.md), `inventory-quantities`, `inventory-management-contract` | Pass locally; unclassified legacy labels are not converted automatically. |
| Safe unit changes | `inventory-management-contract` rejects incompatible dimension changes and preserves same-dimension canonical balances | Pass locally. |
| Recipe draft/active/archive history and sale-time selection | `inventory-management-contract`, `inventory-consumption-contract`, `inventory-consumption-d1`, `b4-sales-inventory` | Pass locally; delayed sales use the version active at occurrence time. |
| Modifier recipes | `inventory-consumption-contract` and D1 cases for positive additions, substitutions, and negative-result whole-request holds | Pass locally. |
| Opening-count cutoff | Consumption contract, D1, and manager cases for equal/earlier sales and backdated counts | Pass locally; held sales do not deduct. |
| Physical-count variance and immutable stock events | `inventory-management-contract`, `a4-data-foundations`, reconciliation history UI | Pass locally; count changes retain estimate and signed variance. |
| Repeated sales do not deduct twice | `inventory-consumption-d1` and `b4-sales-inventory`, including concurrent duplicates and restart/replay | Pass locally. |
| Target examples: incoming, case rounding, capacity, shelf life, zero target, stale count | `inventory-quantities` tests the exact pure calculation | Pass for the exact calculation. The current preview planning tab still displays a **legacy compatibility estimate**, so these tests do not prove an exact, end-to-end planning recommendation in the UI. A6/M7 owns that replacement. |
| Explain the current target calculation in the UI | The preview planning tab labels compatibility values and shows target, position, shortfall, pack size, each capacity/shelf-life pack limit, and final result; the exact stock tab shows canonical on-hand/incoming | The A5 review found that an overdue physical count could still show a suggested pack count. This packet fixes it: the count now requires review and yields zero suggested packs. This UI still needs its manager-screen walkthrough. |
| Existing-data compatibility | `m3-data-foundations` checks pre-`0009` product, inventory, recipe, event, and import rows; `a4-data-foundations` checks pre-`0011` exact rows; [older-data owner walkthrough](M3_A5_OWNER_REVIEW.md) passed with fictional data | Pass locally for the tested fixtures; real company data has not been reviewed or migrated remotely. |
| Company and role security | `inventory-management-contract`, `inventory-consumption-d1`, `inventory-management-contract` route coverage in `m2-security` | Pass locally for anonymous, wrong-company, employee-write, manager-write, and employee-read cases. |

The exact calculation examples include 5 lb, 1 US gallon, a 1,000-item case,
cross-dimensional rejection, a sale just before a recipe change, substitutions,
the count cutoff, negative variance, and an ambiguous legacy `cup`. See the
[accepted A1 decision](decisions/0002-m3-quantity-and-recipe-model.md) for the
expected values and [M3 implementation evidence](M3_LOCAL_EVIDENCE.md) for the
source and test handoff.

## Cross-workstream handoff and prerequisite

[Person B's B4 review](M4_B4_LOCAL_EVIDENCE.md) confirms that M4 sends mapped
sales through the published `pantrack.inventory-consumption.v1` port without
an inventory-specific workaround. Its served fictional-data walkthrough covers
sales, duplicate detection, correction, CSV paths, and role-specific status.
The [A2 handoff](A2_B_CONSUMER_REVIEW.md) also has an independent review and
owner approval. M2/C1 was accepted by the owner **for development** on
2026-09-23; its separate owner authentication/migration review remains a
pre-public-release follow-up, not independent security verification.

## Full local definition-of-done check

On this fresh worktree, with the bundled Node 22.23.2 and pnpm tools:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm test` | Pass; 19 suites |
| `pnpm db:check` | Pass; 13 ordered migrations, schema/snapshot/journal agreement, and fresh SQLite apply |
| `pnpm build` | Pass; production bundle generated locally |
| `pnpm db:migrate:local` | Pass; all 13 migrations applied to a fresh **worktree-local** D1 |
| `pnpm test:local` | Pass; served home, anonymous/forged-header rejection, fictional sign-in/company/catalog, tenant isolation, sign-out |

After the planning fix, the focused `inventory-sales` suite, `pnpm typecheck`,
all 19 `pnpm test` suites, `pnpm build`, and focused ESLint on both changed
TypeScript/TSX files passed again. Migration checks,
fresh local migration, and served smoke passed before the fix; no migration,
database service, route, or smoke-covered behavior changed afterward.

Hosted [draft PR #4](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/4)
ran [repository CI](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35940202302)
on source commit `01286e5`: the Ubuntu and Windows jobs both passed. This is
repository CI evidence, not a deployment or hosted-runtime test.

The first attempts at some checks hit sandbox `spawn EPERM`; each affected
command was rerun with approved local execution and passed. No remote database,
hosted runtime, real provider, or production data was contacted by this run.

Migration review: `0009` expands exact inventory and backfills old labels as
unclassified without changing prior JSON/history. `0011` adds one-active-version
indexes and immutability triggers for activated recipe/modifier history. The
compatibility tests prove seeded pre-migration rows remain unchanged, constraints
reject forbidden edits, foreign keys pass, and a fresh database matches the
generated schema. No migration is edited in this packet. For rollback, leave
`PANTRACK_EXACT_INVENTORY_PREVIEW` unset; after a nonlocal migration or exact
write, retain history and use a new forward-repair migration if needed.

## Acceptance decision still needed

The owner confirmed **"all matched"** on 2026-09-23 after opening the separate
fictional local A5 cafe and checking Exact stock, Count history, Recipe versions,
Modifiers, and Planning explanation. The reviewed fixture showed milk at 12 mL,
an opening count of 10 mL followed by a 12 mL count with +2 mL variance, an
active reviewed latte and extra-milk modifier, three suggested milk packs with
capacity/shelf limits, and no automatic suggestion for overdue coffee. This is
owner-observed local screen evidence, separate from the automated tests and
the earlier [older-data screen walkthrough](M3_A5_OWNER_REVIEW.md). The owner
then requested that displayed decimals omit trailing zeroes while still allowing
decimal input. The display-only formatting follow-up trims those zeroes without
changing canonical quantities, conversion precision, or saved values. Exact
amounts such as `12.000000` now display as `12`, while `12.500000` displays as
`12.5` and a value needing all six places retains them. The compatibility
planning tab also hides trailing zeros from its three-place display rounding.

After that display change, PASS: focused `inventory-quantities`,
`pnpm typecheck`, all 19 `pnpm test` suites, `pnpm db:check`, `pnpm build`,
`pnpm db:migrate:local` (no pending migrations), `pnpm test:local`, focused
ESLint for both changed source files, and a read-only check that the isolated
fictional manager fixture still serves the expected stock, recipe, modifier,
and planning values. The first `test:local` attempt was blocked by the already
running review server; it passed after that server was stopped and was then
restarted. The owner refreshed the local Inventory page and confirmed on
2026-09-23 that the shorter numbers look right. Source commit `ca132a7`
also passed [Windows and Ubuntu CI](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35944315221).

The migration SQL has local compatibility review, but the named fresh reviewer
and owning-human review for
a schema-bearing acceptance have not been recorded.

The owning human should also review the additive `0009`/`0011` migration
summary and forward-repair rule above, or name a qualified reviewer; this
cannot be inferred from automated tests.

Therefore M3 and A5 stay unchecked. The next work is to record the migration
review and the final acceptance decision. B5/M4
acceptance must wait for that decision. The preview remains off by default.
