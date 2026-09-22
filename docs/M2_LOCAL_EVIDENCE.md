# M2 implementation evidence

Date: 2026-09-18. Scope: local source, mocked provider responses, local SQLite/D1 and a loopback dev server. No deployment or real Supabase account/email acceptance is claimed.

Implemented: server-verified Supabase identity; encrypted, revocable opaque sessions; confirmation/recovery/signout screens; centralized permissions; company-specific roles; seven-day single-use invitations; owner membership management; recipient-confirmed ownership transfer; audit history; strict Origin checks; employee read-only views; manager operational views; configured integration callback origins.

Local validation:

- TypeScript type check passed.
- All seven test suites passed, including the new M2 suite.
- Nine ordered migrations match the Drizzle schema and apply to SQLite; deliberate migration drift tests pass.
- Production Worker build passed.
- All nine migrations applied successfully to the local Cloudflare D1 emulator.
- Loopback HTTP smoke passed for the four new account/invitation pages, anonymous/forged-header rejection, fixture sign-in, company creation, catalog access, membership data, cross-company rejection, CSRF rejection and sign-out.

M2 suite exercises all current company API families, machine-route credential separation, exact-origin CSRF checks, per-company roles, employee order redaction, manager pause, owner-only integration/finance actions, token hashing/encryption, invitation expiration/revocation/replacement/incorrect email/replay/concurrent acceptance, ownership reauthentication/recipient acceptance/replay/last-owner guards, session rotation/expiration/logout/provider rejection and recovery isolation/revocation. Existing Clover tests cover OAuth state and replay. Existing purchasing tests continue proving that real supplier submission remains blocked.

Update, 2026-09-19: the implementation is on `main`, and current hosted Ubuntu
and Windows repository CI passed. The separate Cloudflare Workers build failed.

Pending external evidence: configured Supabase email templates and callback
URLs, a real confirmation/login/recovery walkthrough, resolution of the
Cloudflare build, and product-owner review of the migration/authentication flow.
Legacy hosted identities require a separately reviewed mapping before migrating
existing hosted data. M2 is therefore not yet accepted for independent deployment.

Later partial development-provider results are recorded separately in
[M2 development auth evidence](M2_DEV_AUTH_EVIDENCE.md). The results do not
change the local-only scope of the checks above or accept M2.
