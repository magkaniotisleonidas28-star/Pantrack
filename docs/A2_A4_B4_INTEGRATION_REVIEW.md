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
- The older `review/a4-local-overlap-20260922` branch is preserved as a separate
  parallel implementation. It has conflicting versions of the exact screen,
  inventory route, consumption service, and status notes. It must be reviewed
  for unique behavior rather than merged wholesale. The older B1 branch adds
  `0002-m4-sales-ingestion.md`, while main already has decision
  `0002-m3-quantity-and-recipe-model.md`; its decision numbering must be
  reconciled before publication.

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

Rollback is to stop using this integration branch. The source branches and
`main` remain available, and no migration was applied outside the local test
database. Before a merge to `main`, review the two preserved overlap branches,
obtain the workstream owners' review, and verify hosted CI. M2 acceptance remains
a separate gate for M3/M4 acceptance.
