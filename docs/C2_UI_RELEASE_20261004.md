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

No remote mutation or deployment has occurred in this preflight. Publishing
current main must wait for the owner to authorize that development schema cutover
and its fresh-sign-in effect. The proposed release uses a private D1 backup,
temporary maintenance response during cutover, the two unchanged migrations,
fenced main build, unchanged exact-preview/sync settings, and hosted HTTP checks.
No purchasing or Clover sync gate will be enabled.

## Recovery and next step

Before remote migration, the existing Worker remains the recovery point. After
0023, do not restore old sessions or roll back to unfenced authentication; use
the [auth forward-repair instructions](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-01--password-recovery-misses-concurrent-session-creation).
UI rollback can revert the UI commit while retaining the fenced main baseline.
Next unblocked release step: owner approval for the documented development
schema/code cutover. No milestone checkboxes changed.
