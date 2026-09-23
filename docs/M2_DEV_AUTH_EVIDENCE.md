# M2 development authentication evidence — hosted acceptance pending

Dates: 2026-09-22 to 2026-09-23. Scope: user-reported walkthrough against a development
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

## Password-policy feedback and provider retest

Supabase rejected an initial signup with HTTP 422 because its configured
password policy required a special character. Pantrack now states and validates
the 12-character-plus-special-character rule for signup and recovery on both
the client and server. Focused mocked-provider coverage verifies rejected and
accepted new passwords while ordinary sign-in continues to accept an existing
password without applying the new-password rule. On 2026-09-23 the owner
reported that the development-provider signup and recovery screens displayed
the rule and rejected both tested noncompliant password patterns. No passwords
were recorded.

## Additional owner-observed walkthrough — 2026-09-23

- An unconfirmed test account was kept out of the company workspace. Email
  confirmation then allowed sign-in. The same fictional company and owner role
  remained after sign-out and a later sign-in.
- A second test account accepted an invitation link in a separate browser
  profile and saw employee read-only access. The owner promoted that account
  to manager; manager editing of fictional sample data worked, and owner-only
  controls remained absent. The account then owned a different fictional
  company, with controls following the selected company's role.
- A transfer offer was accepted by the second account. The recipient became
  owner; the original owner became manager and lost owner-only controls after
  refresh. The owner reported the transfer behavior worked.
- Recovery rejected the two noncompliant password patterns, accepted a
  compliant replacement, rejected the old password afterward, and preserved
  the account's company memberships. A separate pre-existing session of the
  same account was signed out after recovery and required a new sign-in.
- Security history visibly listed company creation, invitation creation and
  acceptance, role change, and ownership offer and acceptance. The owner
  reported no secret material in the reviewed display. Both accounts' final
  sign-out checks returned them to sign-in for protected pages.

These are user-observed development-provider results, not independent security
verification. The owner reviewed the manual findings and found them acceptable.
No addresses, links, tokens, cookies, passwords, or customer information are
included in this record.

## Accepted limitation: membership panel freshness

The owner's already-open membership panel continued to display the invitation
as pending after it was accepted in another browser. A full page refresh loaded
the accepted invitation and membership correctly. Add a visible refresh action
or another safe freshness mechanism so owners do not mistake stale client state
for an invitation failure and create unnecessary replacement links. The owner
accepted this observed limitation for the development walkthrough; the UI
improvement remains future work.

## Remaining C1 gate

On 2026-09-23 the owner reported that another contributor replaced the failed
Cloudflare setup with a working build and explicitly accepted the build step as
complete. No successful run link, branch, or commit was available to record.
This is owner-attested build acceptance, not an independently verified build or
a deployment claim. Authentication-flow and additive migration review remain
to be recorded before C1/M2 acceptance. Deterministic invitation replay,
expiry, replacement, ownership edge cases, wrong-company access, and
server-side role permissions are covered by the local automated suite rather
than repeated manually. No hosted deployment or production acceptance is
claimed, and the C1/M2 checkboxes remain open.
