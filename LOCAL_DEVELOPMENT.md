# Local development

Use Node **22.23.2** (`.node-version`) and **pnpm 11.25.0** (`packageManager`).
Install Node from the official [Node downloads](https://nodejs.org/en/download),
then run `npm install --global pnpm@11.25.0`. Commands below work in PowerShell
and POSIX shells. If PowerShell blocks the pnpm script, use `pnpm.cmd`.

This Windows checkout also has a verified Node download and pnpm installed under
ignored `.sites-runtime/tools`. To use those tools without changing your system
installation or PowerShell execution policy, run this from the repository root
in each new PowerShell session, then use `pnpm.cmd` for the commands below:

```powershell
$env:Path = "$PWD\.sites-runtime\tools\node-v22.23.2-win-x64;$PWD\.sites-runtime\tools\pnpm\node_modules\.bin;$env:Path"
```

Clean clones should install the prerequisites above; local tools are not committed.

## Setup and run

```text
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm local:setup
pnpm db:migrate:local
pnpm dev
```

Open <http://127.0.0.1:5173/signin-with-chatgpt> to use the
existing local fixture `seedy@sites.test`; this does not contact ChatGPT.
Create a company in the dialog. The catalog contains clearly marked fictional
products. No production database, Cloudflare login, POS account, payment account,
or supplier credentials are needed.

The Vite development middleware strips incoming identity headers and adds the
fixed fixture identity only for a signed-in request from a loopback socket with
a loopback Host. Its cookie is HttpOnly and SameSite=Lax. The fixture runs only
inside Vite's development server and is absent from production Worker output.
Keep this server bound to `127.0.0.1`; never use the fixture with live data.

Production authentication now requires verified Supabase sessions. An
independent deployment must complete the M2 real-provider verification and review in `docs/M2_SETUP.md` before it
is exposed to users. Building locally does not make that deployment ready.

## Local data and variables

`wrangler.local.jsonc` uses a placeholder D1 ID. Every database command above
explicitly uses `--local`; there is no remote migration or deployment script.
Vite and Wrangler share `.wrangler/state`. SQL migrations in `drizzle/` are
applied in filename order by Wrangler. Do not edit existing migrations.

`pnpm local:setup` creates ignored `.env.local` and `.dev.vars`, preserving existing
values. Rerunning it appends missing variables to `.dev.vars`, including a new
authentication encryption key only when that variable is absent. Existing keys,
including deliberately empty values, are never replaced. Variable names come
from `.env.example`; integration secrets remain empty
and Clover defaults to sandbox. Wrangler uses `.dev.vars` for Worker bindings.
Only configure sandbox credentials when the corresponding milestone is ready.
Purchases and automatic mode are blocked pending supplier and pilot validation.

Stop the dev server before resetting fictional local data:

```text
pnpm db:reset:local --confirm-local-reset
```

This removes only this checkout's `.wrangler/state/v3/d1` and reapplies migrations.
It does not delete `.env.local`, `.dev.vars`, dependencies, or any remote data.
Dependencies, tool caches, local databases and secrets are ignored by Git.

## Verification

```text
pnpm typecheck
pnpm test
pnpm db:check
pnpm test:focused inventory-sales register-bridge
pnpm build
pnpm test:local
```

The integration tests run against in-memory SQLite and mocked providers. They
are not proof of real Clover, Stripe, or supplier connectivity. The local smoke
test starts and stops its own server, checks the home page, rejects forged
identity headers and anonymous requests, creates a fictional company, and checks
company isolation. Run `db:migrate:local` first. It leaves the fictional company
in local D1. Browser visual and accessibility acceptance is a separate task.

`pnpm db:check` checks migration history and schema drift in a temporary directory,
then applies all migrations to fresh SQLite. It does not change your local data.
Pull requests run the same checks on Windows and Ubuntu; see CONTRIBUTING.md.

`pnpm build` creates `dist/`. `pnpm start` previews that Worker locally, but it
does not include the development sign-in fixture; use `pnpm dev` for local work.
No command here deploys or changes the hosted site.

## Recovery

If D1 reports a missing table, stop the server and rerun `pnpm db:migrate:local`.
If dependencies are missing, rerun the frozen install without deleting the
lockfile. If port 5173 is busy, stop your old server or use `pnpm dev --port 5174`.
For a clean migration check, reset only disposable local data as described above.
Revert the milestone commit to roll back application changes; preserve any local
database you need before applying migrations from a different branch.

Reference: [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/).

## M2 authentication

Use `/auth` for Supabase email sign-in after configuring the ignored local variables and email templates in [M2_SETUP.md](docs/M2_SETUP.md). The loopback fixture remains accessible at `/signin-with-chatgpt`; it now signs a short-lived dev assertion, and production builds contain no fixture key. The ordinary UI signs out through `/auth/signout`; fixture users can explicitly clear their dev cookie at `/signout-with-chatgpt`. Existing hosted identities are not automatically linked to Supabase users.
