# A2, A4, and B4 integration review

Date: 2026-09-23. This is local integration evidence for
`integration/a2-a4-b4-20260922`, not acceptance of M3 or M4.

## Task contract

Combine the approved A2 consumer fixes and the A4 manager-screen retry fix with
B4's exact-sales branch. Preserve every source branch and its history. Check for
overlapping behavior, migration conflicts, company isolation, duplicate stock
effects, and build/runtime errors. Do not deploy, migrate a remote database, or
enable the production preview.

## Result and boundaries

- B4 commit `2abfa9e`, A2 commit `b6cb919`, and A4 retry commit `a6bebe7` are
  all ancestors of this branch. Git merged their shared sales and inventory
  files without text conflicts. The A2 result-identity checks run before B4
  callbacks or audit persistence; repeated mapped modifiers are combined.
- The A4 screen retains an operation ID while a configuration, count, or stock
  movement has an uncertain outcome. A successful server response followed by
  a failed screen refresh keeps the same ID for retry. Its parent now reports
  refresh failure to the screen. The existing inventory service test proves
  that replaying one operation ID does not change stock twice.
- B4 migration `0012_tough_rage.sql` is unchanged. It adds company-scoped
  occurrence and correction records; the existing compatibility test checks
  preservation of legacy and durable-event rows. No new migration was created
  during this integration.
- The active integration tree has one exact inventory route, one D1 management
  service, one D1 consumption port, and the published B1 decision at
  `docs/decisions/0003-m4-sales-ingestion.md`. No alternate A4 implementation or
  duplicate `0002` decision was added to the active tree.

## Older-branch overlap audit

- `origin/workstream-b/b1-event-contract` contains an earlier B1 decision at
  `0002-m4-sales-ingestion.md`. The accepted `0003` decision on this branch
  revises its A2 handoff: it uses the published port's actual request/results,
  confirmed occurrence times, and current held-reason names. The older B1 file
  is superseded and must not be copied into this branch.
- `origin/review/a4-local-overlap-20260922` is a parallel A2/A4 implementation
  based before the current A4 migrations and B4 sales cutover. It duplicates
  configuration, count, recipe, modifier, consumption, route, and screen work
  with different APIs and an older preview gate. The current A4 service and
  contract tests cover those active behaviors, and B4 uses the current port.
  Merging the older branch would create two competing inventory paths.
- That parallel branch also has a read-only `legacyM3Review` report that compares
  legacy stock and recipes with their backfilled copies. The current preview
  identifies legacy recipes needing reviewed replacement but does not provide
  the same changed-since-backfill report. Keep the older commit reachable until
  A5 either adopts this report or proves an equivalent reconciliation before
  switching legacy authority. This is a distinct follow-up, not a reason to
  merge the duplicate services.
- Neither older branch was merged into the active tree. Their commits remain
  available through the archive tags below.

## Branch cleanup on 2026-09-23

- The exact older A4 commit `1d8a887` is retained at the local annotated tag
  `archive/a4-parallel-20260922`. The exact older B1 commit `f656692` is retained
  at `archive/b1-original-20260919`. Both tags were checked against their source
  commits before removing any local branch name.
- The obsolete local `review/a4-local-overlap-20260922` branch name was removed.
  The local M0, M1, and M2 milestone branch names were also removed after Git
  confirmed each was already contained in `main`. Active A2, A4, B4, and
  integration branch names remain available.
- Both archive tags and the overlap-review commits were pushed to GitHub. Git
  confirmed that each tag points to its original commit before the remote
  `review/a4-local-overlap-20260922` and `workstream-b/b1-event-contract` branch
  names were deleted. The active A2, A4, B4, integration, and `main` branches
  were not deleted; `main` was not changed.

## Verification

- PASS: focused B4 sales/inventory, A2 ingestion contract, and A4 inventory
  management tests.
- PASS: full `node scripts/test.mjs` (18 suites), `pnpm typecheck`,
  `pnpm db:check` (13 ordered migrations), and `pnpm build`.
- PASS: migration `0012` applied to the local D1 database; `pnpm test:local`
  exercised local sign-in, company creation, catalog, tenant isolation, and
  sign-out. The exact preview itself was not visually exercised in this run.
- PASS: integration diff whitespace check. No remote D1, hosted CI, sandbox
  provider, deployment, supplier, or production action occurred.
- PASS on 2026-09-23 after the branch audit: `pnpm typecheck`, `pnpm test` (18
  suites), `pnpm db:check` (13 migrations), `pnpm build`,
  `pnpm db:migrate:local` (nothing pending), and `pnpm test:local`. The first
  test run could not launch esbuild inside the Windows sandbox; the approved
  rerun passed. The smoke test used only a fictional local company.

Rollback is to stop using this integration branch. The source branches and
`main` remain available, and no migration was applied outside the local test
database. Before a merge to `main`, resolve the legacy-backfill review gap,
obtain the workstream owners' review, and verify hosted CI. M2 acceptance remains
a separate gate for M3/M4 acceptance.

## Merge-readiness follow-up — 2026-09-23

- A5 commit `60f79b0` adds only a read-only, company-scoped older-data report
  and manager screen. Its fictional pre-`0009` fixture proves unchanged and
  changed stock/recipe flags, missing exact review, company isolation, and no
  writes. An owner walkthrough of the screen remains pending; A5/M3 is not
  accepted.
- B4 follow-up commit `809b226` limits employee sales responses to state and
  occurrence time, omits legacy import/register references, and denies
  individual event history. Fictional secret-looking values in the route test
  do not appear in employee responses; owner/manager review data remains.
- The combined local branch passed `pnpm typecheck`, `pnpm test` (19 suites),
  `pnpm db:check` (13 migrations), `pnpm build`, `pnpm db:migrate:local` (nothing
  pending), `pnpm test:local`, and `git diff --check`. The smoke test left a
  fictional company in local D1. Migration `0012` remains additive; its
  compatibility test proves prior inventory, sales, and event rows unchanged.
- The owner accepted the development-provider authentication walkthrough but
  chose to keep C1/M2 provisional until the intended Cloudflare build passes.
  An owner-only code/migration review, the A5 screen walkthrough, hosted
  Ubuntu/Windows CI, and the Cloudflare build remain merge gates. No
  independent technical review, branch push, remote migration, or deployment
  is claimed by this follow-up.
