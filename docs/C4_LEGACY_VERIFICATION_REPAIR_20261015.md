# C4 legacy shutdown verification repair — 2026-10-15

## Outcome and boundaries

This is a source-only C4 repair following the
[stopped legacy cleanup](C4_LEGACY_PROFILE_CLEANUP_20261015.md). The reviewable
outcome is reliable distinction between observed process exit and incomplete
executable evidence, with a precise retained reason for future verification
failures. The exact transient reason for the previous stop remains unknown.

No existing browser is signaled, restarted or adopted. No worker lock is
archived, reclaimed or deleted; no historical invocation is retried or resumed.
There is no browser investigation, acceptance gate, supplier access, paid
inference, purchasing, deployment, power-setting change, migration or public API
change. **C4/M8 remain open and the original cart timeout remains unresolved.**

## Changed behavior

The [verification helper](../scripts/po-cart-worker/legacy-profile-verification.mjs)
collects identity snapshots before and after reading executable/start-time
metadata. A pure reconciliation function checks both snapshots against the
captured processes. It preserves the existing array return contract for the
[legacy cleanup module](../scripts/po-cart-worker/legacy-profile-cleanup.mjs).

A captured process absent from the final successful identity snapshot can be
recorded as exited. A process still present without matching executable evidence
blocks further signals. Missing or malformed final evidence never proves exit.
Changed identities, PID reuse, group/parent ambiguity and new descendants or
profile references block cleanup, including observations that disappear before
the final read. Signal authorization still requires fresh captured identity,
executable and exact-profile matches. Existing task-owned cleanup is unchanged.

The [dedicated CLI](../scripts/po-cart-legacy-profile-cleanup.mjs) now writes each
stage before performing its operation. Sanitized private observations retain
numeric IDs, identity hashes, known profile keys and executable hashes. Named
failure categories carry the phase, relevant PID, expected/observed identity
hashes and observation reference when available. Commands, executable paths,
arbitrary exception messages and secrets are excluded from those reports.

An exclusive attempt report prevents competing launchers from overwriting one
another. It does not consume the maintenance invocation: `task.json` still follows
successful preparation, validation, preservation snapshots and ownership guards.
The first failure remains primary when guard release also fails. Evidence-write
failures stop execution; separate exclusive fallback reports preserve available
failures when normal report updates fail. If the filesystem cannot write either
report, persistence cannot be guaranteed and execution still fails closed.

The old fixed root and its consumed invocation are unchanged. This repair adds
no root override, resume option, execution allowance or fresh cleanup runner.
A later cleanup task must explicitly scope and freshly verify its own targets.

## Verification and preservation

The [new regression suite](../tests/po-cart-legacy-verification.mjs) uses simulated
processes and temporary report roots. It exercises split-snapshot exits,
incomplete metadata, PID reuse, disappearing new members, privacy, signal and
timeout failures, interruption, exact failure references, competing launchers,
consumption refusal and evidence-write fallback. Existing cleanup and preservation
regressions passed. Seven focused suites passed: `po-cart-legacy-verification`,
`po-cart-legacy-profile-cleanup`, `po-cart-profile-preflight`,
`po-cart-preview-cleanup`, `po-cart-display-on-investigation`,
`po-cart-full-offline-gate` and `po-cart-second-addition-compatibility`.

All six preparation commands passed in this worktree:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **98 suites** |
| `pnpm db:check` | Passed, 35 ordered migrations and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no pending local migrations |
| `pnpm test:local` | Passed, ordinary fictional loopback HTTP smoke |

The final preparation used **558 source files**, SHA-256
`b9d84d43c1d8a5a72f05985c15d70201f9de213e9d3e0c780ebc7fc03d531df9`.
No real cleanup execution, process signal, worker-lock action, browser job or
acceptance gate ran. This proves the tested local behavior and reporting contract;
it does not prove a real browser shutdown or establish the earlier stop's cause.

Private source, evidence/cart/database/budget/consumption baselines, preparation
logs and preservation audits live under
`.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/`.
This evidence protects historical artifacts and business state. It makes no claim
that the remaining live browser caches are frozen or that an idle baseline exists.
The earlier seventeen-file failure and the partial cleanup's failed profile audit
remain retained without reinterpretation.

The independent preservation audit passed for **16,678 protected evidence files**,
all **494 historical carts**, **37,336 baseline business rows** across six local
databases, budget fingerprints and consumed records. Preparation smoke added
**16 ordinary fictional rows** and changed one bookkeeping row state; no served-cart
rows or browser jobs were added. Reserved exposure remains **$0.921518**.
All **46 worker locks** retain their bytes, inode, modification time and mode;
no reclamation guard was added or removed. All **18 remaining profile processes**
retain their observed identities and membership.

The final read-only preservation preflight remains **blocked: 18 processes and
two live lock references**. The older cleanup report's three live lock references
are retained as its historical observation. Current lock disposition must use
fresh evidence. The consumed maintenance record is unchanged; no new cleanup
invocation or fresh idle baseline exists. Inherited source outside the four
declared files and every milestone checkbox remain unchanged.

## Rollback and handoff

Use this task's private `rollback-manifest.json` to restore only the four declared
source/documentation files and remove only the three new files. Preserve all
runtime evidence, historical consumed records, carts, holds and budgets. Rollback
must not reopen browsers, restore or reclaim worker locks, or replay cleanup.

The next dependency is a separately scoped disposition of freshly verified
remaining resources. An idle preservation preflight and stable fresh baseline
must precede a separately scoped complete offline gate. Changed source invalidates
earlier source fingerprints; this repair supplies no browser or external acceptance.
