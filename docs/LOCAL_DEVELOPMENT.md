# Local development

Use Node **22.23.2** (`.node-version`) and **pnpm 11.25.0** (`packageManager`).
Install Node from the official [Node downloads](https://nodejs.org/en/download),
then run `npm install --global pnpm@11.25.0`. Commands below work in PowerShell
and POSIX shells. If PowerShell blocks the pnpm script, use `pnpm.cmd`.

## Setup and run

```text
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm local:setup
pnpm db:migrate:local
pnpm dev
```

Open <http://127.0.0.1:5173/signin-with-chatgpt> to use the local fixture
`seedy@sites.test`; this does not contact ChatGPT or Supabase. Create a company
in the dialog. Its initial catalog contains clearly labeled fictional products.
No production database or external-service credentials are needed.

The Vite development middleware removes incoming identity headers and creates a
short-lived signed assertion only for loopback requests. The signing key exists
only in the development compilation. Keep the server bound to `127.0.0.1` and
never use this fixture with live data.

Ordinary `/auth` authentication uses Supabase. Follow [M2 setup](M2_SETUP.md)
before testing real email sign-in, confirmation, or recovery. A successful local
build does not make the application ready for public deployment.

## Local data and variables

`wrangler.local.jsonc` uses a placeholder D1 identifier. Every database command
above explicitly uses `--local`; the repository has no remote migration command.
Vite and Wrangler share `.wrangler/state`. Do not edit an existing migration;
generate an additive migration with `pnpm db:generate`.

`pnpm local:setup` creates ignored `.env.local` and `.dev.vars` files. Rerunning
it preserves existing values and appends variables newly added to `.env.example`.
It generates `AUTH_ENCRYPTION_KEY` only when that variable is absent. Existing
keys, including deliberately empty values, are never replaced. Integration
secrets remain empty and Clover defaults to its sandbox environment.

Stop the development server before resetting fictional local data:

```text
pnpm db:reset:local --confirm-local-reset
```

The reset removes only this checkout's `.wrangler/state/v3/d1` data and reapplies
the migrations. It does not delete variables, dependencies, or remote data.

## Verification

```text
pnpm typecheck
pnpm test
pnpm db:check
pnpm test:focused inventory-sales register-bridge
pnpm build
pnpm test:local
```

The integration suites use local SQLite and mocked providers. They do not prove
that Supabase email, Clover, Stripe, a supplier, or a scheduler works. The HTTP
smoke test starts its own loopback server and checks anonymous/forged-header
rejection, fixture sign-in, company creation, catalog access, company isolation,
membership access, CSRF rejection, and sign-out. Run `pnpm db:migrate:local`
first. The smoke test leaves fictional data in local D1.

`pnpm db:check` validates migration order, snapshots, generated schema, and the
result of applying all migrations to fresh SQLite. It uses temporary copies and
does not modify source migrations or local D1 data. GitHub Actions runs the same
pipeline on Ubuntu and Windows.

`pnpm build` creates `dist/`. `pnpm start` previews that Worker locally without
the development sign-in fixture; use `pnpm dev` for fixture-based development.
Neither command deploys the application.

## Recovery

If D1 reports a missing table, stop the server and rerun
`pnpm db:migrate:local`. If dependencies are missing, rerun the frozen install
without deleting the lockfile. If port 5173 is occupied, stop the old server or
use `pnpm dev --port 5174`; Supabase testing on another origin also requires a
matching `APP_ORIGIN` and allowed callback URL.

For a clean local database, use only the reset command above. Preserve any local
data you need before changing migrations or checking out older code.

Reference: [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/).
