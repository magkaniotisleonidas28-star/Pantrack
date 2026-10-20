# C4 historical shutdown review and disposition plan — 2026-10-16

This read-only C4 review follows the [successful real-Chrome lifecycle matrix](C4_BROWSER_LIFECYCLE_VALIDATION_20261015.md).
Its reviewable outcome is an evidence comparison, refreshed historical ownership
checks and a bounded plan for the remaining browser and stale lock. It changes
documentation only. **C4/M8 remain open; historical causes remain unresolved.**

No browser was launched, connected to, adopted, closed or signaled. No profile or
lock was modified by this review, guarded, archived or reclaimed; no invocation was consumed.
There were no application, API, schema, migration, supplier, paid-model,
purchasing, deployment or power-setting changes. Private read-only collection and
analysis artifacts are retained at
`.sites-runtime/po-cart-workers/historical-shutdown-review-task-20261016/`.

## Evidence findings

| Retained event | What the evidence establishes | Remaining limit |
| --- | --- | --- |
| [First legacy cleanup](C4_LEGACY_PROFILE_CLEANUP_20261015.md), SIGTERM to 30060 | One signal, blocked report, later absence of its nine captured members | No refusing observation/category was retained; the transient stop cannot be reconstructed |
| [Remaining-profile cleanup](C4_REMAINING_PROFILE_CLEANUP_20261015.md), helper 30095 | Changed command-derived identity, unchanged parent/group, missing profile reference, absent metadata and final-read absence after SIGTERM to 30082 | Transition-time start/command hashes were not retained; the precise process-instance cause is unestablished |
| [First isolated diagnostic](C4_SHUTDOWN_OBSERVATION_DIAGNOSIS_20261015.md) | Retained unchanged start times with command/executable/zombie transitions | Its overstrong diagnostic label was already repaired; the original blocked report stays unchanged |
| [Earlier disposable matrix](C4_SHUTDOWN_OBSERVATION_MATRIX_20261015.md), `protocol-0-2` | Startup baseline refusal after seven completed cases | Rejected startup population was not retained; subsequent passes cannot explain it |
| [Collected version-two validation](C4_BROWSER_LIFECYCLE_VALIDATION_20261015.md) | Twelve completed cases, four signature cases, passing independent audits | Does not establish an earlier cart-timeout, maintenance-refusal or preservation-failure cause |

The exact historical helper reference is
`.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015/observations/000006.json`,
SHA-256 `5d0f4586905663ec15f5437a8c8c286212fc6fd555ba53888382141797fe8f9e`.
PID 30095's captured identity is
`e71604313e8d59b8856d2ff853072b9cabef9cb660c8d639266426045da2bd96`;
the first read records
`a66fd6e3072031b979b31d4ebf362ae4c2b571ecfbee333e36eb98ad625bf085`.
Its parent/group remain 30082, its profile field is null, it is not marked zombie,
and it is absent from executable metadata and the final complete identity read.
The captured baseline's start time is available, but the changed sample's start
time and separate command hash are not. The identity hashes include both start
text and command text. They cannot distinguish those components retrospectively.
Final-read absence proves absence in that read; missing metadata alone does not.
Neither PID reuse nor a harmless text-only transition is established here.

The new matrix preserves separate start and command hashes. Its four signature
cases are `protocol-0-1`, `protocol-0-2`, `protocol-10-1` and `protocol-10-2`, each
at `cases/<id>/observation-0002.json` under the validation root. Independent
analysis confirms the defined helper signature and continued observation to
complete absence. No historical sample was filled in with these newer fields.

The same collected observations retain the unchanged strict verifier's verdict:
`identity_changed` in those four cases **and `protocol-50-2`**, also at
`observation-0002.json`. The refusing PIDs are respectively 78977, 79271, 79569,
79865 and 80427. Thus five cases contain a strict-verifier refusal, while only
four meet the narrower signature definition. Their separate start evidence is
unchanged. The diagnostic shutdown analysis has no blocking failure and all five
cases subsequently reach complete absence. Zero signature does not imply zero
shutdown-text transition.

## Source assessment

