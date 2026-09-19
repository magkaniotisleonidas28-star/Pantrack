# Contributing to Pantrack

Read the [current status](docs/CURRENT_STATUS.md), [milestone roadmap](docs/PANTRACK_MILESTONES.md), [AI-driven development playbook](docs/AI_DEVELOPMENT.md), and [local development guide](docs/LOCAL_DEVELOPMENT.md) before changing the application. AI-assisted work also follows the root [agent instructions](AGENTS.md). Prototype code is not evidence of working live integrations. Local development and CI use synthetic data and require no production secrets.

## Setup and checks

Use Node **22.23.2** and pnpm **11.25.0**. Install the committed dependency graph with `pnpm install --frozen-lockfile`. Follow the local development guide to create the local database and development identity.

Before requesting review, run:

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
node scripts/local-smoke.mjs
```

Use `pnpm test:focused <test-name>` for a specific existing test. The full test command remains the required review check. Tests use temporary/local SQLite and mocked external services; passing tests do not prove that a real POS, supplier, payment account, or scheduler has been configured.

The GitHub workflow runs these checks on Ubuntu and Windows. It caches only the pnpm package store, keyed by operating system, pinned tool versions, lockfile, and workspace policy. It does not cache local databases, environment files, or build output. No CI step deploys the app or contacts a live business integration. Enabling required checks and branch protection in the GitHub repository is a repository-owner action.

## Branches, commits, and review

- Keep `main` as the only long-lived branch. A solo contributor may work there
  directly if that remains the repository owner's preference. When two or more
  contributors or AI sessions work concurrently, use separate worktrees and
  short-lived workstream branches, then merge reviewed green changes and delete
  those branches. Follow the file ownership and migration queue in the roadmap.
- Scope each AI session to one A/B/C checklist item and one reviewable outcome.
  Record objective, context, constraints, completion conditions, verification,
  and handoff using the AI development playbook.
- Keep commits focused and use an imperative summary such as `Add migration drift checks`.
- Keep unrelated design changes separate from authentication, integration, and schema work.
- Record scope, schema and security impact, verification evidence, and rollback notes in the commit or accompanying documentation. Use the pull-request template if a pull request is explicitly requested.
- Change milestone checkboxes only when evidence supports completion. Record blocked external decisions, credentials, pilot activity, and service setup explicitly.
- Review the diff and run relevant checks before committing to `main`. Passing CI does not authorize deployment, production data changes, real supplier orders, or automatic purchasing.

Record decisions affecting architecture, security, or data compatibility in `docs/decisions/NNNN-title.md` using the roadmap's decision template. Preserve existing work in the checkout.

## Migrations

1. Change the schema in `src/db/schema.ts`.
2. Run `pnpm db:generate`.
3. Review the new SQL, snapshot, and `drizzle/meta/_journal.json` together. Include all three in the commit.
4. Run `pnpm db:check`, the relevant tests, and the documented local migration command.

Never edit, rename, or delete a migration that has been used in a deployed environment. Add a new migration for a repair. Review data conversions and constraints before applying them to an existing database. Recovery may require a new forward migration or a verified backup restore; reverting application code does not reverse database writes.

`pnpm db:check` validates journal order, migration/snapshot correspondence, and snapshot ancestry. It runs Drizzle generation against a temporary copy of the migration directory and fails if generation changes it. It also applies every migration in journal order to a fresh in-memory SQLite database and checks the resulting tables, columns, defaults, keys, and indexes against the latest snapshot. The source migrations and local database are never modified by this check.

The migration-check tests deliberately omit a journal entry, introduce unapplied schema changes, and change valid migration SQL to verify detection. TypeScript errors fail `pnpm typecheck`; failed assertions fail `pnpm test`; schema drift or unapplied/generated migrations fail `pnpm db:check`. CI stops on nonzero exit status.

## Data and security conventions

Every company-owned query and mutation must enforce company scope and server-side authorization. Test anonymous requests, wrong-company access, and forbidden roles for new API families. Test concurrency, idempotency, retries, and unknown outcomes for sales, jobs, and purchases. Preserve inventory and security audit history.

Never commit `.env` files, local databases, credentials, payment details, customer data, dependency directories, or generated secrets. Add variable names and descriptions to `.env.example` using dummy values only. Keep quantities decimal-safe, money exact, and unit conversions explicit. Hold unknown mappings and ambiguous supplier responses for review, and keep automatic ordering disabled until the roadmap's acceptance gates are met.
