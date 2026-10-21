# C4 observation-baseline source — 2026-10-21

This source-only C4/M8 task is Task 1 of the [single-instance maintenance plan](C4_SINGLE_INSTANCE_MAINTENANCE_PLAN_20261021.md).
The plan's owner decisions retire the fixed single-instance runner unexecuted and
exclude stale-lock archival. The one reviewable outcome is a fixed, argument-free,
signal-free observation-baseline entrypoint and independent auditor, tested
offline. **C4/M8 remain open; historical causes remain unresolved.**

## Contract

- Reuse read-only primitives only: process snapshots, the historical profile
  preflight, exact lock metadata, complete profile fingerprints and the existing
  preservation audit. No signal, guard, consumption-record or archive path may be
  importable or callable.
- Bind a fixed root and policy. Require frozen `typecheck`/`test`/`build` logs on
  the then-current source. Refuse arguments, overrides, concurrency and reuse.
  Persist every read before evaluating it.
- Block on any historical or forbidden PID, historical descendant or profile
  reference. Block on any lock or guard change, a changed singleton, a non-idle
  preflight, unequal or too-close fingerprints, inactive-profile drift since
  2026-10-16, or a preservation change. There are no retries.
- Publish `fresh-baseline.json` only after every independent group passes.

The fixed future root is
`.sites-runtime/po-cart-workers/observation-baseline-task-20261021/`, with policy
`fixed-observation-baseline-20261021`. This task did not create that root, run
the entrypoint or publish a baseline. There are no application, API, schema,
migration, supplier, paid-model, purchasing, deployment or power-setting changes.

## Implementation

The [fixed entrypoint](../scripts/po-cart-observation-baseline.mjs) accepts no
arguments. Its [controller](../scripts/po-cart-worker/observation-baseline.mjs)
refuses a missing, symlinked, noncanonical or group/world-accessible root before
writing anything. Exclusive creation of `report.json` is the single-use invocation
record. A repeated or concurrent loser stops with `invocation_consumed` and leaves
the winner's evidence unchanged.

The controller validates the preparation logs against the current source. It then
loads the hash-bound historical evidence: 27 PIDs and 46 lock records with integer
nanosecond mtimes. Its collection takes these reads in order:

1. a bracketed process read;
2. the preflight;
3. all lock and guard files;
4. the retained 30474 `SingletonLock`;
5. a second process read.

Each read is written with exclusive creation before it is evaluated. Process
evidence keeps counts, PIDs, topology and command hashes, never raw commands, so
an unrelated process's arguments cannot reach the evidence. Source, root and
interruption checks follow every write. The first failure is retained with its
evidence reference.

The independent audit always runs last, after any partial failure, and reads the
saved report. A blocked collection therefore never yields a baseline. Acceptance
requires `report.json` status `complete` together with a passing
`verification-summary.json`.

The [Python auditor](../scripts/po-cart-worker/observation-baseline-audit.py)
accepts only `finish` and refuses optimized execution. It reuses only
`legacy-profile-audit.py`'s fingerprint and preservation functions. It
independently checks:

- report binding, phase and collected origin;
- frozen preparation;
- two complete process reads, including historical process groups and parents;
- all 46 locks, and that no guards exist;
- the singleton link hash;
- idle preflight before, between and after two equal fingerprints at least five
  seconds apart;
- that changes since the hash-bound 2026-10-16 fingerprint fall only inside
  `803d991d…`, with its `SingletonLock` unchanged;
- preservation, then final processes, locks, singleton, preservation and source.

Every group is attempted after a failure.

## Offline verification

The [focused suite](../tests/po-cart-observation-baseline.mjs) runs the actual
controller against temporary profiles, locks, singleton links and private roots,
with injected process and preflight reads. `process.kill` is replaced with a
recorder that throws; it recorded no calls. Covered cases:

- a passing run, reuse and a concurrent race;
- missing and unsafe roots;
- reappearance, PID reuse with a changed start, PID 4303 and a profile reference;
- unavailable reads, a live-lock flip and interruption;
- source change after preparation and tampered logs;
- changed lock bytes or mtime, an added guard and a removed lock;
- a retargeted or missing singleton;
- evidence and final-report write failures;
- audit failure or exception, and primary-failure preservation.

