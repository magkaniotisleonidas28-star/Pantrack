# C2 UI release — 2026-10-04

Outcome: carry the Inventory, Waste, recipe/stock forms, catalog, workspace
surface and width refinements onto current `main`, preserving independent
purchasing work in the original checkout. The owner requested a main commit
and deployment. This is a C2 release slice, not milestone or production acceptance.

## Source and local checks

Release checkout: `/private/tmp/pantrack-ui-release-20261004`, branch `main`,
based on fetched `origin/main` at `f984975`. The UI changes introduce no schema,
API, provider or authorization changes. Shared workspace integration was copied
without the original checkout's uncommitted purchasing hooks. Those files,
migrations and pending work remain in the original checkout.

The complete local pipeline passed in this release checkout:

- `pnpm typecheck`.
- `pnpm test`: all 41 suites on this main baseline.
- `pnpm db:check`: 24 ordered migrations, matching metadata and fresh SQLite.
- `pnpm build`.
- `pnpm db:migrate:local`: 24 migrations in the release checkout's isolated D1.
- `VINEXT_NO_DEV_LOCK=1 pnpm test:local`: loopback HTTP, auth fixture,
  company creation/isolation, CSRF, catalog and sign-out passed. Loopback
  permission was required after sandbox `EPERM`.
- `git diff --check`.

Presentation and browser limits are recorded in the
[Inventory](INVENTORY_UI_LOCAL_EVIDENCE.md),
[forms](FORM_UI_LOCAL_EVIDENCE.md), and
[workspace surfaces](WORKSPACE_SURFACE_UI_LOCAL_EVIDENCE.md) evidence. Those
earlier 46-suite results came from the purchasing checkout; the isolated release
has 41 suites and does not publish the pending purchasing feature.

## Deployment preflight

The target is the existing `pantrack-dev` Worker at
<https://pantrack-dev.christospsimadas25.workers.dev>, account
`46a94b92309dd488dadd02f6ae70e0ff`, D1 `pantrack-dev-db`
(`9b50014b-f929-4f03-a187-599df6e438b1`). The active preflight Worker version is
`1d1b22e4-fc01-4cce-819d-46d0115b259b` (2026-10-01).

The read-only remote migration check found `0022_repair_replenishment_state_guard.sql`
and `0023_auth_recovery_fence.sql` pending. These are already on remote main,
independent of the UI refinements. Deploying current main requires their schema
cutover. The [BUG-01 handoff](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-01--password-recovery-misses-concurrent-session-creation)
requires coordinated schema/code release without mixed unfenced auth code.
Migration 0023 intentionally clears existing sessions once, requiring fresh
sign-in while preserving identities, memberships, business data and history.

The preflight made no remote mutations. The owner subsequently authorized both
development migrations and deployment, including fresh sign-in. The executed
release used a private D1 backup, temporary maintenance response during cutover,
the two unchanged migrations, fenced main build, unchanged exact-preview/sync
settings, and hosted HTTP checks. No purchasing or Clover sync gate was enabled.

## Completed hosted release

- UI source commit `65373b308af702c2a9922a2109280568202a95a8` was pushed to
  remote `main`. [Repository CI](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/37256510295)
  completed successfully. The later release-record commit changes documentation
  only; the deployed application comes from `65373b3`.
- Private backup: Git-ignored `.sites-runtime/ui-release-20261004/before.sql`
  in the release checkout, protected by directory mode 700/file mode 600.
  SHA-256: `5a51d2bf54dd099181689bb1b54df2217869823d557c1f7eacc528525baf71d8`.
  Loading it into SQLite passed integrity and foreign-key checks. Applying both
  migrations to that copy preserved all original columns except the migration
  ledger and intentionally cleared sessions.
- The fenced main build was uploaded before maintenance as Worker version
  `ed5e9c65-31b7-432f-bff9-bf4df45e9b68`, tagged `ui-65373b3`. Deployment dry
  run passed; scanning built artifacts found no private local variable values.
- Temporary maintenance version `4de7ba71-0a6e-4fd4-af5e-e279e9f538f3` returned
  503 with no-store and Retry-After before schema mutation. Migration 0022 was
  applied through unchanged SQL file import (the established trigger-safe path).
  Its remote trigger matched the tested upgrade before its ledger row was added.
  Normal migration apply then completed 0023.
- A post-migration private export passed integrity and foreign-key checks. Comparing
  every original column confirmed **63 existing tables unchanged**, including
  company/catalog/inventory/recipes/sales/history and identity fields. The only
  original-table differences were two migration ledger entries and clearance of
  26 existing sessions. All 24 migration names exist exactly once; the fence and
  default user cutoffs are initialized, and no sessions remained at cutover.
- The uploaded main version was activated at 100% traffic on
  `2026-10-05T02:50:23.415Z` (October 4 local time). Final deployment metadata
  confirms its version ID. All nine prior secret bindings remain present;
  exact inventory is enabled and Clover sync disabled. No cron, queue, supplier
  connection, purchasing or payment behavior was enabled or exercised.

Hosted checks passed: `/` and `/auth` returned 200; anonymous company, inventory,
waste and sales-events GETs returned 401; anonymous waste-entry POST returned 401;
forged identity headers returned 401; the local fixture sign-in path returned 404.
The served stylesheet contains the new catalog row and content-width rules.
An initial Python urllib request returned 403; curl-based checks succeeded and
are the recorded HTTP evidence. No hosted stock, recipe, waste, sale or order was
created. A new signed-in browser walkthrough remains owner work after fresh login;
these HTTP checks do not prove provider authentication or hosted concurrency.

## Recovery and next step

Before remote migration, the existing Worker remains the recovery point. After
0023, do not restore old sessions or roll back to unfenced authentication; use
the [auth forward-repair instructions](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-01--password-recovery-misses-concurrent-session-creation).
UI rollback can revert the UI commit while retaining the fenced main baseline.
Next unblocked step: owner fresh sign-in and hosted UI usability review. No
milestone checkboxes changed. The original purchasing checkout remains intact
on its workstream branch; the clean release checkout holds local `main`.
