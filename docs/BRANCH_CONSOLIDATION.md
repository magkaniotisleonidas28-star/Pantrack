# Branch consolidation — 2026-09-19

The repository owner requested a single `main` branch. Review used main commit
`b8d5ab8` and the following remote branch tips:

| Branch | Tip | Disposition |
| --- | --- | --- |
| `milestone/m0-local-baseline` | `0a6986e` | Already an ancestor of main; no unique changes to merge. |
| `milestone/m1-repository-ci` | `703e5e4` | Already an ancestor of main; no unique changes to merge. |
| `milestone/m2-supabase-auth` | `849552b` | Retain setup improvements; preserve main's newer authentication implementation. |

M2's missing-variable upgrade for `.dev.vars` is adapted to main's `APP_ORIGIN`
and `AUTH_ENCRYPTION_KEY` settings. Existing values, including empty keys, remain
unchanged. Its smoke-test setup step is also retained.

Main already implements Supabase sign-in, confirmation, recovery, sign-out,
company invitations, roles and auditing. Its opaque revocable sessions,
verified-email checks, restricted recovery sessions, atomic invitation acceptance,
and recipient-confirmed ownership transfers supersede the branch's initial
implementation. The branch's conflicting migration 0008, raw provider-token
cookies, fixture flag, old auth routes and configuration names are not imported.
The merge retains the original M2 commit as an ancestor, keeping all reviewed
code and historical hosting notes recoverable after branch deletion.

Validation also found a pre-existing stylesheet import broken by the move into
`src/`; its relative path is corrected. Contribution and roadmap instructions
now reflect the owner's main-only workflow.

Validation: pinned Node 22.23.2 and pnpm 11.25.0, frozen dependency installation,
TypeScript, all seven test suites, migration drift checks, production build,
local database migrations, and the local HTTP smoke test passed. An isolated setup check covered fresh
creation, upgrades, preserved values and blank keys, CRLF/export assignments,
and repeat-run idempotence.
