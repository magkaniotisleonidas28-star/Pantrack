# M2 development authentication evidence — partial

Date: 2026-09-22. Scope: user-reported walkthrough against a development
Supabase project, Resend SMTP, the loopback application, and local D1. This is
not independent agent verification, hosted-Worker evidence, or production
acceptance. No credentials, email links, or customer data are recorded here.

## Observed in the development walkthrough

- A test account received a confirmation email, followed its Pantrack
  `/auth/callback` link, and showed an email-confirmation timestamp in Supabase.
- After local D1 migrations and the dev binding were aligned, a test account
  signed in and reached the application with a Pantrack session.
- The signed-in account created a fictional company and appeared as its owner.
  Sign-out blocked access to that workspace; signing in again restored access
  to the same company with the owner role.
- The contributor subsequently reported that the full basic recovery sequence
  succeeded: recovery email and callback, new password, rejection of the old
  password, sign-in with the new password, and retention of the company.
- A second test account accepted a single-use company invitation as an
  employee and saw the employee read-only workspace. This is UI walkthrough
  evidence, not a direct server-side forbidden-action check.
- After refreshing the owner's membership panel, the accepted invitation and
  employee membership appeared and the owner promoted that member to manager.
- The promoted manager loaded the operational workspace, changed and restored
  a fictional sample product, and did not see owner-only payment, register, or
  membership controls. A direct manager request to the company's payments API
  returned a permission denial. This does not prove every owner-only endpoint.
- The same account created a second fictional company and switched between its
  owner role there and its manager role in the original company. Owner-only UI
  appeared only for the company where that account was owner.

The contributor reported these results during the C1 walkthrough. The
repository's mocked-provider tests remain separate [local implementation
evidence](M2_LOCAL_EVIDENCE.md). This report does not prove cookie replay
rejection, revocation of another concurrent session after recovery, hosted
deployment, or any behavior not listed above.

## Password-policy feedback — implemented locally; provider retest pending

Supabase rejected an initial signup with HTTP 422 because its configured
password policy required a special character. Pantrack now states and validates
the 12-character-plus-special-character rule for signup and recovery on both
the client and server. Focused mocked-provider coverage verifies rejected and
accepted new passwords while ordinary sign-in continues to accept an existing
password without applying the new-password rule. This is local implementation
evidence only; re-test signup and recovery against the development provider.

## Open finding: membership panel freshness

The owner's already-open membership panel continued to display the invitation
as pending after it was accepted in another browser. A full page refresh loaded
the accepted invitation and membership correctly. Add a visible refresh action
or another safe freshness mechanism so owners do not mistake stale client state
for an invitation failure and create unnecessary replacement links.

## Still required for C1 acceptance

Complete the remaining [real-provider walkthrough](M2_SETUP.md), including
unconfirmed-login rejection, session replay/expiry, concurrent-session
revocation after recovery, invitation replacement/revocation/expiry/replay,
remaining forbidden-role checks, ownership transfer, and security history.
Review the authentication flow and additive migration, and resolve the
Cloudflare Worker build. Keep local, development-provider, and deployed
evidence separate; do not mark C1 or M2 accepted yet.
