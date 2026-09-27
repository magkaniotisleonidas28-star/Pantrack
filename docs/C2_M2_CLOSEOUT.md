# C2 — M2 development evidence closeout (2026-09-26)

**Checklist outcome:** record the M2 review and evidence, run the complete local
pipeline, and make the development gate and its limits explicit. This closes C2
for **development coordination**. It is not independent security certification,
production acceptance, or permission to move existing customer identities.

## Owner report and review record

On 2026-09-23 the owner accepted the development Supabase walkthrough and
directed C1/M2 to be treated as complete. The owner subsequently reported that
the additive authentication migration and authentication flow had been reviewed.
This paragraph records that report; no separate owner-authored findings, signed
review, or review method were supplied. The earlier replacement Cloudflare build
was also owner-attested without a run link or commit. The later deployed
development Worker and its fictional walkthrough have direct, separate evidence
in [the hosted C2 record](C2_HOSTED_DEV_EVIDENCE.md).

On 2026-09-26, the C2 agent inspected `drizzle/0008_m2_auth_memberships.sql`,
its snapshot and journal entry, `src/lib/auth.ts`, `src/app/api/auth/route.ts`,
`src/lib/authorization.ts`, the M2 decision and setup notes, and the M2 security
suite. Migration `0008` adds authentication, invitation, transfer, and audit
structures plus six invariant triggers; it does not rewrite existing companies
or memberships. Its last-owner, invitation, and transfer rules are exercised by
the local suite. The new Supabase identity is verified on the server, company
roles come from D1, sessions are revocable and encrypted, and browser mutations
require the matching origin. Recovery cannot access company data and revokes
other Pantrack sessions when the password changes. Existing hosted identities
are **not** automatically mapped to Supabase users: moving any customer data
still requires the separately reviewed identity mapping in
[the M2 decision](decisions/0001-m2-authentication.md).

This inspection found no C2 acceptance defect in those paths. It does not
replace a dedicated independent security review or prove provider behavior that
the local tests mock.

## Verification in the isolated C2 worktree

- TypeScript `tsc --noEmit`: passed.
- Focused `scripts/test.mjs m2-security`: passed; Supabase responses were mocked.
- Full `scripts/test.mjs`: passed, 29 suites.
- `scripts/check-migrations.mjs`: passed, 18 ordered migrations matched the
  schema and applied to a fresh SQLite database.
- `scripts/run-framework.mjs build`: passed.
- Wrangler D1 migration apply with `--local`: passed all 18 migrations on a fresh
  isolated local database. No remote D1 was changed.
- `scripts/local-smoke.mjs`: passed local home page, anonymous and forged-header
  rejection, fixture sign-in, company creation, catalog, tenant isolation, and
  sign-out. It left only fictional data in the isolated local D1.
- Read-only requests to the current `pantrack-dev` Worker returned `200` for `/`
  and `/auth`, and `401` for anonymous `/api/companies`.

The earlier [hosted C2 walkthrough](C2_HOSTED_DEV_EVIDENCE.md) separately
records development D1 `0012`, Worker deployment, hosted sign-in, fictional
inventory consumption, held-sale safety, and duplicate protection. The B7
record later documents development D1 through `0015`; this C2 task made no
remote migration, deployment, secret, or account change.

## Limits and recovery

The hosted signup and recovery email callbacks, hosted wrong-company and
forbidden-role requests, and an independent security review were not run in
this closeout. The development-provider signup/recovery walkthrough is
owner-observed in [M2 development auth evidence](M2_DEV_AUTH_EVIDENCE.md); it
used the loopback application, not the hosted Worker. These hosted and release
checks remain follow-up work and must not be inferred from the mocked local
suite or the read-only Worker responses.

Migration `0008` is already in development D1 history. Never edit or reapply a
used migration. For a failed future development trigger apply, inspect the
ledger and schema before using [the documented forward-recovery procedure](M2_SETUP.md#development-d1-trigger-migration-recovery).
Worker rollback does not undo D1. Preserve the disabled exact-inventory preview
and keep production data out of this environment.

**Handoff:** M2's owner-accepted development gate is documented for A and B;
their work had already advanced through A5/M3 and B5/M4. C3 is the next C
checklist item. This record does not open a production or pilot gate.
