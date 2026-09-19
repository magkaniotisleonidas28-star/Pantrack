# M2: Supabase identity, Cloudflare application and company permissions

Status: product decisions approved by the product owner in the implementation conversation on 2026-09-18. Implementation added locally; real-project acceptance and deployment review remain pending.

## Decision

Supabase manages email/password credentials, email confirmation and recovery. Cloudflare Workers runs the application and D1 owns company membership, invitations, session revocation and security history. Supabase is not the company-data database. A user can join multiple companies, with a separate owner, manager or employee role in each.

The approved action matrix is in `docs/MILESTONE_READINESS.md`. `lib/authorization.ts` enforces it for the existing company API families. The members service applies the same owner policy, with explicit exceptions for accepting one's own invitation or ownership offer. Clover's callback verifies its single-use state, signed-in user and current owner membership. Register ingestion and scheduler ticks use separate company-scoped bearer credentials; browser sessions do not authorize these machine routes.

## Implementation details

- The server verifies each Supabase access token through `/auth/v1/user`; arbitrary hosting headers, browser-supplied user IDs/roles and unconfirmed accounts are rejected.
- Browser cookies contain a random 256-bit opaque session identifier. D1 stores its SHA-256 hash and an AES-GCM encrypted provider token. HTTPS cookies use `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`. Local HTTP uses a separate cookie name.
- Sessions last at most one hour and no longer than the provider's returned token lifetime. Refresh tokens are not retained; expired sessions require signing in again. Provider rejection or outage denies company access. Logout revokes D1 state even during a provider outage. Password recovery revokes all of the user's Pantrack sessions before changing the password.
- Recovery sessions can change the password but cannot access company APIs. Email-link verification is a user-confirmed POST, not an automatic GET mutation. Use the email templates in `M2_SETUP.md`.
- JSON browser mutations require an exact matching Origin, and cross-site Fetch Metadata is rejected. All company responses are private/no-store. Redirect destinations are local; tokens are not stored in browser localStorage.
- Invitations are bound to a normalized verified email, company and manager/employee role, expire in exactly seven days, and are single-use. Owners copy a link and share it privately; automated invitation email delivery is not implemented. The raw random token is returned once; only its hash is stored. The link keeps the token in the URL fragment, outside server logs/referrers. Reissuing revokes earlier invitations for that email in the company. Existing members cannot use an invitation to change their role. An inviter must still be an owner at acceptance.
- Only an existing verified member may receive ownership. The current owner reauthenticates within five minutes and creates an offer; the recipient also reauthenticates within five minutes and explicitly accepts. Offers expire after 24 hours and can be canceled or replaced. A database trigger atomically promotes the recipient, demotes the previous owner to manager, cancels other offers and revokes the previous owner's unused invitations. Ordinary role/invitation APIs cannot grant owner status or remove/demote an owner. Last-owner triggers provide database-level protection.
- Membership changes and invitation creation/revocation are batched with audit entries. Invitation and ownership acceptance create audit records in the same database statement via triggers. Integration/configuration operations record an attempt before side effects and a success/failure outcome afterwards. Audit payloads contain actor/action/target identifiers, never passwords, invitation tokens or integration credentials.

The one-hour session cap, five-minute reauthentication window, 24-hour ownership offer window and copy-link invitation delivery are implementation defaults, recorded here separately from the explicitly approved seven-day invitation policy.

## Migration and compatibility

Migration `0008_m2_auth_memberships.sql` adds five tables and six invariant triggers; it does not rewrite company data or map legacy identities. Old hosting identity IDs must never be linked to Supabase accounts by matching a client-provided email. Before migrating existing hosted customer data, prepare and review an explicit identity mapping with independently verified account ownership. Without that mapping, the new provider's users will not inherit old workspaces. No such production migration has been performed.

Local development retains the loopback fixture. Its middleware signs a short-lived assertion with a random process key; the application only accepts it in the dev compilation. Production builds contain no fixture verification key. The old headers alone are never sufficient. This fixture does not exercise real Supabase email or password flows.

## References

- [Supabase Auth REST contract](https://github.com/supabase/auth/blob/master/openapi.yaml)
- [Supabase password and recovery flows](https://supabase.com/docs/guides/auth/passwords)
- [Supabase session semantics](https://supabase.com/docs/guides/auth/sessions)
- [Supabase sign-out semantics](https://supabase.com/docs/guides/auth/signout)

Local D1 revocation is necessary because provider access tokens may remain valid until expiry after a provider logout.
