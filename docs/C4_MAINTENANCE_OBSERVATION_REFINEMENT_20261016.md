# C4 maintenance observation refinement — 2026-10-16

This source-only C4 task implements the next step from the
[historical shutdown review](C4_HISTORICAL_SHUTDOWN_REVIEW_20261016.md).
Its one outcome is persisted, phase-aware maintenance shutdown observation with
strict signal authorization. **C4/M8 and historical causes remain open.**

## Plan and completion contract

1. Preserve inherited source, historical evidence, carts, databases, budgets,
   consumed records, process identities, locks and complete profile fingerprints.
2. Persist version-two scoped process inputs before evaluating strict or shutdown
   decisions. Keep start/command hashes, topology, state and executable/canonical
   evidence separate; preserve primary failures and exact references.
3. Separate bounded waiting from strict pre-signal verification. Keep initial
   target admission and every individual signal strict. Add no retry, settling
   policy, deadline extension or execution allowance.
4. Exercise the actual maintenance lifecycle with injected process dependencies
   and independent auditing, including retained collected transitions and
   insufficient historical evidence. Run focused suites and frozen type checking,
   full tests and build, then independently verify preservation.

No historical browser, profile, worker lock, guard or consumed attempt may be
changed. No new cleanup CLI, task consumption, idle baseline, acceptance gate,
paid inference, supplier access, purchase, deployment or power-setting change is
included. There are no public API, schema or migration changes. No credentials
or external services are needed for this source-only outcome.

## Implementation

The [maintenance observation module](../scripts/po-cart-worker/maintenance-shutdown-observation.mjs)
collects complete identity reads around executable metadata and records a
version-two sample before evaluating it. A separate ordered decision references
that sample. Collection failures retain their precise stage and partial inputs.
Failed sample persistence prevents evaluation; failed decision persistence blocks
progress and retains the primary refusal separately from the write failure.
Missing or invalid durable references cannot authorize progression.
Internal snapshot callers must supply a recording callback that returns a
persisted `observations/NNNNNN.json` reference; this narrows the script helper
contract without changing any application API.

Reports include only scoped numeric identifiers, known profile keys, hashes,
state, topology and executable/canonical-path evidence. Raw commands, full
executable/profile paths, arbitrary exceptions and environment contents are
excluded. Canonical resolution failures during terminal observation are retained
as unavailable evidence and never grant signal permission.

The [existing maintenance module](../scripts/po-cart-worker/legacy-profile-cleanup.mjs)
uses the new collector for strict snapshots and a separate observer during its
existing five-second wait. Historical admission now retains independently read
start/command hashes in its captured baseline. A shutdown wait may retain
start-matched terminal text, zombie and executable-text findings while continuing
to complete final-read absence. An unchanged live member missing metadata still
blocks. Changed starts, unexpected topology/membership, incomplete reads and
reappearance block; previously observed absent PIDs cannot be accepted again,
including metadata-only appearances.

The signal function, strict reconciliation helper, durable consumption and
archival primitive are byte-for-byte unchanged. Every signal still uses fresh
strict reconciliation and population checks twice, with durable intent between
them. The strict collector additionally requires canonical executable evidence.
Interruption, source, directories and ownership are rechecked after evidence
writes as well as before collection. Wait/escalation limits remain five seconds
plus five seconds. Existing injected snapshots without the separate wait
collector retain their stricter behavior; production supplies both collectors.

The [independent Python auditor](../scripts/po-cart-worker/maintenance-observation-audit.py)
recomputes observation decisions, verifies sample-before-decision ordering and
baseline enrichment from proved admission metadata, tracks absence across reads,
and requires fresh strict verification before intent and again before a signal.
It rejects forbidden targets, missing final absence, false completion and replaced
primary failures. Simulated origins remain explicit and cannot satisfy its
collected-evidence requirement. It is an offline audit API and adds no executable
maintenance runner or invocation binding.

## Verification evidence and limits

