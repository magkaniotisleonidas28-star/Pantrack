# Sign-in screens — local evidence

Recorded: 2026-11-18. Branch: `workstream-c/signin-screens`, based on `main`
at `ac8de80`. The owner asked to work on the sign-in screens, reviewed an
uncommitted local preview the same day, and approved it ("yes looks good").
This is **local evidence only**: nothing was deployed, no hosted service was
used, and the browser checks answered every sign-in request with a local fake,
so the real sign-in provider was never contacted.

## What was wrong

- Signing in took two screens: the signed-out home page only had a "Sign in
  with email" button leading to the form at `/auth`.
- The home page described Pantrack as a "purchasing workspace" and spoke only
  of orders; it did not mention stock, recipes or waste.
- The form page used a different logo from the home page. Its switch links
  looked like plain text, and "Back to Pantrack" led to the button-only page.
- Errors and "check your email" replies were small grey text.
- The invitation page had no logo, and its instructions and button ran
  together.

## Changed behavior

- **One frame for every signed-out screen:** a new
  [shell](../src/app/auth/auth-shell.tsx) with its own
  [styles](../src/app/auth/auth.css) puts a short description of Pantrack on a
  green panel beside one focused card on wider screens. Phones show the logo,
  the card and the pilot note. The logo matches the workspace header (icon and
  gold full stop).
- **Sign in on the first screen:** the signed-out [home page](../src/app/page.tsx)
  now shows the sign-in form directly. `/auth`, `/auth/callback`,
  `/auth/signout` and `/invite` use the same frame.
- **Form** ([auth form](../src/app/auth/auth-form.tsx)):
  - "Sign in" and "Create account" tabs, with "Forgot password?" under the
    password box;
  - a show/hide password button;
  - a live checklist of the two password rules when choosing a password;
  - red error and green success boxes (`role="alert"` and `role="status"`);
  - a "Check your email" screen after creating an account or asking for a
    reset. It keeps the existing privacy wording ("If … can be used"), so it
    never says whether an address has an account;
  - plainer titles and buttons: "Reset your password", "Choose a new password",
    "Confirm your email" with "Confirm and continue", and "Sign out of
    Pantrack?" with "Stay signed in";
  - after a password reset, the page opens `/auth?updated=1` and shows
    "Password updated. Sign in with your new password." until the next action.
    Previously that message was lost in the redirect.
- **Invitation page** ([invite](../src/app/invite/page.tsx)): two numbered
  steps (sign in with the invited email in a new tab, then accept here), a red
  error box, and a fallback message when the server gives no error text.
- **Password rules** ([policy](../src/lib/password-policy.ts)): the symbol
  rule is exported as `hasPasswordSpecialCharacter` for the checklist;
  `isValidNewPassword` behaves exactly as before.
- **Smoke check:** [local smoke](../scripts/local-smoke.mjs) now asserts that
  the signed-out home page contains the email and password fields.

Unchanged: `/api/auth` and `/api/members`, the request bodies the screens
send, the "return to" safety check, the password rules, sessions, and every
authorization rule. No schema change.

## Verification

The complete local pipeline passed in this worktree on 2026-11-18 with the
changes staged on base `ac8de80`: `pnpm typecheck`, `pnpm test` (182 suites),
`pnpm db:check` (53 ordered migrations, none added), `pnpm build`,
`pnpm db:migrate:local`, `pnpm test:local` (including the new home-page form
check) and `pnpm a8:check:browser`. In the changed files, ESLint reports 0
errors and 2 warnings, both for the existing full-page `location.assign`
redirects that `main` already had; `main` had 3 errors and 2 warnings in the same
files. Prettier is clean on the changed files, and `git diff --check` is clean.

A local Playwright script (Chromium, run from outside the repository) checked
the screens with every `/api/auth` request answered by the script itself:
- the show-password button reveals the typed text;
- signing in returns to a safe `?next=` destination (`/?company=abc`);
- a weak new password is stopped in the browser with no request sent;
- the "Password updated" notice appears for `?updated=1` and clears after the
  next action;
- the email and password fields have labels;
- no page errors occurred;
- `/`, `/auth`, `/auth/callback`, `/auth/signout` and `/invite` have no
  sideways scrolling at 390 px and 1280 px wide.

Screenshots of every state (sign in, wrong password, create account, check
your email, reset, password updated, confirm, sign out, invitation) at desktop
and phone widths were reviewed before and after the change.

## Not covered

- The hosted site and real accounts. A real sign-in, sign-up, reset email and
  invitation acceptance against the hosted sign-in provider have not been
  tried with these screens.
- Dark mode: the signed-out screens stay light by design (`color-scheme:
  light`).
