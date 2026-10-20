# C4 remaining browser maintenance — 2026-10-15

## Contract

This bounded C4 task follows the [verification repair](C4_LEGACY_VERIFICATION_REPAIR_20261015.md).
Its single permitted attempt closes only the two historical test Chrome instances
rooted at 30082 and 30474, archives the verified stale worker lock containing
4303, and requires an independently verified idle, stable profile baseline.
All eighteen recorded identities must match before consumption. PID 4303 must
remain absent and must never receive a signal. The already-closed instance rooted
at 30060 is excluded. The original maintenance invocation remains consumed.

The earlier seventeen-file preservation failure and partial cleanup audit remain
unchanged. **C4/M8 remain open; the original timeout and prior verification stop's
causes remain unresolved.** There is no browser investigation, acceptance gate,
paid inference, supplier access, purchase, deployment, power-setting change,
public API change or migration in this task.

## Implementation

The [new CLI](../scripts/po-cart-remaining-profile-cleanup.mjs) accepts no arguments,
overrides or resume. Its sole private root is
`.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015/`.
The [policy module](../scripts/po-cart-worker/remaining-profile-cleanup.mjs) binds
the two profiles and eighteen identities to hashed historical evidence, and binds
the stale lock to its retained pre-repair metadata. The original CLI and fixed
three-instance policy are preserved.

The shared cleanup primitives accept an explicitly validated historical target
set. Bracketed observations reject PID-4303 reappearance in either process read
or executable metadata, including a transient appearance. All process signals
are individual and freshly verified. Leaders receive SIGTERM sequentially, with
at most five seconds for captured members to exit; verified surviving captured
members alone may receive SIGKILL, followed by at most five more seconds.
Unknown members, PID reuse, incomplete evidence, interruption and ownership
changes stop the attempt without repair, retry or restart.

Three exclusive task-owned guards protect the two browser profiles and stale-lock
profile. The stale lock can be archived only after both instances are verified
gone and its bytes, inode, hash, mode and modification time still match. Exclusive
hard-link creation followed by verified unlink preserves those attributes and
cannot overwrite an existing archive. Any refusal during archival retains partial
evidence; only task-owned guards are released. Profile directories and all other
worker locks are preserved.

The [independent auditor](../scripts/po-cart-worker/remaining-profile-audit.py)
checks actual processes and lock metadata separately from runner claims, then
checks historical evidence, carts, business rows, budgets, consumed records and
all worker locks. It requires the existing preservation preflight to report idle,
and two complete matching profile fingerprints separated by at least five seconds
after the first finishes, with idle checks before, between and afterward. Changes
are allowed only within the two closed profiles and removal of the archived lock.
The already-closed profile receives no exception. Only passing independent audits
permit publication of `fresh-baseline.json`.

## Verification and outcome

The [simulated-process suite](../tests/po-cart-remaining-profile-cleanup.mjs)
covers the two-instance boundary, excluded first instance, missing targets,
executable/identity changes, PID reuse, transient descendants, incomplete reads,
interruption, bounded escalation, guard ownership, PID-4303 reappearance,
archival races, concurrent invocation refusal, precise primary failure references
and independent rejection of false success, non-idle checks and unstable profiles.
Eight focused suites passed: `po-cart-remaining-profile-cleanup`,
`po-cart-legacy-profile-cleanup`, `po-cart-legacy-verification`,
`po-cart-profile-preflight`, `po-cart-preview-cleanup`,
`po-cart-display-on-investigation`, `po-cart-full-offline-gate` and
`po-cart-second-addition-compatibility`.

All six preparation commands passed in this worktree on unchanged source:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **99 suites** |
| `pnpm db:check` | Passed, 35 ordered migrations and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no pending local migrations |
| `pnpm test:local` | Passed, ordinary fictional loopback HTTP smoke |

Preparation and execution used **562 source files**, SHA-256
`227675452bf0512ca28e8bf08c66dc8d39b7024c793f106bb97bbfb9c3e2f01c`.
Private source/evidence/cart/database/lock baselines, preparation logs and the
single attempt's report are retained in the fixed task root above.

The sole attempt consumed its invocation at `2026-10-15T22:27:21.397Z` and sent
**SIGTERM only to PID 30082** at `2026-10-15T22:27:21.675Z`.
During the next bracketed shutdown observation, captured helper **PID 30095**
changed identity. The runner stopped with named category `identity_changed`,
phase `reconciliation`, and precise reference `observations/000006.json`.
The report retains both expected and observed identity hashes. No SIGKILL, signal
to 30474 or 4303, lock archival, browser restart or retry followed.
**Maintenance is blocked and incomplete; no fresh baseline was published.**

Read-only verification afterward confirms all nine processes of the first target
are gone, while the nine original processes rooted at 30474 remain. PID 4303 is
still absent, the stale lock is unchanged, and all three task-created guards are
cleared. The preservation preflight remains `historical_profiles_active` with
nine processes and one live lock reference. Source remains identical to the
preparation fingerprint. The identity-change evidence establishes the refusal
condition; its underlying cause remains unresolved.

Independent read-only preservation checks passed for **16,798 protected evidence
files**, **494 historical carts**, **37,352 baseline business rows** across six
local databases, budget fingerprints and historical consumed records. All **46
worker locks** retain their bytes, inode, modification time and mode. Preparation
smoke added **16 ordinary fictional rows** and changed one bookkeeping row state;
no served-cart rows or browser jobs were added. Reserved exposure remains
**$0.921518**. The historical seventeen-file failure and previous partial cleanup
audit retain their original bytes and failed statuses.

The post-stop profile comparison found **43 changed entries** relative to the
pre-cleanup fingerprint: 39 in the stopped 30082 profile and four in the still-live
30474 profile. Relative to pre-preparation, it found 47 entries: 41 and six
respectively. No other profile changed, including the already-closed 30060
profile, and the stale lock is unchanged. Changes in the live profile cannot be
accepted as shutdown evidence; **shutdown-only preservation and idle stability
remain unproved**. The private corrected partial summary records that limit and
retains its initial interpretation separately. It never changes the primary
runner report or permits baseline publication.

`git diff --check`, new-file whitespace checks, all **226 relative file/section
links** across the three task documents and unchanged milestone-checkbox checks
passed. No existing milestone checkbox was advanced.

## Rollback and handoff

The private `rollback-manifest.json` restores only this task's four declared
existing files and removes only its five new files. Preserve all runtime evidence,
historical carts/holds, budgets and consumed records. Rollback must never reopen
browsers, restore the archived lock or replay maintenance. The next checklist item
after successful cleanup would be a separately scoped complete offline gate under
C4. That gate remains blocked. The next unblocked task is a separately scoped
read-only review of the retained identity-change observation and disposition of
the remaining instance/lock; neither consumed maintenance invocation may be
retried. This maintenance supplies no browser or external acceptance evidence.
