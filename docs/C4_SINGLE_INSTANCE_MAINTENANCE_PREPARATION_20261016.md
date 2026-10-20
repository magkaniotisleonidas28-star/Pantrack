# C4 single-instance maintenance preparation — 2026-10-16

This is Lane A of the [parallel preparation packet](C4_PARALLEL_IMPLEMENTATION_HANDOFF_20261016.md).
Its one reviewable outcome is a fixed runner, historical target binding and
independent adapter tested offline. The [source-only observation refinement](C4_MAINTENANCE_OBSERVATION_REFINEMENT_20261016.md)
is the prerequisite; the [historical review](C4_HISTORICAL_SHUTDOWN_REVIEW_20261016.md)
defines the eventual operation. **C4/M8 and historical causes remain open.**

## Plan and observable completion

1. Snapshot inherited source, protected evidence, carts, all database rows,
   budgets, consumed records, lock metadata, historical process identities and
   complete profile fingerprints. Preserve Lane B's files and API contract.
2. Add a fresh fixed binding for only the original nine members under 30474 and
   the one verified PID-4303 stale lock. Preserve nanosecond lock metadata and
   reject changed historical hashes, membership, ownership, source or preparation.
3. Reuse strict signal, bounded shutdown, consumption and archive primitives.
   Persist ordered version-two samples/decisions and durable intent, preserve the
   primary failure, and attempt every independent final audit after partial work.
4. Independently bind root/policy/source/history and collected lifecycle evidence;
   require exact lock/guard disposition, zero database changes and idle/stability
   gates before any future fresh-baseline publication.
5. Exercise the actual controller and resources with injected dependencies,
   including refusal, concurrent/repeated invocation, interruption, archive races,
   partial auditing and false-success rejection. Run focused checks and frozen
   type checking, full tests and build; independently verify preservation.

The proposed future execution binding is
`.sites-runtime/po-cart-workers/single-instance-maintenance-task-20261016/`, policy
`fixed-single-instance-maintenance-20261016`. This source task must not create that
root, an execution allowance, guards, a consumed invocation or a fresh baseline.
It must not launch, connect to or signal real browsers or archive historical locks.
All lifecycle tests use temporary directories and injected process dependencies.
There are no public API, schema or migration changes, paid calls, supplier access,
purchases, deployments or power-setting changes.

Private preparation and verification belong only to the separate source-task
root `.sites-runtime/po-cart-workers/single-instance-maintenance-source-task-20261016/`.
Completion of this packet proves source behavior locally; final combined
verification awaits selective integration of Lane B if its handoff is not yet
available. No historical idle or operational acceptance claim follows.

## Implementation

The [fixed entrypoint](../scripts/po-cart-single-instance-maintenance.mjs) accepts
no arguments, filters, root overrides or resume. Its [internal controller](../scripts/po-cart-worker/single-instance-maintenance.mjs)
admits only the original nine PID/identity records under 30474, with hashed
historical evidence and exact nanosecond stale-lock metadata. PID 4303 and the
eighteen already-closed historical members remain excluded. Report creation and
durable consumption reuse the existing exclusive primitives. A losing or repeated
launcher never enters finalization or changes the winning attempt's evidence.

New evidence files cannot replace existing files, follow evidence-directory
symlinks or overwrite another owner's file. Ordered timeline persistence precedes
decision progression. Absence tracking continues through shutdown, archival and
final cleanup reads. Source, interruption, root, directory, guard and lock checks
surround collection and evidence writes. A stale-lock change or racing archive
blocks further signals. Only two owned guards may be acquired; release never
removes a replaced guard.

The signal, strict reconciliation, bounded shutdown, consumption and archival
primitives are byte-for-byte unchanged. There are no group signals, target
adoption, retries, settling periods or deadline extensions. Existing five-second
waits remain unchanged. Every operational failure retains the first failure and
its evidence reference; final local, persistence, independent and source checks
are attempted separately. The independent adapter reads exclusive fallback
reports when a failed report update retained the primary there.

The [fixed Python adapter](../scripts/po-cart-worker/single-instance-maintenance-audit.py)
independently checks the private root identity, policy, historical hashes, exact
captured boundary, frozen source and successful three-command preparation logs.
It requires collected version-two lifecycle proof through Lane B's existing
stable API, and separately rejects repeated/out-of-phase signal actions, false
closure and archive events. It checks complete process reads around metadata,
including transient forbidden/excluded PID appearances, pinned canonical
executables, profile ownership and all 46 exact lock records.

