# Pantrack agent instructions

These instructions apply to every AI-assisted change in this repository. Keep
this file concise; detailed workflow and prompt templates live in
[`docs/AI_DEVELOPMENT.md`](docs/AI_DEVELOPMENT.md).

## Start every task

1. Read `docs/CURRENT_STATUS.md` and the relevant section of
   `docs/PANTRACK_MILESTONES.md`.
2. Identify one workstream checklist item (for example `A2`, `B4`, or `C1`) and
   one reviewable outcome. Do not implement a whole milestone in one task.
3. Read only the decision, setup, integration guide, and source files relevant
   to that outcome. Inspect the current code and tests before proposing changes.
4. Check `git status` and preserve all existing work. When contributors are
   active concurrently, use the worktree/branch and file-ownership rules in the
   milestone roadmap.
5. Restate the task contract: objective, relevant context, constraints, and
   observable completion criteria. Surface any external decision or credential
   dependency without asking for secrets.

## Implementation rules

- Keep company data isolated and enforce authorization on the server. Add
  anonymous, wrong-company, and forbidden-role tests for new API behavior.
- Treat external receipt, retry, scheduling, and purchasing as idempotent and
  auditable. Hold unknown mappings or outcomes for review.
- Keep supplier submission and automatic purchasing disabled until their
  roadmap gates have recorded evidence. Never deploy, change production data,
  contact a live integration, or place an order unless the task explicitly
  authorizes that exact action.
- Never expose or commit secrets, tokens, payment details, or customer data.
- Make schema changes through new migrations. Never rewrite a used migration.
  Only one schema-bearing change may use the migration merge queue at a time.
- Prefer a focused module and focused test over unrelated refactoring. Identify
  handoffs before changing another workstream's files, self-review the diff, and
  verify affected contracts. Coordinate shared-file merges; a second person's
  development review is not a completion gate.
- A mocked-provider pass proves local behavior only. Keep local, sandbox, pilot,
  and production evidence clearly separated.

## Verification

Use the smallest focused check during iteration, then run the checks required by
the task's risk and the milestone definition of done. The normal complete local
pipeline is:

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
```

For documentation-only edits, at minimum run `git diff --check` and verify every
changed relative link. For schema changes, review the SQL, snapshot, journal,
fresh-database result, compatibility behavior, and rollback/forward-repair plan.
Do not claim a check passed unless it ran successfully in the current worktree.

Before finishing, inspect the full diff for scope creep, secrets, missing
authorization, unsafe external effects, and misleading completion claims.

## Handoff

Report:

- workstream step and outcome;
- files and behavior changed;
- migrations, contracts, and downstream handoffs;
- commands run and their results;
- acceptance criteria proved locally, separately from external evidence;
- blockers, risks, rollback, and the next unblocked checklist item.

Update milestone checkboxes only when the required evidence exists. If the same
AI mistake recurs, add a short durable prevention rule here and keep examples or
long procedures in `docs/AI_DEVELOPMENT.md`.
