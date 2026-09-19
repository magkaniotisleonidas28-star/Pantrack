# M0 local baseline evidence

Date: 2026-09-18. Branch: `milestone/m0-local-baseline`.

## Changes

- Pinned Node 22.23.2 and retained pnpm 11.25.0. Installed official Node under
  ignored checkout-local tools after verifying the release SHA-256 checksum.
- Installed dependencies with the frozen lockfile. Added the existing locked
  esbuild version as a direct test dependency instead of importing pnpm internals.
- Added local D1 migration/reset commands, empty local-variable setup, a sequential
  test runner, HTTP smoke test, and exact setup instructions in
  [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).
- Kept the existing loopback-only development identity fixture and tested its
  host/socket checks, forged-header removal, cookies, origin guards and redirects.
- Blocked supplier order submission and automatic policy activation until supplier
  and reviewed-pilot validation. Tested API/direct/scheduled attempts and legacy
  saved automatic policies. Review-only proposal creation still works.
- Ignored local databases and Worker variables; included the credential-free
  `.env.example`, which the previous ignore rule excluded from source control.

## Executed checks

| Command/check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; 627 packages installed using pnpm 11.25.0. |
| `pnpm local:setup` | Created ignored local variables with empty integration secrets and sandbox Clover environment. |
| `pnpm db:migrate:local` | All eight existing migrations applied to new local D1. A repeat reported no migrations to apply. |
| `pnpm typecheck` | Passed. |
| `pnpm test:focused clover-connection inventory-sales register-bridge local-auth purchasing-safety` | All five suites passed against local SQLite and mocked external services. |
| `pnpm build` | Passed for all application routes. |
| `pnpm test:local` | Real HTTP checks passed: home page, anonymous/forged-header rejection, local sign-in, company creation/catalog, wrong-company rejection and sign-out. |
| `git diff --check` | Passed. |
| Ignore checks | `.env.local`, `.dev.vars`, `.wrangler/state`, `node_modules`, `.sites-runtime` are ignored. |
| High-signal credential scan | No private-key/live-token patterns found in tracked or proposed files. Local test credentials are synthetic. |

The HTTP smoke test leaves a fictional company in local D1. No production data
was imported, no production service was modified, and no deployment or purchase
was performed. The source has no exported production database or configured live
secrets. Pattern scanning is supporting evidence, not a complete security audit.

## Limits and rollback

At the time of M0, production identity still relied on the original trusted
hosting headers. M2 has since replaced that path on `main`; its real-provider
acceptance remains open. Clover and supplier tests use mocks and do not satisfy
sandbox/pilot milestones. Browser visual QA remains separate.

This milestone adds no schema migration and changes no existing migration. Revert
the milestone commit to undo source changes. Stop the dev server before the
documented local reset; the reset never targets remote D1. Reverting the purchasing
gate would restore the prototype's unsafe purchasing path and should not be used
to bypass the supplier/pilot acceptance process.
