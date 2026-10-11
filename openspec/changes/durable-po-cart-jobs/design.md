# Design

## Context

C4 migration 0028 saves exact permission, quantity commitments and cap exposure.
The separate file-backed browser preview is not this job consumer.

## Decisions

- One immutable job binding per authorization. Reuse reservations, never duplicate them.
- Persist cart ownership by company/supplier/account, excluding delivery location and
  connection version. Keep the cart row and monotonic fence after safe release.
- Manager enqueue/read/cancel uses the default-off 127.0.0.1 preview gate and current
  owner/manager membership; UUID receipts bind operation input and actor.
- Internal workers use a configured worker identity, server time and 60-second leases.
  Claims, heartbeats, attempts and results require current fenced ownership. All have
  replay identities. Lease expiry cannot be revived by a historical receipt.
- Reuse current authorization/source predicates in the final transaction. First
  attempt and permission start commit together before the fake provider call.
- Each line is attempted at most once. Results must match the complete frozen line;
  a mismatch/uncertainty requires review. Ready requires all exact results and valid
  sources. Purchase stays not_confirmed and delivery stays outstanding.
- Expired leases with no attempts return the same job to queued. Any attempt means
  review_needed with ownership and exposure retained; no automated replay/session.
- Authorization invalidation/cancellation cascades atomically to jobs. Safe cancellation
  releases only never-started work. Started cancellation stops work and retains holds.
- Worker protocol is internal only. Future transport authentication and actual browser
  safety are separate outcomes; database fencing cannot undo an external action.

## Migration and Rollback

Add 0029 without rewriting 0000–0028. Verify SQL/snapshot/journal, Wrangler splitting,
fresh D1 and populated upgrades. Disable preview to roll back access; retain records,
locks and unresolved reservations. Repair schema only through a later migration.
