# M2 setup and review

Implementation is on `main`. The new development D1 database has all current
migrations, but no hosted Worker has been verified after the broken Cloudflare
deployment and integration were removed. Public deployment remains blocked on
the remaining M2 acceptance work. Do not use production company data to test
this change.

## Local prerequisites

Run the usual locked dependency install, `pnpm local:setup`, and `pnpm db:migrate:local`. The setup command creates ignored variable files, appends newly introduced variables to an existing `.dev.vars`, and generates a local authentication-encryption key only when that variable is absent. It never replaces an existing value. The loopback fixture is still available at `/signin-with-chatgpt`; ordinary `/auth` uses Supabase.

For real authentication testing, configure these variables in ignored `.dev.vars`:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `http://127.0.0.1:5173` (use this exact host in the browser) |
| `SUPABASE_URL` | Your development project's `https://PROJECT.supabase.co` URL |
| `SUPABASE_PUBLISHABLE_KEY` | Its publishable key, or legacy anon key; never a service-role key |
| `AUTH_ENCRYPTION_KEY` | An independent random 32-byte key, encoded as 64 hex characters |

Keep the encryption key stable to retain current sessions. Replacing it invalidates existing sessions. `pnpm local:setup` generates a suitable local key for a new setup. Store production variables using the eventual Worker's secrets/configuration, after review. No production credentials are required for automated tests.

## Supabase dashboard configuration

1. Enable Email/password authentication and email confirmation in a development project. Disable anonymous sign-in. Require passwords of at least 12 characters with at least one special character, matching Pantrack's new-password validation.
2. Set Site URL to `http://127.0.0.1:5173`. Allow the exact local `/auth/callback` URL. Add the localhost variant only if testing that origin, with a matching `APP_ORIGIN`.
3. In the confirmation email template, use:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup">Confirm email</a>
   ```

4. In the recovery email template, use:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
   ```

These templates are required: the application expects server-side token-hash verification, not access tokens in the callback fragment. The callback page asks the user to continue before consuming the link. Single-use links are verified by Supabase. Real email delivery is governed by your project's mail configuration and rate limits.

## Review checklist with a configured development project

- Create two real test accounts; confirm emails; verify unconfirmed login is rejected.
- Sign in, create a company, sign out, and verify replay of the old cookie fails.
- Have the owner invite the second account as employee. Open the link, sign in in another tab with the matching verified email, then accept in the invitation tab. Verify expiry, revocation, replacement, wrong-email rejection and replay.
- Change the second member to manager; verify operations are available and integration/financial controls remain forbidden. Switch among two companies with different roles.
- Confirm both users' passwords and transfer ownership; verify the previous owner becomes manager immediately. Test a canceled offer and an expired offer.
- Request recovery, follow the email, change password, and confirm other Pantrack sessions are revoked. Verify an expired session requires signing in again.
- Review security history as owner and confirm secrets are absent.

The automated suite covers these security rules with mocked Supabase responses and a real local SQLite engine. This dashboard/email walkthrough remains required evidence and is only partially complete; see [development auth evidence](M2_DEV_AUTH_EVIDENCE.md).

## Migration review

Inspect `0008_m2_auth_memberships.sql`, its snapshot and journal, especially invitation and ownership triggers. It is additive, preserves existing company data and prevents removing the last owner. Review the identity-mapping requirement in `decisions/0001-m2-authentication.md` before moving any existing hosted data. App rollback alone does not undo D1 migration state.

### Development D1 trigger-migration recovery

On 2026-09-23, `wrangler d1 migrations apply --remote` applied `0000`–`0007` to the new development D1 database, then failed on `0008` with `incomplete input: SQLITE_ERROR`. The same migration passed local SQLite and local Wrangler D1. The remote failure is consistent with [Cloudflare's reported `/query` trigger parser issue](https://github.com/cloudflare/workers-sdk/issues/15690). The failed migration left no `0008` tables or triggers. The unchanged SQL for `0008`–`0011` then applied successfully through `wrangler d1 execute --remote --file`, which uses D1's file import path. Each import included its `d1_migrations` entry as its last statement. A final remote `wrangler d1 migrations list` reported no pending migrations. **Do not rerun these imports on the current development database.**

For another fresh **development** database with the same failure, first check `d1_migrations` and `sqlite_master` to confirm which migration is pending and that it left no partial objects. After `0000`–`0007` are applied, import `0008` through `0011` one at a time, in order. For each migration, create a temporary copy of its original SQL with its ledger entry as the last statement. For example, for `0008`:

```sh
migration=0008_m2_auth_memberships.sql
repair_dir=$(mktemp -d)
cat "drizzle/$migration" > "$repair_dir/$migration"
printf "\nINSERT INTO d1_migrations(name) VALUES ('%s');\n" "$migration" >> "$repair_dir/$migration"
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --remote --config wrangler.jsonc --file "$repair_dir/$migration" &&
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --remote --config wrangler.jsonc --command "SELECT name FROM d1_migrations WHERE name='$migration';" &&
rm -r "$repair_dir"
```

Repeat with `0009_clammy_doctor_octopus.sql`, `0010_aromatic_the_initiative.sql`, and `0011_slimy_vargas.sql`. Stop if any command fails; confirm each name appears exactly once in `d1_migrations` before continuing. End with `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config wrangler.jsonc`; it should report no pending migrations. Never change the committed migration SQL or insert a ledger entry without its schema import. If an import fails, inspect the remote ledger and schema before retrying; Cloudflare says a failed file import restores the database to its prior state.

## Commands

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
```

`tests/m2-security.mjs` is the focused security suite. The dev HTTP smoke uses fictional company data and the signed local fixture. CI automatically discovers the suite through `scripts/test.mjs`; the current `main` workflow passed on Ubuntu and Windows.