The [actual-lifecycle suite](../tests/po-cart-maintenance-lifecycle.mjs) uses real
temporary profiles, locks, owned guards, target validation, the maintenance loop,
strict collector and report persistence with injected process reads/signals and
clocks. **32 simulated lifecycles** cover terminal text/zombie transitions,
graceful exit, bounded escalation/timeout, changed starts, topology/new members,
forbidden PID and metadata-only appearances, reappearance, incomplete reads,
canonical executable changes, source/interruption during durable rechecks,
write/signal failures and preservation of primary failures through write/audit
errors. There are no real browser launches or process signals in these tests.

The [sanitized retained fixture](../tests/fixtures/po-cart-maintenance-transitions.json)
contains five collected version-two transition samples with original references
and hashes. Both analyzers accept their wait findings and reject them for strict
signal authority. The original version-one 30095 observation, including an
attempted version-number-only upgrade, remains insufficient for a positive
process-instance finding. No missing historical start, command or canonical
evidence was invented. Nine mutated-proof scenarios reject downgraded evidence,
false decisions/absence, changed starts, forbidden signals, missing post-intent
rechecks, changed profile claims, reordered inputs and primary-failure replacement.

Nine focused suites passed: `po-cart-maintenance-lifecycle`,
`po-cart-legacy-verification`, `po-cart-legacy-profile-cleanup`,
`po-cart-remaining-profile-cleanup`, `po-cart-profile-preflight`,
`po-cart-shutdown-observation`, `po-cart-browser-lifecycle`,
`po-cart-browser-lifecycle-validation` and `po-cart-shutdown-matrix`.
The command was `pnpm test` followed by those nine suite names.

| Final frozen-source command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **104 suites** |
| `pnpm build` | Passed |

The final snapshot contains **581 source files**, SHA-256
`637d00c651bb6e58dd516cec8d9494cf6abef4c61b5b88b7b365f884b1633547`.
Logs and their source-before/source-after hashes are bound in
`verification-final/pipeline.json`. An earlier successful pass is retained
separately: self-review subsequently added explicit profile and full-admission
checks to the independent auditor, and the focused/full checks were rerun on the
final source above. The earlier pass is not substituted for final verification.
Eight representative final-source simulated proofs are retained privately and
independently audited, including primary/write/audit failure combinations; all
are rejected when collected evidence is required.

Independent preservation passed for **22,905 protected evidence files**, **494
carts**, **37,368 business rows** across six databases and every prior consumed
record. All database deltas are empty, including bookkeeping; there are zero
additions or changes. Budgets remain unchanged, with **$0.921518** reserved.
All **46 worker locks** retain their bytes, inode/device, mode and exact mtime.
The nine historical process identities and live singleton reference under 30474
are unchanged; PID 4303 remains absent and untouched. Six profile fingerprint
differences are confined to the profile already active initially; no inactive
profile changed. Preflight remains `historical_profiles_active`, and no idle or
shutdown-only stability claim is made. Earlier failed reports and consumed
maintenance/diagnostic attempts retain their original bytes and statuses.

`git diff --check`, new-file whitespace, changed-relative-link and unchanged
checklist checks passed. `pnpm db:check`, `pnpm db:migrate:local` and
`pnpm test:local` were not run: this source-only process/evidence change has no
schema, API or application workflow change. No six-command local pipeline or
new real-browser validation is claimed. This proof does not establish a
historical cause or guarantee that later macOS maintenance encounters no new
behavior.

Private preparation, before-images, policy comparison, simulated proof and audit
artifacts are retained at
`.sites-runtime/po-cart-workers/maintenance-observation-source-task-20261016/`.
Both consumed maintenance roots and every prior failed report remain unchanged.
Rollback restores this task's declared source/documentation before-images and
removes its new files; it must retain runtime evidence, consumed records,
historical profiles, locks, carts, holds and budgets.

The next separately scoped C4 outcome is the review's one-instance/stale-lock
maintenance plan, with a fresh fixed binding, immediate ownership verification,
collected version-two evidence and independent idle/stability/preservation gates.
No such runner, allowance, cleanup or baseline is created here.