The [legacy reconciliation helper](../scripts/po-cart-worker/legacy-profile-verification.mjs)
checks a changed identity, topology or zombie state before accepting a process's
absence from the final read. The [maintenance wait loop](../scripts/po-cart-worker/legacy-profile-cleanup.mjs)
uses that reconciliation and then strict population verification for every
shutdown observation, as well as before each signal. This conservatively stops
on the collected terminal transitions above. It is an operational limitation of
using the strict identity gate for waiting as well as signaling; it is not proof
that signal ownership checks are defective or should be relaxed.

The [consolidated diagnostic observer](../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs)
already separates observational findings from signal authority, but the legacy
maintenance wait path does not use that separation. Its safe diagnostic behavior
cannot simply be substituted for a signal verifier. It also cannot classify the
older helper sample definitively because required fields are missing.

**Recommendation: complete a separately scoped source-only maintenance
observation refinement before another automated maintenance attempt.** Keep
current code and signal policy unchanged in this review. The next source task
must make the observation/signal distinction explicit and independently test it.
The evidence supports this change without claiming to solve the historical cause.

## Refreshed ownership and preservation

Fresh bracketed identity/executable reads and independent Python process reads
match the nine original members: **30474, 30480, 30481, 30482, 30484, 30487,
30488, 30493 and 30528**. Leader 30474 has parent 1 and group 30474; helpers
retain their recorded topology, start-time metadata, command-derived identities,
canonical allowed Chrome executables and exact profile arguments. The sole
remaining active historical profile is
`803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571`.
Strict read-only target, population, canonical-directory and lock-ownership
validation passed. These observations authorize no later signal by themselves;
any later action requires new immediate verification.

The eighteen earlier captured PIDs under 30060/30082 are absent. PID **4303 is
absent** from both independent process reads and metadata and remains a forbidden
signal target. All **46 worker locks** match the prior validation snapshot,
including bytes/hash, inode, device, mode and exact integer nanosecond mtime.
There are no reclamation guards. The live singleton reference still points to
30474; the preservation preflight remains `historical_profiles_active`.

The stale worker lock is
`e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf.lock`.
Its bytes are `4303` and its metadata/hash still match the retained remaining
maintenance plan. The active profile's worker lock also remains untouched; its
stale worker-PID reference does not authorize a signal. No other stale lock is a
candidate for archival in the proposed maintenance scope.

Final independent preservation passed for **22,864 protected evidence files**,
**494 carts**, **37,368 business rows** across six databases, budgets and every
prior consumed record. Database deltas are empty: zero additions or changes,
including bookkeeping. Reserved exposure remains **$0.921518**. Complete initial
and final historical profile fingerprints differ in six entries, all within the
profile already active initially; no inactive profile changed. Active-profile
drift is observational and cannot constitute an idle or shutdown-only baseline.
The seventeen-file failed audit and all consumed attempts retain their bytes and
statuses. Source remains **577 files**, SHA-256
`8191b4c7d1dc1540d5db85d2dc65c70222fc51c1f8554fd675ede1da601c7894`.

## Next source-only task packet

Workstream **C4/M8**; one outcome: phase-aware maintenance shutdown observation
with persisted evidence, while preserving strict signal authorization.

- Persist complete scoped before/metadata/after inputs, separate start and
  command hashes, state/topology and canonical-executable evidence before
  evaluating admission, waiting or refusal decisions. Preserve primary failures
  and exact references separately from disposal/audit failures.
- Keep initial historical admission strict. During a bounded wait, record
  start-matched terminal text/zombie transitions as observations and require
  complete independently verifiable absence. Changed start times, ambiguous
  membership/topology, reappearance and incomplete collection still block.
- Before every individual signal, require the original captured identity,
  start time, canonical executable, exact profile, allowed topology and current
  ownership. Changed text or missing metadata cannot grant signal permission.
  PID 4303 and excluded historical instances remain forbidden. No group signals,
  adoption, deadline extension, settling policy or retry is added.
- Test the actual maintenance lifecycle with injected resource dependencies,
  persisted refusal inputs and independent auditing. Include the collected
  version-two transitions, unchanged strict signal refusals, start/PID reuse,
  new members, missing reads, bounded escalation, interruption, write/audit
  failures and primary-failure preservation. The retained version-one 30095
  observation must remain insufficient for a positive process-instance finding.
