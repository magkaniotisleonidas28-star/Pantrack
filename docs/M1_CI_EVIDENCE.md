# M1 repository quality and CI evidence

Date: 2026-09-18. Branch: `milestone/m1-repository-ci`, stacked on M0 commit
`0a6986e`. M0 review: https://github.com/magkaniotisleonidas28-star/Pantrack/pull/1.

## Implementation

The GitHub workflow checks pull requests on Windows and Ubuntu with Node 22.23.2
and pnpm 11.25.0. It installs the frozen dependency graph, type-checks, runs the
test suites, checks migrations, builds production output, applies local D1
migrations and runs the HTTP smoke test. It requires no integration credentials
and never deploys. Only the package store is cached. Contributor instructions and
a PR template cover scope, migrations, security, validation and rollback.

The migration checker validates the journal/snapshot chain and applies all eight
migrations to empty SQLite. It compares the resulting schema to the snapshot and
runs Drizzle generation into a temporary migration copy to detect missing changes.
Drizzle 0.31.10 incorrectly reads absolute output paths on Windows and can report
that error with exit status zero. The checker uses a relative temporary output
path and requires explicit successful completion so that error cannot pass CI.

## Local acceptance evidence

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed after all intentional failure fixtures were removed. |
| `pnpm test` | All six suites passed. |
| `pnpm db:check` | Eight migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | Passed. |
| `pnpm db:migrate:local` | Repeat is a no-op after M0 fresh application. |
| `pnpm test:local` | Passed during M0 for the unchanged application and smoke script. Hosted CI repeats it per PR. |
| Deliberate source type error | Injected a temporary wrong assignment; the real TypeScript command returned nonzero with TS2322. Fixture removed. |
| Deliberate failing test | Injected a temporary assertion failure; the real test runner returned nonzero. Fixture removed. |
| Missing generated migration | A temporary schema change is rejected by the migration checker; source migrations remain untouched. |
| Missing journal/SQL mismatch | Dedicated tests reject missing journal entries and a SQL column absent from the snapshot. |

## Hosted acceptance and rollback

Hosted workflow results are pending the M1 pull request. The criterion "CI passes
on the baseline main branch" remains open until the reviewed branches are merged
and an actual main-branch run succeeds. Local success is not claimed as hosted
CI evidence. Ubuntu execution is also pending that workflow run.

No schema or application behavior changes are made in M1. Revert its commit to
remove the CI/checking changes. Neither rollback nor merging authorizes deployment,
production credentials, purchases, or bypassing the M2-M12 prerequisites.
