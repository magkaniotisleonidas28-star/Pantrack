# C2 desktop synchronization and local startup — 2026-10-22

## Task contract

Update the desktop checkout to current GitHub `main`, verify the complete local
pipeline, and investigate the existing startup failure. Preserve existing local
configuration, stock/history and private C4 evidence. This is one C2 local
readiness outcome; it does not accept another milestone or authorize a release.

The checkout started clean at `ec59dc2`, 26 commits behind `origin/main`.
`git fetch origin` and `git pull --ff-only` advanced it to `7a516ea` without
conflicts. The pinned tools are Node 22.23.2 and pnpm 11.25.0. A frozen install
passed without dependency or lockfile changes.

## Startup finding and repair

The initial six-command run passed type checking, tests, migration consistency,
build and local migration application. Its HTTP smoke failed after the unchanged
120-second readiness deadline: the home page never became available. A separate
180-second diagnostic also failed to start. The subsequent module trace reached
Cloudflare's Worker export inspection, with very slow module loading; one small
virtual entry took about 42 seconds to transform. Dependency optimizer hashes
were reported as consistent in that trace.

The [Vite configuration](../vite.config.ts) now excludes this checkout's
`.sites-runtime`, `.wrangler`, `.vinext` and `work` directories from development
file watching. These contain generated state, private tool/cache files and other
checkouts. Source files and root configuration remain watched; the existing
Seatbelt polling configuration and loopback binding remain in place.

After that change, the ordinary, unmodified `pnpm test:local` passed in about
27 seconds. No timeout was increased, database reset performed, cache directory
deleted, dependency upgraded or credential replaced. Vite performed its ordinary
configuration-change dependency optimization. This establishes the recorded
local repair; it does not explain the earlier October 13 internal runner error
or constitute a clean-cache reliability matrix.

A separate real Vite watcher check found 122 watched directories, with none
under the four excluded roots. A private generated-file write published no
reload. A temporary source module was transformed, edited and observed through
the actual watcher and a published client reload. The temporary source module
was removed before the final pipeline.

## Verification on the final configuration

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; locked dependencies unchanged. |
| `pnpm typecheck` | Passed after the watcher change. |
| `pnpm test` | Passed: 98 executed suites and ten explicit Windows skips, 108 runner invocations. |
| `pnpm db:check` | Passed: 35 ordered migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | Passed. |
| `pnpm db:migrate:local` | Passed: no pending local migrations and no schema change. |
| `pnpm test:local` | Passed again in the final pipeline, in about 48 seconds. |

Both full test runs invoked 108 suites: 98 executed successfully and ten
explicitly skipped on Windows. The skips cover POSIX/macOS browser-maintenance
behavior requiring file modes, symlinks, directory fsync or `python3`. They are
not Windows verification of those behaviors. Local providers remain mocked;
this task does not run the complete C4 browser/model acceptance gate.

The HTTP smoke checks home/auth pages, anonymous and forged-header rejection,
local fixture sign-in, company creation/catalog access, wrong-company rejection,
CSRF, owner membership access, default-off purchasing APIs and sign-out. Each
successful smoke adds a fictional company to local D1.

Private logs, command timestamps/exit codes, diagnostic reports and watcher
evidence are retained in `.sites-runtime/c2-local-readiness-20261022/`. Earlier
failed runs are retained separately from successful checks. The sandbox refused
the first package-manager child process; the authorized local checks then ran
outside that restriction. This is desktop evidence, not a new GitHub CI pass.
`git diff --check` and all 268 relative file links across the five updated
documents passed; roadmap milestone checkboxes are unchanged.

## Preservation, contracts and handoff

Before checks, both root D1 SQLite databases were backed up through SQLite's
backup API into the ignored task directory. Both passed integrity checks.
The initial post-failure comparison preserved existing business rows and all
configuration hashes; only Cloudflare's `_cf_METADATA` bookkeeping changed.
The final comparison again preserved every existing business row and all
configuration hashes; both databases passed integrity checks. The two successful
smokes added two fictional companies, two memberships, 24 sample products and
four security-audit rows. The only changed pre-existing row is Cloudflare's
`_cf_METADATA` bookkeeping. Temporary source probes and test servers were removed
or stopped; no local development server is left running.

The final configuration's SHA-256 is
`27821e75ef5524b051fb3babddbf0db504f48b876a63c22ab6ccae28999e1cd0`.

There is no new migration, schema, application API or inventory/sales contract.
The 35 existing local migrations remain separate from the hosted database's
last recorded 24-entry ledger. Hosted code/database inspection was not refreshed
by this task. There was no deployment, remote migration, live integration test,
paid model call, historical C4 cleanup or supplier purchase.

The next C2 outcome is development-release preparation: refresh hosted release
facts, review the complete pending upgrade, backup/recovery and coordinated
runtime rollout, then obtain authorization for that specific development release.
A8/M7, C3–C5/M8, Toast access, pilot and production acceptance remain open.

Rollback removes only the watcher exclusion change and its documentation.
Retain local databases, variable files, private evidence and consumed C4 attempts.
Reverting this repair can reintroduce the desktop startup slowdown; it does not
require rolling back any database migration. Future C4 acceptance must bind to
its actual source; this local pass creates no paid execution allowance.