- Add no new CLI, task allowance, guard acquisition, profile access session or
  maintenance execution. Preserve both consumed maintenance policies and roots.
  Run focused checks and the source task's agreed frozen verification before
  proposing the next executable maintenance task.

## Later bounded maintenance plan

This is a proposal for a subsequent explicitly scoped task, not an execution
allowance created by this review. Its prerequisites include the source task's
offline proof and review of the new maintenance policy.

1. Bind a fresh private fixed root and one permanent invocation to **only the
   original nine-member 30474 instance** and the verified PID-4303 stale lock,
   using hashed historical evidence plus fresh complete identity, executable,
   profile, directory and lock checks. Exclude the eighteen already-closed PIDs;
   never substitute a process whose identity changed. Refuse arguments, root
   overrides, concurrency and reuse. Neither old maintenance runner can resume:
   their invocations are consumed and their 27/18-member admissions no longer fit.
2. Snapshot source, evidence, carts, databases, budgets, consumed records, all
   worker locks and complete profiles before preparation. Require unchanged
   frozen preparation logs. After exclusive attempt creation and successful
   target checks, acquire only the two task-owned guards for the active and
   stale-lock profiles. Revalidate source, targets, lock metadata and guard
   ownership immediately before consumption; refuse unknown ownership,
   PID-4303 reappearance or inactive-profile drift. Verify/release only those
   exact guards; a failed prerequisite must not consume the invocation.
3. Signal only the freshly verified owned leader with SIGTERM. Observe up to the
   existing five-second limit. If needed, only individually reverified surviving
   captured members may receive SIGKILL, with the existing five-second final
   wait. Never signal changed/unverified targets. Stop on the first unexpected
   condition, persist partial evidence, attempt all independent final audits and
   do not retry, restart or replace the attempt.
4. After independently verified complete historical process absence, freshly
   verify PID 4303 remains absent and stale-lock bytes/hash/inode/device/mode/mtime
   still match. Archive only that lock with exclusive creation and verified
   removal, preserving metadata and refusing an existing/replaced destination.
   Preserve all profiles and the other 45 worker locks. Chrome's removal of its
   own singleton and changes within the just-closed profile must be recorded
   explicitly; earlier closed or unrelated profiles receive no exception.
5. Independently require idle preflight and two complete equal profile
   fingerprints separated by at least five seconds after the first finishes,
   with idle/process/lock checks before, between and after. Audit zero database
   additions/changes, unchanged evidence/carts/budgets/prior consumption and exact
   archive/guard disposition. Publish a fresh baseline only after every check
   passes. Failure retains a blocked report and grants no second invocation.

A passing future maintenance outcome would unblock consideration of a separately
scoped fresh complete offline acceptance gate. It would not close C4/M8 or
authorize supplier access, paid inference or a purchase. Earlier timeout,
startup-refusal and seventeen-file preservation failures remain retained.

## Verification and handoff

The read-only Node comparison and independent Python audit passed: all twelve
retained real cases, four signatures, signal boundaries, fixture absence, nine
historical identities, eighteen closed historical PIDs, all 46 exact lock
metadata records and PID-4303 absence. The collector's first millisecond-mtime
comparison lost floating-point precision; initial artifacts were retained and
the exact Python integer-nanosecond audit passed. No lock change is inferred from
that collector error.

`pnpm test po-cart-legacy-verification po-cart-remaining-profile-cleanup
po-cart-shutdown-observation` passed **three simulated suites** in this worktree.
These exercised existing behavior without real signals or browser launches.
Type checking, full tests, build, migrations and HTTP smoke were not rerun for
this documentation-only review. The prior validation's 103-suite preparation
remains historical evidence, not a new pipeline claim.

`git diff --check`, changed-relative-link checks, documentation self-review and
unchanged-checklist checks passed. Private references include `ownership-observation-before.json`,
`ownership-decision.json`, `independent-process-bracket.json`,
`independent-review-audit.json`, `comparison.json`,
`strict-verdict-comparison.json`, `preservation-summary.json`,
`historical-profiles-before.json`, `historical-profiles-after.json`,
`concurrent-active-profile-drift.json`, before-images and focused logs.
Only this report, current status and roadmap documentation change. There are no
public or downstream domain-contract changes. Rollback restores the two
documentation before-images and removes this report; all runtime evidence,
consumed attempts, locks, profiles and business state must remain retained.