Profile trees are byte- and metadata-identical after every case, and no
`TOKEN_MUST_NOT_LOG` text reaches evidence. A static check confirms that the
controller, CLI and auditor reference no signal, guard, consumption, archive,
removal or rename primitive. Thirteen auditor cases cover binding, processes,
locks, the singleton, stability, drift and publication. Three planted defects
were caught by the suite: a removed process gate, a verdict ignoring the audit,
and an allowed singleton drift. The second was caught only after strengthening
the audit-failure assertions.

| Command | Result |
| --- | --- |
| `pnpm test po-cart-observation-baseline` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **109 suites** |
| `pnpm build` | Passed |

`pnpm db:check`, `pnpm db:migrate:local` and `pnpm test:local` were not run. This
process/evidence harness adds no schema, API or application workflow. No
six-command pipeline is claimed.

The full test run added new attempt records under 14 new `po-cart-workers/ai-evaluation`
directories and regenerated `.sites-runtime/*.mjs` harness modules, as existing
suites do. It changed no older file there and added no `task.json` or
`allowance.json`. No independent preservation audit was run for this source task.

## Database inventory correction

Task 2's first preparation exposed a scope gap in this auditor's database
inventory. It enumerated SQLite files only under `.wrangler/state` and
`.sites-runtime/po-cart-workers`. That missed `.sites-runtime/cart-review-state/`,
which holds 35,513 of the 37,368 historical business rows in the earlier
six-database preservation scope, as well as other local review states. A
read-only comparison found the cart-review data unchanged since 2026-10-16.

The auditor now inventories every `*.sqlite` under `.wrangler/state` and the
whole of `.sites-runtime`. Any database added or removed after capture fails
preservation. A focused case shows that adding or removing a cart-review database
fails. A static assertion pins the scope; reverting it to the narrower scope makes
the suite fail. The uninvoked first preparation was moved aside unchanged, and
Task 2 reprepares on the corrected source. No invocation was consumed.

The second preparation's capture then found five WAL-format database copies
without `-wal`/`-shm` sidecars. Four are backups under
`.sites-runtime/checkout-sync-20261007/` and one is under `po-review-state`.
Plain `mode=ro` cannot open them, and the shared
`legacy-profile-audit.py` used that mode. Its new `open_readonly` helper opens
only such sidecar-less copies with `immutable=1`. They hold no uncommitted
frames, and every other database opens exactly as before.

A focused case covers three behaviors. Plain mode fails on such a copy. The helper
reads it without creating sidecars. Rows that exist only in a live WAL stay
visible. All 118 local databases now open read-only. The partial, uninvoked
second preparation was also moved aside.

## Live read-only dry check

Without creating the fixed root, the auditor's read-only groups were run against
current machine state:

- all 27 historical PIDs and PID 4303 are absent;
- all 46 locks are exact, and the original singleton is retained;
- preflight is `idle` with 1,434 profiles;
- two complete fingerprints of 353,361 entries, taken 5.46 seconds apart, are
  equal;
- eleven changes since 2026-10-16 all fall inside `803d991d…`, and none is
  inactive.

This shows Task 2 is currently feasible. **It is not collected evidence and
publishes no baseline.**

## Task 2 preparation and handoff

The separately authorized run must:

1. Create the fixed root with mode `0700`.
2. Run `typecheck`, `test` and `build` on the frozen current source, writing
   `source-frozen.json`, `pipeline.json` and the private `verification/*.log`.
   The full suite adds evaluation records, so it must finish before the
   before-images are captured.
3. Capture `baseline.json` (protected evidence, excluding the fixed root),
   `storefront-before.json`, `database-before.json`, `source-before.json` and
   `rollback-manifest.json`, the last with empty `restore`/`remove`.
4. Repeat the read-only checks, then invoke `node scripts/po-cart-observation-baseline.mjs`
   exactly once.

Any reappearance, a non-idle read or a lock difference stops the run and returns
it to planning. A failure retains a blocked report and grants no second invocation.

A passing baseline would unblock consideration of a separately scoped fresh full
offline acceptance gate. It would not close C4/M8 or explain the earlier timeout,
startup-refusal or seventeen-file preservation failures.

Rollback removes the four new source files and this report and restores the
status/roadmap paragraphs. No runtime evidence, profile, lock, cart, business
row, budget or consumed record was changed by this task.