All independent final groups are attempted after partial failure. Successful
baseline publication additionally requires exact archive/guard disposition,
unchanged protected evidence/carts/budgets/prior consumption, zero database
additions or changes including bookkeeping, idle checks around two equal complete
fingerprints and a second capture starting at least five seconds after the first
finishes. Process, lock, preservation and source checks repeat after hashing.
An original singleton reference retained after forced exit is never removed by
the auditor; if present it must retain the captured ownership metadata, while
complete process absence remains a separate requirement.

Future preparation must populate the fixed execution root with the captured
before-images and preservation inputs, `source-frozen.json`, `pipeline.json`
and private `verification/typecheck.log`, `verification/test.log` and
`verification/build.log` with matching frozen-source hashes. The controller does
not prepare those files automatically. This task does not create that root or
authorize its execution.

## Offline verification

The [new focused suite](../tests/po-cart-single-instance-maintenance.mjs) exercises
21 injected controller modes plus concurrency, reuse and evidence ownership.
It uses real temporary profiles, worker locks, singleton references, guard
acquisition/release, exclusive reports, durable consumption and archival with
injected process reads/signals/clocks. Coverage includes graceful/terminal exit,
escalation/timeout, start/membership changes, interruption/source changes after
intent, forbidden PID appearance, write failures, guard replacement, changed
stale-lock bytes, racing archives and independent final failures. No real process
signal or browser launch occurs.

Independent offline checks cover matching/mutated fixed bindings, 46 exact worker
locks, two owned guards, one-nanosecond mismatch, fresh ownership changes,
transient PID appearances in any read, unsafe/inactive profile changes,
insufficient fingerprint intervals, unstable hashes, late source failure and
primary-failure preservation. Simulated proofs cannot pass the collected gate.

Ten focused suites passed: the new suite plus the nine suites from the prior
maintenance observation task. Frozen verification then passed:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **105 suites** |
| `pnpm build` | Passed |

The frozen Lane A snapshot contains **585 source files**, SHA-256
`9e77df4716d31d03c551f29b8ba0941f25472c26f138cd0134b1d1ef92ebecbc`.
`verification-final/pipeline.json` binds successful logs and before/after hashes.
Eight representative relocated simulated proofs are retained under
`offline-proof/`; `offline-proof-audit.json` records all eight valid offline
audits, collected-gate rejection and retained primary failures. Relocated proof
paths are for offline review and cannot establish live resource ownership or
production invocation binding.

`pnpm db:check`, `pnpm db:migrate:local` and `pnpm test:local` were not run:
this source-only process harness adds no schema/API/application workflow and
does not authorize migrations or application HTTP smoke. No six-command pipeline
or collected historical-maintenance acceptance is claimed.

## Preservation

Independent final preservation passed for **23,366 protected evidence files**,
**494 carts**, **37,368 business rows** across six databases, budgets and all
prior consumed records. Database deltas are empty, including bookkeeping;
reserved exposure remains **$0.921518**. The nine historical identities and all
46 worker-lock bytes/metadata remain unchanged. PID 4303 is absent and untouched.
Seven complete-profile differences are confined to the profile already active
initially; no inactive profile changed. Preflight remains
`historical_profiles_active`, so no idle or strict historical-stability claim is
made. The earlier seventeen-file audit failure retains its original failed status.

The fixed execution root remains absent. There is no real invocation, signal,
archive, allowance or baseline. Retained offline proofs include simulated task
records created by the controller in temporary resources and subsequently
relocated for review; these records use simulated source/proof and cannot satisfy
the fixed real binding. `preservation-summary.json`, `unchanged-policy-review.json`
and `handoff-checks.json` retain the independent checks. Diff/new-file whitespace,
eleven changed relative links and unchanged milestone-checkbox checks passed.

## Handoff and limits

Lane A source implementation and its frozen checks are complete. At that handoff,
Lane B changes were separate and were not covered by the 105-suite result above.
The subsequent [combined integration](C4_MAINTENANCE_PARALLEL_INTEGRATION_20261016.md)
records selective integration, the stricter proof reassessment and a new frozen
106-suite pipeline. Both source lanes are now integrated. Real
one-instance/stale-lock maintenance remains a later explicitly scoped task, with
immediate revalidation. It would unblock consideration of a fresh full offline
gate, not close C4/M8.

Rollback restores this packet's declared source/documentation before-images and
removes its new files. It must retain all runtime evidence, consumed attempts,
historical profiles/locks, carts, business rows, holds and budgets.
