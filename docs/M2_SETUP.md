# M2 setup and review

Implementation is on `main`. Repository CI passes. The older Cloudflare
Workers build failed; the owner reports that another contributor replaced it
with a working build and accepts that build step, without a run or commit
record available here. This is not independent verification or deployment
evidence. The development Supabase walkthrough was accepted by the owner;
authentication-flow and migration review still block C1/M2 acceptance. Do not
use production company data to test this change.

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
